// 链路残缺修复的回归测试：
//   1. 审计字段级前后快照（此前 before 恒为 null）
//   2. 停用物料的库存校验 + 重新启用
//   3. 单匹（件卡）追溯链路
//   4. targetType 两端对齐（后端写入的每个类型都能被查回来）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { login, get, post, patch, num, sleep, expectReject } from './helpers.mjs'

/**
 * 拉审计日志，按倒序找最近一条匹配 path 的
 *
 * 必须等一下：审计是 `void this.audit.record(...)` 异步落库的
 * （刻意的设计——审计不该阻塞业务响应），响应返回时记录可能还没写完。
 * 不等就会偶发失败——那种失败比真失败更费时间。
 */
const AUDIT_SETTLE_MS = 300

async function latestAudit(c, pathPart, action) {
  await sleep(AUDIT_SETTLE_MS)
  const r = await get(c, '/audit-logs?pageSize=200')
  return (
    r.records.find((x) => x.path.includes(pathPart) && (action === undefined || x.action === action)) ??
    null
  )
}

// ---------------------------------------------------------------------------
// 1. 审计字段级前后快照
// ---------------------------------------------------------------------------

test('审计：更新物料能记录字段级 before/after（原值可追溯）', async () => {
  const owner = await login('owner')

  const created = await post(owner, '/materials', {
    name: '审计测试料',
    category: 'yarn',
    specification: '40S 精梳棉',
    remark: '原始备注',
  })
  assert.ok(created.id, '应创建成功')

  await patch(owner, `/materials/${created.id}`, { name: '审计测试料-改名', remark: '新备注' })

  const log = await latestAudit(owner, `/materials/${created.id}`, 'update')
  assert.ok(log, '应能查到该物料的更新审计')
  assert.equal(log.targetType, 'material', `targetType 应为 material，实际 ${log.targetType}`)
  assert.equal(log.targetId, created.id, 'targetId 应为物料 ID')

  assert.ok(log.diff && Object.keys(log.diff).length > 0, 'diff 不应为空')
  const nameDiff = log.diff.name
  assert.ok(nameDiff, 'diff 应含 name 字段')
  assert.equal(nameDiff.before, '审计测试料', 'before 应是改之前的名称——此前恒为 null')
  assert.equal(nameDiff.after, '审计测试料-改名', 'after 应是改之后的名称')
  assert.equal(log.diff.remark?.before, '原始备注', 'remark 的 before 也应有原值')

  // 技术字段不该出现在 diff 里：updatedAt 每次 save 都刷新，
  // 若不过滤，审计页会显示「updatedAt 变了」而真实业务变更被淹没
  assert.equal(log.diff.updatedAt, undefined, 'updatedAt 是技术噪声，不应进 diff')
  assert.equal(log.diff.createdAt, undefined, 'createdAt 不应进 diff')
  assert.equal(log.diff.tenantId, undefined, '租户字段不应进 diff')
  assert.equal(log.diff.id, undefined, 'id 不应进 diff')
})

test('审计：未改动的字段不占 diff（只记真正变化的）', async () => {
  const owner = await login('owner')
  const created = await post(owner, '/materials', {
    name: '噪声测试料',
    category: 'yarn',
    specification: '20S 棉',
  })

  // 只改名称，不碰 specification
  await patch(owner, `/materials/${created.id}`, { name: '噪声测试料2' })

  const log = await latestAudit(owner, `/materials/${created.id}`, 'update')
  assert.ok(log?.diff, '应有 diff')
  assert.ok(log.diff.name, 'name 应在 diff 里')
  assert.equal(
    log.diff.specification,
    undefined,
    '未改动的 specification 不应出现在 diff 里（否则审计页看不出改了什么）',
  )
})

test('审计：状态字段变更能记录原值（停用物料 active → discontinued）', async () => {
  const owner = await login('owner')
  const created = await post(owner, '/materials', {
    name: '停用审计料',
    category: 'yarn',
    specification: '30S',
  })
  await post(owner, `/materials/${created.id}/discontinue`)

  const log = await latestAudit(owner, `/materials/${created.id}/discontinue`, 'update')
  assert.ok(log?.diff, '停用也应记 diff')
  assert.equal(log.diff.status?.before, 'active', 'status 的 before 应为启用——此前恒为 null')
  assert.equal(log.diff.status?.after, 'discontinued', 'status 的 after 应为停用')
})

test('审计：敏感字段即使出现在库里也不会明文落审计', async () => {
  const owner = await login('owner')
  // 改密码类接口不在冒烟范围内，这里验证的是脱敏函数的行为：
  // 通过「改密码后审计里搜不到明文」来覆盖。
  const before = await get(owner, '/audit-logs?pageSize=200&action=update')
  const serialized = JSON.stringify(before.records)
  assert.equal(
    /"(password|passwordHash|token|secret)"\s*:\s*"(?!\*\*\*)[^"]{3,}/i.test(serialized),
    false,
    '审计记录中不应出现明文密码/令牌',
  )
})

test('审计：织机更新也有 targetType= machine（前端下拉曾缺此项）', async () => {
  const owner = await login('owner')
  const machines = await get(owner, '/machines')
  const m = machines.find((x) => x.status !== 'retired')
  assert.ok(m, '应有可用机台')

  await patch(owner, `/machines/${m.id}`, { remark: '审计测试备注' })

  const log = await latestAudit(owner, `/machines/${m.id}`, 'update')
  assert.ok(log, '应能查到机台更新审计')
  assert.equal(log.targetType, 'machine', '机台 targetType 应为 machine')
  assert.ok(log.diff, '机台更新也应有字段级 diff')
})

