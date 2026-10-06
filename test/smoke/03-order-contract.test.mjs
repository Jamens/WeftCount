// 订单多明细 + 按行履约进度 + 合同/价格
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { login, get, post, expectReject, activeGreigeMaterial, supplierOf, assertNear, num } from './helpers.mjs'

test('创建多明细订单，表头汇总=各行之和', async () => {
  const c = await login('factory')
  let specs = (await get(c, '/greige-specs')).filter((s) => s.status !== 'discontinued')
  // 自建第二个规格：干净库里 seed 只有 1 个规格，若不补，两条明细会落到同一规格，
  // 协议价查询拿到的是后一条(8.8)而非 7.7——**测试必须自备数据，不能依赖库里的存量**
  if (specs.length < 2) {
    await post(c, '/greige-specs', {
      name: `合同测试规格${Date.now()}`, finishedWidth: 140, warpDensity: 100, weftDensity: 60,
      weaveType: 'plain', warpCount: { value: 40, system: 'NeS' }, weftCount: { value: 40, system: 'NeS' },
    })
    specs = (await get(c, '/greige-specs')).filter((s) => s.status !== 'discontinued')
  }
  const mat = await activeGreigeMaterial(c)
  const sup = await supplierOf(c)
  const s2 = specs[1] ?? specs[0]

  const o = await post(c, '/orders', {
    orderType: 'purchase', partnerId: sup.id,
    items: [
      { materialId: mat.id, specId: specs[0].id, orderedUnit: 'kg', orderedValue: 1000, unitPrice: 8 },
      { materialId: mat.id, specId: s2.id, orderedUnit: 'kg', orderedValue: 1000, unitPrice: 9 },
    ],
  })
  assert.ok(o.orderNo, '应返回订单号')

  const d = await get(c, '/orders/' + o.id)
  assert.equal(d.items.length, 2, '应有 2 条明细')
  const sum = d.items.reduce((s, i) => s + num(i.quantityM), 0)
  assertNear(num(d.order.totalQuantityM), sum, 0.01, '表头汇总=各行折米之和')
})

test('按行挂单：单据物料/规格须命中订单某一明细行', async () => {
  const c = await login('factory')
  let specs = (await get(c, '/greige-specs')).filter((s) => s.status !== 'discontinued')
  // 自建第二个规格：干净库里 seed 只有 1 个规格，若不补，两条明细会落到同一规格，
  // 协议价查询拿到的是后一条(8.8)而非 7.7——**测试必须自备数据，不能依赖库里的存量**
  if (specs.length < 2) {
    await post(c, '/greige-specs', {
      name: `合同测试规格${Date.now()}`, finishedWidth: 140, warpDensity: 100, weftDensity: 60,
      weaveType: 'plain', warpCount: { value: 40, system: 'NeS' }, weftCount: { value: 40, system: 'NeS' },
    })
    specs = (await get(c, '/greige-specs')).filter((s) => s.status !== 'discontinued')
  }
  const mat = await activeGreigeMaterial(c)
  const sup = await supplierOf(c)

  const o = await post(c, '/orders', {
    orderType: 'purchase', partnerId: sup.id,
    items: [{ materialId: mat.id, specId: specs[0].id, orderedUnit: 'kg', orderedValue: 1000, unitPrice: 8 }],
  })
  await post(c, '/orders/' + o.id + '/confirm', {})

  // 挂一个命中行的入库单
  await post(c, '/inventory/purchase-inbound', { materialId: mat.id, specId: specs[0].id, enteredUnit: 'm', enteredValue: 50, partnerId: sup.id, orderId: o.id })

  const d = await get(c, '/orders/' + o.id)
  assert.equal(d.perItem.length, 1, '应有 1 行进度')
  assertNear(d.perItem[0].fulfilledM, 50, 0.01, '该行已履约 50m')
  assert.ok(d.perItem[0].progressPct > 0, '行进度应 > 0')
})

test('按行挂单：规格不在订单内被拒', async () => {
  const c = await login('factory')
  const specs = (await get(c, '/greige-specs')).filter((s) => s.status !== 'discontinued')
  if (specs.length < 2) return
  const mat = await activeGreigeMaterial(c)
  const sup = await supplierOf(c)
  const o = await post(c, '/orders', {
    orderType: 'purchase', partnerId: sup.id,
    items: [{ materialId: mat.id, specId: specs[0].id, orderedUnit: 'kg', orderedValue: 1000, unitPrice: 8 }],
  })
  await post(c, '/orders/' + o.id + '/confirm', {})
  // 用别的规格挂单应被拒
  const msg = await expectReject(c, 'POST', '/inventory/purchase-inbound', {
    materialId: mat.id, specId: specs[1].id, enteredUnit: 'm', enteredValue: 10, partnerId: sup.id, orderId: o.id,
  })
  assert.match(msg, /明细行|规格/, '应提示规格不在订单明细行')
})

