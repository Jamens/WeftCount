import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { App as AntdApp, Button, Layout, Menu, Typography, Dropdown, Space, Tag, Avatar, Switch, Result, type MenuProps } from 'antd'
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
  ToolOutlined,
  BarcodeOutlined,
  BellOutlined,
  AreaChartOutlined,
  InboxOutlined,
  FileExcelOutlined,
  DollarOutlined,
  TransactionOutlined,
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
import ReportExportPage from './pages/ReportExportPage'
import AlertPage from './pages/AlertPage'
import TrendPage from './pages/TrendPage'
import ImportExportPage from './pages/ImportExportPage'
import SpecPage from './pages/SpecPage'
import BatchPage from './pages/BatchPage'
import TransactionPage from './pages/TransactionPage'
import ReconcilePage from './pages/ReconcilePage'
import DocPage from './pages/DocPage'
import QualityInspectionPage from './pages/QualityInspectionPage'
import QualityInspectionDetailPage from './pages/QualityInspectionDetailPage'
import QualityDefectTypePage from './pages/QualityDefectTypePage'
import QualityGradePricePage from './pages/QualityGradePricePage'
import ReceivablesPage from './pages/ReceivablesPage'
import MachineMaintenancePage from './pages/MachineMaintenancePage'
import PayrollPage from './pages/PayrollPage'
import EnergyPage from './pages/EnergyPage'
import { routePerms } from './lib/route-perms'
import { useThemeStore } from './stores/theme.store'

const { Text } = Typography

/** 路由守卫：未登录跳登录页 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = tokenStore.get()
  const location = useLocation()
  if (!token) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  return <>{children}</>
}

/**
 * 路由守卫：权限不足时跳回工作台
 *
 * ## 为什么必须有这一层
 *
 * 菜单做权限过滤只是「不让用户点到」，不是「不让用户进」。
 * 之前路由区完全没有校验：菜单里看不到的角色，把路径敲进地址栏照样能打开页面，
 * 随后所有请求被后端 403，界面表现为一屏红字报错——
 * 用户看到的是「系统坏了」，而不是「你没有这个权限」。
 *
 * ## 关键：与菜单读同一份数据
 *
 * 权限码来自 `ROUTE_PERMS`，与侧边栏菜单的过滤用的是同一张表。
 * 之前菜单是19 处内联散写、路由区零处，两边天然会漂移。
 *
 * ## 权限尚未加载完时不要渲染页面
 *
 * `permissions` 初始为空数组，若此时就判定「无权」会先把登录用户弹回工作台，
 * 刷新页面必现闪烁。`/auth/me` 请求回来后 store 才填上真实权限，
 * 所以用 `loading` 区分「还没加载」与「确实没有」。
 *
 * ## 这不是安全边界
 *
 * 前端门控只改善体验，真正的拦截在服务端 `@RequirePermission`。
 * 这里挡不住改前端代码的人，但能挡住绝大多数误操作与好奇点击。
 */
