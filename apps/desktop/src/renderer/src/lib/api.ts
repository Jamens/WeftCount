import axios from 'axios'

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
      return Promise.reject(
        new Error(
          failure?.message ??
            (error.code === 'ECONNABORTED' ? '请求超时' : '无法连接服务器，请确认后端已启动'),
        ),
      )
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
