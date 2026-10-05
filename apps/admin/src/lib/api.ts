import axios from 'axios'
import type { AxiosInstance, AxiosRequestConfig } from 'axios'
import { ErrorCode, type ApiFailure, type ApiSuccess } from '@weftcount/shared'

const TOKEN_KEY = 'weftcount_token'
const TENANT_KEY = 'weftcount_tenant'
const COMPANY_KEY = 'weftcount_company'

export const tokenStore = {
  get: (): string | null => localStorage.getItem(TOKEN_KEY),
  set: (token: string): void => localStorage.setItem(TOKEN_KEY, token),
  clear: (): void => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(TENANT_KEY)
    localStorage.removeItem(COMPANY_KEY)
  },
}

export const contextStore = {
  getTenantId: (): string | null => localStorage.getItem(TENANT_KEY),
  getCompanyId: (): string | null => localStorage.getItem(COMPANY_KEY),
  setContext: (tenantId: string, companyId: string): void => {
    localStorage.setItem(TENANT_KEY, tenantId)
    localStorage.setItem(COMPANY_KEY, companyId)
  },
}

const instance: AxiosInstance = axios.create({
  baseURL: '/api',
  timeout: 30000,
})

instance.interceptors.request.use((config) => {
  const token = tokenStore.get()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  const tenantId = contextStore.getTenantId()
  const companyId = contextStore.getCompanyId()
  if (tenantId) config.headers['X-Tenant-Id'] = tenantId
  if (companyId) config.headers['X-Company-Id'] = companyId
  return config
})

instance.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (axios.isAxiosError(error)) {
      const failure = error.response?.data as ApiFailure | undefined
      if (failure) {
        // 登录失效：清本地状态并回登录页
        if (failure.code === ErrorCode.LOGIN_FAILED || failure.code === ErrorCode.TOKEN_EXPIRED) {
          tokenStore.clear()
          if (!window.location.pathname.startsWith('/login')) {
            window.location.href = '/login'
          }
        }
        return Promise.reject(new Error(failure.message))
      }
      if (error.code === 'ECONNABORTED') {
        return Promise.reject(new Error('请求超时，请检查网络或稍后重试'))
      }
      return Promise.reject(new Error('无法连接服务器，请确认后端服务已启动'))
    }
    return Promise.reject(error)
  },
)

export const api = {
  get: <T,>(url: string, config?: AxiosRequestConfig) =>
    instance.get<ApiSuccess<T>>(url, config),
  post: <T,>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    instance.post<ApiSuccess<T>>(url, data, config),
  put: <T,>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    instance.put<ApiSuccess<T>>(url, data, config),
  delete: <T,>(url: string, config?: AxiosRequestConfig) =>
    instance.delete<ApiSuccess<T>>(url, config),
}
