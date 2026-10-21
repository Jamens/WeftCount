// 设备能耗：抄表差值派生用量、表底回退拒收、单耗 kWh/百米、合计按总量（反证：≠平均的平均）、
// 0 产量不返回 Infinity、末次抄表法归期、环比、有产量无抄表要提醒
//
// **用 2027 年的期间做隔离**：其他冒烟文件的报工都落在 2026 年，
// 期间聚合是全公司口径，撞上别人的数据会让期望值算不准。
import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { login, get, post, del, expectReject, activeSpec, activeGreigeMaterial, assertNear } from './helpers.mjs'

const P_START = '2027-02-10'
const P_END = '2027-02-28'
const PREV_START = '2027-01-22' // 等长 18 天 → 上期 [2027-01-22, 2027-02-09]
const TARIFF = 0.65

let c
let mA, mB, mC, mD

/** 造一张有产出的工单并报工一次 */
async function reportOutput(machineId, outputM, reportDate) {
  const mat = await activeGreigeMaterial(c)
  const spec = await activeSpec(c)
  const order = await post(c, '/production-orders', {
    materialId: mat.id, specId: spec.id, plannedQuantityM: 999999, machineId,
  })
  await post(c, `/production-orders/${order.id}/schedule`)
  await post(c, `/production-orders/${order.id}/reports`, {
    outputM, reportDate, clientRequestId: `en-${machineId}-${reportDate}-${Date.now()}${Math.random().toString(36).slice(2, 7)}`,
  })
  return order
}

async function meter(machineId, meterNo, rows) {
  const out = []
  for (const r of rows) {
    out.push(await post(c, '/energy/readings', {
      machineId, meterNo, readingDate: r.date, reading: r.reading, tariff: TARIFF,
    }))
  }
  return out
}

before(async () => {
  c = await login('factory')
  const machines = await get(c, '/energy/machines')
  assert.ok(machines.length >= 4, '需至少 4 台演示机台做能耗测试')
  ;[mA, mB, mC, mD] = machines

  // 机台 A：本期产量 25000 m，读数 1000→1500（另在上一期建基线 700→800）
  await reportOutput(mA.id, 25000, '2027-01-26')
  await reportOutput(mA.id, 25000, '2027-02-12')
  await meter(mA.id, 'E-A1', [
    { date: '2027-01-26', reading: 700 },
    { date: '2027-02-05', reading: 800 },
    { date: '2027-02-12', reading: 1000 },
    { date: '2027-02-20', reading: 1500 },
  ])

  // 机台 B：本期产量 5000 m，读数 5000→6000（首条 2/12 是基线）
  await reportOutput(mB.id, 5000, '2027-02-12')
  await meter(mB.id, 'E-B1', [
    { date: '2027-02-12', reading: 5000 },
    { date: '2027-02-20', reading: 6000 },
  ])

  // 机台 C：只抄表不报工 → 单耗必须为 null（除零不得给 Infinity）
  await meter(mC.id, 'E-C1', [
    { date: '2027-02-12', reading: 100 },
    { date: '2027-02-20', reading: 300 },
  ])
})

test('首条读数只建基线：不出量（consumed 为 null 而非 0）', async () => {
  const rows = await get(c, `/energy/readings?machineId=${mB.id}`)
  const first = rows.find((r) => r.readingDate === '2027-02-12')
  assert.ok(first.isBaseline, '首条应标记为基线')
  assert.equal(first.consumedKwh, null, '基线没有上期，用量应为 null 而不是 0')
  assert.equal(first.cost, null, '基线不出电费')
})

test('用量与电费按表底差值派生', async () => {
  const rows = await get(c, `/energy/readings?machineId=${mA.id}`)
  const byDate = Object.fromEntries(rows.map((r) => [r.readingDate, r]))
  // A 的序列：700(基线) → 800 → 1000 → 1500
  assert.equal(byDate['2027-02-05'].consumedKwh, 100, '800 − 700 = 100')
  assert.equal(byDate['2027-02-12'].consumedKwh, 200, '1000 − 800 = 200')
  assert.equal(byDate['2027-02-20'].consumedKwh, 500, '1500 − 1000 = 500')
  assertNear(byDate['2027-02-20'].cost, 500 * TARIFF, 0.01, '电费 = 用量 × 当期电价')
})

test('累计表底回退被拒（换表应换电表号）', async () => {
  const msg = await expectReject(c, 'POST', '/energy/readings', {
    machineId: mA.id, meterNo: 'E-A1', readingDate: '2027-02-25', reading: 100, tariff: TARIFF,
  })
  assert.match(msg, /回退/, '读数小于上期应被拒')
})

test('同机台同电表同日重复抄表被拒', async () => {
  const msg = await expectReject(c, 'POST', '/energy/readings', {
    machineId: mA.id, meterNo: 'E-A1', readingDate: '2027-02-20', reading: 1600, tariff: TARIFF,
  })
  assert.match(msg, /已有抄表|重复/, '同电表同日应唯一')
})

