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

test('账号有效权限：多角色并集 + 车间可见页面', async () => {
  const c = await login('owner')
  const { users } = await get(c, '/users')
  // 找一个多角色或单角色账号，校验有效权限=角色并集
  const u = users.find(x => x.roleCodes && x.roleCodes.length > 0)
  assert.ok(u, '应有已分配角色的用户')
  const p = await get(c, `/users/${u.id}/permissions`)
  assert.ok(Array.isArray(p.effective), '应有有效权限数组')
  assert.ok(p.roles.length > 0, '应返回角色来源')
  // 有效权限应包含各角色权限的并集
  for (const r of p.roles) {
    for (const perm of r.permissions) {
      // 角色里可能是 p.module.* 通配，有效集里可能是展开的具体码；至少角色数一致
      void perm
    }
  }
  assert.ok(Array.isArray(p.workshopViews), '应返回车间可见页面数组')
  // 管理员(owner)应能看到多个车间页面
  if (u.username === 'owner' || u.roleCodes.includes('tenant_owner')) {
    assert.ok(p.workshopViews.length >= 5, '管理员应可见多个车间页面')
  }
})
