import { useEffect, useState } from 'react'
import { Card, Space, Tag, Typography, Row, Col } from 'antd'
import { BarcodeOutlined, FileTextOutlined, DashboardOutlined } from '@ant-design/icons'

const { Title, Text } = Typography

interface EnvInfo {
  version: string
  platform: string
}

const MODULES = [
  { key: 'inbound', label: '扫码入库', icon: <BarcodeOutlined />, desc: '扫布匹码 / 纱线筒子号入库' },
  { key: 'outbound', label: '扫码出库', icon: <BarcodeOutlined />, desc: '拣货扫码出库与送货车绑定' },
  { key: 'report', label: '织机报工', icon: <FileTextOutlined />, desc: '挡车工报工，产量自动累加' },
  { key: 'board', label: '车间大屏', icon: <DashboardOutlined />, desc: '产线状态、当日产量、异常预警' },
]

export default function App() {
  const [env, setEnv] = useState<EnvInfo | null>(null)

  useEffect(() => {
    if (!window.weftDesktop) return
    void Promise.all([window.weftDesktop.getVersion(), window.weftDesktop.getPlatform()]).then(
      ([version, platform]) => setEnv({ version, platform }),
    )
  }, [])

  return (
    <div style={{ padding: '32px 40px' }}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Row align="middle" justify="space-between">
          <Col>
            <Title level={3} style={{ marginBottom: 4 }}>
              纬数车间工作台
            </Title>
            <Text type="secondary">仓管 · 挡车 · 工艺员的日常操作台</Text>
          </Col>
          <Col>
            {env ? (
              <Space size="small">
                <Tag color="green">Electron 在线</Tag>
                <Tag>v{env.version}</Tag>
                <Tag>{env.platform}</Tag>
              </Space>
            ) : (
              <Tag color="default">预加载桥未就绪</Tag>
            )}
          </Col>
        </Row>

        <Row gutter={[16, 16]}>
          {MODULES.map((m) => (
            <Col key={m.key} span={12}>
              <Card hoverable size="small">
                <Space align="start">
                  <Text style={{ fontSize: 22, color: '#BA7517' }}>{m.icon}</Text>
                  <Space direction="vertical" size={2}>
                    <Text strong>{m.label}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {m.desc}
                    </Text>
                  </Space>
                </Space>
              </Card>
            </Col>
          ))}
        </Row>

        <Card size="small" title="阶段说明">
          <Text type="secondary">
            桌面端骨架已就绪，扫码出入库与报工功能将在阶段五、阶段八接入。
          </Text>
        </Card>
      </Space>
    </div>
  )
}
