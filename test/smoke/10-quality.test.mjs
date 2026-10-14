// 质检：坯布检验分等 + 销售出库按品等计价
//
// 重点覆盖「分等的最后一公里」——只建质检模块而不接计价，等级就是个标签，
// 等级价差 5~15% 一分钱收不回来。所以这里大半用例在验计价链路，不只验定等。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { login, get, post, put, expectReject, activeSpec, activeGreigeMaterial, supplierOf, customerOf, assertNear, num } from './helpers.mjs'

/**
 * 备两匹布并定好等：A 匹无疵点（必定一等），B 匹砸 3 个破洞（定不到一等）。
 *
 * 为什么用「固定 4 分」的疵点而不是按长度的：按长度扣分要算面积才能预知等级，
 * 而门幅随规格变，把测试绑死在具体数值上一改规格就崩。固定分与面积无关，
 * 3 个破洞 = 12 分，任何门幅下都足以让一匹掉出一等。
 *
 * **每个用例自建规格**：grade_prices 按 specId 挂，而干净库只有 1 个 seed 规格，
 * 复用会让前一个用例配的价目污染后一个（「未配价目应退回基准价」就会假失败）。
 *
 * 返回两匹的 grade 与 rollId，**不断言具体是哪一等**（除了 A 匹必须是一等），
 * 把等级当观测值用——这样规格换了测试照样成立。
 */
async function setupGradedRolls(c, tag) {
  const mat = await activeGreigeMaterial(c)
  // 自建规格，避免与同文件其他用例抢同一个 specId（价目是按 spec 挂的）
  await post(c, '/greige-specs', {
    name: `质检测试规格${tag}`, finishedWidth: 150, warpDensity: 120, weftDensity: 72,
    weaveType: 'plain', warpCount: { value: 40, system: 'NeS' }, weftCount: { value: 40, system: 'NeS' },
  })
  const specs = (await get(c, '/greige-specs')).filter((s) => s.status !== 'discontinued')
  const spec = specs.find((s) => s.name === `质检测试规格${tag}`)
  assert.ok(spec, '应能建出自建规格')
  const sup = await supplierOf(c)
  const cus = await customerOf(c)
  const rollA = `GA${tag}`
  const rollB = `GB${tag}`
  await post(c, '/inventory/purchase-inbound', {
    materialId: mat.id, specId: spec.id, enteredUnit: 'm', enteredValue: 60,
    partnerId: sup.id, unitPrice: 8.5,
    rolls: [{ rollNo: rollA, meters: 40 }, { rollNo: rollB, meters: 20 }],
  })

  const insp = await post(c, '/quality/inspections', { mode: 'full' })
  const la = await get(c, `/quality/rolls/lookup?rollNo=${rollA}`)
  const lb = await get(c, `/quality/rolls/lookup?rollNo=${rollB}`)
  await post(c, `/quality/inspections/${insp.id}/rolls`, { rollIds: [la.id, lb.id] })

  const types = await get(c, '/quality/defect-types')
  const hole = types.find((t) => t.penaltyMode === 'fixed' && t.fixedPenalty >= 4)
  assert.ok(hole, '疵点类型里应有固定 4 分的（破洞）')
  await put(c, `/quality/inspections/${insp.id}/rolls/${lb.id}/defects`, {
    items: [
      { defectTypeId: hole.id, positionM: 5, lengthInch: null },
      { defectTypeId: hole.id, positionM: 15, lengthInch: null },
      { defectTypeId: hole.id, positionM: 25, lengthInch: null },
    ],
  })

  await post(c, `/quality/inspections/${insp.id}/finalize`)
  const detail = await get(c, `/quality/inspections/${insp.id}`)
  const ra = detail.rolls.find((r) => r.rollId === la.id)
  const rb = detail.rolls.find((r) => r.rollId === lb.id)
  assert.equal(ra.grade, 'A', '无疵点的匹应定一等')
  assert.ok(rb.grade && rb.grade !== 'A', '砸了 12 分疵点的匹不该还是一等')

  return { spec, mat, cus, rollA, rollB, gradeA: ra.grade, gradeB: rb.grade, la, lb }
}

/** 建一张已确认的销售订单，返回订单与首行明细 */
async function confirmedSalesOrder(c, { mat, spec, cus, unitPrice = 12.5 }) {
  const o = await post(c, '/orders', {
    orderType: 'sales', partnerId: cus.id,
    items: [{ materialId: mat.id, specId: spec.id, orderedUnit: 'm', orderedValue: 60, unitPrice }],
  })
  await post(c, '/orders/' + o.id + '/confirm', {})
  const d = await get(c, '/orders/' + o.id)
  return { order: o, item: d.items[0] }
}

test('定等后等级写回件卡，无疵点的匹定一等', async () => {
  const c = await login('owner')
  const s = await setupGradedRolls(c, Date.now())
  // 件卡上应能直接读到等级（出库选匹/追溯/打标签都读这里，不 join 检验单）
  const la = await get(c, `/quality/rolls/lookup?rollNo=${s.rollA}`)
  const lb = await get(c, `/quality/rolls/lookup?rollNo=${s.rollB}`)
  assert.equal(la.grade, 'A', '件卡应带上一等等级')
  assert.equal(lb.grade, s.gradeB, '件卡等级应与检验单一致')
  assert.ok(la.inspectedAt, '应记录定等时间')
})

