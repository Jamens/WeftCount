// 计件工资：档案建档与重复拒绝、报工聚合计件、生成工资单（金额服务端算）、重复生成幂等、
// 奖扣修改与确认/发放状态推进、草稿删除、无档案跳过、挡车工权限隔离
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { login, get, post, put, del, expectReject, activeSpec, activeGreigeMaterial, assertNear } from './helpers.mjs'

const S = (t) => `wage${t}`

/** 建→排产→报工一次的整链路，返回工单与报工结果 */
async function setupReportedOrder(c, t, { reportAs, date, outputM, stoppageMinutes }) {
  const mat = await activeGreigeMaterial(c)
  const spec = await activeSpec(c)
  const machineId = (await get(c, '/machines'))[0].id
  const order = await post(c, '/production-orders', {
    materialId: mat.id, specId: spec.id, plannedQuantityM: 1000, machineId,
  })
  await post(c, `/production-orders/${order.id}/schedule`)
  const reporter = reportAs ? await login(reportAs) : c
  const rep = { outputM, reportDate: date, clientRequestId: `${S(t)}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
  if (stoppageMinutes != null) rep.stoppageMinutes = stoppageMinutes
  await post(reporter, `/production-orders/${order.id}/reports`, rep)
  return order
}

async function factoryUserId(c) {
  const users = (await get(c, '/users')).users ?? await get(c, '/users')
  const u = users.find((x) => x.username === 'factory')
  assert.ok(u, '演示账号 factory 应存在')
  return u.id
}

test('工资档案：建档成功，同一用户重复建档被拒', async () => {
  const c = await login('factory')
  const userId = await factoryUserId(c)
  const exist = await get(c, '/wages/profiles').then((rows) => rows.find((p) => p.userId === userId))
  if (!exist) {
    const p = await post(c, '/wages/profiles', { userId, unitPrice: 2.5, jobType: '挡车工', baseWage: 0 })
    assert.equal(p.unitPrice, 2.5, '单价应入库')
    assert.equal(p.realName, '王厂长', '姓名应快照自用户表')
  }
  const msg = await expectReject(c, 'POST', '/wages/profiles', { userId, unitPrice: 3 })
  assert.match(msg, /档案/, '重复建档应被拒')
})

test('生成工资单：一条事务算出 计件=80米×2.5=200，明细分行，实发=计件+底薪', async () => {
  const c = await login('factory')
  const userId = await factoryUserId(c)
  // 单价统一为 2.5（T1 建的可能是 2.5；若不是，先改成 2.5）
  const profile = (await get(c, '/wages/profiles')).find((p) => p.userId === userId)
  assert.ok(profile, 'factory 应有工资档案')
  await put(c, `/wages/profiles/${profile.id}`, { unitPrice: 2.5, baseWage: 0 })

  const start = '2026-06-01'
  const end = '2026-06-30'
  await setupReportedOrder(c, 'S1a', { date: '2026-06-05', outputM: 50 })
  await setupReportedOrder(c, 'S1b', { date: '2026-06-10', outputM: 30, stoppageMinutes: 40 })

  // 预览口径与实生成一致：预估 = 80 × 2.5 = 200
  const preview = await get(c, `/wages/payroll/preview?periodStart=${start}&periodEnd=${end}`)
  const pre = preview.find((r) => r.userId === userId)
  assert.equal(pre.totalOutputM, 80, '预览应聚合 80 米')
  assert.equal(pre.estimatedAmount, 200, '预览预估金额 = 80 × 2.5')

  const res = await post(c, '/wages/slips', { periodStart: start, periodEnd: end })
  assert.equal(res.created.length, 1, '应生成 1 张（仅 factory 有档案且有报工）')
  assert.equal(res.skipped.length, 0, '无跳过（无 loom 报工）')
  const s = res.created[0]
  assert.equal(s.totalOutputM, 80, '产出合计 80 米')
  assert.equal(s.reportCount, 2, '报工 2 次')
  assert.equal(s.stoppageMin, 40, '停机分钟合计 40')
  assert.equal(s.pieceAmount, 200, '计件额 = Σ 明细（逐行舍入后累加）')
  assert.equal(s.netAmount, 200, '实发 = 底薪 0 + 计件 200')
  assert.equal(s.items.length, 2, '明细按工单 2 行')
  assert.equal(s.items.reduce((a, i) => a + i.amount, 0), 200, '明细金额之和 = 计件额')
  assert.match(s.slipNo, /^GZ\d{12}$/, '单号格式 GZ+日期+4位序')
  assert.equal(s.status, 'draft', '新单为草稿')

  const detail = await get(c, `/wages/slips/${s.id}`)
  assert.equal(detail.items.length, 2, '详情返回明细')
})

test('重复生成幂等：同周期再次生成跳过已存在', async () => {
  const c = await login('factory')
  const start = '2026-06-01'
  const end = '2026-06-30'
  const res = await post(c, '/wages/slips', { periodStart: start, periodEnd: end })
  assert.equal(res.created.length, 0, '重复周期不得再建单')
  assert.equal(res.skipped.length, 1, '已存在的人应被跳过')
  assert.equal(res.skipped[0].reason, 'exists', '跳过原因 = 已存在')
})

test('状态推进：改奖扣→确认锁定→发放；确认后不可改不可删', async () => {
  const c = await login('factory')
  const slip = (await get(c, '/wages/slips')).find((s) => s.periodStart === '2026-06-01')
  assert.ok(slip, '应有 6 月工资单')

  const upd = await put(c, `/wages/slips/${slip.id}`, { bonus: 50, deduction: 20 })
  assert.equal(upd.bonus, 50, '奖金入库')
  assert.equal(upd.deduction, 20, '扣款入库')
  assert.equal(upd.netAmount, 230, '实发 = 200 + 50 − 20')

  const confirmed = await post(c, `/wages/slips/${slip.id}/confirm`)
  assert.equal(confirmed.status, 'confirmed', '确认后为已确认')

  const msg = await expectReject(c, 'PUT', `/wages/slips/${slip.id}`, { bonus: 1 })
  assert.match(msg, /草稿/, '确认后改奖扣应被拒')
  const msg2 = await expectReject(c, 'DELETE', `/wages/slips/${slip.id}`)
  assert.match(msg2, /草稿/, '确认后删除应被拒')

  const paid = await post(c, `/wages/slips/${slip.id}/pay`)
  assert.equal(paid.status, 'paid', '发放后为已发放')
  assert.ok(paid.paidAt, '发放应记时间')
  const msg3 = await expectReject(c, 'POST', `/wages/slips/${slip.id}/pay`)
  assert.match(msg3, /确认/, '已发放不可再发放')
})

test('草稿可删：删后同周期可重新生成（幂等键随之放开）', async () => {
  const c = await login('factory')
  const start = '2026-07-01'
  const end = '2026-07-15'
  await setupReportedOrder(c, 'S2', { date: '2026-07-03', outputM: 100 })

  const res = await post(c, '/wages/slips', { periodStart: start, periodEnd: end })
  assert.equal(res.created.length, 1, '应生成 1 张')
  const s = res.created[0]
  assert.equal(s.pieceAmount, 250, '计件 = 100 × 2.5')

  await del(c, `/wages/slips/${s.id}`)
  const res2 = await post(c, '/wages/slips', { periodStart: start, periodEnd: end })
  assert.equal(res2.created.length, 1, '删除后可重新生成')
  assert.equal(res2.skipped.length, 0, '删净后无跳过')
  await del(c, `/wages/slips/${res2.created[0].id}`)
})

test('无档案跳过：挡车工有报工但无档案，生成时跳过且不猜单价', async () => {
  const c = await login('factory')
  const start = '2026-08-01'
  const end = '2026-08-31'
  await setupReportedOrder(c, 'S3', { reportAs: 'loom', date: '2026-08-08', outputM: 120 })

  const res = await post(c, '/wages/slips', { periodStart: start, periodEnd: end })
  assert.equal(res.created.length, 0, '无档案者不得生成')
  assert.equal(res.skipped.length, 1, '应有 1 人被跳过')
  assert.equal(res.skipped[0].reason, 'no_profile', '跳过原因 = 无档案')
  assert.equal(res.skipped[0].outputM, 120, '跳过记录带上产出量，便于追认')

  const msg = await expectReject(c, 'POST', '/wages/slips', { periodStart: '2026-09-01', periodEnd: '2026-08-01' })
  assert.match(msg, /周期/, '起晚于止应被拒')
})

test('权限隔离：挡车工不可读工资单（工资对报工者保密）', async () => {
  const loom = await login('loom')
  const msg = await expectReject(loom, 'GET', '/wages/slips')
  assert.match(msg, /1003|无|禁止/, 'loom 不应看到工资单（期望无权限 1003）')
})

test('总览：档案数/待发/已发金额口径正确', async () => {
  const c = await login('factory')
  const ov = await get(c, '/wages/overview')
  assert.ok(ov.profileCount >= 1, '至少 1 个档案')
  assert.ok(ov.paidAmount >= 230, '已发含 6 月已发放的 230')
  assert.equal(ov.draftCount, 0, '6 月已发放、7 月已删、8 月未生成，应无草稿')
  assert.equal(ov.confirmedCount, 0, '同口径，应无待确认')
})

test('金额精度：单价小数位与逐行舍入（50.125米 × 0.08 = 4.01）', async () => {
  const c = await login('factory')
  const userId = await factoryUserId(c)
  const profile = (await get(c, '/wages/profiles')).find((p) => p.userId === userId)
  await put(c, `/wages/profiles/${profile.id}`, { unitPrice: 0.08 })

  const start = '2026-10-01'
  const end = '2026-10-31'
  await setupReportedOrder(c, 'S4', { date: '2026-10-05', outputM: 50.125 })
  const res = await post(c, '/wages/slips', { periodStart: start, periodEnd: end })
  assert.equal(res.created.length, 1, '应生成 1 张')
  assertNear(res.created[0].pieceAmount, 4.01, 0.005, '逐行舍入: 50.125 × 0.08 = 4.01')
  // 恢复单价，避免影响后续文件
  await put(c, `/wages/profiles/${profile.id}`, { unitPrice: 2.5 })
})
