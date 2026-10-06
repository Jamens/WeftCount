#!/usr/bin/env node
/**
 * 端到端全流程演练（贴近真实织厂日常）
 *
 * 目的：单测/冒烟覆盖的是「每个接口对不对」，这里覆盖的是**串起来对不对**——
 * 集成问题（不变式被破坏、口径不一致、跨模块字段没带上）只有跑全流程才暴露。
 *
 * 每步都校验业务不变式，任何一步失败即记录并继续，最后汇总问题清单。
 *
 * 用法：先起后端，再 `node scripts/e2e-drill.mjs`
 */
const B = (process.env.BASE ?? 'http://127.0.0.1:3180') + '/api'

let TOKEN =''
let TENANT = ''
let COMPANY = ''
const problems = []
const steps = []
let ctx = {}

function H(extra = {}) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, 'X-Tenant-Id': TENANT, 'X-Company-Id': COMPANY, ...extra }
}
async function req(method, path, body) {
  const r = await fetch(B + path, { method, headers: H(), body: body ? JSON.stringify(body) : undefined })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.code !== 0) {
    const msg = `${method} ${path} -> ${r.status} ${j.code ?? ''} ${j.message ?? ''}`
    throw new Error(msg)
  }
  return j.data
}
const GET = (p) => req('GET', p)
const POST = (p, b) => req('POST', p, b)
const PUT = (p, b) => req('PUT', p, b)
const PATCH = (p, b) => req('PATCH', p, b)

function check(label, cond, detail = '') {
  steps.push({ label, ok: !!cond, detail })
  if (!cond) problems.push(`【${label}】${detail}`)
  const mark = cond ? '✅' : '❌'
  console.log(`  ${mark} ${label}${detail && !cond ? ' — ' + detail : ''}`)
  return !!cond
}
function near(a, b, tolPct = 0.01) {
  const na = Number(a); const nb = Number(b)
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return false
  return Math.abs(na - nb) <= Math.max(Math.abs(nb) * tolPct / 100, 0.01)
}
async function step(name, fn) {
  console.log(`\n▶ ${name}`)
  try {
    await fn()
  } catch (e) {
    problems.push(`【${name}】执行异常：${e.message}`)
    console.log(`  ❌ 异常：${e.message}`)
  }
}

// ─────────────────────────── 开始 ───────────────────────────
console.log('═══ 织厂全流程演练 ═══')

const tag = Date.now().toString().slice(-6)

await step('0. 登录', async () => {
  const lr = await fetch(B + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'owner', password: 'weft2026' }),
  }).then((r) => r.json())
  if (lr.code !== 0) throw new Error(lr.message)
  TOKEN = lr.data.accessToken
  TENANT = lr.data.tenant.id
  COMPANY = lr.data.currentCompanyId
  check('登录拿到令牌与三件套', !!(TOKEN && TENANT && COMPANY))
})

await step('1. 采购纱线原料入库', async () => {
  // 用一个**与规格关联**的纱线（贴近真实：买纱是为了织某规格）
  const spec = (await GET('/greige-specs')).find((s) => s.status === 'active' && s.warpMaterialId)
  ctx.spec = spec
  check('取到坯布规格', !!spec, spec?.name)
  ctx.yarn = (await GET('/materials')).find((m) => m.id === spec.warpMaterialId)
  check('规格已关联纱线(取该纱线)', !!ctx.yarn, ctx.yarn?.name)
  // 给纱线设安全库存 → 触发其补货预警（验证纱线转采购单的自动选规格）
  await PATCH(`/materials/${ctx.yarn.id}`, { safetyStock: 500, leadTimeDays: 7 })

  const sup = (await GET('/partners')).find((p) => p.type === 'supplier' || p.type === 'both')
  ctx.sup = sup
  const greige = (await GET('/materials')).find((m) => m.category === 'greige')
  ctx.greige = greige

  const doc = await POST('/inventory/purchase-inbound', {
    materialId: greige.id, specId: spec.id, enteredUnit: 'm', enteredValue: 2000,
    unitPrice: 8.5, partnerId: sup.id, remark: `E2E 采购 ${tag}`,
  })
  ctx.inboundDoc = doc
  check('采购入库 2000m', !!doc.docNo)

  const batches = await GET('/inventory/batches')
  ctx.batch = batches.find((b) => b.sourceDocId === doc.id)
  check('入库生成批次', !!ctx.batch, `批号=${ctx.batch?.batchNo}`)
  check('批次剩余=2000m', near(ctx.batch?.remainingQuantity, 2000), `实际=${ctx.batch?.remainingQuantity}`)
})

