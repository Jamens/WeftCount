/**
 * 极简 CSV 工具（零依赖）
 *
 * 导入/模板用 CSV：Excel/WPS 原生可开可编辑，解析零风险（xlsx 需解压+XML 解析，复杂度高）。
 * 导出报表用 xlsx（见 xlsx.ts），更好看。
 */

/** 解析 CSV 文本 → 二维数组（支持双引号包裹、字段内逗号/换行/转义引号 ""） */
export function parseCsv(text: string): string[][] {
  // 去掉 UTF-8 BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      // 跳过完全空行
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else field += ch
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/** 二维数组 → CSV 文本（可选 UTF-8 BOM，Excel 中文不乱码需开启） */
export function toCsv(rows: (string | number | null | undefined)[][], withBom = true): string {
  const body = rows
    .map((r) =>
      r
        .map((c) => {
          const v = c === null || c === undefined ? '' : String(c)
          return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
        })
        .join(','),
    )
    .join('\r\n')
  return (withBom ? '\uFEFF' : '') + body
}