test('分等计价：留空单价逐匹发货，按件卡品等加权算价并落快照', async () => {
  const c = await login('owner')
  const s = await setupGradedRolls(c, Date.now())

  // 配 spec 级分等价目：一等原价、二等降 1、三等降 2、等外七折
  await put(c, '/quality/grade-prices', {
    scope: 'spec', refId: s.spec.id,
    rules: [
      { grade: 'A', mode: 'delta', value: 0 },
      { grade: 'B', mode: 'delta', value: -1 },
      { grade: 'C', mode: 'delta', value: -2 },
      { grade: 'D', mode: 'discount', value: 0.7 },
    ],
  })

  const { order, item } = await confirmedSalesOrder(c, { mat: s.mat, spec: s.spec, cus: s.cus })

  // 逐匹发货，**故意不传 unitPrice**
  const outDoc = await post(c, '/inventory/sales-outbound', {
    materialId: s.mat.id, specId: s.spec.id, enteredUnit: 'm', enteredValue: 60,
    partnerId: s.cus.id, pickedRolls: [{ rollNo: s.rollA }, { rollNo: s.rollB }],
    orderId: order.id, orderItemId: item.id,
  })

  const priceOf = { A: 12.5, B: 11.5, C: 10.5, D: 12.5 * 0.7 }
  const expected = (priceOf[s.gradeA] * 40 + priceOf[s.gradeB] * 20) / 60
  assertNear(num(outDoc.unitPrice), expected, 0.01, '整单价应按各品等米数加权')
  assertNear(num(outDoc.totalAmount), expected * 60, 0.01, '金额 = 加权单价 × 总米数')

  // 反证：若实现退化成就低/就高/取平均等级，都不会等于加权值
  const worst = priceOf[s.gradeA] < priceOf[s.gradeB] ? priceOf[s.gradeA] : priceOf[s.gradeB]
  const best = priceOf[s.gradeA] > priceOf[s.gradeB] ? priceOf[s.gradeA] : priceOf[s.gradeB]
  const naiveAvg = (priceOf[s.gradeA] + priceOf[s.gradeB]) / 2
  assert.notEqual(num(outDoc.unitPrice), worst, '不应取最低等级单价')
  assert.notEqual(num(outDoc.unitPrice), best, '不应取最高等级单价')
  assert.notEqual(num(outDoc.unitPrice), naiveAvg, '不应取两级算术平均')

  // 快照：基准价、来源、明细都要在（等级会因复验变，不冻结就说不清当时为什么是这个价）
  assert.ok(outDoc.priceSnapshot, '应落分等计价快照')
  assert.equal(outDoc.priceSnapshot.source, 'spec', '来源应是规格挂牌价')
  assertNear(num(outDoc.priceSnapshot.basePrice), 12.5, 0.01, '基准价应取订单行单价')
  assert.equal(outDoc.priceSnapshot.breakdown.length, 2, '应按品等分两组')
  const byGrade = Object.fromEntries(outDoc.priceSnapshot.breakdown.map((b) => [b.grade, b]))
  assertNear(num(byGrade[s.gradeA].meters), 40, 0.01, '一等品那组应 40m')
  assertNear(num(byGrade[s.gradeB].meters), 20, 0.01, '另一组应 20m')
})

test('分等计价：显式传单价时以显式为准，不落快照', async () => {
  const c = await login('owner')
  const s = await setupGradedRolls(c, Date.now())
  await put(c, '/quality/grade-prices', {
    scope: 'spec', refId: s.spec.id,
    rules: [{ grade: 'A', mode: 'delta', value: 0 }, { grade: 'B', mode: 'delta', value: -1 }],
  })
  const { order, item } = await confirmedSalesOrder(c, { mat: s.mat, spec: s.spec, cus: s.cus })

  // 分等价目是默认规则不是强制折扣：客户抹零/急单加价必须能覆盖
  const outDoc = await post(c, '/inventory/sales-outbound', {
    materialId: s.mat.id, specId: s.spec.id, enteredUnit: 'm', enteredValue: 60,
    partnerId: s.cus.id, unitPrice: 9, pickedRolls: [{ rollNo: s.rollA }, { rollNo: s.rollB }],
    orderId: order.id, orderItemId: item.id,
  })
  assert.equal(num(outDoc.unitPrice), 9, '显式单价应原样生效')
  assertNear(num(outDoc.totalAmount), 9 * 60, 0.01, '金额按显式单价算')
  assert.equal(outDoc.priceSnapshot ?? null, null, '显式定价不应落分等快照')
})

