import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { App as AntdApp, Layout, Menu, Typography, Dropdown, Space, Tag, Avatar } from 'antd'
import {
  DashboardOutlined,
  FileSearchOutlined,
  LogoutOutlined,
  SettingOutlined,
  ShopOutlined,
  SwapOutlined,
  UserOutlined,
  AppstoreOutlined,
} from '@ant-design/icons'
import { api, tokenStore } from './lib/api'
import { useAuthStore } from './stores/auth.store'
import type { CurrentUserInfo } from '@weftcount/shared'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import AuditLogPage from './pages/AuditLogPage'
import MaterialPage from './pages/MaterialPage'
import SpecPage from './pages/SpecPage'
import BatchPage from './pages/BatchPage'
import TransactionPage from './pages/TransactionPage'
import ReconcilePage from './pages/ReconcilePage'
import DocPage from './pages/DocPage'
import { PERM } from './lib/erp'

const { Text } = Typography

/** 路由守卫：未登录跳登录页 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = tokenStore.get()
  const location = useLocation()
  if (!token) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  return <>{children}</>
}

/** 带侧边栏的框架布局 */
function Shell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore((s) => s.user)
  const tenant = useAuthStore((s) => s.tenant)
  const companies = useAuthStore((s) => s.companies)
  const currentCompanyId = useAuthStore((s) => s.currentCompanyId)
  const hasPermission = useAuthStore((s) => s.hasPermission)
  const logout = useAuthStore((s) => s.logout)
  const switchCompany = useAuthStore((s) => s.switchCompany)

  const menuItems = [
    { key: '/', icon: <DashboardOutlined />, label: '工作台' },
    ...(hasPermission(PERM.MATERIAL_VIEW)
      ? [
          { key: '/materials', icon: <AppstoreOutlined />, label: '物料主数据' },
          { key: '/greige-specs', icon: <AppstoreOutlined />, label: '坯布规格' },
        ]
      : []),
    ...(hasPermission(PERM.INVENTORY_VIEW)
      ? [
          { key: '/inventory/batches', icon: <AppstoreOutlined />, label: '库存批次' },
          { key: '/inventory/documents', icon: <AppstoreOutlined />, label: '三算单据' },
          { key: '/inventory/transactions', icon: <AppstoreOutlined />, label: '事务流水' },
          { key: '/inventory/reconcile', icon: <AppstoreOutlined />, label: '三算对账' },
        ]
      : []),
    ...(hasPermission(PERM.AUDIT_VIEW)
      ? [{ key: '/audit-logs', icon: <FileSearchOutlined />, label: '审计日志' }]
      : []),
    { key: 'placeholder-m2', icon: <SettingOutlined />, label: '系统设置（建设中）', disabled: true },
  ]

  const onLogout = () => {
    void api.post('/auth/logout').catch(() => undefined)
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Header
        style={{
          background: '#fff',
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid #f0f0f0',
        }}
      >
        <Text strong style={{ fontSize: 16 }}>
          纬数 WeftCount
        </Text>

        <Space size="middle">
          {companies.length > 1 && (
            <Dropdown
              menu={{
                items: companies.map((c) => ({ key: c.id, label: c.name })),
                onClick: ({ key }) => void switchCompany(key),
              }}
            >
              <Space style={{ cursor: 'pointer' }}>
                <ShopOutlined />
                <Text>{companies.find((c) => c.id === currentCompanyId)?.name}</Text>
                <SwapOutlined style={{ fontSize: 11 }} />
              </Space>
            </Dropdown>
          )}

          {tenant && (
            <Tag color={tenant.aiEnabled ? 'gold' : 'default'}>{tenant.planLabel}</Tag>
          )}

          <Dropdown
            menu={{
              items: [
                { key: 'name', label: `${user?.realName}（${user?.username}）`, disabled: true },
                { type: 'divider' },
                { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true },
              ],
              onClick: ({ key }) => {
                if (key === 'logout') onLogout()
              },
            }}
          >
            <Space style={{ cursor: 'pointer' }}>
              <Avatar size="small" icon={<UserOutlined />} />
              <Text>{user?.realName}</Text>
            </Space>
          </Dropdown>
        </Space>
      </Layout.Header>

      <Layout>
        <Layout.Sider width={200} theme="light" style={{ borderRight: '1px solid #f0f0f0' }}>
          <Menu
            mode="inline"
            selectedKeys={[location.pathname]}
            items={menuItems}
            style={{ borderInlineEnd: 'none' }}
            onClick={({ key }) => {
              if (!key.startsWith('placeholder-')) navigate(key)
            }}
          />
        </Layout.Sider>
        <Layout.Content style={{ padding: 24, background: '#f5f5f5' }}>{children}</Layout.Content>
      </Layout>
    </Layout>
  )
}

export default function App() {
  useEffect(() => {
    useAuthStore.getState().hydrate()
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
    <AntdApp>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <Shell>
                <DashboardPage />
              </Shell>
            </RequireAuth>
          }
        />
        <Route
          path="/materials"
          element={
            <RequireAuth>
              <Shell>
                <MaterialPage />
              </Shell>
            </RequireAuth>
          }
        />
        <Route
          path="/greige-specs"
          element={
            <RequireAuth>
              <Shell>
                <SpecPage />
              </Shell>
            </RequireAuth>
          }
        />
        <Route
          path="/inventory/batches"
          element={
            <RequireAuth>
              <Shell>
                <BatchPage />
              </Shell>
            </RequireAuth>
          }
        />
        <Route
          path="/inventory/transactions"
          element={
            <RequireAuth>
              <Shell>
                <TransactionPage />
              </Shell>
            </RequireAuth>
          }
        />
        <Route
          path="/inventory/reconcile"
          element={
            <RequireAuth>
              <Shell>
                <ReconcilePage />
              </Shell>
            </RequireAuth>
          }
        />
        <Route
          path="/inventory/documents"
          element={
            <RequireAuth>
              <Shell>
                <DocPage />
              </Shell>
            </RequireAuth>
          }
        />
        <Route
          path="/audit-logs"
          element={
            <RequireAuth>
              <Shell>
                <AuditLogPage />
              </Shell>
            </RequireAuth>
          }
        />
        <Route
          path="*"
          element={
            <div style={{ padding: 40, textAlign: 'center' }}>
              <Text type="secondary">页面不存在</Text>
            </div>
          }
        />
      </Routes>
    </AntdApp>
  )
}