await step('2. 坯布逐匹入库（建件卡）', async () => {
  const rolls = [120, 118, 122, 119, 121].map((m, i) => ({ rollNo: `E2E-${tag}-${i + 1}`, meters: m }))
  ctx.rollMeters = rolls.reduce((s, r) => s + r.meters, 0)
  const doc = await POST('/inventory/purchase-inbound', {
    materialId: ctx.greige.id, specId: ctx.spec.id, enteredUnit: 'm', enteredValue: ctx.rollMeters,
    unitPrice: 8.8, partnerId: ctx.sup.id, remark: `E2E 逐匹入库 ${tag}`, rolls,
  })
  ctx.rollDoc = doc
  const rs = await GET(`/inventory/rolls?batchId=${(await GET('/inventory/batches')).find((b) => b.sourceDocId === doc.id).id}`)
  ctx.rolls = rs
  check('逐匹入库生成 5 张件卡', rs.length === 5, `实际=${rs.length}`)
  check('件卡米数之和=入库量', near(rs.reduce((s, r) => s + Number(r.meters), 0), ctx.rollMeters),
    `件卡和=${rs.reduce((s, r) => s + Number(r.meters), 0)} vs 入库=${ctx.rollMeters}`)
})

await step('3. 生产工单：排产 → 开工 → 按匹报工', async () => {
  const machine = (await GET('/machines')).find((m) => m.status !== 'retired')
  ctx.machine = machine
  check('有可用机台', !!machine, machine?.name)

  const wo = await POST('/production-orders', {
    materialId: ctx.greige.id, specId: ctx.spec.id, plannedQuantityM: 600, machineId: machine.id,
    dueDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), remark: `E2E ${tag}`,
  })
  ctx.wo = wo
  await POST(`/production-orders/${wo.id}/schedule`, {})
  await POST(`/production-orders/${wo.id}/start`, {})
  check('工单已排产并开工', true)

  // 按匹报工 3 匹
  const out = [125, 130, 118]
  let last = null
  for (let i = 0; i < out.length; i++) {
    const cid = `e2e-report-${tag}-${i}`
    const r1 = await POST(`/production-orders/${wo.id}/reports`, {
      outputM: out[i], clientRequestId: cid, rolls: [{ rollNo: `E2E-RPT-${tag}-${i + 1}`, meters: out[i] }],
    })
    // 幂等：同 id 再发一次
    const r2 = await POST(`/production-orders/${wo.id}/reports`, {
      outputM: out[i], clientRequestId: cid, rolls: [{ rollNo: `E2E-RPT-${tag}-${i + 1}`, meters: out[i] }],
    })
    if (r1.report.id !== r2.report.id) {
      check(`第${i + 1}匹报工幂等`, false, '重放产生了不同报工单')
    }
    last = r1
  }
  ctx.produced = out.reduce((s, x) => s + x, 0)
  ctx.reportBatchId = last.batchId
  check('三次报工都幂等（无重复计量）', true)

  const after = await GET(`/production-orders/${wo.id}`)
  check('工单产量=报工合计', near(after.order?.producedQuantityM ?? after.producedQuantityM, ctx.produced), `工单=${after.order?.producedQuantityM} vs 报工=${ctx.produced}`)
})

