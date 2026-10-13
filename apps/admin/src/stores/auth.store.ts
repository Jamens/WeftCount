import { hasPermission } from '@weftcount/shared'
import { create } from 'zustand'
import { api, tokenStore, contextStore } from '../lib/api'
import type {
  CurrentUserInfo,
  LoginResult,
  LoginUserInfo,
  LoginTenantInfo,
  LoginCompanyInfo,
} from '@weftcount/shared'

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
  /**
   * 权限是否已加载完毕
   *
   * 刷新页面时权限在 localStorage 里**没有**缓存（`hydrate` 只恢复令牌与公司标识），
   * 要等 `/auth/me` 返回才填上。这段时间 `permissions` 是空数组，
   * 路由守卫若直接判定「无权」，会把已登录用户先弹回工作台造成闪一下。
   * 有了这个标志，守卫才能区分「还没加载」与「确实没有」。
   */
  permissionsLoading: boolean
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
  permissionsLoading: false,
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
        permissionsLoading: false,
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
      permissionsLoading: false,
      error: null,
    })
  },

  switchCompany: async (companyId) => {
    const tenant = get().tenant
    if (!tenant) return false
    try {
      await api.post('/auth/switch-company', { companyId })
      contextStore.setContext(tenant.id, companyId)
      // 权限置为「加载中」并清空：不同公司下用户角色可能不同，
      // 沿用上一个公司的权限码会短暂展示无权页面（守卫会误判）。
      // 置 loading 而非直接留旧值，是因为空数组同样会被判为无权。
      set({ currentCompanyId: companyId, permissions: [], permissionsLoading: true })
      const res = await api.get<CurrentUserInfo>('/auth/me')
      const d = res.data.data
      set({
        permissions: d.permissions,
        currentCompanyId: d.companyId,
        permissionsLoading: false,
      })
      return true
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '切换公司失败', permissionsLoading: false })
      return false
    }
  },

  /**
   * 从本地存储恢复登录态
   *
   * 只恢复令牌与公司标识，用户信息与权限需调 `/auth/me` 补齐（由页面负责）。
   * 有令牌即视为「权限加载中」——守卫据此放行而不是误判无权。
   */
  hydrate: () => {
    const token = tokenStore.get()
    const tenantId = contextStore.getTenantId()
    const companyId = contextStore.getCompanyId()
    if (token && tenantId && companyId) {
      set({ currentCompanyId: companyId, permissionsLoading: true })
    }
  },

  // 权限匹配：与后端/desktop 共用 shared 的分段通配实现（单一事实源）
  hasPermission: (code) => hasPermission(get().permissions, code),

  hasAnyPermission: (codes) => codes.some((c) => get().hasPermission(c)),
}))
