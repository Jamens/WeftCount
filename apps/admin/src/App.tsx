import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Typography } from 'antd'
import { useAuthStore } from './stores/auth.store'
import { tokenStore } from './lib/api'
import { api } from './lib/api'
import type { CurrentUserInfo } from '@weftcount/shared'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'

/** 路由守卫：未登录跳登录页 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = tokenStore.get()
  if (!token) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  useEffect(() => {
    const state = useAuthStore.getState()
    state.hydrate()
    // 有令牌时补齐权限（用户信息在登录时已存）
    if (tokenStore.get()) {
      api
        .get<CurrentUserInfo>('/auth/me')
        .then((res) => {
          const d = res.data.data
          useAuthStore.setState({
            permissions: d.permissions,
            currentCompanyId: d.companyId,
          })
        })
        .catch(() => {
          // 令牌失效由 axios 拦截器统一处理跳转
        })
    }
  }, [])

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <DashboardPage />
          </RequireAuth>
        }
      />
      <Route
        path="*"
        element={
          <div style={{ padding: 40, textAlign: 'center' }}>
            <Typography.Text type="secondary">页面不存在</Typography.Text>
          </div>
        }
      />
    </Routes>
  )
}