test('仅已确认订单可挂单（草稿不可）', async () => {
  const c = await login('factory')
  let specs = (await get(c, '/greige-specs')).filter((s) => s.status !== 'discontinued')
  // 自建第二个规格：干净库里 seed 只有 1 个规格，若不补，两条明细会落到同一规格，
  // 协议价查询拿到的是后一条(8.8)而非 7.7——**测试必须自备数据，不能依赖库里的存量**
  if (specs.length < 2) {
    await post(c, '/greige-specs', {
      name: `合同测试规格${Date.now()}`, finishedWidth: 140, warpDensity: 100, weftDensity: 60,
      weaveType: 'plain', warpCount: { value: 40, system: 'NeS' }, weftCount: { value: 40, system: 'NeS' },
    })
    specs = (await get(c, '/greige-specs')).filter((s) => s.status !== 'discontinued')
  }
  const mat = await activeGreigeMaterial(c)
  const sup = await supplierOf(c)
  const o = await post(c, '/orders', {
    orderType: 'purchase', partnerId: sup.id,
    items: [{ materialId: mat.id, specId: specs[0].id, orderedUnit: 'kg', orderedValue: 500, unitPrice: 8 }],
  })
  // 未确认(草稿)直接挂单应被拒
  await expectReject(c, 'POST', '/inventory/purchase-inbound', { materialId: mat.id, specId: specs[0].id, enteredUnit: 'm', enteredValue: 5, partnerId: sup.id, orderId: o.id })
})

test('合同多明细 + 生效 + 协议价查询', async () => {
  const c = await login('factory')
  let specs = (await get(c, '/greige-specs')).filter((s) => s.status !== 'discontinued')
  // 自建第二个规格：干净库里 seed 只有 1 个规格，若不补，两条明细会落到同一规格，
  // 协议价查询拿到的是后一条(8.8)而非 7.7——**测试必须自备数据，不能依赖库里的存量**
  if (specs.length < 2) {
    await post(c, '/greige-specs', {
      name: `合同测试规格${Date.now()}`, finishedWidth: 140, warpDensity: 100, weftDensity: 60,
      weaveType: 'plain', warpCount: { value: 40, system: 'NeS' }, weftCount: { value: 40, system: 'NeS' },
    })
    specs = (await get(c, '/greige-specs')).filter((s) => s.status !== 'discontinued')
  }
  const mat = await activeGreigeMaterial(c)
  const sup = await supplierOf(c)
  const ct = await post(c, '/contracts', {
    contractType: 'purchase', partnerId: sup.id,
    items: [
      { materialId: mat.id, specId: specs[0].id, agreedPrice: 7.7, agreedQuantityM: 50000 },
      { materialId: mat.id, specId: (specs[1] ?? specs[0]).id, agreedPrice: 8.8, agreedQuantityM: 30000 },
    ],
  })
  assert.ok(ct.contractNo, '应返回合同号')
  const detail = await get(c, '/contracts/' + ct.id)
  assert.equal(detail.items.length, 2, '合同应有 2 条明细')
  // 合同总额 = 7.7*50000 + 8.8*30000
  const expect = 7.7 * 50000 + 8.8 * 30000
  assertNear(num(ct.totalAmount), expect, 0.01, '合同总额')

  // 生效后才能查到协议价
  await post(c, '/contracts/' + ct.id + '/activate', {})
  const price = await get(c, `/contracts/price/lookup?partnerId=${sup.id}&specId=${specs[0].id}`)
  assert.equal(price.price, 7.7, '协议价应为 7.7')
})

test('供应商条码映射：建映射→扫码解析', async () => {
  const c = await login('factory')
  let specs = (await get(c, '/greige-specs')).filter((s) => s.status !== 'discontinued')
  // 自建第二个规格：干净库里 seed 只有 1 个规格，若不补，两条明细会落到同一规格，
  // 协议价查询拿到的是后一条(8.8)而非 7.7——**测试必须自备数据，不能依赖库里的存量**
  if (specs.length < 2) {
    await post(c, '/greige-specs', {
      name: `合同测试规格${Date.now()}`, finishedWidth: 140, warpDensity: 100, weftDensity: 60,
      weaveType: 'plain', warpCount: { value: 40, system: 'NeS' }, weftCount: { value: 40, system: 'NeS' },
    })
    specs = (await get(c, '/greige-specs')).filter((s) => s.status !== 'discontinued')
  }
  const mat = await activeGreigeMaterial(c)
  const sup = await supplierOf(c)
  const code = 'SMOKE-' + Date.now()
  await post(c, '/supplier-codes', { supplierId: sup.id, supplierCode: code, materialId: mat.id, specId: specs[0].id })
  const hit = await get(c, '/supplier-codes/lookup?code=' + code)
  assert.ok(hit && hit.materialId === mat.id, '应解析到映射的物料')
  assert.equal(hit.supplierId, sup.id, '应解析到供应商')
  // 清理
  const list = await get(c, '/supplier-codes')
  const row = list.find((m) => m.supplierCode === code)
  if (row) await import('./helpers.mjs').then((h) => h.del(c, '/supplier-codes/' + row.id))
})
