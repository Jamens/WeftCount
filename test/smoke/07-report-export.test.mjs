// 通用报表导出：清单 / 逐个报表可导出 / 权限隔离 / 非法 key 被拒
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { login, get, BASE } from './helpers.mjs'

/** 带鉴权拿原始响应（导出不是 JSON envelope） */
async function raw(client, path) {
  const r = await fetch(BASE + '/api' + path, { headers: client.headers })
  return r
}

/** 断言是合法 xlsx：zip 头 + 含 sheet1.xml */
async function assertXlsx(res, label) {
  assert.equal(res.status, 200, `${label} 应返回 200，实际 ${res.status}`)
  assert.match(res.headers.get('content-type') ?? '', /spreadsheetml/, `${label} 应是 xlsx 类型`)
  assert.match(res.headers.get('content-disposition') ?? '', /attachment/, `${label} 应是附件下载`)
  const buf = Buffer.from(await res.arrayBuffer())
  assert.ok(buf.length > 0, `${label} 文件非空`)
  assert.equal(buf[0], 0x50, `${label} zip 头 P`)
  assert.equal(buf[1], 0x4b, `${label} zip 头 K`)
  assert.match(buf.toString('latin1'), /xl\/worksheets\/sheet1\.xml/, `${label} 应含 sheet1.xml`)
  return buf
}

/** 全部已注册报表的 key（与后端 REPORTS 一致） */
const ALL_KEYS = [
  'inventory-batches', 'inventory-transactions', 'inventory-documents', 'rolls',
  'materials', 'specs', 'warehouses', 'orders',
  'production-orders', 'production-reports', 'cost', 'trends',
  'stocktakes', 'audit-logs',
]

test('报表清单可获取且覆盖全部已注册报表', async () => {
  const c = await login('factory')
  const list = await get(c, '/import-export/reports')
  assert.ok(Array.isArray(list), '应返回数组')
  const keys = list.map((r) => r.key)
  for (const k of ALL_KEYS) {
    assert.ok(keys.includes(k), `清单应含报表 ${k}`)
  }
  for (const r of list) {
    assert.ok(r.label, `${r.key} 应有中文名`)
    assert.ok(r.description, `${r.key} 应有说明`)
    assert.equal(typeof r.supportsDays, 'boolean', `${r.key} 应声明是否支持时间窗`)
  }
})

test('全部报表均可导出为合法 XLSX，且行数头与文件一致', async () => {
  const c = await login('factory')
  for (const key of ALL_KEYS) {
    const res = await raw(c, `/import-export/reports/${key}/export`)
    const buf = await assertXlsx(res, key)
    // X-Row-Count 是给前端提示用的（读不到 xlsx 内部），校验它确实是数字且非负
    const rowCount = Number(res.headers.get('x-row-count'))
    assert.ok(Number.isFinite(rowCount) && rowCount >= 0, `${key} 应返回行数头，实际 ${res.headers.get('x-row-count')}`)
    // 行数不应超过文件可容纳的规模（防行数头虚报）
    assert.ok(rowCount * 10 < buf.length || rowCount === 0, `${key} 行数(${rowCount})与文件大小(${buf.length})明显不符`)
  }
})

test('带时间窗导出可用（trends 近30天）', async () => {
  const c = await login('factory')
  const res = await raw(c, '/import-export/reports/trends/export?days=30')
  await assertXlsx(res, 'trends?days=30')
})

test('非法报表 key 被拒（400/404，不是静默空文件）', async () => {
  const c = await login('factory')
  for (const bad of ['not-exist', '../materials', 'materials;drop', 'Materials']) {
    const res = await raw(c, `/import-export/reports/${encodeURIComponent(bad)}/export`)
    assert.ok(res.status === 400 || res.status === 404, `非法 key「${bad}」应被拒，实际 ${res.status}`)
  }
})

test('权限隔离：只读账号导不了审计日志（缺 audit.view）', async () => {
  const c = await login('warehouse') // 仓管员：有 inventory.view，无 audit.view
  // 前端会隐藏入口，但真正的边界在服务端——直接调接口也必须被拒
  const res = await raw(c, '/import-export/reports/audit-logs/export')
  assert.equal(res.status, 403, `无 audit.view 导出审计日志应 403，实际 ${res.status}`)
  const body = await res.json()
  assert.match(body.message ?? '', /audit\.view/, '错误信息应指出缺少的权限')
})

test('权限隔离：库存报表按归属权限放行', async () => {
  const c = await login('warehouse')
  const res = await raw(c, '/import-export/reports/inventory-batches/export')
  await assertXlsx(res, 'inventory-batches（仓管员）')
})