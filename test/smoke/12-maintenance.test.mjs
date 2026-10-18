// 设备维保：保养计划自动推算到期、录维保回写计划/机台、备件扣减与低库存拒收、故障 MTBF
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { login, get, post, expectReject, num } from './helpers.mjs'

async function firstMachine(c) {
  const machines = await get(c, '/machines')
  assert.ok(machines.length > 0, '需存在演示机台用于维保测试')
  return machines[0]
}

test('新建保养计划：按天循环自动推算下次到期日', async () => {
  const c = await login('factory')
  const m = await firstMachine(c)
  const plan = await post(c, '/machine-maintenance/plans', {
    machineId: m.id, planName: '周巡检', type: 'inspect', cycleType: 'day', cycleValue: 7,
    lastDoneDate: '2026-04-01', responsible: '张三',
  })
  assert.ok(plan.id, '应返回计划 id')
  assert.equal(plan.nextDueDate, '2026-04-08', '按天循环: 4-01 + 7 天 = 4-08')
})

test('计划关联不存在机台被拒', async () => {
  const c = await login('factory')
  const msg = await expectReject(c, 'POST', '/machine-maintenance/plans', {
    machineId: 'non-existent-machine-id', planName: 'x',
  })
  assert.match(msg, /机台/, '机台不存在应被拒')
})

test('录计划保养：回写计划 lastDone/nextDue 与机台最近维保日期，并扣减备件库存', async () => {
  const c = await login('factory')
  const m = await firstMachine(c)
  const plan = await post(c, '/machine-maintenance/plans', {
    machineId: m.id, planName: '月润滑', type: 'lubricate', cycleType: 'day', cycleValue: 30,
  })
  const part = await post(c, '/machine-maintenance/spare-parts', {
    partCode: 'P-' + Date.now(), name: '润滑油', unit: '瓶', stock: 10, minStock: 2,
  })
  const before = (await get(c, '/machine-maintenance/spare-parts')).records.find((p) => p.id === part.id)

  const rec = await post(c, '/machine-maintenance/records', {
    machineId: m.id, planId: plan.id, type: 'planned', category: '加润滑油',
    date: '2026-04-10', durationMin: 30, cost: 50, result: 'ok',
    spareParts: [{ partId: part.id, qty: 2, cost: 20 }],
  })
  assert.ok(rec.id, '应返回记录 id')

  const planAfter = await get(c, `/machine-maintenance/plans/${plan.id}`)
  assert.equal(planAfter.lastDoneDate, '2026-04-10', '计划 lastDone 回写为记录日期')
  assert.equal(planAfter.nextDueDate, '2026-05-10', '计划 nextDue 顺延 30 天')

  const machineAfter = (await get(c, '/machines')).find((x) => x.id === m.id)
  assert.equal(machineAfter.lastMaintenanceDate, '2026-04-10', '机台 last_maintenance_date 回写')

  const partAfter = (await get(c, '/machine-maintenance/spare-parts')).records.find((p) => p.id === part.id)
  assertNear(partAfter.stock, num(before.stock) - 2, 0.01, '备件库存扣减 2')
})

test('备件库存不足：录维保被拒', async () => {
  const c = await login('factory')
  const m = await firstMachine(c)
  const part = await post(c, '/machine-maintenance/spare-parts', {
    partCode: 'Q-' + Date.now(), name: '皮带', unit: '条', stock: 1, minStock: 0,
  })
  const msg = await expectReject(c, 'POST', '/machine-maintenance/records', {
    machineId: m.id, type: 'planned', category: '换皮带',
    date: '2026-04-11',
    spareParts: [{ partId: part.id, qty: 5, cost: 10 }], // 库存仅 1
  })
  assert.match(msg, /库存不足|不足/, '备件超额应被拒')
})

test('故障停机计入 MTBF 统计（平均间隔、总停机）', async () => {
  const c = await login('factory')
  const m = await firstMachine(c)
  await post(c, '/machine-maintenance/records', {
    machineId: m.id, type: 'breakdown', category: '经轴卡死',
    date: '2026-03-01', downtimeMin: 120, result: 'failed',
  })
  await post(c, '/machine-maintenance/records', {
    machineId: m.id, type: 'breakdown', category: '综丝断裂',
    date: '2026-03-15', downtimeMin: 60, result: 'ok',
  })
  const mtbf = await get(c, '/machine-maintenance/mtbf')
  const row = mtbf.find((r) => r.machineId === m.id)
  assert.ok(row, 'MTBF 应包含该机台')
  assert.equal(row.breakdownCount, 2, '故障次数 = 2')
  assert.equal(row.totalDowntimeMin, 180, '总停机 = 180 分')
  assertNear(row.mtbfDays, 14, 0.01, '平均间隔 ≈ 14 天')
})

test('总览反映设备数 / 启用计划 / 备件预警', async () => {
  const c = await login('factory')
  const ov = await get(c, '/machine-maintenance/overview')
  assert.ok(ov.totalMachines > 0, '设备数应 > 0')
  assert.equal(typeof ov.activePlans, 'number', 'activePlans 应为数字')
  assert.equal(typeof ov.lowStockParts, 'number', 'lowStockParts 应为数字')
  assert.equal(typeof ov.overduePlans, 'number', 'overduePlans 应为数字')
})

function assertNear(actual, expected, eps, msg) {
  assert.ok(Math.abs(Number(actual) - Number(expected)) <= eps, `${msg}：期望≈${expected}，实际=${actual}`)
}