test('单耗聚合 kWh/百米：期末抄表法归期，产量为 0 时不给 Infinity', async () => {
  const st = await get(c, `/energy/stats?periodStart=${P_START}&periodEnd=${P_END}`)
  const a = st.rows.find((r) => r.machineId === mA.id)
  const b = st.rows.find((r) => r.machineId === mB.id)
  const cc = st.rows.find((r) => r.machineId === mC.id)

  // A 本期含 2/12(200) 与 2/20(500) 两次抄表用量 = 700 kWh，产量 25000 m
  assertNear(a.totalKwh, 700, 0.01, 'A 本期用量 = 200 + 500 = 700')
  assertNear(a.kwhPer100m, 700 / 250, 0.01, 'A 单耗 = 700 ÷ 250 = 2.8')
  assert.equal(a.lastReadingDate, '2027-02-20', '最后抄表日 2/20')

  assertNear(b.totalKwh, 1000, 0.01, 'B 本期用量 = 6000 − 5000 = 1000')
  assertNear(b.kwhPer100m, 1000 / 50, 0.01, 'B 单耗 = 1000 ÷ 50 = 20')

  assert.equal(cc.outputM, 0, 'C 无报工')
  assert.equal(cc.kwhPer100m, null, '产量为 0 时单耗必须是 null（服务端显式判空，不做除法）')
})

test('合计按总量算：反证「不是各机台单耗的平均」', async () => {
  const st = await get(c, `/energy/stats?periodStart=${P_START}&periodEnd=${P_END}`)
  // A 700 kWh/25000 m + B 1000 kWh/5000 m + C 200 kWh/0 m = 1900 kWh / 30000 m
  assertNear(st.totals.totalKwh, 1900, 0.01, '总用量 = 700 + 1000 + 200')
  assertNear(st.totals.outputM, 30000, 0.01, '总产量')
  assertNear(st.totals.kwhPer100m, 1900 / 300, 0.01, '合计单耗 = 1900 ÷ 300')
  assertNear(st.totals.totalCost, 1900 * TARIFF, 0.01, '总电费 = 总用量 × 电价')

  // 反证：若实现退化成「各机台单耗取平均」，值会完全不同
  const simpleAvg = (st.rows.filter((r) => r.kwhPer100m != null).reduce((s, r) => s + r.kwhPer100m, 0)) /
    st.rows.filter((r) => r.kwhPer100m != null).length
  assert.ok(
    Math.abs(st.totals.kwhPer100m - simpleAvg) > 0.5,
    `合计单耗 ${st.totals.kwhPer100m} 不应等于简单平均 ${simpleAvg}`,
  )
})

test('环比：与上一个等长期间比单耗变化', async () => {
  const cmp = await get(c, `/energy/compare?periodStart=${P_START}&periodEnd=${P_END}`)
  assert.equal(cmp.prevStart, PREV_START, '上期起 = 本期起前推等长天数')
  // 上期：仅 A 的 2/5 那次抄表出量 100 kWh，产量 25000 m → 0.4
  assertNear(cmp.prev.kwhPer100m, 100 / 250, 0.01, '上期单耗 = 100 ÷ 250 = 0.4')
  assertNear(cmp.kwhPer100mDelta, 1900 / 300 - 0.4, 0.01, '单耗环比差值')
  assertNear(cmp.kwhPer100mDeltaPct, ((1900 / 300 - 0.4) / 0.4) * 100, 0.1, '单耗环比百分比')
})

test('有产量但本期无抄表：进 missingMachines（缺数≠零耗电）', async () => {
  await reportOutput(mD.id, 8000, '2027-02-15')
  const st = await get(c, `/energy/stats?periodStart=${P_START}&periodEnd=${P_END}`)
  assert.ok(
    st.missingMachines.some((n) => n.includes(mD.name)),
    `D 机台应在缺抄表名单里，实际: ${JSON.stringify(st.missingMachines)}`,
  )
  const rowD = st.rows.find((r) => r.machineId === mD.id)
  assert.equal(rowD.totalKwh, null, '无抄表时用电量是 null，不是 0')
  assert.equal(rowD.kwhPer100m, null, '无抄表时单耗不可算')
})

test('删抄表后用量重算：删中间一条，差值并入下一次', async () => {
  const rows = await get(c, `/energy/readings?machineId=${mA.id}`)
  const mid = rows.find((r) => r.readingDate === '2027-02-12')
  await del(c, `/energy/readings/${mid.id}`)
  const after = await get(c, `/energy/readings?machineId=${mA.id}`)
  const byDate = Object.fromEntries(after.map((r) => [r.readingDate, r]))
  // 序列变成 700(基线) → 800 → 1500，最后一条用量应为 700（跨两期的总量）
  assert.equal(byDate['2027-02-20'].consumedKwh, 700, '删中间一条后，末条差值并为 800→1500 = 700')
})

test('权限隔离：挡车工（无 cost 域）读能耗统计被拒', async () => {
  const loom = await login('loom')
  const msg = await expectReject(loom, 'GET', `/energy/stats?periodStart=${P_START}&periodEnd=${P_END}`)
  assert.match(msg, /1003|无|禁止/, 'loom 不应读到能耗统计')
})