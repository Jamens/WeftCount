import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  App as AntdApp,
  Button,
  Layout,
  Menu,
  Result,
  Spin,
  Space,
  Tag,
  Tooltip,
  Typography,
  theme,
} from 'antd'
import {
  FundOutlined,
  DashboardOutlined,
  LogoutOutlined,
  PrinterOutlined,
  BarcodeOutlined,
  SendOutlined,
  SunOutlined,
  MoonOutlined,
  InboxOutlined,
  FileSearchOutlined,
} from '@ant-design/icons'
import { api, authStore, sessionStore, flushOfflineQueue, type SessionInfo } from './lib/api'
import { offlineQueue } from './lib/offline-queue'
import { WORKSHOP_VIEW_PERM } from '@weftcount/shared'
import { useThemeStore } from './stores/theme.store'
import LoginPage from './pages/LoginPage'
import ReportPage from './pages/ReportPage'
import BoardPage from './pages/BoardPage'
import LabelPage from './pages/LabelPage'
import RollCardPage from './pages/RollCardPage'
import ScanPage from './pages/ScanPage'
import InspectPage from './pages/InspectPage'
import PickPage from './pages/PickPage'
import PickInPage from './pages/PickInPage'

const { Text } = Typography

type View = 'report' | 'board' | 'label' | 'rollcard' | 'scan' | 'pick' | 'pickin' | 'inspect'

/** 车间视图→权限码：取自 shared 单一事实源（与后端端点权限一一对应） */
const VIEW_PERM = WORKSHOP_VIEW_PERM

