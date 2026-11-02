import { config as loadEnv } from 'dotenv'

/**
 * 安全配置：环境变量解析 + 生产环境强制校验。
 *
 * ## 为什么单独抽一个模块（而不是各处直接读 process.env）
 *
 * 1. **求值时机**：Nest 装饰器参数（如 `@Throttle({ default: { limit } })`）
 *    是在**模块导入时**求值的，那会儿 `ConfigModule.forRoot()` 还没跑，
 *    `process.env` 里读不到 `.env` 的值 → 阈值永远退回默认值。
 *    所以这里在 import 时先把 `.env` 灌进 `process.env`。
 * 2. **可测**：解析规则都是纯函数，能被 vitest 直接覆盖；
 *    散落在各处的 `process.env.X ?? 默认值` 是没法单测的。
 */

// 顺序与 ConfigModule.envFilePath 保持一致：.env.local 优先。
// dotenv 默认不覆盖已存在的变量，故先加载的 .env.local 胜出。
loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })

export const IS_PRODUCTION = process.env.NODE_ENV === 'production'

/**
 * 生产环境禁止继续使用的「公开示例值」。
 *
 * 这些值都躺在仓库里（.env.example / docker-compose.yml），
 * 等同于没有口令 —— 生产必须拒绝启动。
 * 只拦示例值，不拦用户自己设的弱口令：那是运维的责任，
 * 服务端不该替用户猜「什么算弱」。
 */
const PUBLIC_DB_PASSWORDS = new Set([
  '1234560', // .env.example 的历史示例值
  'weft_change_me', // docker-compose.yml 的默认值
  'change_me',
  'change_me_local',
  'password',
  'root',
])

/** 开发期允许的跨源来源（管理端 vite dev server） */
const DEV_CORS_ORIGINS = ['http://localhost:5180', 'http://127.0.0.1:5180']

export interface CorsConfig {
  /** true = 放行任意来源（仅限显式配置 CORS_ORIGIN=* 的内网演示） */
  allowAll: boolean
  /** 精确匹配的来源白名单 */
  origins: string[]
}

export interface SwaggerConfig {
  enabled: boolean
  /** Basic Auth 用户名，未配置则文档页不加认证 */
  user?: string
  /** Basic Auth 密码 */
  password?: string
}

export interface RateLimitConfig {
  enabled: boolean
  /** 全局窗口内单 IP 允许的请求数 */
  limit: number
  /** 全局窗口长度（毫秒） */
  ttl: number
  /** 登录端点窗口内单 IP 允许的尝试次数 */
  loginLimit: number
  /** 登录端点窗口长度（毫秒） */
  loginTtl: number
}

export function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback
  const v = raw.trim().toLowerCase()
  if (v === '') return fallback
  if (['1', 'true', 'yes', 'on'].includes(v)) return true
  if (['0', 'false', 'no', 'off'].includes(v)) return false
  return fallback
}

/**
 * 解析正整数型环境变量。
 * 非法值直接抛错而不是退回默认值 —— 配错了却静默生效，比启动失败更难查。
 */
export function parsePositiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw.trim())
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${name} 必须是正整数，当前值：${raw.trim()}`)
  }
  return Math.floor(n)
}

/**
 * 逗号分隔的来源白名单。
 * 顺手去掉尾部斜杠，避免 `http://a/` 与 `http://a` 匹配不上。
 */
export function parseOriginList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter((s) => s.length > 0)
}

/**
 * 解析 CORS 白名单。
 *
 * - 显式配了逗号列表 → 精确白名单
 * - 显式配了 `*` → 放行任意来源（内网演示用，会打警告）
 * - 什么都没配：生产 → 拒绝一切跨源；开发 → 放行本机管理端端口
 */
export function resolveCorsConfig(raw: string | undefined, isProduction: boolean): CorsConfig {
  const list = parseOriginList(raw)
  if (list.includes('*')) return { allowAll: true, origins: [] }
  if (list.length > 0) return { allowAll: false, origins: list }
  return { allowAll: false, origins: isProduction ? [] : DEV_CORS_ORIGINS }
}

