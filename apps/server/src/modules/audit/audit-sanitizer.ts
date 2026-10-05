/**
 * 审计快照脱敏与差异计算
 *
 * 审计日志会长期保存并可能被导出给客户，因此写入前必须脱敏：
 * 密码、密钥、令牌这类字段一旦落库就等于泄露。
 */

/** 命中即脱敏的字段名（不区分大小写，支持部分匹配） */
const SENSITIVE_KEYS = [
  'password',
  'oldpassword',
  'newpassword',
  'passwordhash',
  'token',
  'accesstoken',
  'refreshtoken',
  'secret',
  'apikey',
  'authorization',
  'credential',
  'privatekey',
  'bankaccount',
  'idcard',
  'idno',
]

/** 脱敏后的固定值 */
export const MASKED = '***'

/** 字段名是否需要脱敏 */
export function isSensitive(key: string): boolean {
  const k = key.toLowerCase().replace(/[_-]/g, '')
  return SENSITIVE_KEYS.some((s) => k.includes(s))
}

/**
 * 递归脱敏
 * 深度上限 3 层，防止循环引用导致栈溢出
 */
export function maskSensitive(value: unknown, depth = 0): unknown {
  if (depth > 3) return '[深度超限]'

  if (value === null || value === undefined) return value

  if (Array.isArray(value)) {
    return value.map((v) => maskSensitive(v, depth + 1))
  }

  if (value instanceof Date) return value.toISOString()

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitive(k) ? MASKED : maskSensitive(v, depth + 1)
    }
    return out
  }

  return value
}

/** 字段是否发生了实质变化 */
function changed(before: unknown, after: unknown): boolean {
  if (before === after) return false
  // null 与 undefined 视为无变化
  if (before == null && after == null) return false
  // 日期对象按值比较
  if (before instanceof Date || after instanceof Date) {
    const b = before instanceof Date ? before.getTime() : before
    const a = after instanceof Date ? after.getTime() : after
    return b !== a
  }
  if (typeof before === 'object' && typeof after === 'object') {
    return JSON.stringify(before) !== JSON.stringify(after)
  }
  return true
}

/**
 * 计算前后快照的差异
 * 只返回发生变化的字段，未变化的字段不占空间
 */
export function computeDiff(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): Record<string, { before: unknown; after: unknown }> | null {
  if (!before && !after) return null

  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])
  const diff: Record<string, { before: unknown; after: unknown }> = {}

  for (const key of keys) {
    const b = before?.[key]
    const a = after?.[key]
    if (!changed(b, a)) continue
    if (isSensitive(key)) {
      diff[key] = { before: MASKED, after: MASKED }
    } else {
      diff[key] = { before: maskSensitive(b), after: maskSensitive(a) }
    }
  }

  return Object.keys(diff).length > 0 ? diff : null
}

/**
 * 把请求体整理成可存储的快照
 * 去掉分页、排序等与业务无关的字段，避免噪声
 */
const NOISE_FIELDS = new Set(['page', 'pageSize', 'sortBy', 'sortOrder', 'keyword', '_t'])

export function buildSnapshot(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (NOISE_FIELDS.has(k)) continue
    out[k] = isSensitive(k) ? MASKED : maskSensitive(v)
  }
  return Object.keys(out).length > 0 ? out : null
}