// ---------------------------------------------------------------------------
// 2. 停用物料的库存校验
// ---------------------------------------------------------------------------

test('停用物料：有库存余额时被拒（库存报表不能指向已停用物料）', async () => {
  const owner = await login('owner')

  // 找一个真有库存的物料：有批次的即有库存
  const batches = await get(owner, '/inventory/batches')
  const withStock = batches.find(
    (b) => b.status !== 'depleted' && num(b.remainingQuantity) > 0 && b.materialId,
  )
  assert.ok(withStock, '测试数据应有带库存的批次')

  const msg = await expectReject(owner, 'POST', `/materials/${withStock.materialId}/discontinue`)
  assert.match(msg, /库存|批次/, `应因库存被拒，实际: ${msg}`)
})

test('停用物料：无库存时可停用，且能重新启用', async () => {
  const owner = await login('owner')
  const created = await post(owner, '/materials', {
    name: '库存校验测试料',
    category: 'spare',
    specification: '标准件',
  })

  const stopped = await post(owner, `/materials/${created.id}/discontinue`)
  assert.equal(stopped.status, 'discontinued', '应变为停用状态')

  // 重复停用应被拒，而不是静默成功
  await expectReject(owner, 'POST', `/materials/${created.id}/discontinue`)

  const back = await post(owner, `/materials/${created.id}/activate`)
  assert.equal(back.status, 'active', '应能重新启用——只有停用没有启用等于误操作不可逆')
})

// ---------------------------------------------------------------------------
// 3. 单匹（件卡）追溯
// ---------------------------------------------------------------------------

test('件卡追溯：查不到的件卡号明确报错（而不是返回空对象）', async () => {
  const owner = await login('owner')
  const msg = await expectReject(
    owner,
    'GET',
    '/inventory/rolls/trace?rollNo=__不存在的件卡号__',
  )
  assert.match(msg, /不存在/, `应提示件卡不存在，实际: ${msg}`)
})

test('件卡追溯：件卡号含特殊字符时不会破坏查询', async () => {
  const owner = await login('owner')
  // 现场件卡号是手写/条码，带空格与斜杠很常见；
  // 若后端没做 URL 编码，这里会 400 而不是业务错误
  const msg = await expectReject(
    owner,
    'GET',
    `/inventory/rolls/trace?rollNo=${encodeURIComponent('R 001/2#3')}`,
  )
  assert.match(msg, /不存在/, `应提示不存在而非参数错误，实际: ${msg}`)
})

test('件卡追溯：需要 report.view 权限（不是 inventory.view）', async () => {
  // loom（挡车工）没有 report.view
  const loom = await login('loom')
  await expectReject(loom, 'GET', '/inventory/rolls/trace?rollNo=R0001')

  // warehouse 有 inventory.view 也没有 report.view
  const wh = await login('warehouse')
  await expectReject(wh, 'GET', '/inventory/rolls/trace?rollNo=R0001')
})

// ---------------------------------------------------------------------------
// 4. targetType 两端对齐
// ---------------------------------------------------------------------------

test('targetType：后端写入的类型都在 shared 清单内（加载期自检的兜底）', async () => {
  const owner = await login('owner')
  const known = new Set([
    'material',
    'greige_spec',
    'partner',
    'warehouse',
    'order',
    'contract',
    'machine',
    'production_order',
    'inventory_document',
    'stocktake',
  ])

  // 拉一批审计记录，逐条检查 targetType
  const r = await get(owner, '/audit-logs?pageSize=200')
  const seen = new Set(r.records.map((x) => x.targetType).filter(Boolean))
  for (const t of seen) {
    assert.ok(known.has(t), `出现未登记的 targetType: ${t}（前端下拉里没有，查了也选不到）`)
  }
  assert.ok(seen.size > 0, '应有审计记录可供校验')
})

test('targetType：按对象查变更史可用（targetType+targetId 组合能匹配上）', async () => {
  const owner = await login('owner')
  const created = await post(owner, '/materials', {
    name: '变更史测试料',
    category: 'auxiliary',
    specification: '拉链',
  })
  await patch(owner, `/materials/${created.id}`, { name: '变更史测试料2' })

  const history = await get(owner, `/audit-logs/target?targetType=material&targetId=${created.id}`)
  assert.ok(Array.isArray(history.records), '应返回记录数组')
  assert.ok(history.records.length > 0, '应能按 targetType+targetId 查到变更史')
  assert.ok(
    history.records.every((x) => x.targetType === 'material' && x.targetId === created.id),
    '返回的记录应全部属于该对象',
  )
})

test('targetType：查一个不存在的对象类型也应返回空数组而非报错', async () => {
  const owner = await login('owner')
  const r = await get(owner, '/audit-logs/target?targetType=inventory_batch&targetId=xxx')
  // inventory_batch 后端从不写，查它应返回空——前端下拉里已移除该选项
  assert.ok(Array.isArray(r.records), '应返回数组')
  assert.equal(r.records.length, 0, 'inventory_batch 不该有记录')
})
