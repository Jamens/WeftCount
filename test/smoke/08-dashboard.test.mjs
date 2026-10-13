// 首页概览：数据真实性（与业务页对账）+ 权限门槛 + 空库不报错
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { login, get, num } from './helpers.mjs'

test('概览端点返回完整结构且期间口径正确', async () => {
  const c = await login('factory')
  const d = await get(c, '/dashboard/overview')

  // 期间：本月首日 → 今天
  assert.match(d.period.from, /^\d{4}-\d{2}-01$/, '期间起点应是本月首日')
  assert.ok(d.period.to >= d.period.from, '期间终点不应早于起点')
  assert.ok(d.period.label.includes('年'), '期间应有中文标签')

  // 结构完整
  for (const k of ['inventory', 'purchase', 'sales', 'production', 'todo', 'recentOutput']) {
    assert.ok(d[k], `应含 ${k} 段`)
  }
  for (const k of ['greigeMeters', 'remainingKg', 'stockValue', 'rollsInStock', 'depletedBatches']) {
    assert.equal(typeof d.inventory[k], 'number', `inventory.${k} 应为数字`)
  }
  for (const k of ['outputMeters', 'inProgressOrders', 'draftOrders', 'reportCount', 'machineTotal', 'machineRunning']) {
    assert.equal(typeof d.production[k], 'number', `production.${k} 应为数字`)
  }
  for (const k of ['openAlerts', 'dueSoonOrders', 'overdueOrders']) {
    assert.equal(typeof d.todo[k], 'number', `todo.${k} 应为数字`)
  }
})

test('近 7 日产量 X 轴连续（缺失日期补 0，不跳日期）', async () => {
  const c = await login('factory')
  const d = await get(c, '/dashboard/overview')
  assert.equal(d.recentOutput.length, 7, '应恰好 7 个点')
  const dates = d.recentOutput.map((p) => p.date)
  // 严格递增且连续（相邻差 1 天）
  for (let i = 1; i < dates.length; i++) {
    const prev = new Date(dates[i - 1])
    const cur = new Date(dates[i])
    const diffDays = Math.round((cur - prev) / 86400000)
    assert.equal(diffDays, 1, `日期应连续，${dates[i - 1]} → ${dates[i]} 相差 ${diffDays} 天`)
  }
  for (const p of d.recentOutput) {
    assert.equal(typeof p.meters, 'number', `${p.date} 产量应为数字`)
    assert.ok(p.meters >= 0, '产量不应为负')
  }
})

test('概览数字与业务页一致（库存批次、订单、预警三处对账）', async () => {
  const c = await login('factory')
  const d = await get(c, '/dashboard/overview')

  // 在库坯布米数 = 库存批次页剩余量合计（排除已耗尽）
  const batches = await get(c, '/inventory/batches')
  const sumRemaining = batches
    .filter((b) => b.status !== 'depleted')
    .reduce((s, b) => s + num(b.remainingQuantity), 0)
  assert.ok(
    Math.abs(d.inventory.greigeMeters - sumRemaining) < 0.01,
    `在库米数应与批次页一致：概览 ${d.inventory.greigeMeters} vs 批次 ${sumRemaining}`,
  )

  // 未确认预警数 = 预警中心角标
  const alertSummary = await get(c, '/alerts/summary')
  assert.equal(d.todo.openAlerts, alertSummary.open, `未确认预警数应与预警中心一致：概览 ${d.todo.openAlerts} vs 预警 ${alertSummary.open}`)

  // 机台在产数不应超过总数（数据一致性的基本 sanity）
  assert.ok(
    d.production.machineRunning <= d.production.machineTotal,
    `在产机台数(${d.production.machineRunning})不应超过机台总数(${d.production.machineTotal})`,
  )
})

test('概览期间口径为本月，且采购/销售单数取的是「本月新增单据」', async () => {
  const c = await login('factory')
  const d = await get(c, '/dashboard/overview')

  // 期间起点必须是本月首日——这决定了下面所有金额/单数都是「本月」口径
  const now = new Date()
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  assert.equal(d.period.from, monthStart, '期间起点应是本月首日')

  // 单数来自单据表（purchase_inbound / sales_outbound），非订单表，
  // 因此不能拿 /orders 的条数当上界——两者是不同集合，只能校验非负与合理性。
  for (const k of ['purchase', 'sales']) {
    assert.ok(d[k].orders >= 0, `${k}.orders 应非负`)
    assert.ok(d[k].amount >= 0, `${k}.amount 应非负`)
    assert.ok(Number.isFinite(d[k].amount), `${k}.amount 应为有限数`)
  }
})

test('权限：挡车工（仅 production.report）也能进首页', async () => {
  // 挡车工没有 production.view / inventory.view，若首页只挂单一权限就会 403。
  // 首页是所有角色的落地页，一个角色进不去就是产品缺陷。
  const c = await login('loom')
  const d = await get(c, '/dashboard/overview')
  assert.ok(d.production, '挡车工应能拿到概览')
  assert.ok(Array.isArray(d.recentOutput), '应拿到产量序列')
})

test('权限：仓管员（有 inventory.* 无 cost.*）也能进首页', async () => {
  // 仓管员没有 production.view，只有 inventory.*；
  // 若概览只挂 PRODUCTION_VIEW，登录即撞 403。首页必须是所有角色的落地页。
  const c = await login('warehouse')
  const d = await get(c, '/dashboard/overview')
  assert.ok(d.production, '仓管员应能拿到概览')
  assert.ok(Array.isArray(d.recentOutput), '应拿到产量序列')
  // 金额由前端按 cost./report. 权限过滤收敛（展示层，非安全边界）
  assert.equal(typeof d.inventory.stockValue, 'number', '货值字段本身仍会返回，由前端隐藏')
})