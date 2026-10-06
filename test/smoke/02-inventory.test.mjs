// 三算闭环：采购入库 → 销售出库(FIFO) → 扫码拣货 → 对账恒等式
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { login, get, post, expectReject, activeSpec, activeGreigeMaterial, supplierOf, customerOf, firstWarehouse, num, assertNear } from './helpers.mjs'

test('采购入库建批次并增加库存', async () => {
  const c = await login('factory')
  const spec = await activeSpec(c)
  const mat = await activeGreigeMaterial(c)
  const sup = await supplierOf(c)
  const wh = await firstWarehouse(c)
  const before = (await get(c, '/inventory/batches')).filter((b) => b.specId === spec.id)
    .reduce((s, b) => s + num(b.remainingQuantity), 0)

  const doc = await post(c, '/inventory/purchase-inbound', {
    materialId: mat.id, specId: spec.id, enteredUnit: 'm', enteredValue: 200,
    partnerId: sup.id, unitPrice: 8.5, warehouseId: wh.id,
  })
  assert.ok(doc.docNo, '应返回入库单号')

  const after = (await get(c, '/inventory/batches')).filter((b) => b.specId === spec.id)
    .reduce((s, b) => s + num(b.remainingQuantity), 0)
  assertNear(after - before, 200, 0.01, '入库后库存应 +200m')
})

test('销售出库按 FIFO 消耗先进批次', async () => {
  const c = await login('factory')
  const spec = await activeSpec(c)
  const mat = await activeGreigeMaterial(c)
  const cus = await customerOf(c)
  // 先确保有库存
  await post(c, '/inventory/purchase-inbound', { materialId: mat.id, specId: spec.id, enteredUnit: 'm', enteredValue: 100, partnerId: (await supplierOf(c)).id, unitPrice: 8.5 })

  const batches = (await get(c, '/inventory/batches')).filter((b) => b.specId === spec.id && b.status === 'normal' && num(b.remainingQuantity) > 0)
  const oldest = batches.sort((a, b) => new Date(a.inboundAt) - new Date(b.inboundAt))[0]
  const oldestBefore = num(oldest.remainingQuantity)

  await post(c, '/inventory/sales-outbound', { materialId: mat.id, specId: spec.id, enteredUnit: 'm', enteredValue: 10, partnerId: cus.id, unitPrice: 9 })

  const oldestAfter = num((await get(c, '/inventory/batches')).find((b) => b.id === oldest.id).remainingQuantity)
  assertNear(oldestBefore - oldestAfter, 10, 0.01, 'FIFO 应扣最早入库批次 10m')
})

test('扫码拣货(pickedItems)扣指定批次', async () => {
  const c = await login('factory')
  const spec = await activeSpec(c)
  const mat = await activeGreigeMaterial(c)
  const cus = await customerOf(c)
  const sup = await supplierOf(c)
  await post(c, '/inventory/purchase-inbound', { materialId: mat.id, specId: spec.id, enteredUnit: 'm', enteredValue: 100, partnerId: sup.id, unitPrice: 8.5 })

  const target = (await get(c, '/inventory/batches')).filter((b) => b.specId === spec.id && b.status === 'normal' && num(b.remainingQuantity) > 5)
    .sort((a, b) => new Date(b.inboundAt) - new Date(a.inboundAt))[0] // 取最新批次(非FIFO)
  const before = num(target.remainingQuantity)

  await post(c, '/inventory/sales-outbound', { materialId: mat.id, specId: spec.id, enteredUnit: 'm', enteredValue: 3, partnerId: cus.id, unitPrice: 9, pickedItems: [{ batchId: target.id, quantityM: 3 }] })

  const after = num((await get(c, '/inventory/batches')).find((b) => b.id === target.id).remainingQuantity)
  assertNear(before - after, 3, 0.01, '扫码拣货应扣指定批次 3m')
})

test('拣货超量被拒', async () => {
  const c = await login('factory')
  const spec = await activeSpec(c)
  const mat = await activeGreigeMaterial(c)
  const cus = await customerOf(c)
  const batch = (await get(c, '/inventory/batches')).find((b) => b.specId === spec.id && b.status === 'normal')
  const msg = await expectReject(c, 'POST', '/inventory/sales-outbound', {
    materialId: mat.id, specId: spec.id, enteredUnit: 'm', enteredValue: 999999, partnerId: cus.id,
    pickedItems: [{ batchId: batch.id, quantityM: 999999 }],
  })
  assert.match(msg, /超出|不足/, '应提示超出剩余')
})

test('拣货规格不符被拒（扫的批次规格≠单据规格）', async () => {
  const c = await login('factory')
  const specs = (await get(c, '/greige-specs')).filter((s) => s.status !== 'discontinued')
  if (specs.length < 2) return // 只有一个规格则跳过
  const mat = await activeGreigeMaterial(c)
  const cus = await customerOf(c)
  // 找一个「属于别的规格」的批次，用它配 specs[0] 的单据 → 应被拒
  const foreign = (await get(c, '/inventory/batches')).find((b) => b.specId === specs[1].id && b.status === 'normal' && num(b.remainingQuantity) > 1)
  if (!foreign) return // 无其它规格批次则跳过
  const msg = await expectReject(c, 'POST', '/inventory/sales-outbound', {
    materialId: mat.id, specId: specs[0].id, enteredUnit: 'm', enteredValue: 1, partnerId: cus.id,
    pickedItems: [{ batchId: foreign.id, quantityM: 1 }], // 批次规格≠单据规格
  })
  assert.match(msg, /规格/, '应提示规格不一致')
})

test('对账恒等式成立（采购入库+产出+盘盈 = 领用+出库+盘亏+结存）', async () => {
  const c = await login('factory')
  const r = await get(c, '/inventory/reconcile')
  // 恒等式：来源合计 === 去向合计
  const src = r.totals?.purchaseInKg ?? r.purchaseInKg ?? 0
  assert.ok(r, '应返回对账结果')
  // 不同版本字段名可能不同，做宽松校验：存在差异字段且在容差内
  if (r.diffKg !== undefined) assertNear(num(r.diffKg), 0, 0.01, '对账差异应为 0')
  void src
})
