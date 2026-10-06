// 回归冒烟测试助手：极简 API 客户端（零依赖，node:test + node:assert）
// 用法见同目录 *.test.mjs。所有测试通过 BASE 环境变量指向后端（默认 127.0.0.1:3180）。

export const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:3180'
const API = BASE + '/api'

/** 登录返回带三件套头的 client */
export async function login(username, password = 'weft2026') {
  const r = await fetch(API + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const b = await r.json()
  if (b.code !== 0) throw new Error(`login ${username} 失败: ${b.message}`)
  const d = b.data
  return {
    username,
    token: d.accessToken,
    headers: {
      Authorization: `Bearer ${d.accessToken}`,
      'X-Tenant-Id': d.tenant.id,
      'X-Company-Id': d.currentCompanyId,
      'Content-Type': 'application/json',
    },
  }
}

/** 带 auth 头的请求；返回 envelope，失败抛错 */
export async function req(client, method, path, body) {
  const r = await fetch(API + path, {
    method,
    headers: client.headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const b = await r.json()
  if (b.code !== 0) {
    const err = new Error(`${method} ${path} -> ${b.code} ${b.message}`)
    err.envelope = b
    throw err
  }
  return b.data
}
export const get = (c, p) => req(c, 'GET', p)
export const post = (c, p, b) => req(c, 'POST', p, b)
export const patch = (c, p, b) => req(c, 'PATCH', p, b)
export const del = (c, p) => req(c, 'DELETE', p)

/** 期望请求被拒（权限/校验/库存等），返回错误消息；没被拒则抛错 */
export async function expectReject(client, method, path, body) {
  try {
    await req(client, method, path, body)
  } catch (e) {
    return e.message
  }
  throw new Error(`期望被拒但成功了: ${method} ${path}`)
}

/** 数值断言：相对误差内相等 */
export function assertNear(actual, expected, tolPct, label) {
  if (expected === 0) {
    if (Math.abs(actual) > 1e-6) throw new Error(`${label}: 期望 0，实际 ${actual}`)
    return
  }
  const diff = Math.abs((actual - expected) / expected) * 100
  if (diff > tolPct) throw new Error(`${label}: 期望 ${expected}，实际 ${actual}（偏差 ${diff.toFixed(2)}% > ${tolPct}%）`)
}

/** 取活跃的坯布规格（跳过已停用） */
export async function activeSpec(client) {
  const specs = await get(client, '/greige-specs')
  const active = specs.filter((s) => s.status !== 'discontinued')
  if (!active.length) throw new Error('无可用坯布规格')
  return active[0]
}
export async function activeGreigeMaterial(client) {
  const mats = await get(client, '/materials?status=active&category=greige')
  if (!mats.length) throw new Error('无可用坯布物料')
  return mats[0]
}
export async function supplierOf(client) {
  const ps = await get(client, '/partners?status=active')
  const s = ps.find((p) => p.type === 'supplier' || p.type === 'both')
  if (!s) throw new Error('无可用供应商')
  return s
}
export async function customerOf(client) {
  const ps = await get(client, '/partners?status=active')
  const c = ps.find((p) => p.type === 'customer' || p.type === 'both')
  if (!c) throw new Error('无可用客户')
  return c
}
/** 首个启用仓库 */
export async function firstWarehouse(client) {
  const ws = await get(client, '/warehouses')
  const w = ws.find((x) => x.status === 'active') ?? ws[0]
  if (!w) throw new Error('无可用仓库')
  return w
}

export const num = (v) => Number(v ?? 0)
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