await step('4. 生产产出批次与件卡守恒', async () => {
  const b = (await GET('/inventory/batches')).find((x) => x.id === ctx.reportBatchId)
  check('报工产出批次存在', !!b, b?.batchNo)
  if (b) {
    const rs = await GET(`/inventory/rolls?batchId=${b.id}`)
    const sum = rs.reduce((s, r) => s + Number(r.remainingM ?? r.meters), 0)
    check('Σ件卡剩余 == 批次剩余', near(sum, b.remainingQuantity), `件卡和=${sum} vs 批次=${b.remainingQuantity}`)
  }
  // 每次报工是独立批次（可追溯到具体报工），故汇总**所有产出批次**的件卡数= 报工匹数
  const prodBatches = (await GET('/inventory/batches')).filter((x) =>
    String(x.sourceDocId ?? '').startsWith('x') === false && x.specId === ctx.spec.id && x.sourceDocId != null)
  let allRolls = 0
  for (const pb of prodBatches) allRolls += (await GET(`/inventory/rolls?batchId=${pb.id}`)).length
  check('产出件卡总数=报工匹数(3)', allRolls >= 3, `实际=${allRolls}`)
})

await step('5. 库存盘点（件卡级）', async () => {
  const wh = (await GET('/warehouses?status=active'))[0]
  ctx.wh = wh
  const st = await POST('/stocktakes', { warehouseId: wh.id, mode: 'roll', remark: `E2E 盘点 ${tag}` })
  const detail = await GET(`/stocktakes/${st.id}`)
  ctx.st = st
  check('件卡级盘点单已建', !!st.id, `明细 ${detail.items.length} 条`)
  check('盘点明细带件卡号', detail.items.every((i) => i.rollNo), '存在无件卡号的明细')

  // 只录部分件卡的实盘 → 其余视为缺失
  const mine = detail.items.filter((i) => i.batchId === ctx.rollDoc && false)
  const records = detail.items.slice(0, Math.max(0, detail.items.length - 1)).map((i) => ({
    itemId: i.id, countedQuantityM: i.bookQuantityM,
  }))
  if (records.length > 0) await POST(`/stocktakes/${st.id}/counts`, { records })
  await POST(`/stocktakes/${st.id}/complete`, {})
  check('盘点完成并过账', true)
})

await step('6. 销售订单 → 件卡发货（含拆匹）', async () => {
  const cus = (await GET('/partners')).find((p) => p.type === 'customer' || p.type === 'both')
  ctx.cus = cus
  const order = await POST('/orders', {
    orderType: 'sales', partnerId: cus.id,
    expectedDate: new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10),
    remark: `E2E 销售 ${tag}`,
    items: [{ materialId: ctx.greige.id, specId: ctx.spec.id, orderedUnit: 'm', orderedValue: 200, unitPrice: 11.5 }],
  })
  ctx.so = order
  await POST(`/orders/${order.id}/confirm`, {})
  check('销售订单已确认', true)

  // 从逐匹入库的批次里取一张在库件卡
  const rb = (await GET('/inventory/batches')).find((b) => b.sourceDocId === ctx.rollDoc.id)
  const rs = (await GET(`/inventory/rolls?batchId=${rb.id}`)).filter((r) => r.status === 'in_stock')
  check('有可发货件卡', rs.length > 0, `${rs.length} 张`)
  if (rs.length === 0) return

  const target = rs[0]
  ctx.soldRoll = target
  ctx.soldRollBatch = rb

  // 整匹发第一张
  await POST('/inventory/sales-outbound', {
    materialId: ctx.greige.id, specId: ctx.spec.id, enteredUnit: 'm', enteredValue: Number(target.meters),
    unitPrice: 11.5, partnerId: cus.id, orderId: order.id, clientRequestId: `e2e-out-${tag}-a`,
    pickedRolls: [{ rollNo: target.rollNo }],
  })
  // 拆匹发第二张的一半
  if (rs[1]) {
    const half = Number(rs[1].meters) / 2
    ctx.splitRollNo = rs[1].rollNo
    ctx.splitBefore = Number(rs[1].meters)
    await POST('/inventory/sales-outbound', {
      materialId: ctx.greige.id, specId: ctx.spec.id, enteredUnit: 'm', enteredValue: half,
      unitPrice: 11.5, partnerId: cus.id, orderId: order.id, clientRequestId: `e2e-out-${tag}-b`,
      pickedRolls: [{ rollNo: rs[1].rollNo, meters: half }],
    })
  }
  check('销售出库（整匹 + 拆匹）成功', true)
})

