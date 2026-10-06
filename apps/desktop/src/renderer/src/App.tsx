import { useCallback, useEffect, useState } from 'react'
import {
  App as AntdApp,
  Button,
  Layout,
  Menu,
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
} from '@ant-design/icons'
import { api, authStore, sessionStore, type SessionInfo } from './lib/api'
import { WORKSHOP_VIEW_PERM } from '@weftcount/shared'
import { useThemeStore } from './stores/theme.store'
import LoginPage from './pages/LoginPage'
import ReportPage from './pages/ReportPage'
import BoardPage from './pages/BoardPage'
import LabelPage from './pages/LabelPage'
import RollCardPage from './pages/RollCardPage'
import ScanPage from './pages/ScanPage'
import PickPage from './pages/PickPage'
import PickInPage from './pages/PickInPage'

const { Text } = Typography

type View = 'report' | 'board' | 'label' | 'rollcard' | 'scan' | 'pick' | 'pickin'

/** 车间视图→权限码：取自 shared 单一事实源（与后端端点权限一一对应） */
const VIEW_PERM = WORKSHOP_VIEW_PERM

export default function App() {
  const [authed, setAuthed] = useState<boolean>(() => !!authStore.getToken())
  const [view, setView] = useState<View>('report')
  const [env, setEnv] = useState<{ version: string; platform: string } | null>(null)
  const [session, setSession] = useState<SessionInfo | null>(() => sessionStore.get())

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
  useEffect(() => {
    if (!session) return
    if (sessionStore.has(VIEW_PERM[view])) return
    const first = (Object.keys(VIEW_PERM) as View[]).find((v) => sessionStore.has(VIEW_PERM[v]))
    if (first) setView(first)
  }, [session, view])

  const onLogout = useCallback(() => {
    authStore.clear()
    sessionStore.clear()
    setSession(null)
    setAuthed(false)
  }, [])

  // 头部/侧栏跟随主题，文字用对比色
  const headerText = mode === 'dark' ? '#fff' : token.colorText

  const shell = (children: React.ReactNode) => (
    <AntdApp>
      <Layout style={{ minHeight: '100vh' }}>
        <Layout.Header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 16px',
            // antd Layout.Header 默认深色底(#001529)，亮色模式必须给浅色底，
            // 否则深色文字压在深色底上会被「遮住」
            background: mode === 'dark' ? '#141414' : '#ffffff',
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
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
            <Text style={{ color: headerText, cursor: 'pointer' }} onClick={onLogout}>
              <LogoutOutlined /> 退出
            </Text>
          </Space>
        </Layout.Header>
        <Layout>
          <Layout.Sider width={160} theme={mode}>
            <Menu
              theme={mode}
              mode="inline"
              selectedKeys={[view]}
              items={[
                { key: 'report', icon: <FundOutlined />, label: '织机报工' },
                { key: 'board', icon: <DashboardOutlined />, label: '车间大屏' },
                { key: 'pick', icon: <SendOutlined />, label: '扫码出库' },
                { key: 'pickin', icon: <InboxOutlined />, label: '扫码入库' },
                { key: 'label', icon: <PrinterOutlined />, label: '标签打印' },
                { key: 'rollcard', icon: <BarcodeOutlined />, label: '件卡打印' },
                { key: 'scan', icon: <BarcodeOutlined />, label: '扫码查询' },
              ]
                // 菜单按权限门控：低权限账号(如挡车工)看不到无权访问的车间页，
                // 避免「点了才报无权限」。与后端端点权限码一一对应。
                .filter((item) => !session || sessionStore.has(VIEW_PERM[item.key as View]))}
              onClick={({ key }) => setView(key as View)}
            />
          </Layout.Sider>
          <Layout.Content>{children}</Layout.Content>
        </Layout>
      </Layout>
    </AntdApp>
  )

  if (!authed) {
    return (
      <AntdApp>
        <LoginPage onSuccess={() => setAuthed(true)} />
      </AntdApp>
    )
  }

  const page =
    view === 'report' ? <ReportPage /> : view === 'board' ? <BoardPage /> : view === 'label' ? <LabelPage /> : view === 'rollcard' ? <RollCardPage /> : view === 'pick' ? <PickPage /> : view === 'pickin' ? <PickInPage /> : <ScanPage />

  return shell(page)
}
