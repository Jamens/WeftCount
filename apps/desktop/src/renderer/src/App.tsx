import { useCallback, useEffect, useState } from 'react'
import { App as AntdApp, Layout, Menu, Space, Tag, Typography } from 'antd'
import { FundOutlined, DashboardOutlined, LogoutOutlined, PrinterOutlined, BarcodeOutlined, SendOutlined } from '@ant-design/icons'
import { authStore } from './lib/api'
import LoginPage from './pages/LoginPage'
import ReportPage from './pages/ReportPage'
import BoardPage from './pages/BoardPage'
import LabelPage from './pages/LabelPage'
import ScanPage from './pages/ScanPage'
import PickPage from './pages/PickPage'

const { Text } = Typography

type View = 'report' | 'board' | 'label' | 'scan' | 'pick'

export default function App() {
  const [authed, setAuthed] = useState<boolean>(() => !!authStore.getToken())
  const [view, setView] = useState<View>('report')
  const [env, setEnv] = useState<{ version: string; platform: string } | null>(null)

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

  if (!authed) {
    return (
      <AntdApp>
        <LoginPage onSuccess={() => setAuthed(true)} />
      </AntdApp>
    )
  }

  return (
    <AntdApp>
      <Layout style={{ minHeight: '100vh' }}>
      <Layout.Header style={{ background: '#141414', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px' }}>
        <Text strong style={{ color: '#fff', fontSize: 16 }}>纬数 · 车间工作台</Text>
        <Space>
          {env && <Tag style={{ margin: 0 }}>v{env.version}</Tag>}
          <Text style={{ color: 'rgba(255,255,255,0.7)', cursor: 'pointer' }} onClick={onLogout}>
            <LogoutOutlined /> 退出
          </Text>
        </Space>
      </Layout.Header>
      <Layout>
        <Layout.Sider width={160} theme="dark">
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[view]}
            items={[
              { key: 'report', icon: <FundOutlined />, label: '织机报工' },
              { key: 'board', icon: <DashboardOutlined />, label: '车间大屏' },
              { key: 'pick', icon: <SendOutlined />, label: '扫码出库' },
              { key: 'label', icon: <PrinterOutlined />, label: '标签打印' },
              { key: 'scan', icon: <BarcodeOutlined />, label: '扫码查询' },
            ]}
            onClick={({ key }) => setView(key as View)}
          />
        </Layout.Sider>
        <Layout.Content style={{ background: view === 'board' ? '#0f1115' : '#f5f5f5' }}>
          {view === 'report' ? <ReportPage /> : view === 'board' ? <BoardPage /> : view === 'label' ? <LabelPage /> : view === 'pick' ? <PickPage /> : <ScanPage />}
        </Layout.Content>
      </Layout>
    </Layout>
    </AntdApp>
  )
}