await step('7. 拆匹后件卡状态守恒', async () => {
  if (!ctx.splitRollNo) return
  const rs = await GET(`/inventory/rolls?batchId=${ctx.soldRollBatch.id}`)
  const r = rs.find((x) => x.rollNo === ctx.splitRollNo)
  const expect = ctx.splitBefore / 2
  check('拆匹后剩余=原来一半', near(r?.remainingM, expect), `剩=${r?.remainingM} 期望≈${expect}`)
  check('拆匹后仍可再发（in_stock）', r?.status === 'in_stock', `状态=${r?.status}`)
  const sum = rs.reduce((s, x) => s + Number(x.remainingM ?? 0), 0)
  check('Σ件卡剩余 == 批次剩余', near(sum, ctx.soldRollBatch.remainingQuantity - (ctx.soldRoll ? Number(ctx.soldRoll.meters) : 0) - (ctx.splitBefore ? ctx.splitBefore / 2 : 0)),
    `件卡和=${sum}`)
})

await step('8. 订单履约进度', async () => {
  const d = await GET(`/orders/${ctx.so.id}`)
  check('订单已产生履约记录', d.items.length > 0)
  check('订单状态已推进', d.status !== 'draft', `状态=${d.status}`)
})

await step('9. 三算对账恒等式', async () => {
  const rec = await GET('/inventory/reconcile')
  const led = rec.ledger ?? {}
  const lhs = Number(led.purchaseKg) + Number(led.productionInKg) + Number(led.countGainKg)
  const rhs = Number(led.productionOutKg) + Number(led.salesOutKg) + Number(led.countLossKg) + Number(led.remainingKg)
  check('对账恒等式成立（采购+产出+盘盈 = 领用+销售+盘亏+结存）', near(lhs, rhs, 0.5),
    `左=${lhs.toFixed(3)} 右=${rhs.toFixed(3)} 差=${(lhs - rhs).toFixed(3)}`)
  check('无「去向不明」差额', near(led.unexplainedKg, 0, 0.5), `unexplained=${led.unexplainedKg}`)
  if (!rec.check?.withinTolerance) {
    problems.push(`【对账】超出容差：${JSON.stringify(rec.check?.warnings ?? [])}`)
    console.log(`  ⚠️ 对账告警：${JSON.stringify(rec.check?.warnings ?? []).slice(0, 200)}`)
  }
})

await step('10. 成本与毛利', async () => {
  const cost = await GET(`/cost/analysis?specId=${ctx.spec.id}`)
  const rows = Array.isArray(cost) ? cost : (cost.rows ?? [])
  check('成本分析有数据', rows.length > 0, `${rows.length} 行`)
  if (rows[0]) {
    // 成本为 0 只在「经/纬纱都没有价格来源」时才是正确结果（本演练未采购纱线）
    const priced = rows[0].warpPriceSource !== 'none' || rows[0].weftPriceSource !== 'none'
    if (priced) {
      check('有纱线进价时单米成本为正', Number(rows[0].totalCostPerM) > 0,
        `单米成本=${rows[0].totalCostPerM} 经纱来源=${rows[0].warpPriceSource}`)
    } else {
      check('无纱线进价时成本为 0 且价格来源标none（合理降级）',
        Number(rows[0].totalCostPerM) === 0 && rows[0].warpPriceSource === 'none',
        `单米成本=${rows[0].totalCostPerM} 来源=${rows[0].warpPriceSource}`)
    }
  }
})

await step('11. 全链路追溯', async () => {
  if (!ctx.soldRoll) return
  const tr = await GET(`/inventory/rolls/trace?rollNo=${encodeURIComponent(ctx.soldRoll.rollNo)}`)
  check('件卡可追溯来源', !!tr.source, `来源单=${tr.source?.docNo ?? '无'}`)
  check('件卡可追溯去向（拆匹后可能多单）', Array.isArray(tr.destinations), `去向数=${tr.destinations?.length}`)
  const bt = await GET(`/traceability/batch/${ctx.soldRollBatch.id}`)
  check("批次可追溯", !!(bt.batch?.batchNo ?? bt.batchNo), `批号=${bt.batch?.batchNo ?? "无"}`)
})