function RequirePerm({
  path,
  children,
}: {
  path: string
  children: React.ReactNode
}) {
  const hasPermission = useAuthStore((s) => s.hasPermission)
  const loading = useAuthStore((s) => s.permissionsLoading)
  const perms = routePerms(path)

  // 该路由不设门控（如登录页），或权限还在加载：放行
  if (!perms || loading) return <>{children}</>

  if (perms.some((p) => hasPermission(p))) return <>{children}</>

  return (
    <Result
      status="403"
      title="无权访问该页面"
      subTitle={
        <Space direction="vertical" size={4}>
          <Text type="secondary">
            你的角色缺少以下任一权限：{perms.join(' 或 ')}
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            如需开通，请联系系统管理员在「角色管理」中调整。
          </Text>
        </Space>
      }
      extra={
        <Button type="primary" onClick={() => window.location.assign('/')}>
          返回工作台
        </Button>
      }
    />
  )
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

  /**
   * 菜单项是否可见
   *
   * 权限码查`ROUTE_PERMS`——与 `<RequirePerm>` 守卫读的是同一张表。
   * 之前这里是 19 处内联散写的 `hasPermission(...)`，路由区却一处都没有，
   * 于是「菜单里没有的页面手输 URL 能进」。
   * 两处同源后，加权限只改一处，不会再出现一边藏一边露。
   */
  const visible = (path: string): boolean => {
    const perms = routePerms(path)
    // 未登记的路径不做菜单过滤（如工作台）
    if (!perms) return true
    return perms.some((p) => hasPermission(p))
  }
  /**
   * 按可见性过滤一组菜单项
   *
   * `it.key` 类型是 `React.Key | undefined`（antd 的 ItemType 还包含 Divider 这类无 key 项），
   * 所以要先滤掉无 key 的项——它们也不对应任何路由，无从判权限。
   */
  const items = (list: ItemType[]): ItemType[] =>
    list.filter((it): it is Exclude<ItemType, null> => {
      if (!it || typeof it !== 'object' || it.key == null) return false
      return visible(String(it.key))
    })

  // 过滤空分组：某用户若无某组全部权限，不显示该组空标题
  const menuItems: ItemType[] = [
    g('概览', items([
      { key: '/', icon: <DashboardOutlined />, label: '工作台' },
      { key: '/production', icon: <ClusterOutlined />, label: '生产管理' },
      { key: '/machine-maintenance', icon: <ToolOutlined />, label: '设备维保' },
      { key: '/wages', icon: <DollarOutlined />, label: '计件工资' },
      { key: '/alerts', icon: <BellOutlined />, label: '预警中心' },
    ])),
    g('基础资料', items([
      { key: '/materials', icon: <AppstoreOutlined />, label: '物料主数据' },
      { key: '/greige-specs', icon: <AppstoreOutlined />, label: '坯布规格' },
      { key: '/partners', icon: <TeamOutlined />, label: '往来单位' },
      { key: '/supplier-codes', icon: <BarcodeOutlined />, label: '供应商条码映射' },
      { key: '/warehouses', icon: <BankOutlined />, label: '仓库管理' },
      { key: '/import-export', icon: <InboxOutlined />, label: '导入导出' },
      { key: '/report-export', icon: <FileExcelOutlined />, label: '报表导出' },
    ])),
    g('采购销售', items([
      { key: '/orders', icon: <ShoppingCartOutlined />, label: '采购/销售订单' },
      { key: '/contracts', icon: <FileProtectOutlined />, label: '合同/价格' },
    ])),
    g('库存与三算', items([
      { key: '/inventory/batches', icon: <AppstoreOutlined />, label: '库存批次' },
      { key: '/inventory/documents', icon: <AppstoreOutlined />, label: '三算单据' },
      { key: '/inventory/transactions', icon: <AppstoreOutlined />, label: '事务流水' },
      { key: '/inventory/reconcile', icon: <AppstoreOutlined />, label: '三算对账' },
      { key: '/stocktakes', icon: <FileDoneOutlined />, label: '库存盘点' },
    ])),
    g('成本与报表', items([
      { key: '/cost', icon: <PieChartOutlined />, label: '成本报表' },
      { key: '/energy', icon: <ThunderboltOutlined />, label: '设备能耗' },
      { key: '/receivables', icon: <TransactionOutlined />, label: '应收账款' },
      { key: '/trends', icon: <AreaChartOutlined />, label: '趋势分析' },
      { key: '/traceability', icon: <NodeIndexOutlined />, label: '全链路追溯' },
    ])),
    g('质检', items([
      { key: '/quality/inspections', icon: <FileSearchOutlined />, label: '坯布检验分等' },
      { key: '/quality/defect-types', icon: <ExperimentOutlined />, label: '疵点类型' },
      { key: '/quality/grade-prices', icon: <DollarOutlined />, label: '分等价目' },
    ])),
    g('AI 智能', items([
      { key: '/ai-quote', icon: <RobotOutlined />, label: '智能核价' },
      { key: '/ai-loss', icon: <ExperimentOutlined />, label: '损耗归因' },
      { key: '/ai-coefficient', icon: <ThunderboltOutlined />, label: '系数自学习' },
      { key: '/ai-production', icon: <ExperimentOutlined />, label: 'AI 生产助手' },
    ])),
    g('系统管理', items([
      { key: '/users', icon: <UserOutlined />, label: '用户管理' },
      { key: '/roles', icon: <KeyOutlined />, label: '角色管理' },
      { key: '/audit-logs', icon: <FileSearchOutlined />, label: '审计日志' },
    ])),
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

      {/* body 行：必须有 flex:1 + minHeight:0 才有确定高度(外层是 100vh 的 column flex)，
          否则本层按内容高度撑开，Sider 拿不到有界高度，左侧菜单无法滚动、底部被裁 */}
      <Layout style={{ flex: 1, minHeight: 0 }}>
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
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', maxHeight: 'calc(100vh - 64px)' }}>
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

/**
 * 受保护路由清单
 *
 * 数据驱动而非 29 段复制粘贴的 `<Route>`：每加一个页面只需在此加一行，
 * 漏掉 `path` 或 `page` 会在类型层报错，而复制粘贴的写法只会漏在肉眼看不见的地方。
 *
 * 权限码不在这里写死，而由 `<RequirePerm path>` 查`ROUTE_PERMS`——
 * 与侧边栏菜单的过滤条件同源，杜绝「菜单藏了但路由还能进」。
 */
const PROTECTED_ROUTES: { path: string; page: React.ReactNode }[] = [
  { path: '/', page: <DashboardPage /> },
  { path: '/materials', page: <MaterialPage /> },
  { path: '/greige-specs', page: <SpecPage /> },
  { path: '/partners', page: <PartnerPage /> },
  { path: '/orders', page: <OrderPage /> },
  { path: '/contracts', page: <ContractPage /> },
  { path: '/import-export', page: <ImportExportPage /> },
  { path: '/report-export', page: <ReportExportPage /> },
  { path: '/trends', page: <TrendPage /> },
  { path: '/alerts', page: <AlertPage /> },
  { path: '/supplier-codes', page: <SupplierCodePage /> },
  { path: '/ai-quote', page: <AiQuotePage /> },
  { path: '/ai-loss', page: <AiLossPage /> },
  { path: '/ai-production', page: <AiProductionPage /> },
  { path: '/ai-coefficient', page: <AiCoefficientPage /> },
  { path: '/production', page: <ProductionPage /> },
  { path: '/cost', page: <CostPage /> },
  { path: '/warehouses', page: <WarehousePage /> },
  { path: '/stocktakes', page: <StocktakePage /> },
  { path: '/traceability', page: <TracePage /> },
  { path: '/users', page: <UserPage /> },
  { path: '/roles', page: <RolePage /> },
  { path: '/inventory/batches', page: <BatchPage /> },
  { path: '/inventory/transactions', page: <TransactionPage /> },
  { path: '/inventory/reconcile', page: <ReconcilePage /> },
  { path: '/inventory/documents', page: <DocPage /> },
  { path: '/audit-logs', page: <AuditLogPage /> },
  { path: '/quality/inspections', page: <QualityInspectionPage /> },
  { path: '/quality/inspections/:id', page: <QualityInspectionDetailPage /> },
  { path: '/quality/defect-types', page: <QualityDefectTypePage /> },
  { path: '/quality/grade-prices', page: <QualityGradePricePage /> },
  { path: '/receivables', page: <ReceivablesPage /> },
  { path: '/machine-maintenance', page: <MachineMaintenancePage /> },
  { path: '/wages', page: <PayrollPage /> },
  { path: '/energy', page: <EnergyPage /> },
]

/**
 * 自检：每条受保护路由都必须在 `ROUTE_PERMS` 里登记
 *
 * 漏登记的表现是「页面能打开但完全没门控」——菜单里也不会出现，
 * 用户手输 URL 就能进。**这类漏配不会有任何报错**，所以在模块加载时就拦下。
 * 新的路由只要往 `PROTECTED_ROUTES` 加一行忘了配权限，这里会直接抛错。
 *
 * 不加 `import.meta.env.DEV` 条件：这是开发期的护栏，
 * 放到生产才生效等于没有——而漏配恰恰最容易发生在功能验收前的最后阶段。
 */
{
  const missing = PROTECTED_ROUTES.map((r) => r.path).filter((p) => !routePerms(p))
  if (missing.length > 0) {
    throw new Error(`以下路由未在 ROUTE_PERMS 中登记权限，将完全不受门控保护：${missing.join(', ')}`)
  }
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
            permissionsLoading: false,
            currentCompanyId: d.companyId,
          })
        })
        .catch(() => {
          // 令牌失效由 axios 拦截器统一处理跳转。
          // 这里必须把 loading 落 false：否则请求失败后权限永远停在「加载中」，
          // 守卫会一直放行，变成有漏洞的门。
          useAuthStore.setState({ permissionsLoading: false })
        })
    }
  }, [])

  return (
    <AntdApp>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {PROTECTED_ROUTES.map((r) => (
          <Route
            key={r.path}
            path={r.path}
            element={
              <RequireAuth>
                <RequirePerm path={r.path}>
                  <Shell>{r.page}</Shell>
                </RequirePerm>
              </RequireAuth>
            }
          />
        ))}
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
