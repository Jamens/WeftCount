import { useEffect, useState } from 'react'
import { Card, Space, Tag, Typography, Spin, Alert } from 'antd'
import { Link } from 'react-router-dom'
import { api } from './lib/api'

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

export default function App() {
  const [health, setHealth] = useState<HealthPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api
      .get<HealthPayload>('/health')
      .then((res) => {
        setHealth(res.data.data)
        setError(null)
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : '后端服务未启动')
      })
      .finally(() => setLoading(false))
  }, [])

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '48px 24px' }}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div>
          <Title level={2} style={{ marginBottom: 8 }}>
            纬数 WeftCount
          </Title>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            纺织行业 AI 进销存系统 · 管理端
          </Paragraph>
        </div>

        {loading && <Spin />}

        {!loading && error && (
          <Alert
            type="warning"
            showIcon
            message="后端服务未连通"
            description={`${error}。请先启动后端：pnpm dev:server`}
          />
        )}

        {!loading && health && (
          <Space size="middle">
            <Tag color="green">服务在线</Tag>
            <Text type="secondary">
              {health.service} v{health.version}
            </Text>
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

        <Card size="small">
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            阶段一地基已就绪。API 文档：
            <Link to="http://127.0.0.1:3180/api/docs" target="_blank">
              http://127.0.0.1:3180/api/docs
            </Link>
          </Paragraph>
        </Card>
      </Space>
    </div>
  )
}