test('分等计价：未配分等价目时退回订单行基准价', async () => {
  const c = await login('owner')
  const s = await setupGradedRolls(c, Date.now())
  // 故意不配 grade_prices
  const { order, item } = await confirmedSalesOrder(c, { mat: s.mat, spec: s.spec, cus: s.cus, unitPrice: 13 })
  const outDoc = await post(c, '/inventory/sales-outbound', {
    materialId: s.mat.id, specId: s.spec.id, enteredUnit: 'm', enteredValue: 60,
    partnerId: s.cus.id, pickedRolls: [{ rollNo: s.rollA }, { rollNo: s.rollB }],
    orderId: order.id, orderItemId: item.id,
  })
  assertNear(num(outDoc.unitPrice), 13, 0.01, '无分等价目应按基准价，分文不改')
  assert.equal(outDoc.priceSnapshot.source, 'base', '来源应标记为不分等')
})

test('分等计价：不关联订单行则不自动计价（不凭空造基准价）', async () => {
  const c = await login('owner')
  const s = await setupGradedRolls(c, Date.now())
  await put(c, '/quality/grade-prices', {
    scope: 'spec', refId: s.spec.id,
    rules: [{ grade: 'A', mode: 'delta', value: 0 }, { grade: 'B', mode: 'delta', value: -1 }],
  })
  // 配了价目也不自动算——没有订单行就没有基准价，猜一个出来比不计价更糟
  const outDoc = await post(c, '/inventory/sales-outbound', {
    materialId: s.mat.id, specId: s.spec.id, enteredUnit: 'm', enteredValue: 60,
    partnerId: s.cus.id, pickedRolls: [{ rollNo: s.rollA }, { rollNo: s.rollB }],
  })
  assert.equal(outDoc.unitPrice ?? null, null, '无订单行应留空单价')
  assert.equal(outDoc.totalAmount ?? null, null, '金额应留空')
  assert.equal(outDoc.priceSnapshot ?? null, null, '不应落快照')
})

test('分等计价：批次级消耗（扫码拣货）无从分摊，不自动计价', async () => {
  const c = await login('owner')
  const s = await setupGradedRolls(c, Date.now())
  await put(c, '/quality/grade-prices', {
    scope: 'spec', refId: s.spec.id,
    rules: [{ grade: 'A', mode: 'delta', value: 0 }, { grade: 'B', mode: 'delta', value: -1 }],
  })
  const { order, item } = await confirmedSalesOrder(c, { mat: s.mat, spec: s.spec, cus: s.cus })
  const batches = await get(c, '/inventory/batches')
  const batch = batches.find((b) => b.specId === s.spec.id && num(b.remainingQuantity) > 0)
  assert.ok(batch, '应有含库存的批次')

  // 同一批次里混着不同等级的匹（验布是逐匹的），按批次发货无从分摊
  const outDoc = await post(c, '/inventory/sales-outbound', {
    materialId: s.mat.id, specId: s.spec.id, enteredUnit: 'm', enteredValue: 10,
    partnerId: s.cus.id, pickedItems: [{ batchId: batch.id, quantityM: 10 }],
    orderId: order.id, orderItemId: item.id,
  })
  assert.equal(outDoc.unitPrice ?? null, null, '批次级消耗不应自动计价')
})

test('分等价目：折扣率必须在 (0,1] 之间', async () => {
  const c = await login('owner')
  const spec = await activeSpec(c)
  await expectReject(c, 'PUT', '/quality/grade-prices', {
    scope: 'spec', refId: spec.id,
    rules: [{ grade: 'B', mode: 'discount', value: 1.5 }],
  })
  await expectReject(c, 'PUT', '/quality/grade-prices', {
    scope: 'spec', refId: spec.id,
    rules: [{ grade: 'B', mode: 'discount', value: 0 }],
  })
})

test('检验单作废：件卡等级回退到未检验', async () => {
  const c = await login('owner')
  const s = await setupGradedRolls(c, Date.now())
  const detail = await get(c, `/quality/rolls/lookup?rollNo=${s.rollA}`)
  assert.equal(detail.grade, 'A', '定等后件卡带等级')

  const inspList = await get(c, '/quality/inspections?status=done')
  const insp = inspList.find((i) => i.inspectionNo)
  assert.ok(insp, '应有一张已定等的检验单')
  await post(c, `/quality/inspections/${insp.id}/void`)

  const after = await get(c, `/quality/rolls/lookup?rollNo=${s.rollA}`)
  assert.equal(after.grade ?? null, null, '作废后等级应回退到未检验')
  const st = (await get(c, '/quality/inspections')).find((i) => i.id === insp.id)
  assert.equal(st.status, 'void', '检验单应置为已作废')
})

test('检验单已定等后不能再改疵点', async () => {
  const c = await login('owner')
  const s = await setupGradedRolls(c, Date.now())
  const inspList = await get(c, '/quality/inspections?status=done')
  const insp = inspList.find((i) => i.inspectionNo)
  const types = await get(c, '/quality/defect-types')
  const hole = types.find((t) => t.penaltyMode === 'fixed')
  await expectReject(c, 'PUT', `/quality/inspections/${insp.id}/rolls/${s.la.id}/defects`, {
    items: [{ defectTypeId: hole.id, positionM: 3, lengthInch: null }],
  })
})
