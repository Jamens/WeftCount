// 预警中心：扫描生成 / 去重 / 确认
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { login, get, post, activeSpec, activeGreigeMaterial, assertNear, firstMachine } from './helpers.mjs'

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

// ---- 趋势分析 ----

test('趋势聚合：日期序列连续且长度正确', async () => {
  const c = await login('factory')
  for (const days of [7, 30]) {
    const t = await get(c, `/analytics/trends?days=${days}`)
    assert.equal(t.days, days, '应返回请求的天数')
    assert.equal(t.daily.length, days, `daily 应有 ${days} 个点(缺失日期补0)`)
    // 日期应连续递增
    for (let i = 1; i < t.daily.length; i++) {
      const prev = new Date(t.daily[i - 1].date).getTime()
      const cur = new Date(t.daily[i].date).getTime()
      assert.equal(cur - prev, 86400000, '日期应逐日连续')
    }
  }
})

test('趋势聚合：结构完整且数值非负', async () => {
  const c = await login('factory')
  const t = await get(c, '/analytics/trends?days=30')
  for (const p of t.daily) {
    assert.ok(p.meters >= 0 && p.weightKg >= 0 && p.purchaseAmount >= 0 && p.salesAmount >= 0, '数值应非负')
  }
  assert.ok(t.totals, '应有合计')
  assert.ok(Array.isArray(t.specShare), '应有规格占比数组')
})

// ---- 趋势图表深化：损耗趋势 + 匹维度 ----

test('趋势：损耗段(投料vs产出vs累计损耗)与匹维度段结构完整', async () => {
  const c = await login('factory')
  const t = await get(c, '/analytics/trends?days=30')
  // 损耗段
  assert.ok(t.loss, '应有 loss 段')
  assert.equal(t.loss.daily.length, 30, '损耗应有30个日点')
  for (const p of t.loss.daily) {
    assert.ok(typeof p.inputM === 'number' && typeof p.outputM === 'number' && typeof p.cumulativeExcessM === 'number', '损耗点应含 inputM/outputM/cumulativeExcessM')
    assertNear(p.excessM, p.inputM - p.outputM, 0.01, '当日损耗应=投料-产出')
  }
  assert.ok(typeof t.loss.totalExcessM === 'number', '应有窗口累计损耗')
  // 匹维度段
  assert.ok(t.rolls, '应有 rolls 段')
  assert.equal(t.rolls.daily.length, 30, '匹数应有30个日点')
  for (const p of t.rolls.daily) {
    assert.ok(typeof p.produced === 'number' && typeof p.shipped === 'number', '匹数点应含 produced/shipped')
  }
  assert.ok(typeof t.rolls.inStock === 'number', '应有在库匹数')
  assert.ok(Array.isArray(t.rolls.machineTop), '应有机台产出Top数组')
})

// ---- 报工幂等（防重复计量） ----

test('报工幂等：同一 clientRequestId 重复提交只计量一次', async () => {
  const c = await login('factory')
  const spec = await activeSpec(c)
  const mat = await activeGreigeMaterial(c)
  const machine = await firstMachine(c)
  const wo = await post(c, '/production-orders', {
    materialId: mat.id, specId: spec.id, plannedQuantityM: 100, machineId: machine.id,
  })
  await post(c, `/production-orders/${wo.id}/schedule`, {})
  await post(c, `/production-orders/${wo.id}/start`, {})

  const cid = `smoke-idem-${Date.now()}`
  const r1 = await post(c, `/production-orders/${wo.id}/reports`, { outputM: 20, clientRequestId: cid })
  // 模拟网络重试/双击：同id 再提交一次
  const r2 = await post(c, `/production-orders/${wo.id}/reports`, { outputM: 20, clientRequestId: cid })

  assert.equal(r1.report.id, r2.report.id, '重复提交应返回首次那次的报工单')
  assert.equal(r2.batchId, r1.batchId, '不应新建第二个批次')
  // 产量只应累加一次
  const after = await get(c, `/production-orders/${wo.id}`)
  assertNear(Number(after.outputQuantityM), 20, 0.01, '产量应只计一次(20m)，不能是 40m')
})

test('报工不带幂等键时仍可正常报工(向后兼容)', async () => {
  const c = await login('factory')
  const spec = await activeSpec(c)
  const mat = await activeGreigeMaterial(c)
  const machine = await firstMachine(c)
  const wo = await post(c, '/production-orders', { materialId: mat.id, specId: spec.id, plannedQuantityM: 100, machineId: machine.id })
  await post(c, `/production-orders/${wo.id}/schedule`, {})
  await post(c, `/production-orders/${wo.id}/start`, {})
  const r = await post(c, `/production-orders/${wo.id}/reports`, { outputM: 30 })
  assert.ok(r.report.id, '不传幂等键也应能报工')
})
