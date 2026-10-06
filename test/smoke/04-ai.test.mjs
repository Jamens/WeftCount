// AI 引擎五能力：结构完整性（不依赖 key 是否有效，llm/rule 都得有 source/confidence/derivation/data）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { login, get, post, activeSpec, activeGreigeMaterial } from './helpers.mjs'

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
