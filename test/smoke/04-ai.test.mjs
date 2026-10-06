// AI 引擎五能力：结构完整性（不依赖 key 是否有效，llm/rule 都得有 source/confidence/derivation/data）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { login, get, post, activeSpec, activeGreigeMaterial } from './helpers.mjs'

/** 取一个启用机台（报工要求工单已指派机台） */
async function firstMachine(c) {
  const ms = await get(c, '/machines')
  const m = ms.find((x) => x.status === 'running' || x.status === 'idle') ?? ms[0]
  if (!m) throw new Error('无可用机台')
  return m
}

/** 断言 AiInsight 结构完整 */
function assertInsight(x, label) {
  assert.ok(x, `${label}: 应有返回`)
  assert.ok(['llm', 'rule'].includes(x.source), `${label}: source 应为 llm|rule，实际 ${x.source}`)
  assert.ok(typeof x.confidence === 'number' && x.confidence >= 0 && x.confidence <= 1, `${label}: 置信度应在 0~1`)
  assert.ok(Array.isArray(x.derivation) && x.derivation.length > 0, `${label}: 应有推导依据`)
  assert.ok(typeof x.reasoning === 'string' && x.reasoning.length > 0, `${label}: 应有理由`)
  assert.ok(x.data, `${label}: 应有 data`)
}

test('AI 状态端点可访问', async () => {
  const c = await login('factory')
  const st = await get(c, '/ai/status')
  assert.equal(typeof st.llmEnabled, 'boolean', 'llmEnabled 应为布尔')
})

test('智能核价：返回建议价+成本+依据', async () => {
  const c = await login('factory')
  const spec = await activeSpec(c)
  const r = await post(c, '/ai/quote', { specId: spec.id, quantityM: 5000 })
  assertInsight(r, '智能核价')
  assert.ok(r.data.suggestedPrice > 0, '建议价应 > 0')
  assert.ok(r.data.costPerM >= 0, '成本应 >= 0')
})

test('损耗归因：返回各规格损耗行', async () => {
  const c = await login('factory')
  const r = await get(c, '/ai/loss')
  assertInsight(r, '损耗归因')
  assert.ok(Array.isArray(r.data.rows), '应有 rows')
  assert.ok(typeof r.data.totalExcessKg === 'number', '应有总超额损耗')
})

test('系数自学习：返回实测多耗倍数与建议', async () => {
  const c = await login('factory')
  const r = await get(c, '/ai/coefficients')
  assertInsight(r, '系数自学习')
  if (r.data.rows.length) {
    const row = r.data.rows[0]
    assert.ok(typeof row.observedFactor === 'number', '应有实测多耗倍数')
    assert.ok(row.suggestedFactor >= 1 && row.suggestedFactor <= 1.6, '建议系数应在 [1,1.6]')
  }
})

test('用料预测：需求=单耗×产量，缺口非负', async () => {
  const c = await login('factory')
  const spec = await activeSpec(c)
  const r = await post(c, '/ai/prediction', { specId: spec.id, plannedMeters: 10000 })
  assertInsight(r, '用料预测')
  const d = r.data
  assert.ok(d.warp.needKg >= 0 && d.weft.needKg >= 0, '需求应 >= 0')
  assert.ok(d.warp.gapKg >= 0 && d.weft.gapKg >= 0, '缺口应 >= 0（无负缺口）')
  // 需求校验：单耗/100 × 产量
  const expectWarp = (d.warpKgPer100m / 100) * 10000
  assert.ok(Math.abs(expectWarp - d.warp.needKg) < 1, `经纱需求应≈单耗×产量(${expectWarp.toFixed(0)})，实际 ${d.warp.needKg.toFixed(0)}`)
})

test('排产建议：返回排产行，机台/起止/按期', async () => {
  const c = await login('factory')
  const r = await get(c, '/ai/scheduling')
  assertInsight(r, '排产建议')
  if (r.data.rows.length) {
    const row = r.data.rows[0]
    assert.ok('machineName' in row && 'startDay' in row && 'meetsDue' in row, '排产行应有机台/起止/按期')
  }
})

test('AI 参数非法被拒', async () => {
  const c = await login('factory')
  const spec = await activeSpec(c)
  await assert.rejects(() => post(c, '/ai/quote', { specId: spec.id, quantityM: 0 }))
  await assert.rejects(() => post(c, '/ai/prediction', { specId: spec.id, plannedMeters: -1 }))
})

// ---- 报工按匹 ----

test('报工按匹：产出各匹生成件卡', async () => {
  const c = await login('factory')
  const spec = await activeSpec(c)
  const mat = await activeGreigeMaterial(c)
  // 建一个已排产的工单
  const machine = await firstMachine(c)
  const order = await post(c, '/production-orders', { materialId: mat.id, specId: spec.id, plannedQuantityM: 1000, machineId: machine.id })
  await post(c, `/production-orders/${order.id}/schedule`, {}) // 排产
  const tag = Date.now()
  const rolls = [{ rollNo: `RP${tag}-1`, meters: 40 }, { rollNo: `RP${tag}-2`, meters: 35 }]
  const total = rolls.reduce((s, r) => s + r.meters, 0)
  // 按匹报工
  await post(c, `/production-orders/${order.id}/reports`, { outputM: total, rolls })
  // 追溯件卡：应来自该报工的产出批次
  const tr = await get(c, `/inventory/rolls/trace?rollNo=${rolls[0].rollNo}`)
  assert.ok(tr, '件卡应有追溯')
  assert.equal(tr.roll.meters, '40.000', '件卡米数应为 40')
  assert.ok(tr.spec.specName, '应带规格')
})

test('报工按匹：各匹之和与产量不符被拒', async () => {
  const c = await login('factory')
  const spec = await activeSpec(c)
  const mat = await activeGreigeMaterial(c)
  const machine = await firstMachine(c)
  const order = await post(c, '/production-orders', { materialId: mat.id, specId: spec.id, plannedQuantityM: 1000, machineId: machine.id })
  await post(c, `/production-orders/${order.id}/schedule`, {})
  const tag = Date.now()
  // 产量 100，但各匹只合 50 → 拒
  await assert.rejects(() =>
    post(c, `/production-orders/${order.id}/reports`, { outputM: 100, rolls: [{ rollNo: `RQ${tag}`, meters: 50 }] })
  )
})
