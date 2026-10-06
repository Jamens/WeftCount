import axios from 'axios'
import { isNetworkError, netStatus, offlineQueue } from './offline-queue'
import { hasPermission } from '@weftcount/shared'

/**
 * 桌面端（车间工作台）API 客户端
 *
 * 车间终端直连后端服务（默认本机 3180，后端已开 CORS）。
 * 认证与 admin 一致：Bearer token + X-Tenant-Id / X-Company-Id 三件套。
 * 令牌存 localStorage，进程重启后免登录。
 *
 * 统一拆服务端 envelope({code,message,data})：成功直接返回 data，失败抛后端 message。
 */

/**
 * API 基址
 *
 * - 开发(渲染进程由 vite dev server 加载，http 协议)：用相对路径 `/api`，由 dev server
 *   代理到后端(见 electron.vite.config.ts 的 server.proxy)。渲染进程与请求**同源**，
 *   从根上绕开 Chromium 的 CORS 与 Private Network Access 拦截——直连绝对地址
 *   127.0.0.1 常被 PNA 判违规拦成「网络错误」。
 * - 打包后(file:// 加载)：没有 dev server 可代理，退回绝对地址(后端需允许该来源)。
 */
export const API_BASE = window.location.protocol === 'file:' ? 'http://127.0.0.1:3180/api' : '/api'

const BACKEND_ORIGIN = 'http://127.0.0.1:3180'

const TOKEN_KEY = 'weft_desktop_token'
const TENANT_KEY = 'weft_desktop_tenant'
const COMPANY_KEY = 'weft_desktop_company'

export const authStore = {
  getToken: (): string | null => localStorage.getItem(TOKEN_KEY),
  setSession: (token: string, tenantId: string, companyId: string): void => {
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(TENANT_KEY, tenantId)
    localStorage.setItem(COMPANY_KEY, companyId)
  },
  clear: (): void => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(TENANT_KEY)
    localStorage.removeItem(COMPANY_KEY)
  },
}

/** 当前登录用户上下文（含权限码），用于菜单按权限门控 */
export interface SessionInfo {
  username: string
  realName: string
  roles: string[]
  permissions: string[]
}

const PERMS_KEY = 'weft_desktop_perms'
const NAME_KEY = 'weft_desktop_name'

export const sessionStore = {
  get: (): SessionInfo | null => {
    const raw = localStorage.getItem(PERMS_KEY)
    if (!raw) return null
    try {
      return {
        username: localStorage.getItem(NAME_KEY) ?? '',
        realName: localStorage.getItem('weft_desktop_realname') ?? '',
        roles: [],
        permissions: JSON.parse(raw) as string[],
      }
    } catch {
      return null
    }
  },
  set: (info: SessionInfo): void => {
    localStorage.setItem(PERMS_KEY, JSON.stringify(info.permissions))
    localStorage.setItem(NAME_KEY, info.username)
    localStorage.setItem('weft_desktop_realname', info.realName)
  },
  /** 权限匹配：与后端/admin 共用 shared 的分段通配实现（单一事实源） */
  has: (perm: string): boolean => {
    const perms = sessionStore.get()?.permissions
    if (!perms) return false
    return hasPermission(perms, perm)
  },
  clear: (): void => {
    localStorage.removeItem(PERMS_KEY)
    localStorage.removeItem(NAME_KEY)
    localStorage.removeItem('weft_desktop_realname')
  },
}

const instance = axios.create({ baseURL: API_BASE, timeout: 15000 })

instance.interceptors.request.use((config) => {
  const token = authStore.getToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
    const tenantId = localStorage.getItem(TENANT_KEY)
    const companyId = localStorage.getItem(COMPANY_KEY)
    if (tenantId) config.headers['X-Tenant-Id'] = tenantId
    if (companyId) config.headers['X-Company-Id'] = companyId
  }
  return config
})

instance.interceptors.response.use(
  (r) => r,
  (error: unknown) => {
    if (axios.isAxiosError(error)) {
      const failure = error.response?.data as { code?: number; message?: string } | undefined
      if (failure?.code === 2001 || failure?.code === 2002) {
        authStore.clear() // 登录失效，交由上层跳登录
      }
      const e = new Error(
        failure?.message ??
          (error.code === 'ECONNABORTED' ? '请求超时' : '无法连接服务器，请确认后端已启动'),
      )
      // **保留原始 axios 错误**：离线队列要靠它区分「网络类」与「业务类」。
      // 丢了原始错误，所有失败都会被当成业务错误而不入队，队列形同虚设。
      ;(e as Error & { isAxios?: boolean; noResponse?: boolean }).isAxios = true
      ;(e as Error & { noResponse?: boolean }).noResponse = !error.response
      return Promise.reject(e)
    }
    return Promise.reject(error)
  },
)

interface Envelope<T> {
  code: number
  message: string
  data: T
}

async function request<T>(method: 'get' | 'post' | 'patch', url: string, data?: unknown): Promise<T> {
  const res = await instance.request<Envelope<T>>({ method, url, data })
  return res.data.data
}

export const api = {
  get: <T,>(url: string): Promise<T> => request<T>('get', url),
  post: <T,>(url: string, data?: unknown): Promise<T> => request<T>('post', url, data),
  patch: <T,>(url: string, data?: unknown): Promise<T> => request<T>('patch', url, data),
}

/** 写操作结果：正常成功，或已存入离线队列待重放 */
export type WriteResult<T> = { queued: false; data: T } | { queued: true; opId: string }

/**
 * 写操作 + 离线兜底（**离线队列入口**）
 *
 * - 请求成功 → `{queued:false, data}`
 * - **网络类失败**（断网/超时，请求没到服务端）→ 存入离线队列，返回 `{queued:true}`
 *   界面提示「已离线暂存，恢复后自动同步」，操作员**不会丢单**。
 * - **业务类失败**（库存不足/规格不符/权限不足等 4xx）→ 直接抛错给界面，
 *   **不入队**——服务端已明确拒绝，重试无用，且排队会掩盖真实错误。
 *
 * 幂等：入队时生成 `clientRequestId` 并写进 body，重放复用同一个，
 * 服务端据此去重，不会重复计量/重复出入库。
 */
export async function postOrQueue<T>(
  label: string,
  url: string,
  data?: unknown,
): Promise<WriteResult<T>> {
  const body = (data && typeof data === 'object' ? { ...data } : {}) as Record<string, unknown>
  if (!body.clientRequestId) body.clientRequestId = newReqId()
  try {
    const res = await request<T>('post', url, body)
    return { queued: false, data: res }
  } catch (e) {
    if (!isNetworkError(e)) throw e
    const op = offlineQueue.enqueue({
      label,
      method: 'POST',
      path: url,
      body,
      clientRequestId: String(body.clientRequestId),
    })
    return { queued: true, opId: op.id }
  }
}

/** 重放离线队列（应用启动/恢复网络时调用） */
export async function flushOfflineQueue(): Promise<{ done: number; failed: number }> {
  const r = await offlineQueue.flush(async (op) => {
    await request('post', op.path, op.body)
  })
  netStatus.lastSyncAt = Date.now()
  return r
}

/**
 * 生成报工幂等键（clientRequestId）
 *
 * 车间网络不稳，超时重试很常见；报工若无幂等键，重试会**重复计量**——
 * 产量虚高、件卡翻倍、成本跟着错。一次报工生成一个，**重试必须复用同一个**。
 */
export function newReqId(): string {
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
