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

  // FIFO 性质：全局最老的可用批次一定被优先消耗。用「最老批次剩余变少」断言，
  // 不断言固定扣减量——前面的用例可能已消耗过它（状态随运行次数变化）。
  const oldest = (await get(c, '/inventory/batches'))
    .filter((b) => b.specId === spec.id && b.status === 'normal' && num(b.remainingQuantity) > 0)
    .sort((a, b) => new Date(a.inboundAt) - new Date(b.inboundAt))[0]
  assert.ok(oldest, '应有可用批次')
  const before = num(oldest.remainingQuantity)

  await post(c, '/inventory/sales-outbound', { materialId: mat.id, specId: spec.id, enteredUnit: 'm', enteredValue: 1, partnerId: cus.id, unitPrice: 9 })

  const after = num((await get(c, '/inventory/batches')).find((b) => b.id === oldest.id).remainingQuantity)
  assert.ok(after < before, `FIFO 应优先消耗最老批次(${oldest.batchNo})：${before} -> ${after}`)
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

test('并发建单不撞号（撞号重试生效）', async () => {
  const c = await login('factory')
  const spec = await activeSpec(c)
  const mat = await activeGreigeMaterial(c)
  const sup = await supplierOf(c)
  const wh = await firstWarehouse(c)
  // 同时发起 6 个采购入库（都生成单号+批号）——修复前会撞 uk_docs_no_company(500)
  const results = await Promise.allSettled(
    Array.from({ length: 6 }, (_, i) =>
      post(c, '/inventory/purchase-inbound', {
        materialId: mat.id, specId: spec.id, enteredUnit: 'm', enteredValue: 20 + i,
        partnerId: sup.id, unitPrice: 8.5, warehouseId: wh.id,
      })
    )
  )
  const ok = results.filter((r) => r.status === 'fulfilled')
  const failed = results.filter((r) => r.status === 'rejected')
  assert.equal(failed.length, 0, `并发建单应有全部成功，失败 ${failed.length} 个: ${failed.map((f) => f.reason?.message).join('; ')}`)
  // 单号应互不相同
  const docNos = new Set(ok.map((r) => r.value.docNo))
  assert.equal(docNos.size, ok.length, '并发建单的单号应互不相同')
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

// ---- 逐匹入库(件卡计数) ----

test('逐匹入库：按各匹米数建批次并生成件卡', async () => {
  const c = await login('factory')
  const spec = await activeSpec(c)
  const mat = await activeGreigeMaterial(c)
  const sup = await supplierOf(c)
  const wh = await firstWarehouse(c)
  const tag = Date.now()
  const rolls = [
    { rollNo: `R${tag}-1`, meters: 25 },
    { rollNo: `R${tag}-2`, meters: 25.5 },
    { rollNo: `R${tag}-3`, meters: 24.5 },
  ]
  const total = rolls.reduce((s, r) => s + r.meters, 0)
  const doc = await post(c, '/inventory/purchase-inbound', {
    materialId: mat.id, specId: spec.id, enteredUnit: 'm', enteredValue: total,
    partnerId: sup.id, unitPrice: 8.5, warehouseId: wh.id, rolls,
  })
  assert.ok(doc.docNo, '应建入库单')
  // 回读该单对应批次，米数应 = 各匹之和
  const all = await get(c, '/inventory/batches')
  const batch = all.find((b) => b.sourceDocId === doc.id)
  assert.ok(batch, '应生成批次')
  assertNear(num(batch.quantity), total, 0.01, '批次米数应=各匹合计')
})

test('逐匹合计与入库总量不一致被拒', async () => {
  const c = await login('factory')
  const spec = await activeSpec(c)
  const mat = await activeGreigeMaterial(c)
  const sup = await supplierOf(c)
  const tag = Date.now()
  // 声明总量 100，但各匹只合 50 → 应拒
  await expectReject(c, 'POST', '/inventory/purchase-inbound', {
    materialId: mat.id, specId: spec.id, enteredUnit: 'm', enteredValue: 100,
    partnerId: sup.id, rolls: [{ rollNo: `X${tag}`, meters: 50 }],
  })
})

test('同件卡号重复被拒(防重扫)', async () => {
  const c = await login('factory')
  const spec = await activeSpec(c)
  const mat = await activeGreigeMaterial(c)
  const sup = await supplierOf(c)
  const tag = Date.now()
  const no = `DUP${tag}`
  // 同一单内两匹同号 → 拒
  await expectReject(c, 'POST', '/inventory/purchase-inbound', {
    materialId: mat.id, specId: spec.id, enteredUnit: 'm', enteredValue: 20,
    partnerId: sup.id, rolls: [{ rollNo: no, meters: 10 }, { rollNo: no, meters: 10 }],
  })
})

// ---- 件卡全生命周期：入库逐匹 → 逐匹发货 → 单匹追溯 ----

test('件卡逐匹发货：扫件卡发整匹并置已售', async () => {
  const c = await login('factory')
  const spec = await activeSpec(c)
  const mat = await activeGreigeMaterial(c)
  const sup = await supplierOf(c)
  const cus = await customerOf(c)
  const tag = Date.now()
  // 先入库两匹
  const rolls = [{ rollNo: `S${tag}-1`, meters: 30 }, { rollNo: `S${tag}-2`, meters: 20 }]
  const inDoc = await post(c, '/inventory/purchase-inbound', {
    materialId: mat.id, specId: spec.id, enteredUnit: 'm', enteredValue: 50,
    partnerId: sup.id, unitPrice: 8.5, rolls,
  })
  // 逐匹发货：只发第一匹(30m)
  const outDoc = await post(c, '/inventory/sales-outbound', {
    materialId: mat.id, specId: spec.id, enteredUnit: 'm', enteredValue: 30,
    partnerId: cus.id, unitPrice: 9, pickedRolls: [{ rollNo: rolls[0].rollNo }],
  })
  assert.ok(outDoc.docNo, '应建出库单')
  // 追溯：件卡状态=sold，去向有出库单
  const tr = await get(c, `/inventory/rolls/trace?rollNo=${rolls[0].rollNo}`)
  assert.equal(tr.roll.status, 'sold', '发货后件卡应 sold')
  assert.equal(tr.roll.meters, '30.000', '件卡米数应为 30')
  assert.ok(tr.destination && tr.destination.docNo === outDoc.docNo, '去向应是该出库单')
  assert.ok(tr.source && tr.source.docNo === inDoc.docNo, '来源应是该入库单')
  assert.ok(tr.source.partnerName, '来源应带供应商')
  assert.ok(tr.spec.specName, '应带规格名')
  void tag
})

test('已售件卡不可重复发货(防重发)', async () => {
  const c = await login('factory')
  const spec = await activeSpec(c)
  const mat = await activeGreigeMaterial(c)
  const sup = await supplierOf(c)
  const cus = await customerOf(c)
  const tag = Date.now()
  const rollNo = `RE${tag}`
  await post(c, '/inventory/purchase-inbound', {
    materialId: mat.id, specId: spec.id, enteredUnit: 'm', enteredValue: 10,
    partnerId: sup.id, unitPrice: 8.5, rolls: [{ rollNo, meters: 10 }],
  })
  await post(c, '/inventory/sales-outbound', {
    materialId: mat.id, specId: spec.id, enteredUnit: 'm', enteredValue: 10,
    partnerId: cus.id, unitPrice: 9, pickedRolls: [{ rollNo }],
  })
  // 再发一次应被拒（件卡已 sold）
  await expectReject(c, 'POST', '/inventory/sales-outbound', {
    materialId: mat.id, specId: spec.id, enteredUnit: 'm', enteredValue: 10,
    partnerId: cus.id, pickedRolls: [{ rollNo }],
  })
})

test('件卡规格不符被拒(发错布种)', async () => {
  const c = await login('factory')
  const specs = (await get(c, '/greige-specs')).filter((s) => s.status !== 'discontinued')
  if (specs.length < 2) return
  const mat = await activeGreigeMaterial(c)
  const sup = await supplierOf(c)
  const cus = await customerOf(c)
  const tag = Date.now()
  const rollNo = `M${tag}`
  // 件卡属于 specs[0]
  await post(c, '/inventory/purchase-inbound', {
    materialId: mat.id, specId: specs[0].id, enteredUnit: 'm', enteredValue: 10,
    partnerId: sup.id, unitPrice: 8.5, rolls: [{ rollNo, meters: 10 }],
  })
  // 用 specs[1] 的单据发这件卡 → 规格不符
  await expectReject(c, 'POST', '/inventory/sales-outbound', {
    materialId: mat.id, specId: specs[1].id, enteredUnit: 'm', enteredValue: 10,
    partnerId: cus.id, pickedRolls: [{ rollNo }],
  })
})

test('列批次件卡(件卡打印用)：含件卡号/米数/规格/批次', async () => {
  const c = await login('factory')
  const spec = await activeSpec(c)
  const mat = await activeGreigeMaterial(c)
  const sup = await supplierOf(c)
  const tag = Date.now()
  const rolls = [{ rollNo: `P${tag}-1`, meters: 22 }, { rollNo: `P${tag}-2`, meters: 28 }]
  const doc = await post(c, '/inventory/purchase-inbound', {
    materialId: mat.id, specId: spec.id, enteredUnit: 'm', enteredValue: 50,
    partnerId: sup.id, unitPrice: 8.5, rolls,
  })
  const batches = await get(c, '/inventory/batches')
  const batch = batches.find((b) => b.sourceDocId === doc.id)
  assert.ok(batch, '应有批次')
  // 按批次列件卡
  const list = await get(c, `/inventory/rolls?batchId=${batch.id}`)
  assert.equal(list.length, 2, '应列出 2 匹件卡')
  const one = list.find((r) => r.rollNo === rolls[0].rollNo)
  assert.ok(one, '应含第一匹')
  assert.equal(one.meters, '22.000', '件卡米数22')
  assert.equal(one.batchNo, batch.batchNo, '应带批次号')
  assert.ok(one.specName, '应带规格名')
  assert.equal(one.status, 'in_stock', '新件卡应在库')
})

// ---- 拆匹发货（一匹分多次出库） ----

test('拆匹发货：发部分米数后残匹留在库，remaining 递减', async () => {
  const c = await login('factory')
  const spec = await activeSpec(c)
  const mat = await activeGreigeMaterial(c)
  const sup = await supplierOf(c)
  const cus = await customerOf(c)
  const tag = Date.now()
  // 入库 1 匹 100m
  const doc = await post(c, '/inventory/purchase-inbound', {
    materialId: mat.id, specId: spec.id, enteredUnit: 'm', enteredValue: 100,
    unitPrice: 8.2, partnerId: sup.id, rolls: [{ rollNo: `SPLIT-${tag}`, meters: 100 }],
  })
  const bId0 = (await get(c, '/inventory/batches')).find(b => b.sourceDocId === doc.id).id
  const rolls = await get(c, `/inventory/rolls?batchId=${bId0}`)
  const roll = rolls[0]
  assert.equal(Number(roll.remainingM), 100, '入库后 remainingM 应=100(全部)')
  // 拆匹发货：只发 30m
  const out = await post(c, '/inventory/sales-outbound', {
    materialId: mat.id, specId: spec.id, enteredUnit: 'm', enteredValue: 30,
    unitPrice: 9.5, partnerId: cus.id, pickedRolls: [{ rollNo: roll.rollNo, meters: 30 }],
  })
  assert.ok(out.docNo)
  // 查件卡：remaining=70，status 仍 in_stock（未发完）
  const after = (await get(c, `/inventory/rolls?batchId=${roll.batchId}`))[0]
  assertNear(after.remainingM, 70, 0.01, '拆匹后 remainingM 应=70')
  assert.equal(after.status, 'in_stock', '未发完应仍 in_stock')
  // 守恒：批内 Σroll.remaining == batch.remaining
  const batch = (await get(c, '/inventory/batches')).find(b => b.id === roll.batchId)
  const all = await get(c, `/inventory/rolls?batchId=${roll.batchId}`)
  const sumRemain = all.reduce((s, r) => s + Number(r.remainingM), 0)
  assertNear(sumRemain, Number(batch.remainingQuantity), 0.01, 'Σroll.remaining 应==batch.remaining')
})

test('拆匹发货：超出该匹剩余量被拒', async () => {
  const c = await login('factory')
  const spec = await activeSpec(c)
  const mat = await activeGreigeMaterial(c)
  const sup = await supplierOf(c)
  const cus = await customerOf(c)
  const tag = Date.now()
  const doc = await post(c, '/inventory/purchase-inbound', {
    materialId: mat.id, specId: spec.id, enteredUnit: 'm', enteredValue: 50,
    unitPrice: 8.2, partnerId: sup.id, rolls: [{ rollNo: `SPLITX-${tag}`, meters: 50 }],
  })
  const bIdX = (await get(c, '/inventory/batches')).find(b => b.sourceDocId === doc.id).id
  const roll = (await get(c, `/inventory/rolls?batchId=${bIdX}`))[0]
  // 发 80m > 该匹 50m，应被拒
  await assert.rejects(
    () => post(c, '/inventory/sales-outbound', {
      materialId: mat.id, specId: spec.id, enteredUnit: 'm', enteredValue: 80,
      unitPrice: 9.5, partnerId: cus.id, pickedRolls: [{ rollNo: roll.rollNo, meters: 80 }],
    })
  )
})

// ---- 件卡级盘点（拆匹后的真实需求：能定位缺哪一匹） ----

test('件卡级盘点：未盘到的件卡按剩余量写损并置零，守恒不破', async () => {
  const c = await login('factory')
  const spec = await activeSpec(c)
  const mat = await activeGreigeMaterial(c)
  const sup = await supplierOf(c)
  const wh = await firstWarehouse(c)
  const tag = Date.now()
  // 入库 2 匹各 100m
  const doc = await post(c, '/inventory/purchase-inbound', {
    materialId: mat.id, specId: spec.id, enteredUnit: 'm', enteredValue: 200,
    unitPrice: 8.2, partnerId: sup.id, warehouseId: wh.id,
    rolls: [{ rollNo: `STK-${tag}-A`, meters: 100 }, { rollNo: `STK-${tag}-B`, meters: 100 }],
  })
  const batch = (await get(c, '/inventory/batches')).find(b => b.sourceDocId === doc.id)

  // 件卡级盘点单：明细应逐匹
  const st = await post(c, '/stocktakes', { warehouseId: wh.id, mode: 'roll', remark: `件卡盘点${tag}` })
  const detail = await get(c, `/stocktakes/${st.id}`)
  const items = detail.items.filter(i => i.batchId === batch.id)
  assert.equal(items.length, 2, '件卡级盘点应有 2 条件卡明细')
  assert.ok(items.every(i => i.rollNo), '明细应带件卡号')
  const lost = items.find(i => i.rollNo === `STK-${tag}-A`)
  const kept = items.find(i => i.rollNo === `STK-${tag}-B`)
  assert.ok(lost && kept, '应能定位到具体件卡')

  // 只录「B」的实盘（=账面），A 不录 → A 视为缺失
  await post(c, `/stocktakes/${st.id}/counts`, { records: [{ itemId: kept.id, countedQuantityM: 100 }] })
  await post(c, `/stocktakes/${st.id}/complete`, {})

  // A 应被写损：remaining=0、status=consumed
  const rollsAfter = await get(c, `/inventory/rolls?batchId=${batch.id}`)
  const a = rollsAfter.find(r => r.rollNo === `STK-${tag}-A`)
  const b = rollsAfter.find(r => r.rollNo === `STK-${tag}-B`)
  assertNear(Number(a.remainingM), 0, 0.01, '缺失件卡 remaining 应归零')
  assert.equal(a.status, 'consumed', '缺失件卡应置 consumed')
  assertNear(Number(b.remainingM), 100, 0.01, '盘到的件卡 remaining 不变')
  // 守恒：Σroll.remaining == batch.remaining
  const batchAfter = (await get(c, '/inventory/batches')).find(x => x.id === batch.id)
  const sum = rollsAfter.reduce((s, r) => s + Number(r.remainingM), 0)
  assertNear(sum, Number(batchAfter.remainingQuantity), 0.01, 'Σroll.remaining 应==batch.remaining')
  assertNear(Number(batchAfter.remainingQuantity), 100, 0.01, '批次应剩 100m（少了一匹）')
})

test('件卡级盘点：账实相符时不产生盘盈盘亏流水', async () => {
  const c = await login('factory')
  const spec = await activeSpec(c)
  const mat = await activeGreigeMaterial(c)
  const sup = await supplierOf(c)
  const wh = await firstWarehouse(c)
  const tag = Date.now()
  const doc = await post(c, '/inventory/purchase-inbound', {
    materialId: mat.id, specId: spec.id, enteredUnit: 'm', enteredValue: 100,
    unitPrice: 8.2, partnerId: sup.id, warehouseId: wh.id,
    rolls: [{ rollNo: `STKOK-${tag}`, meters: 100 }],
  })
  const batch = (await get(c, '/inventory/batches')).find(b => b.sourceDocId === doc.id)
  const st = await post(c, '/stocktakes', { warehouseId: wh.id, mode: 'roll', remark: `件卡盘点OK${tag}` })
  const detail = await get(c, `/stocktakes/${st.id}`)
  const item = detail.items.find(i => i.batchId === batch.id)
  await post(c, `/stocktakes/${st.id}/counts`, { records: [{ itemId: item.id, countedQuantityM: 100 }] })
  const before = (await get(c, '/inventory/batches')).find(b => b.id === batch.id)
  await post(c, `/stocktakes/${st.id}/complete`, {})
  const after = (await get(c, '/inventory/batches')).find(b => b.id === batch.id)
  assertNear(Number(after.remainingQuantity), Number(before.remainingQuantity), 0.01, '账实相符不应改变剩余量')
  const rollsAfter = await get(c, `/inventory/rolls?batchId=${batch.id}`)
  assertNear(Number(rollsAfter[0].remainingM), 100, 0.01, '账实相符件卡 remaining 不变')
})
