// 认证 + 权限边界 + 多租户隔离
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { login, get, post, expectReject } from './helpers.mjs'

test('登录返回令牌与三件套上下文', async () => {
  const c = await login('factory')
  assert.ok(c.token, '应有 accessToken')
  assert.ok(c.headers['X-Tenant-Id'], '应有 X-Tenant-Id')
  assert.ok(c.headers['X-Company-Id'], '应有 X-Company-Id')
})

test('错误密码被拒', async () => {
  await assert.rejects(() => login('factory', 'wrong-password'))
})

test('/auth/me 恢复用户与权限（刷新不掉线）', async () => {
  const c = await login('factory')
  const me = await get(c, '/auth/me')
  assert.equal(me.username, 'factory', '应返回用户名')
  assert.ok(me.realName && me.realName !== 'undefined', 'realName 不应为 undefined')
  assert.ok(Array.isArray(me.permissions) && me.permissions.length > 0, '应返回权限列表')
})

test('无效令牌被拒', async () => {
  const bad = { headers: { Authorization: 'Bearer not-a-real-token', 'X-Tenant-Id': 'x', 'X-Company-Id': 'x', 'Content-Type': 'application/json' } }
  await assert.rejects(() => get(bad, '/auth/me'))
})

test('权限边界：仓管看不到成本(loom 无 cost.view)', async () => {
  const loom = await login('loom')
  await expectReject(loom, 'GET', '/cost/analysis')
})

test('权限边界：低权限角色不可写(loom 无 purchase.manage)', async () => {
  const loom = await login('loom') // loom 只有 production.report / production.self.view
  // 创建采购订单需 purchase.manage，loom 应被拒
  await expectReject(loom, 'POST', '/orders', { orderType: 'purchase', partnerId: 'x', items: [] })
})

test('多租户隔离：伪造 X-Tenant-Id 被拒', async () => {
  const c = await login('factory')
  const forged = { ...c, headers: { ...c.headers, 'X-Tenant-Id': '00000000-0000-0000-0000-000000000000' } }
  // 令牌里的租户与头不一致，应被守卫拒绝（或查不到数据）
  let rejected = false
  try {
    await get(forged, '/materials')
  } catch {
    rejected = true
  }
  assert.ok(rejected, '伪造租户头应被拒绝')
})

test('缺少 X-Company-Id 被拒', async () => {
  const c = await login('factory')
  const noCompany = { headers: { Authorization: c.headers.Authorization, 'X-Tenant-Id': c.headers['X-Tenant-Id'], 'Content-Type': 'application/json' } }
  let rejected = false
  try {
    await get(noCompany, '/materials')
  } catch {
    rejected = true
  }
  assert.ok(rejected, '缺 X-Company-Id 应被拒绝')
})

test('权限拒绝返回 403 + FORBIDDEN(1003)，不误判登录失效', async () => {
  // loom(挡车工) 无 cost.view；打需 cost.view 的端点应被拒
  const c = await login('loom')
  const res = await fetch('http://127.0.0.1:3180/api/analytics/trends?days=7', { headers: c.headers })
  assert.equal(res.status, 403, '权限不足应返回 HTTP 403(而非 401)')
  const b = await res.json()
  assert.equal(b.code, 1003, '业务码应为 FORBIDDEN(1003)')
  assert.ok(b.code !== 2001 && b.code !== 2002, '不得是登录失效码(否则前端会误跳登录页)')
})
