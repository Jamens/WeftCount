import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { App as AntdApp, Layout, Menu, Typography, Dropdown, Space, Tag, Avatar, Switch, type MenuProps } from 'antd'
type ItemType = NonNullable<MenuProps['items']>[number]
import {
  DashboardOutlined,
  FileSearchOutlined,
  LogoutOutlined,

  ShopOutlined,
  SwapOutlined,
  UserOutlined,
  AppstoreOutlined,
  TeamOutlined,
  KeyOutlined,
  ShoppingCartOutlined,
  ClusterOutlined,
  PieChartOutlined,
  BankOutlined,
  FileDoneOutlined,
  NodeIndexOutlined,
  FileProtectOutlined,
  RobotOutlined,
  ExperimentOutlined,
  ThunderboltOutlined,
  BarcodeOutlined,
  BellOutlined,
  AreaChartOutlined,
  InboxOutlined,
} from '@ant-design/icons'
import { api, tokenStore } from './lib/api'
import { useAuthStore } from './stores/auth.store'
import type { CurrentUserInfo } from '@weftcount/shared'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import AuditLogPage from './pages/AuditLogPage'
import MaterialPage from './pages/MaterialPage'
import PartnerPage from './pages/PartnerPage'
import UserPage from './pages/UserPage'
import RolePage from './pages/RolePage'
import OrderPage from './pages/OrderPage'
import ProductionPage from './pages/ProductionPage'
import CostPage from './pages/CostPage'
import WarehousePage from './pages/WarehousePage'
import StocktakePage from './pages/StocktakePage'
import TracePage from './pages/TracePage'
import ContractPage from './pages/ContractPage'
import AiQuotePage from './pages/AiQuotePage'
import AiLossPage from './pages/AiLossPage'
import AiCoefficientPage from './pages/AiCoefficientPage'
import SupplierCodePage from './pages/SupplierCodePage'
import AiProductionPage from './pages/AiProductionPage'
import AlertPage from './pages/AlertPage'
import TrendPage from './pages/TrendPage'
import ImportExportPage from './pages/ImportExportPage'
import SpecPage from './pages/SpecPage'
import BatchPage from './pages/BatchPage'
import TransactionPage from './pages/TransactionPage'
import ReconcilePage from './pages/ReconcilePage'
import DocPage from './pages/DocPage'
import { PERM } from './lib/erp'
import { useThemeStore } from './stores/theme.store'

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
  const mode = useThemeStore((s) => s.mode)
  const toggleTheme = useThemeStore((s) => s.toggle)

  // 菜单按业务分组（antd Menu type:'group'）：26 项平铺太深，「用户/角色管理」这类
  // 系统入口容易被埋掉找不到。分组后每组可折叠、可扫读。
  const g = (label: string, children: ItemType[]) => ({ key: label, label, type: 'group' as const, children })
  // 过滤空分组：某用户若无某组全部权限，不显示该组空标题

  const menuItems: ItemType[] = [
    g('概览', [
      { key: '/', icon: <DashboardOutlined />, label: '工作台' },
      ...(hasPermission(PERM.PRODUCTION_VIEW)
        ? [{ key: '/production', icon: <ClusterOutlined />, label: '生产管理' }]
        : []),
      ...(hasPermission(PERM.INVENTORY_VIEW)
        ? [{ key: '/alerts', icon: <BellOutlined />, label: '预警中心' }]
        : []),
    ]),
    g('基础资料', [
      ...(hasPermission(PERM.MATERIAL_VIEW)
        ? [
            { key: '/materials', icon: <AppstoreOutlined />, label: '物料主数据' },
            { key: '/greige-specs', icon: <AppstoreOutlined />, label: '坯布规格' },
          ]
        : []),
      ...(hasPermission(PERM.PARTNER_VIEW)
        ? [{ key: '/partners', icon: <TeamOutlined />, label: '往来单位' }]
        : []),
      ...(hasPermission(PERM.PARTNER_VIEW)
        ? [{ key: '/supplier-codes', icon: <BarcodeOutlined />, label: '供应商条码映射' }]
        : []),
      ...(hasPermission(PERM.WAREHOUSE_VIEW)
        ? [{ key: '/warehouses', icon: <BankOutlined />, label: '仓库管理' }]
        : []),
      ...(hasPermission(PERM.MATERIAL_VIEW)
        ? [{ key: '/import-export', icon: <InboxOutlined />, label: '导入导出' }]
        : []),
    ]),
    g('采购销售', [
      ...(hasPermission(PERM.PURCHASE_VIEW) || hasPermission(PERM.SALES_VIEW)
        ? [
            { key: '/orders', icon: <ShoppingCartOutlined />, label: '采购/销售订单' },
            { key: '/contracts', icon: <FileProtectOutlined />, label: '合同/价格' },
          ]
        : []),
    ]),
    g('库存与三算', [
      ...(hasPermission(PERM.INVENTORY_VIEW)
        ? [
            { key: '/inventory/batches', icon: <AppstoreOutlined />, label: '库存批次' },
            { key: '/inventory/documents', icon: <AppstoreOutlined />, label: '三算单据' },
            { key: '/inventory/transactions', icon: <AppstoreOutlined />, label: '事务流水' },
            { key: '/inventory/reconcile', icon: <AppstoreOutlined />, label: '三算对账' },
            { key: '/stocktakes', icon: <FileDoneOutlined />, label: '库存盘点' },
          ]
        : []),
    ]),
    g('成本与报表', [
      ...(hasPermission(PERM.COST_VIEW)
        ? [{ key: '/cost', icon: <PieChartOutlined />, label: '成本报表' }]
        : []),
      ...(hasPermission(PERM.COST_VIEW)
        ? [{ key: '/trends', icon: <AreaChartOutlined />, label: '趋势分析' }]
        : []),
      ...(hasPermission(PERM.REPORT_VIEW)
        ? [{ key: '/traceability', icon: <NodeIndexOutlined />, label: '全链路追溯' }]
        : []),
    ]),
    g('AI 智能', [
      ...(hasPermission(PERM.SALES_VIEW)
        ? [{ key: '/ai-quote', icon: <RobotOutlined />, label: '智能核价' }]
        : []),
      ...(hasPermission(PERM.COST_VIEW)
        ? [{ key: '/ai-loss', icon: <ExperimentOutlined />, label: '损耗归因' }]
        : []),
      ...(hasPermission(PERM.PRODUCTION_VIEW)
        ? [
            { key: '/ai-coefficient', icon: <ThunderboltOutlined />, label: '系数自学习' },
            { key: '/ai-production', icon: <ExperimentOutlined />, label: 'AI 生产助手' },
          ]
        : []),
    ]),
    g('系统管理', [
      ...(hasPermission(PERM.USER_VIEW)
        ? [{ key: '/users', icon: <UserOutlined />, label: '用户管理' }]
        : []),
      ...(hasPermission(PERM.ROLE_VIEW)
        ? [{ key: '/roles', icon: <KeyOutlined />, label: '角色管理' }]
        : []),
      ...(hasPermission(PERM.AUDIT_VIEW)
        ? [{ key: '/audit-logs', icon: <FileSearchOutlined />, label: '审计日志' }]
        : []),
    ]),
  ].filter((it) => (it as { children?: unknown[] }).children?.length) as ItemType[]

  const onLogout = () => {
    void api.post('/auth/logout').catch(() => undefined)
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <Layout style={{ height: '100vh' }}>
      <Layout.Header
        style={{
          background: mode === 'dark' ? '#141414' : '#fff',
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.12)' : '#f0f0f0'}`,
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

          <Switch
            checkedChildren="暗"
            unCheckedChildren="亮"
            checked={mode === 'dark'}
            onChange={() => toggleTheme()}
            title="切换亮/暗主题"
          />

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
        <Layout.Sider
          width={200}
          theme={mode}
          style={{
            borderRight: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.12)' : '#f0f0f0'}`,
            // 菜单分组后项数多：在 Sider 内用一层 div 做滚动容器(不依赖 antd Menu 内部结构)
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            <Menu
              mode="inline"
              selectedKeys={[location.pathname]}
              items={menuItems}
              style={{ borderInlineEnd: 'none' }}
              onClick={({ key }) => {
                if (!key.startsWith('placeholder-')) navigate(key)
              }}
            />
          </div>
        </Layout.Sider>
        <Layout.Content
          style={{
            padding: 24,
            background: mode === 'dark' ? '#000' : '#f5f5f5',
            // 外壳固定视口、不产生整页滚动；正常列表由表格体内滚动，
            // 这里作为兜底：万一某页内容偏高，只滚 Content 而非整页
            overflow: 'auto',
          }}
        >
          {children}
        </Layout.Content>
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
            // 刷新后恢复用户信息：否则右上角显示 undefined(undefined)
            user: { id: d.userId, username: d.username, realName: d.realName, phone: null, email: null },
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
          path="/partners"
          element={
            <RequireAuth>
              <Shell>
                <PartnerPage />
              </Shell>
            </RequireAuth>
          }
        />
        <Route
          path="/orders"
          element={
            <RequireAuth>
              <Shell>
                <OrderPage />
              </Shell>
            </RequireAuth>
          }
        />
        <Route
          path="/contracts"
          element={
            <RequireAuth>
              <Shell>
                <ContractPage />
              </Shell>
            </RequireAuth>
          }
        />
        <Route
          path="/import-export"
          element={
            <RequireAuth>
              <Shell>
                <ImportExportPage />
              </Shell>
            </RequireAuth>
          }
        />
        <Route
          path="/trends"
          element={
            <RequireAuth>
              <Shell>
                <TrendPage />
              </Shell>
            </RequireAuth>
          }
        />
        <Route
          path="/alerts"
          element={
            <RequireAuth>
              <Shell>
                <AlertPage />
              </Shell>
            </RequireAuth>
          }
        />
        <Route
          path="/supplier-codes"
          element={
            <RequireAuth>
              <Shell>
                <SupplierCodePage />
              </Shell>
            </RequireAuth>
          }
        />
        <Route
          path="/ai-quote"
          element={
            <RequireAuth>
              <Shell>
                <AiQuotePage />
              </Shell>
            </RequireAuth>
          }
        />
        <Route
          path="/ai-loss"
          element={
            <RequireAuth>
              <Shell>
                <AiLossPage />
              </Shell>
            </RequireAuth>
          }
        />
        <Route
          path="/ai-production"
          element={
            <RequireAuth>
              <Shell>
                <AiProductionPage />
              </Shell>
            </RequireAuth>
          }
        />
        <Route
          path="/ai-coefficient"
          element={
            <RequireAuth>
              <Shell>
                <AiCoefficientPage />
              </Shell>
            </RequireAuth>
          }
        />
        <Route
          path="/production"
          element={
            <RequireAuth>
              <Shell>
                <ProductionPage />
              </Shell>
            </RequireAuth>
          }
        />
        <Route
          path="/cost"
          element={
            <RequireAuth>
              <Shell>
                <CostPage />
              </Shell>
            </RequireAuth>
          }
        />
        <Route
          path="/warehouses"
          element={
            <RequireAuth>
              <Shell>
                <WarehousePage />
              </Shell>
            </RequireAuth>
          }
        />
        <Route
          path="/stocktakes"
          element={
            <RequireAuth>
              <Shell>
                <StocktakePage />
              </Shell>
            </RequireAuth>
          }
        />
        <Route
          path="/traceability"
          element={
            <RequireAuth>
              <Shell>
                <TracePage />
              </Shell>
            </RequireAuth>
          }
        />
        <Route
          path="/users"
          element={
            <RequireAuth>
              <Shell>
                <UserPage />
              </Shell>
            </RequireAuth>
          }
        />
        <Route
          path="/roles"
          element={
            <RequireAuth>
              <Shell>
                <RolePage />
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
