// 应收账款 / 客户对账：录收款核销多张单、台账未收额、账龄、作废回退
//
// 不依赖品等计价路径——走最简单的「显式单价销售出库」即可产生一张应收，
// 把应收模块自己的核销/台账/账龄/对账单/作废逻辑覆盖到。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { login, get, post, expectReject, activeSpec, activeGreigeMaterial, supplierOf, customerOf, firstWarehouse, num } from './helpers.mjs'

// 确保指定规格有库存（销售出库要消耗），再开一张显式单价的销售出库单
async function sellOut(c, { meters = 50, unitPrice = 10 } = {}) {
  const spec = await activeSpec(c)
  const mat = await activeGreigeMaterial(c)
  const cus = await customerOf(c)
  const sup = await supplierOf(c)
  await post(c, '/inventory/purchase-inbound', {
    materialId: mat.id, specId: spec.id, enteredUnit: 'm', enteredValue: meters + 20,
    partnerId: sup.id, unitPrice: 8.5,
  })
  const doc = await post(c, '/inventory/sales-outbound', {
    materialId: mat.id, specId: spec.id, enteredUnit: 'm', enteredValue: meters,
    partnerId: cus.id, unitPrice,
  })
  return { doc, cus }
}

test('销售出库自动成为应收（台账显示未收=应收总额）', async () => {
  const c = await login('factory')
  const { doc } = await sellOut(c)
  const ledger = await get(c, '/receivables/ledger')
  const row = ledger.find((r) => r.docNo === doc.docNo)
  assert.ok(row, `台账应包含出库单 ${doc.docNo}`)
  assertNear(row.totalAmount, num(doc.totalAmount), 0.01, '台账应收=出库单金额')
  assertNear(row.uncollected, num(doc.totalAmount), 0.01, '未核销前未收=应收总额')
  assert.equal(row.settledAmount, 0, 'initial settled 应为 0')
})

test('录收款核销多张单：台账未收随核销减少', async () => {
  const c = await login('factory')
  const { doc } = await sellOut(c, { meters: 100, unitPrice: 10 })
  const ledger = await get(c, '/receivables/ledger')
  const row = ledger.find((r) => r.docNo === doc.docNo)
  const docId = row.docId
  const total = row.totalAmount

  // 分两张收款冲抵：第一笔 30，第二笔 20
  const r1 = await post(c, '/receivables/receipts', {
    partnerId: row.partnerId, receiptDate: '2026-03-20', amount: 30, method: 'bank',
    applications: [{ docId, appliedAmount: 30 }],
  })
  assert.ok(r1.id, '应返回收款单 id')
  const r2 = await post(c, '/receivables/receipts', {
    partnerId: row.partnerId, receiptDate: '2026-03-21', amount: 20, method: 'cash',
    applications: [{ docId, appliedAmount: 20 }],
  })
  assert.ok(r2.id, '应返回收款单 id')

  const after = (await get(c, '/receivables/ledger')).find((r) => r.docId === docId)
  assertNear(after.settledAmount, 50, 0.01, '两张收款合计已收 50')
  assertNear(after.uncollected, total - 50, 0.01, '未收 = 总额 - 已收')
})

test('核销分配合计必须等于收款额', async () => {
  const c = await login('factory')
  const { doc } = await sellOut(c, { meters: 80, unitPrice: 10 })
  const row = (await get(c, '/receivables/ledger')).find((r) => r.docNo === doc.docNo)
  const msg = await expectReject(c, 'POST', '/receivables/receipts', {
    partnerId: row.partnerId, receiptDate: '2026-03-20', amount: 100, method: 'bank',
    applications: [{ docId: row.docId, appliedAmount: 30 }], // 只分配 30 ≠ 100
  })
  assert.match(msg, /不一致|核销/, '分配合计≠收款额应被拒')
})

test('核销超额被拒（已收+本次>应收）', async () => {
  const c = await login('factory')
  const { doc } = await sellOut(c, { meters: 40, unitPrice: 10 })
  const row = (await get(c, '/receivables/ledger')).find((r) => r.docNo === doc.docNo)
  const msg = await expectReject(c, 'POST', '/receivables/receipts', {
    partnerId: row.partnerId, receiptDate: '2026-03-20', amount: 999, method: 'bank',
    applications: [{ docId: row.docId, appliedAmount: 999 }], // 远超应收 400
  })
  assert.match(msg, /超额|大于|应收/, '核销超额应被拒')
})

test('收款必须是客户（供应商被拒）', async () => {
  const c = await login('factory')
  const sup = await supplierOf(c)
  const msg = await expectReject(c, 'POST', '/receivables/receipts', {
    partnerId: sup.id, receiptDate: '2026-03-20', amount: 10, method: 'bank',
    applications: [],
  })
  assert.match(msg, /客户|不是/, '非客户应被拒')
})

test('账龄分析按客户汇总未收额', async () => {
  const c = await login('factory')
  const { doc, cus } = await sellOut(c, { meters: 60, unitPrice: 10 })
  const aging = await get(c, '/receivables/aging')
  const agg = aging.find((a) => a.partnerId === cus.id)
  assert.ok(agg, `账龄应包含客户 ${cus.name}`)
  assert.ok(agg.total >= num(doc.totalAmount) - 0.01, '客户账龄合计应含本单未收')
})

test('作废收款回退已核销额', async () => {
  const c = await login('factory')
  const { doc } = await sellOut(c, { meters: 70, unitPrice: 10 })
  const row = (await get(c, '/receivables/ledger')).find((r) => r.docNo === doc.docNo)
  const docId = row.docId
  const total = row.totalAmount
  const r = await post(c, '/receivables/receipts', {
    partnerId: row.partnerId, receiptDate: '2026-03-20', amount: 40, method: 'bank',
    applications: [{ docId, appliedAmount: 40 }],
  })
  const mid = (await get(c, '/receivables/ledger')).find((r) => r.docId === docId)
  assertNear(mid.uncollected, total - 40, 0.01, '核销后未收减少')

  await post(c, `/receivables/receipts/${r.id}/void`, {})
  const back = (await get(c, '/receivables/ledger')).find((r) => r.docId === docId)
  assertNear(back.settledAmount, 0, 0.01, '作废后已收归零')
  assertNear(back.uncollected, total, 0.01, '作废后未收恢复为总额')
})

test('对账单返回发货与收款流水', async () => {
  const c = await login('factory')
  const { doc, cus } = await sellOut(c, { meters: 50, unitPrice: 10 })
  const ledger = await get(c, '/receivables/ledger')
  const row = ledger.find((r) => r.docNo === doc.docNo)
  await post(c, '/receivables/receipts', {
    partnerId: cus.id, receiptDate: '2026-03-20', amount: 25, method: 'bank',
    applications: [{ docId: row.docId, appliedAmount: 25 }],
  })
  const st = await get(c, '/receivables/statement', { partnerId: cus.id })
  assert.ok(st.lines.some((l) => l.kind === 'invoice' && l.docNo === doc.docNo), '对账单应有本单发货行')
  assert.ok(st.lines.some((l) => l.kind === 'receipt'), '对账单应有收款行')
  assertNear(st.totalDebit, num(doc.totalAmount), 0.01, '借方=发货总额')
  assertNear(st.totalCredit, 25, 0.01, '贷方=收款额')
})

// 小数比较：金额经 JSON 序列化为字符串，helpers.num 转 number
function assertNear(actual, expected, eps, msg) {
  assert.ok(Math.abs(Number(actual) - Number(expected)) <= eps, `${msg}：期望≈${expected}，实际=${actual}`)
}