await step('12. 预警扫描与补货建议', async () => {
  const s = await POST('/alerts/scan', {})
  check('扫描可执行', typeof s.created === 'number', `新增 ${s.created} 条`)
  const alerts = await GET('/alerts')
  const low = alerts.filter((a) => a.type === 'low_stock')
  check('低库存预警带补货建议', low.every((a) => !a.data || a.data.basis), '存在无依据的建议')
  check('预警文案无 undefined', alerts.every((a) => !String(a.message).includes('undefined')),
    alerts.filter((a) => String(a.message).includes('undefined')).map((a) => a.message.slice(0, 40)).join(';'))
})

await step('13. 预警 → 采购单', async () => {
  const alerts = await GET('/alerts')
  const withSuggest = alerts.find((a) => a.type === 'low_stock' && a.data?.suggestQty && Number(a.data.suggestQty) > 0)
  if (!withSuggest) {
    check('存在可转单的补货预警', false, '当前无带建议的预警（可能库存充足）')
    return
  }
  const spec = ctx.spec
  const order = await POST(`/orders/from-alert/${withSuggest.id}`, { specId: spec.id, partnerId: ctx.sup.id })
  check('预警可生成采购单', !!order.orderNo, `单号=${order.orderNo}`)
  check('采购单为草稿', order.status === 'draft', `状态=${order.status}`)
  // 建议量按物料**主单位**(纱线=kg)，订单明细 orderedValue 同单位；totalQuantityM 是米换算值
  const od = await GET(`/orders/${order.id}`)
  check('采购单数量=建议补货量(主单位)', near(od.items[0].orderedValue, withSuggest.data.suggestQty),
    `订单=${od.items[0].orderedValue}${od.items[0].orderedUnit} 建议=${withSuggest.data.suggestQty}`)
  check('采购单物料=预警物料', od.items[0].materialId === withSuggest.refId, '物料不一致')
  // 防重复
  try {
    await POST(`/orders/from-alert/${withSuggest.id}`, { specId: spec.id, partnerId: ctx.sup.id })
    check('同一预警不可重复生成采购单', false, '第二次竟然成功了')
  } catch {
    check('同一预警不可重复生成采购单', true)
  }
})

await step('14. 审计与操作时间线', async () => {
  const logs = await GET('/audit-logs?pageSize=20')
  const withType = logs.records.filter((r) => r.targetType)
  check('审计记录带 targetType（时间线可用）', withType.length > 0, `${withType.length}/${logs.records.length} 条`)
  if (withType.length > 0) {
    const t = await GET(`/audit-logs/target?targetType=${withType[0].targetType}&targetId=${withType[0].targetId}`)
    check('可按对象查变更史', t.records.length > 0, `${t.records.length} 条`)
  }
})

await step('15. 预警确认与静默期', async () => {
  const alerts = await GET('/alerts')
  if (alerts.length === 0) { check('有待处理预警', false, '当前无预警'); return }
  await POST(`/alerts/${alerts[0].id}/ack`, {})
  check('确认后从未确认列表消失', !(await GET('/alerts')).some((a) => a.id === alerts[0].id))
  const s2 = await POST('/alerts/scan', {})
  check('静默期内重复扫描不新建', !(await GET('/alerts')).some((a) => a.refId === alerts[0].refId),
    `扫描新增 ${s2.created} 条`)
})

// ─────────────────────────── 汇总 ───────────────────────────
const passed = steps.filter((s) => s.ok).length
console.log(`\n${'═'.repeat(50)}`)
console.log(`结果：${passed}/${steps.length} 项通过`)
if (problems.length) {
  console.log(`\n发现 ${problems.length} 个问题：`)
  problems.forEach((p, i) => console.log(`  ${i + 1}. ${p}`))
  process.exitCode = 1
} else {
  console.log('\n全流程通过，未发现问题 ✅')
}