/**
 * 极简 XLSX 写入器（零依赖）
 *
 * XLSX 本质是 zip 容器（PK\x03\x04 …），内含 xl/worksheets/sheet1.xml 等 XML。
 * 这里用 Node 内置 `zlib.deflateRawSync` 逐文件构造 zip，不引第三方库。
 * 只支持「表头 + 单元格字符串/数字」的单表，够用于导入模板与报表导出。
 *
 * 之所以自己写：项目坚持零新增依赖；且导出内容全部是确定性业务数据，无需通用表格库。
 */
import { deflateRawSync } from 'node:zlib'

export type XlsxCell = string | number | null | undefined

function crc32(buf: Buffer): number {
  let c: number
  const table = (crc32 as unknown as { table: number[] }).table ?? (() => {
    const t: number[] = []
    for (let n = 0; n < 256; n++) {
      c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      t[n] = c >>> 0
    }
    ;(crc32 as unknown as { table: number[] }).table = t
    return t
  })()
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff]
  return (crc ^ 0xffffffff) >>> 0
}

function zip(files: { name: string; data: Buffer }[]): Buffer {
  const chunks: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8')
    const deflated = deflateRawSync(f.data, { level: 6 })
    const crc = crc32(f.data)

    // local file header
    const lfh = Buffer.alloc(30)
    lfh.writeUInt32LE(0x04034b50, 0)
    lfh.writeUInt16LE(20, 4) // version needed
    lfh.writeUInt16LE(0, 6) // flags
    lfh.writeUInt16LE(8, 8) // deflate
    lfh.writeUInt16LE(0, 10) // time
    lfh.writeUInt16LE(0, 12) // date
    lfh.writeUInt32LE(crc, 14)
    lfh.writeUInt32LE(deflated.length, 18)
    lfh.writeUInt32LE(f.data.length, 22)
    lfh.writeUInt16LE(nameBuf.length, 26)
    lfh.writeUInt16LE(0, 28)
    chunks.push(lfh, nameBuf, deflated)

    // central directory header
    const cdh = Buffer.alloc(46)
    cdh.writeUInt32LE(0x02014b50, 0)
    cdh.writeUInt16LE(20, 4)
    cdh.writeUInt16LE(20, 6)
    cdh.writeUInt16LE(0, 8)
    cdh.writeUInt16LE(8, 10)
    cdh.writeUInt16LE(0, 12)
    cdh.writeUInt16LE(0, 14)
    cdh.writeUInt32LE(crc, 16)
    cdh.writeUInt32LE(deflated.length, 20)
    cdh.writeUInt32LE(f.data.length, 24)
    cdh.writeUInt16LE(nameBuf.length, 28)
    cdh.writeUInt32LE(0, 38) // external attrs
    cdh.writeUInt32LE(offset, 42)
    central.push(Buffer.concat([cdh, nameBuf]))

    offset += lfh.length + nameBuf.length + deflated.length
  }
  const cdBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(cdBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...chunks, cdBuf, eocd])
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function colName(i: number): string {
  let s = ''
  let n = i
  do {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return s
}

/** 生成 xlsx Buffer：header 为表头行，rows 为数据行 */
export function buildXlsx(header: string[], rows: XlsxCell[][]): Buffer {
  const cellXml = (v: XlsxCell, ri: number, ci: number): string => {
    const ref = `${colName(ci)}${ri}`
    if (v === null || v === undefined || v === '') return `<c r="${ref}"/>`
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`
  }
  const lines: string[] = []
  lines.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')
  lines.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>')
  lines.push(`<row r="1">${header.map((h, i) => cellXml(h, 1, i)).join('')}</row>`)
  rows.forEach((r, ri) => {
    const rn = ri + 2
    lines.push(`<row r="${rn}">${r.map((c, ci) => cellXml(c, rn, ci)).join('')}</row>`)
  })
  lines.push('</sheetData></worksheet>')

  const files = [
    {
      name: '[Content_Types].xml',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          '</Types>',
        'utf8',
      ),
    },
    {
      name: '_rels/.rels',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          '</Relationships>',
        'utf8',
      ),
    },
    {
      name: 'xl/workbook.xml',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
        'utf8',
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
          '</Relationships>',
        'utf8',
      ),
    },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(lines.join(''), 'utf8') },
  ]
  return zip(files)
}
