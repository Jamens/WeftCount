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
import { authStore } from './lib/api'
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

export default function App() {
  const [authed, setAuthed] = useState<boolean>(() => !!authStore.getToken())
  const [view, setView] = useState<View>('report')
  const [env, setEnv] = useState<{ version: string; platform: string } | null>(null)

  const mode = useThemeStore((s) => s.mode)
  const toggleTheme = useThemeStore((s) => s.toggle)
  const { token } = theme.useToken()

  useEffect(() => {
    if (!window.weftDesktop) return
    void Promise.all([window.weftDesktop.getVersion(), window.weftDesktop.getPlatform()]).then(
      ([version, platform]) => setEnv({ version, platform }),
    )
  }, [])

  const onLogout = useCallback(() => {
    authStore.clear()
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
              ]}
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
