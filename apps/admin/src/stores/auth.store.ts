import { hasPermission } from '@weftcount/shared'
import { create } from 'zustand'
import { api, tokenStore, contextStore } from '../lib/api'
import type { LoginResult, LoginUserInfo, LoginTenantInfo, LoginCompanyInfo } from '@weftcount/shared'

/**
 * 认证状态
 *
 * 设计取舍：令牌与租户上下文持久化到 localStorage，
 * 刷新页面不掉线；权限也缓存下来，让首屏渲染不必等接口。
 */

export interface AuthState {
  user: LoginUserInfo | null
  tenant: LoginTenantInfo | null
  companies: LoginCompanyInfo[]
  currentCompanyId: string
  permissions: string[]
  loading: boolean
  error: string | null

  login: (username: string, password: string) => Promise<boolean>
  logout: () => void
  switchCompany: (companyId: string) => Promise<boolean>
  hydrate: () => void
  hasPermission: (code: string) => boolean
  hasAnyPermission: (codes: string[]) => boolean
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  tenant: null,
  companies: [],
  currentCompanyId: '',
  permissions: [],
  loading: false,
  error: null,

  login: async (username, password) => {
    set({ loading: true, error: null })
    try {
      const res = await api.post<LoginResult>('/auth/login', { username, password })
      const d = res.data.data
      tokenStore.set(d.accessToken)
      contextStore.setContext(d.tenant.id, d.currentCompanyId)
      set({
        user: d.user,
        tenant: d.tenant,
        companies: d.companies,
        currentCompanyId: d.currentCompanyId,
        permissions: d.permissions,
        loading: false,
      })
      return true
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : '登录失败' })
      return false
    }
  },

  logout: () => {
    tokenStore.clear()
    set({
      user: null,
      tenant: null,
      companies: [],
      currentCompanyId: '',
      permissions: [],
      error: null,
    })
  },

  switchCompany: async (companyId) => {
    const tenant = get().tenant
    if (!tenant) return false
    try {
      await api.post('/auth/switch-company', { companyId })
      contextStore.setContext(tenant.id, companyId)
      set({ currentCompanyId: companyId })
      return true
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '切换公司失败' })
      return false
    }
  },

  /**
   * 从本地存储恢复登录态
   * 只恢复令牌与公司标识，用户信息与权限需调 /auth/me 补齐（由页面负责）
   */
  hydrate: () => {
    const token = tokenStore.get()
    const tenantId = contextStore.getTenantId()
    const companyId = contextStore.getCompanyId()
    if (token && tenantId && companyId) {
      set({ currentCompanyId: companyId })
    }
  },

  // 权限匹配：与后端/desktop 共用 shared 的分段通配实现（单一事实源）
  hasPermission: (code) => hasPermission(get().permissions, code),

  hasAnyPermission: (codes) => codes.some((c) => get().hasPermission(c)),
}))
