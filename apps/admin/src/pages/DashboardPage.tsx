import { useEffect, useState } from 'react'
import { Alert, Card, Space, Spin, Tag, Typography, theme } from 'antd'
import { api } from '../lib/api'
import { useAuthStore } from '../stores/auth.store'

const { Text, Paragraph } = Typography
const { token } = theme.useToken()

interface HealthPayload {
  status: string
  service: string
  version: string
  timestamp: string
}

/** 基准算例：全棉府绸，用于演示工艺内核能力 */
const DEMO_SPEC: Record<string, string> = {
  经密: '120 根/英寸',
  纬密: '72 根/英寸',
  纱支: '40 NeS（≈ 14.76 Tex / 132.9 旦）',
  幅宽: '150 cm',
  坯布克重: '111.6 g/m²',
  百米用料: '约 18.4 kg',
  日产量: '约 259 米（600 纬/分，运转率 85%）',
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
  const permissions = useAuthStore((s) => s.permissions)
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

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      {loading && <Spin />}

      {!loading && healthError && (
        <Alert type="warning" showIcon message="后端服务未连通" description={healthError} />
      )}

      {!loading && health && (
        <Card size="small">
          <Space size="middle" wrap>
            <Tag color="green">服务在线</Tag>
            <Text type="secondary">
              {health.service} v{health.version}
            </Text>
            <Text type="secondary">已授权 {permissions.length} 项权限</Text>
          </Space>
        </Card>
      )}

      <Card title="工艺内核基准算例（全棉府绸）" size="small">
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            下列结果由 packages/shared 确定性内核算出，非 AI 估算。克重、支数、用料三路交叉验证闭合，
            改动任何一条公式都会导致此表数值变化。
          </Text>
          <div style={{ marginTop: 8 }}>
            {Object.entries(DEMO_SPEC).map(([k, v]) => (
              <div
                key={k}
                style={{ display: 'flex', padding: '4px 0', borderBottom: `1px solid ${token.colorBorderSecondary}` }}
              >
                <Text type="secondary" style={{ width: 120 }}>
                  {k}
                </Text>
                <Text strong>{v}</Text>
              </div>
            ))}
          </div>
        </Space>
      </Card>

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

      <Card title="我的权限" size="small">
        <Space size={[6, 6]} wrap>
          {permissions.map((p) => (
            <Tag key={p}>{p}</Tag>
          ))}
        </Space>
      </Card>

      <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
        阶段一已完成 1.1 / 1.2 / 1.3 / 1.4。API 文档：
        <Text
          style={{ cursor: 'pointer', color: '#1D9E75' }}
          onClick={() => window.open('http://127.0.0.1:3180/api/docs', '_blank')}
        >
          http://127.0.0.1:3180/api/docs
        </Text>
      </Paragraph>
    </Space>
  )
}