/**
 * 解析 Swagger 开关。
 * 生产默认关闭；显式配置时按配置走。
 */
export function resolveSwaggerConfig(
  enabledRaw: string | undefined,
  userRaw: string | undefined,
  passwordRaw: string | undefined,
  isProduction: boolean,
): SwaggerConfig {
  const enabled =
    enabledRaw === undefined || enabledRaw.trim() === ''
      ? !isProduction
      : parseBool(enabledRaw, !isProduction)
  const user = userRaw?.trim() || undefined
  const password = passwordRaw?.trim() || undefined
  return { enabled, user, password }
}

/**
 * 解析反向代理信任跳数（Express `trust proxy`）。
 *
 * 限速按客户端 IP 计数，前提是能拿到**真实** IP。
 * nginx 会把真实 IP 追加到 `X-Forwarded-For` 末尾，
 * Express 按「从右往左数、跳过被信任的跳数」取第一个不可信地址，
 * 所以默认 1 跳正好对应「nginx → server」这一层拓扑。
 *
 * 注意：直接暴露 3180 端口时，客户端可以自己伪造 X-Forwarded-For 绕过限速，
 * 因此生产应当只暴露 nginx（5180），后端端口仅限内网/本机访问。
 */
export function resolveTrustProxy(raw: string | undefined): string | number {
  const v = (raw ?? '').trim()
  if (v === '') return 1
  if (/^\d+$/.test(v)) return Number(v)
  return v
}

/**
 * 解析数据库口令。
 *
 * 以前代码里写着明文兜底默认值，等于「没配密码也能连上库」，
 * 源码一公开口令就公开了。现在：
 * - 缺失 → 直接失败（开发/生产都一样，避免连到意料之外的库）
 * - 生产且仍是仓库里的示例值 → 失败
 */
export function resolveDbPassword(raw: string | undefined, isProduction: boolean): string {
  const value = (raw ?? '').trim()
  if (!value) {
    throw new Error(
      'DB_PASSWORD 未设置。数据库口令已不再有内置默认值，' +
        '请在 apps/server/.env（或部署环境变量）里显式配置后重启。',
    )
  }
  if (isProduction && PUBLIC_DB_PASSWORDS.has(value)) {
    throw new Error(
      'DB_PASSWORD 仍是仓库里的公开示例值，生产环境拒绝启动。' +
        "请换成强随机口令：node -e \"console.log(require('crypto').randomBytes(24).toString('base64'))\"",
    )
  }
  return value
}

/**
 * 汇总后的安全配置。
 *
 * 注意：这里**不**包含数据库口令 —— 口令要等到真正建连接时才解析，
 * 否则「import 即抛错」会让所有单测都跑不起来。
 */
export const securityEnv = {
  isProduction: IS_PRODUCTION,
  cors: resolveCorsConfig(process.env.CORS_ORIGIN, IS_PRODUCTION),
  swagger: resolveSwaggerConfig(
    process.env.SWAGGER_ENABLED,
    process.env.SWAGGER_BASIC_AUTH_USER,
    process.env.SWAGGER_BASIC_AUTH_PASSWORD,
    IS_PRODUCTION,
  ),
  rateLimit: {
    enabled: parseBool(process.env.RATE_LIMIT_ENABLED, true),
    limit: parsePositiveInt(process.env.RATE_LIMIT_MAX, 1200, 'RATE_LIMIT_MAX'),
    ttl: parsePositiveInt(process.env.RATE_LIMIT_TTL, 60_000, 'RATE_LIMIT_TTL'),
    loginLimit: parsePositiveInt(process.env.RATE_LIMIT_LOGIN_MAX, 10, 'RATE_LIMIT_LOGIN_MAX'),
    loginTtl: parsePositiveInt(process.env.RATE_LIMIT_LOGIN_TTL, 60_000, 'RATE_LIMIT_LOGIN_TTL'),
  },
  trustProxy: resolveTrustProxy(process.env.TRUST_PROXY),
}
