// 预警中心：扫描生成 / 去重 / 确认
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { login, get, post, activeSpec, activeGreigeMaterial } from './helpers.mjs'

test('预警扫描可执行并返回统计', async () => {
  const c = await login('factory')
  const r = await post(c, '/alerts/scan')
  assert.ok(typeof r.created === 'number', '应返回新增条数')
  assert.ok(r.stats, '应返回统计')
  assert.ok(typeof r.stats.orderOverdue === 'number' && typeof r.stats.lowStock === 'number', '统计应含逾期/低库存数')
})

test('预警列表结构完整', async () => {
  const c = await login('factory')
  const list = await get(c, '/alerts')
  assert.ok(Array.isArray(list), '应返回数组')
  for (const a of list) {
    assert.ok(['order_overdue', 'low_stock', 'stale_batch'].includes(a.type), `未知类型 ${a.type}`)
    assert.ok(['info', 'warning', 'critical'].includes(a.severity), `未知级别 ${a.severity}`)
    assert.ok(a.title && a.message && a.refId, '应有标题/详情/关联对象')
  }
})

test('预警去重：重复扫描不重复生成同类未确认预警', async () => {
  const c = await login('factory')
  await post(c, '/alerts/scan') // 先扫一次建立基线
  const before = (await get(c, '/alerts')).length
  const r = await post(c, '/alerts/scan') // 立刻再扫
  assert.equal(r.created, 0, '第二次扫描不应新增(已存在未确认的会被去重)')
  const after = (await get(c, '/alerts')).length
  assert.equal(after, before, '预警总数不应增长')
})

test('确认预警后角标递减', async () => {
  const c = await login('factory')
  const list = await get(c, '/alerts')
  if (!list.length) return // 无预警可确认
  const before = (await get(c, '/alerts/summary')).open
  await post(c, `/alerts/${list[0].id}/ack`)
  const after = (await get(c, '/alerts/summary')).open
  assert.equal(after, before - 1, '确认一条后未确认数应 -1')
})

test('逾期工单触发交期逾期预警', async () => {
  const c = await login('factory')
  const spec = await activeSpec(c)
  const mat = await activeGreigeMaterial(c)
  // 造一个交期已过的工单
  const past = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10)
  const wo = await post(c, '/production-orders', { materialId: mat.id, specId: spec.id, plannedQuantityM: 50, dueDate: past })
  await post(c, '/alerts/scan')
  const list = await get(c, '/alerts')
  const overdue = list.find((a) => a.type === 'order_overdue' && a.refId === wo.id)
  assert.ok(overdue, '应生成该逾期工单的预警')
  assert.match(overdue.title, new RegExp(wo.orderNo), '标题应含工单号')
})
