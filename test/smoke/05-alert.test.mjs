// 预警中心：扫描生成 / 去重 / 确认
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { login, get, post, activeSpec, activeGreigeMaterial, assertNear, firstMachine, supplierOf, customerOf } from './helpers.mjs'

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

// ---- 补货建议（真实消耗驱动，不拍脑袋） ----

test('补货建议：按真实出库流水算日均用量并给出建议补货量', async () => {
  const c = await login('factory')
  const spec = await activeSpec(c)
  const sup = await supplierOf(c)
  const cus = await customerOf(c)
  const tag = Date.now()
  // 建一个**专用物料**并设安全库存+提前期（不碰其它用例用的物料）
  const mat = await post(c, '/materials', {
    name: `补货测试料${tag}`, category: 'greige', specification: '测试',
    safetyStock: 900, leadTimeDays: 10,
  })
  // 入库 200m（低于补货点：日均 600/30=20 → 补货点=20*(10+10)+900=1300）
  await post(c, '/inventory/purchase-inbound', {
    materialId: mat.id, specId: spec.id, enteredUnit: 'm', enteredValue: 200,
    unitPrice: 8.2, partnerId: sup.id,
  })
  // 造出库消耗：先入库 600m，再卖 600m → 观察窗口日均 = 600/30 = 20/天
  await post(c, '/inventory/purchase-inbound', {
    materialId: mat.id, specId: spec.id, enteredUnit: 'm', enteredValue: 600,
    unitPrice: 8.2, partnerId: sup.id,
  })
  await post(c, '/inventory/sales-outbound', {
    materialId: mat.id, specId: spec.id, enteredUnit: 'm', enteredValue: 600,
    unitPrice: 9.5, partnerId: cus.id,
  })
  await post(c, '/alerts/scan')
  const mine = (await get(c, '/alerts')).find((a) => a.type === 'low_stock' && a.refId === mat.id)
  assert.ok(mine, '该物料应触发低库存/补货预警')
  assert.ok(mine.data, '预警应带结构化 data（补货建议）')
  const d = mine.data
  assert.ok(d.suggestQty != null, '应含建议补货量')
  assert.ok(d.reorderPoint != null, '应含补货点')
  assert.ok(d.basis && d.basis.length > 0, '应含可人工核对的依据')
  assert.ok(!mine.message.includes('undefined'), '文案不应出现 undefined')
  // 日均 = 600/30 = 20；补货点 = 20*(10+10) + 900 = 1300
  const daily = 600 / 30
  assertNear(Number(d.dailyUsage), daily, 0.01, '日均用量应来自真实出库流水')
  assertNear(Number(d.reorderPoint), daily * 20 + 900, 0.01, '补货点 = 日均×(提前期+周期)+安全库存')
  assert.ok(Number(d.suggestQty) > 0, '库存低于补货点应给出正的建议补货量')
})

// ---- 预警一键生成采购订单 ----

test('预警→采购单：按建议生成采购订单，同一预警不可重复生成', async () => {
  const c = await login('factory')
  const spec = await activeSpec(c)
  const sup = await supplierOf(c)
  const cus = await customerOf(c)
  const tag = Date.now()
  const mat = await post(c, '/materials', {
    name: `转单测试料${tag}`, category: 'greige', specification: '测试',
    safetyStock: 900, leadTimeDays: 10, standardPrice: 9.9,
  })
  // 造消耗：入库 600 → 卖 600（产生日均 20/天）与一条现存批次
  await post(c, '/inventory/purchase-inbound', {
    materialId: mat.id, specId: spec.id, enteredUnit: 'm', enteredValue: 600,
    unitPrice: 8.2, partnerId: sup.id,
  })
  await post(c, '/inventory/sales-outbound', {
    materialId: mat.id, specId: spec.id, enteredUnit: 'm', enteredValue: 600,
    unitPrice: 9.5, partnerId: cus.id,
  })
  await post(c, '/alerts/scan')
  const alert = (await get(c, '/alerts')).find((a) => a.type === 'low_stock' && a.refId === mat.id)
  assert.ok(alert, '应有低库存预警')

  // 一键生成采购单
  const order = await post(c, `/orders/from-alert/${alert.id}`, {})
  assert.ok(order.orderNo, '应生成采购订单号')
  assert.equal(order.orderType, 'purchase', '应为采购订单')
  assert.equal(order.status, 'draft', '应为草稿（需人工确认）')
  // 数量 = 建议补货量
  const suggestQty = Number(alert.data.suggestQty)
  assertNear(Number(order.totalQuantityM), suggestQty, 0.01, '订单数量应等于建议补货量')
  // 交期 = 今天 + 提前期 10 天。**必须按本地时区算日期**：
  // toISOString() 是 UTC，凌晨时段会差一天（服务端 dayjs 用本地时间，是对的）
  const exp = (() => {
    const d = new Date()
    d.setDate(d.getDate() + 10)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()
  assert.equal(order.expectedDate, exp, '交期应为今天+采购提前期(10天)')
  // 明细带规格与单价
  const detail = await get(c, `/orders/${order.id}`)
  assert.equal(detail.items.length, 1, '应有一条明细')
  assert.equal(detail.items[0].specId, spec.id, '规格应取该物料历史入库所用规格')
  assertNear(Number(detail.items[0].unitPrice), 9.9, 0.01, '单价应取物料标准价')
  assert.ok(String(detail.remark ?? order.remark).includes('补货预警'), '备注应记录建议来源')

  // 防重复：同一预警再生成应被拒
  await assert.rejects(() => post(c, `/orders/from-alert/${alert.id}`, {}))
})

// ---- 确认(ack) 的静默期：确认后不该立刻又冒出来 ----

test('预警确认后进入静默期：重复扫描不再新建（否则「确认」像没反应）', async () => {
  const c = await login('factory')
  const spec = await activeSpec(c)
  const sup = await supplierOf(c)
  const tag = Date.now()
  const mat = await post(c, '/materials', {
    name: `静默测试料${tag}`, category: 'greige', specification: '测试',
    safetyStock: 500, leadTimeDays: 7,
  })
  await post(c, '/inventory/purchase-inbound', {
    materialId: mat.id, specId: spec.id, enteredUnit: 'm', enteredValue: 100,
    unitPrice: 8, partnerId: sup.id,
  })

  await post(c, '/alerts/scan')
  const a = (await get(c, '/alerts')).find((x) => x.refId === mat.id)
  assert.ok(a, '库存远低于补货点，应触发预警')

  // 规则1：已有未确认 → 不重复建
  await post(c, '/alerts/scan')
  assert.equal(
    (await get(c, '/alerts')).filter((x) => x.refId === mat.id).length,
    1, '有未确认预警时不应重复创建',
  )

  // 规则2：确认后进入静默期 → 不再新建
  await post(c, `/alerts/${a.id}/ack`, {})
  assert.equal(
    (await get(c, '/alerts')).filter((x) => x.refId === mat.id).length,
    0, '确认后应从未确认列表消失',
  )
  await post(c, '/alerts/scan')
  assert.equal(
    (await get(c, '/alerts')).filter((x) => x.refId === mat.id).length,
    0, '确认后静默期内重复扫描不应再冒出来（否则「确认」等于没反应）',
  )
})