export default function App() {
  const { message: messageApi } = AntdApp.useApp()
  const [authed, setAuthed] = useState<boolean>(() => !!authStore.getToken())
  const [view, setView] = useState<View>('report')
  const [env, setEnv] = useState<{ version: string; platform: string } | null>(null)
  const [session, setSession] = useState<SessionInfo | null>(() => sessionStore.get())
  /** 待同步的离线操作条数（离线队列） */
  const [pendingOps, setPendingOps] = useState(0)

  const mode = useThemeStore((s) => s.mode)
  const toggleTheme = useThemeStore((s) => s.toggle)
  const { token } = theme.useToken()

  useEffect(() => {
    if (!window.weftDesktop) return
    void Promise.all([window.weftDesktop.getVersion(), window.weftDesktop.getPlatform()]).then(
      ([version, platform]) => setEnv({ version, platform }),
    )
  }, [])

  // 拉取当前用户权限（/auth/me），用于菜单按权限门控
  // 离线队列自动重放：启动即试一次，之后定时试，网络恢复(online)立刻试。
  // 重放安全性依赖服务端 clientRequestId 幂等——即使首次其实成功只是响应丢了，
  // 重放也只会拿到首次结果，不会重复计量/重复出入库。
  useEffect(() => {
    if (!authed) return
    let stopped = false
    const tryFlush = async () => {
      if (offlineQueue.count() === 0) {
        if (!stopped) setPendingOps(0)
        return
      }
      const r = await flushOfflineQueue().catch(() => null)
      if (stopped) return
      setPendingOps(offlineQueue.count())
      if (r && r.done > 0) {
        messageApi.success(`已同步 ${r.done} 条离线操作`)
      }
    }
    void tryFlush()
    const timer = setInterval(() => void tryFlush(), 20000)
    const onOnline = () => void tryFlush()
    window.addEventListener('online', onOnline)
    return () => {
      stopped = true
      clearInterval(timer)
      window.removeEventListener('online', onOnline)
    }
  }, [authed])

  useEffect(() => {
    if (!authed) return
    let alive = true
    void api
      .get<SessionInfo>('/auth/me')
      .then((info) => {
        if (!alive) return
        sessionStore.set(info)
        setSession(info)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [authed])

  // 权限就绪后，若当前页无权访问，自动落到第一个有权的页面
  // 有权的车间视图；权限未加载时为空数组
  const allowedViews = useMemo(
    () => (session ? (Object.keys(VIEW_PERM) as View[]).filter((v) => sessionStore.has(VIEW_PERM[v])) : []),
    [session]
  )
  // 渲染前就落到有权的视图：只靠 effect 后置切换会先渲染一次无权页再切，仍会撞 403
  const safeView: View = session && sessionStore.has(VIEW_PERM[view]) ? view : (allowedViews[0] ?? view)
  useEffect(() => {
    if (safeView !== view) setView(safeView)
  }, [safeView, view])

  const onLogout = useCallback(() => {
    authStore.clear()
    sessionStore.clear()
    setSession(null)
    setAuthed(false)
  }, [])

  // 头部/侧栏跟随主题，文字用对比色
  const headerText = mode === 'dark' ? '#fff' : token.colorText

  /**
   * 层级配色：**只允许三种深色**，其余一律走 antd token。
   *
   * 此前的问题是三处各自写死颜色——侧栏沿用 antd 默认 `#001529`（藏青）、
   * 主体用 `#000`、卡片是 `#1f1f1f`。三个黑里两个还带不同色相，
   * 放在一起就是截图里那种「贴片感」。
   *
   * 现在的分层：
   *   - 侧栏 / 页头（外壳）：`#1c1f26`，比内容区**略亮**，形成凹陷感
   *   - 内容区背景：`colorBgLayout`（深色下 `#101215`，最深）
   *   - 卡片：`colorBgContainer`（`#1c1f26`，比背景亮，卡片浮起来）
   * 这样只有一条明度梯度，色相统一为中性灰蓝。
   */
  const shellBg = mode === 'dark' ? '#1c1f26' : '#ffffff'
  const shellBorder = mode === 'dark' ? 'rgba(255,255,255,0.08)' : token.colorBorderSecondary

  const shell = (children: React.ReactNode) => (
    <AntdApp>
      {/**
       * 固定视口 + 内容区独立滚动：页头与侧栏恒定可见。
       * 不这样做的话，内容不足一屏时整页滚动会把导航一起带走——
       * 车间操作员在「短页面」和「长列表」间来回切换时不断丢失侧栏。
       */}
      <div className="weft-content">
        <Layout style={{ minHeight: '100%', background: token.colorBgLayout }}>
          <Layout.Header
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 16px',
              // 与侧栏同色：外壳是一个整体，中间不该有横向色带把界面切成两段
              background: shellBg,
              borderBottom: `1px solid ${shellBorder}`,
            }}
          >
            <Text strong style={{ color: headerText, fontSize: 16 }}>
              纬数 · 车间工作台
            </Text>
            <Space>
              <Tooltip title={mode === 'dark' ? '切换到明亮模式' : '切换到暗黑模式'}>
                <Button
                  type="text"
                  aria-label="切换明暗模式"
                  icon={mode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
                  onClick={toggleTheme}
                  style={{ color: headerText }}
                />
              </Tooltip>
              {env && <Tag style={{ margin: 0 }}>v{env.version}</Tag>}
              {/* 离线队列待同步提示：有待同步时操作员能明确知道「数据还没进系统」 */}
              {pendingOps > 0 && (
                <Tooltip title={`${pendingOps} 条操作待同步（网络恢复后自动重放）`}>
                  <Tag color="warning" style={{ margin: 0 }}>
                    待同步 {pendingOps}
                  </Tag>
                </Tooltip>
              )}
              <Text style={{ color: headerText, cursor: 'pointer' }} onClick={onLogout}>
                <LogoutOutlined /> 退出
              </Text>
            </Space>
          </Layout.Header>
        <Layout style={{ background: token.colorBgLayout }}>
          <Layout.Sider
            width={176}
            className="weft-sider"
            style={{
              background: shellBg,
              borderRight: `1px solid ${shellBorder}`,
            }}
          >
            <Menu
              theme={mode}
              mode="inline"
              style={{ background: 'transparent', borderInlineEnd: 0 }}
              selectedKeys={[safeView]}
              items={[
                { key: 'report', icon: <FundOutlined />, label: '织机报工' },
                { key: 'board', icon: <DashboardOutlined />, label: '车间大屏' },
                { key: 'pick', icon: <SendOutlined />, label: '扫码出库' },
                { key: 'pickin', icon: <InboxOutlined />, label: '扫码入库' },
                { key: 'label', icon: <PrinterOutlined />, label: '标签打印' },
                { key: 'rollcard', icon: <BarcodeOutlined />, label: '件卡打印' },
                { key: 'scan', icon: <BarcodeOutlined />, label: '扫码查询' },
                { key: 'inspect', icon: <FileSearchOutlined />, label: '验布录入' },
              ]
                // 菜单按权限门控：低权限账号(如挡车工)看不到无权访问的车间页，
                // 避免「点了才报无权限」。与后端端点权限码一一对应。
                .filter((item) => !session || sessionStore.has(VIEW_PERM[item.key as View]))}
              onClick={({ key }) => setView(key as View)}
            />
          </Layout.Sider>
          <Layout.Content style={{ background: token.colorBgLayout }}>{children}</Layout.Content>
        </Layout>
        </Layout>
      </div>
    </AntdApp>
  )

  if (!authed) {
    return (
      <AntdApp>
        <LoginPage onSuccess={() => setAuthed(true)} />
      </AntdApp>
    )
  }

  // 权限尚未加载完：先显示加载态，**不渲染任何车间页**。
  // 否则会用默认视图(织机报工)抢先发请求，低权限账号(如仓管员无 production.report)
  // 登录瞬间就撞 403「无权访问，缺少权限」——即使随后兜底切页，错误提示已弹出。
  if (!session) {
    return (
      <AntdApp>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
          <Spin size="large" tip="加载账号权限…" />
        </div>
      </AntdApp>
    )
  }

  // 渲染前就落到有权的视图（safeView 在上方已算好，这里不再重复推导）
  // 权限已加载但一个车间页面都没权限：给出明确提示，而不是渲染无权页再报 403
  if (allowedViews.length === 0) {
    return (
      <AntdApp>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
          <Result status="403" title="无可访问的车间页面" subTitle="该账号未被授予任何车间权限，请联系管理员在「角色管理」中配置。" />
        </div>
      </AntdApp>
    )
  }

  const page =
    safeView === 'report' ? <ReportPage /> : safeView === 'board' ? <BoardPage /> : safeView === 'label' ? <LabelPage /> : safeView === 'rollcard' ? <RollCardPage /> : safeView === 'pick' ? <PickPage /> : safeView === 'pickin' ? <PickInPage /> : safeView === 'inspect' ? <InspectPage /> : <ScanPage />

  return shell(page)
}
