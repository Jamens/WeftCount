// 导入导出：模板 / 批量导入(部分成功) / XLSX 导出
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { login, get, post, BASE } from './helpers.mjs'

// 带鉴权拿原始文本/字节（模板与导出不是 JSON envelope）
async function raw(client, path) {
  const r = await fetch(BASE + '/api' + path, { headers: client.headers })
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`)
  return r
}

test('物料/规格模板可下载且是 CSV', async () => {
  const c = await login('factory')
  for (const [path, must] of [['/import-export/materials/template', '物料名称*'], ['/import-export/specs/template', '规格名称*']]) {
    const res = await raw(c, path)
    assert.match(res.headers.get('content-type') ?? '', /text\/csv/, '应是 text/csv')
    assert.match(res.headers.get('content-disposition') ?? '', /attachment/, '应是附件下载')
    const text = await res.text()
    assert.match(text, new RegExp(must), `模板应含表头「${must}」`)
  }
})

test('物料批量导入：逐行校验，错误行不影响其他行', async () => {
  const c = await login('factory')
  const tag = Date.now()
  const csv = [
    '物料名称*,大类*,规格描述*,计量方式,主单位,安全库存,标准单价,备注',
    `冒烟纱${tag},纱线,40S,weight,kg,100,20,ok`,
    `冒烟坏类${tag},非法类,辅料,weight,kg,,,应失败`,
    `冒烟坯${tag},坯布,120x72,length,m,,,ok`,
  ].join('\n')
  const r = await post(c, '/import-export/materials/import', { csv })
  assert.equal(r.total, 3, '总行数应为 3')
  assert.equal(r.succeeded, 2, '应有 2 行成功')
  assert.equal(r.failed, 1, '应有 1 行失败')
  assert.equal(r.errors.length, 1)
  assert.equal(r.errors[0].row, 3, '错误应定位到第 3 行')
  assert.match(r.errors[0].message, /大类/, '错误原因应指出大类不合法')
})

test('规格批量导入成功', async () => {
  const c = await login('factory')
  const tag = Date.now()
  const csv = [
    '规格名称*,成品幅宽cm*,经密(根/英寸)*,纬密(根/英寸)*,组织,经纱支数*,经纱体系*,纬纱支数*,纬纱体系*,上机幅宽cm,加放量cm,经纱损耗率,纬纱损耗率,备注',
    `冒烟规格${tag},150,120,72,plain,40,NeS,40,NeS,150,10,0.055,0.05,ok`,
  ].join('\n')
  const r = await post(c, '/import-export/specs/import', { csv })
  assert.equal(r.succeeded, 1, '规格应导入成功')
  assert.equal(r.failed, 0)
})

test('导入表头缺必填列被拒', async () => {
  const c = await login('factory')
  await assert.rejects(() => post(c, '/import-export/materials/import', { csv: '错误列1,错误列2\r\na,b' }))
})

test('物料导出 XLSX 是合法 zip(含 sheet 数据)', async () => {
  const c = await login('factory')
  const res = await raw(c, '/import-export/materials/export')
  assert.match(res.headers.get('content-type') ?? '', /spreadsheetml/, '应是 xlsx 类型')
  const buf = Buffer.from(await res.arrayBuffer())
  assert.ok(buf.length > 0, '文件非空')
  assert.equal(buf[0], 0x50, 'zip 头 P')
  assert.equal(buf[1], 0x4b, 'zip 头 K')
  // xlsx 内含 worksheets/sheet1.xml
  const asText = buf.toString('latin1')
  assert.match(asText, /xl\/worksheets\/sheet1\.xml/, '应含 sheet1.xml')
})
