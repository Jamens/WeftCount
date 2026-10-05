import { useEffect, useState } from 'react'
import { Alert, Button, Card, Col, Row, Select, Space, Spin, Tag, Typography } from 'antd'
import { LogoutOutlined, SwapOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuthStore } from '../stores/auth.store'

const { Title, Text, Paragraph } = Typography

interface HealthPayload {
  status: string
  service: string
  version: string
  timestamp: string
}

const LAYERS = [
  {
    name: 'AI 智能引擎层',
    color: 'purple',
    items: ['系数自学习', '智能核价', '用料预测', '损耗归因', '排产建议'],
  },
  {
    name: '工艺计量内核层',
    color: 'cyan',
    items: ['多单位体系', '支数换算', '经纬用量公式', '克重反算', '一件事三算'],
  },
  {
    name: '进销存业务层',
    color: 'blue',
    items: ['采购 / 销售', '库存 / 批次', '生产 / 报工', '成本 / 报表', '全链路追溯'],
  },
]

export default function DashboardPage() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const tenant = useAuthStore((s) => s.tenant)
  const companies = useAuthStore((s) => s.companies)
  const currentCompanyId = useAuthStore((s) => s.currentCompanyId)
  const permissions = useAuthStore((s) => s.permissions)
  const logout = useAuthStore((s) => s.logout)
  const switchCompany = useAuthStore((s) => s.switchCompany)

  const [health, setHealth] = useState<HealthPayload | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api
      .get<HealthPayload>('/health')
      .then((res) => {
        setHealth(res.data.data)
        setHealthError(null)
      })
      .catch((e: unknown) => setHealthError(e instanceof Error ? e.message : '后端未连通'))
      .finally(() => setLoading(false))
  }, [])

  const onLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '32px 24px' }}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Row align="middle" justify="space-between">
          <Col>
            <Title level={3} style={{ marginBottom: 4 }}>
              纬数 WeftCount
            </Title>
            <Space size="small">
              <Text strong>{user?.realName}</Text>
              <Text type="secondary">{tenant?.name}</Text>
              {tenant && (
                <Tag color={tenant.aiEnabled ? 'gold' : 'default'}>{tenant.planLabel}</Tag>
              )}
            </Space>
          </Col>
          <Col>
            <Space>
              {companies.length > 1 && (
                <Select
                  value={currentCompanyId}
                  onChange={(v) => void switchCompany(v)}
                  options={companies.map((c) => ({ value: c.id, label: c.name }))}
                  suffixIcon={<SwapOutlined />}
                  style={{ width: 180 }}
                />
              )}
              <Button icon={<LogoutOutlined />} onClick={onLogout}>
                退出
              </Button>
            </Space>
          </Col>
        </Row>

        {loading && <Spin />}

        {!loading && healthError && (
          <Alert type="warning" showIcon message="后端服务未连通" description={healthError} />
        )}

        {!loading && health && (
          <Space size="middle">
            <Tag color="green">服务在线</Tag>
            <Text type="secondary">
              {health.service} v{health.version}
            </Text>
            <Text type="secondary">已授权 {permissions.length} 项权限</Text>
          </Space>
        )}

        <Card title="系统分层" size="small">
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            {LAYERS.map((layer) => (
              <div key={layer.name}>
                <Text strong>{layer.name}</Text>
                <div style={{ marginTop: 8 }}>
                  <Space size={[8, 8]} wrap>
                    {layer.items.map((item) => (
                      <Tag key={item} color={layer.color}>
                        {item}
                      </Tag>
                    ))}
                  </Space>
                </div>
              </div>
            ))}
          </Space>
        </Card>

        <Card size="small" title="我的权限">
          <Space size={[6, 6]} wrap>
            {permissions.map((p) => (
              <Tag key={p}>{p}</Tag>
            ))}
          </Space>
        </Card>

        <Card size="small">
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            阶段一已完成 1.1 / 1.2 / 1.3。API 文档：
            <Text
              style={{ cursor: 'pointer', color: '#1D9E75' }}
              onClick={() => window.open('http://127.0.0.1:3180/api/docs', '_blank')}
            >
              http://127.0.0.1:3180/api/docs
            </Text>
          </Paragraph>
        </Card>
      </Space>
    </div>
  )
}
