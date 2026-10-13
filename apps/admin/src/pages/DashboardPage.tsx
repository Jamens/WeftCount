import { useCallback, useEffect, useState } from 'react'
import { Alert, Badge, Button, Card, Col, Empty, Row, Skeleton, Space, Statistic, Table, Tag, Typography } from 'antd'
import {
  AlertOutlined,
  ArrowRightOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { fmt, type DashboardData } from '../lib/erp'
import { useAuthStore } from '../stores/auth.store'

const { Text, Paragraph } = Typography

interface HealthPayload {
  status: string
  service: string
  version: string
  timestamp: string
}

/** 近 7 日日产量的迷你条形图（零依赖 SVG，与 Charts.tsx 风格一致） */
function OutputSpark({ data }: { data: { date: string; meters: number }[] }) {
  const W = 640
  const H = 96
  const PAD_B = 20
  const max = Math.max(...data.map((d) => d.meters), 1)
  const bw = W / Math.max(data.length, 1)
  const label = { fontSize: 10, fill: '#8C8C8C' } as const

  return (
    <svg viewBox={`0 0 ${W} ${H + PAD_B}`} style={{ width: '100%', display: 'block' }} role="img" aria-label="近7日日产量">
      {data.map((d, i) => {
        const h = (d.meters / max) * H
        const x = i * bw + bw * 0.2
        const w = bw * 0.6
        return (
          <g key={d.date}>
            <rect x={x} y={H - h} width={w} height={Math.max(h, 1)} fill="#0F6E56" rx={2}>
              <title>{`${d.date}：${fmt(String(d.meters), 0)} 米`}</title>
            </rect>
            {d.meters > 0 && (
              <text x={x + w / 2} y={H - h - 4} fontSize={9} fill="#0F6E56" textAnchor="middle">
                {fmt(String(d.meters), 0)}
              </text>
            )}
            <text x={x + w / 2} y={H + 14} style={label} textAnchor="middle">
              {d.date.slice(5)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/**
 * 首页概览
 *
 * 此前是**纯静态页**——唯一请求是 `/health`，其余全是硬编码的演示数据
 * （固定的全棉府绸工艺基准值），业务方打开看不到任何与自己工厂有关的东西。
 * 现改为真实的确定性聚合：库存/采购/销售/生产/待办 + 近 7 日产量。
 */
export default function DashboardPage() {
  const permissions = useAuthStore((s) => s.permissions)
  const hasPermission = useAuthStore((s) => s.hasPermission)
  const nav = useNavigate()
  const [health, setHealth] = useState<HealthPayload | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)
  const [data, setData] = useState<DashboardData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    // 两个请求互不依赖：健康状态失败不应让概览一起挂掉，各自兜底
    const [h, d] = await Promise.allSettled([
      api.get<HealthPayload>('/health'),
      api.get<DashboardData>('/dashboard/overview'),
    ])
    if (h.status === 'fulfilled') {
      setHealth(h.value.data.data)
      setHealthError(null)
    } else {
      setHealthError(h.reason instanceof Error ? h.reason.message : '后端未连通')
    }
    if (d.status === 'fulfilled') {
      setData(d.value.data.data)
      setLoadError(null)
    } else {
      setLoadError(d.reason instanceof Error ? d.reason.message : '加载概览失败')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // 金额属敏感数据：无成本/报表权限者不展示，避免只读角色看到全厂营收
  const canSeeMoney = hasPermission('cost.view') || hasPermission('report.view')
  const t = data?.todo
  const hasTodo = !!t && (t.openAlerts > 0 || t.overdueOrders > 0 || t.dueSoonOrders > 0)
  const monthLabel = data?.period.label ?? '本月'

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Space align="center" style={{ width: '100%', justifyContent: 'space-between' }}>
        <div>
          <Text strong style={{ fontSize: 16 }}>工作台</Text>
          <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
            {monthLabel}经营概览 · 数字均来自数据库聚合，与各业务页一致
          </Text>
        </div>
        <Button size="small" icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
          刷新
        </Button>
      </Space>

      {loading && !data && <Skeleton active paragraph={{ rows: 6 }} />}

      {loadError && (
        <Alert
          type="error"
          showIcon
          message="概览加载失败"
          description={
            <Space direction="vertical" size={4}>
              <Text>{loadError}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                常见原因：当前账号没有任何业务查看权限（inventory.view / production.view / report.view 等），
                或后端服务未启动。
              </Text>
            </Space>
          }
        />
      )}

      {!loading && healthError && (
        <Alert type="warning" showIcon message="后端服务未连通" description={healthError} />
      )}

      {!loading && health && !healthError && (
        <Card size="small" styles={{ body: { padding: '8px 12px' } }}>
          <Space size="middle" wrap>
            <Tag color="green" style={{ marginInlineEnd: 0 }}>服务在线</Tag>
            <Text type="secondary" style={{ fontSize: 12 }}>{health.service} v{health.version}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>已授权 {permissions.length} 项权限</Text>
          </Space>
        </Card>
      )}

      {data && (
        <>
          {/* 待办优先：MES 首页第一屏该是"今天要处理什么"，不是漂亮图表 */}
          {hasTodo && (
            <Card size="small" title={<Space><AlertOutlined />待办事项</Space>}>
              <Space size="middle" wrap>
                <Badge count={t!.overdueOrders} offset={[8, 0]}>
                  <Button
                    size="small"
                    danger={t!.overdueOrders > 0}
                    icon={<ExclamationCircleOutlined />}
                    onClick={() => nav('/orders')}
                  >
                    逾期订单
                  </Button>
                </Badge>
                <Badge count={t!.dueSoonOrders} offset={[8, 0]} color="#FA8C16">
                  <Button size="small" icon={<ClockCircleOutlined />} onClick={() => nav('/orders')}>
                    7天内交期
                  </Button>
                </Badge>
                <Badge count={t!.openAlerts} offset={[8, 0]} color="#FAAD14">
                  <Button size="small" icon={<AlertOutlined />} onClick={() => nav('/alerts')}>
                    未确认预警
                  </Button>
                </Badge>
              </Space>
            </Card>
          )}

          <Row gutter={[12, 12]}>
            <Col xs={12} sm={12} md={6}>
              <Card size="small" loading={loading}>
                <Statistic
                  title="在库坯布"
                  value={data.inventory.greigeMeters}
                  precision={0}
                  suffix="m"
                  valueStyle={{ color: '#0F6E56' }}
                />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {fmt(String(data.inventory.rollsInStock), 0)} 匹在库
                </Text>
              </Card>
            </Col>
            <Col xs={12} sm={12} md={6}>
              <Card size="small" loading={loading}>
                <Statistic
                  title={`${monthLabel}产出`}
                  value={data.production.outputMeters}
                  precision={0}
                  suffix="m"
                />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  在产{data.production.inProgressOrders}单 · 待排{data.production.draftOrders}单
                </Text>
              </Card>
            </Col>
            {canSeeMoney ? (
              <>
                <Col xs={12} sm={12} md={6}>
                  <Card size="small" loading={loading}>
                    <Statistic title={`${monthLabel}销售额`} value={data.sales.amount} precision={0} prefix="¥" valueStyle={{ color: '#185FA5' }} />
                    <Text type="secondary" style={{ fontSize: 12 }}>{data.sales.orders} 单出库</Text>
                  </Card>
                </Col>
                <Col xs={12} sm={12} md={6}>
                  <Card size="small" loading={loading}>
                    <Statistic title="在库货值" value={data.inventory.stockValue} precision={0} prefix="¥" />
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      采购 {fmt(String(data.purchase.amount), 0)} 元
                    </Text>
                  </Card>
                </Col>
              </>
            ) : (
              <Col xs={24} sm={24} md={12}>
                <Card size="small" loading={loading}>
                  <Statistic title="在库重量" value={data.inventory.remainingKg} precision={0} suffix="kg" />
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    机台 {data.production.machineRunning}/{data.production.machineTotal} 在产
                  </Text>
                </Card>
              </Col>
            )}
          </Row>

          <Row gutter={[12, 12]}>
            <Col xs={24} lg={14}>
              <Card size="small" title="近 7 日日产量" extra={<Text type="secondary" style={{ fontSize: 12 }}>报工产出（批次口径）</Text>}>
                {data.recentOutput.some((d) => d.meters > 0) ? (
                  <OutputSpark data={data.recentOutput} />
                ) : (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        近 7 日暂无报工产出。生产工单排产后，车间报工即会出现在这里。
                      </Text>
                    }
                    style={{ margin: '16px 0' }}
                  />
                )}
              </Card>
            </Col>
            <Col xs={24} lg={10}>
              <Card size="small" title="生产概况">
                <Table
                  size="small"
                  pagination={false}
                  showHeader={false}
                  rowKey="k"
                  dataSource={[
                    { k: '机台状态', v: `${data.production.machineRunning} / ${data.production.machineTotal} 在产` },
                    { k: '在产工单', v: `${data.production.inProgressOrders} 单` },
                    { k: '待排产', v: `${data.production.draftOrders} 单` },
                    { k: `${monthLabel}报工`, v: `${data.production.reportCount} 次` },
                    { k: '在库匹数', v: `${data.inventory.rollsInStock} 匹` },
                    ...(canSeeMoney
                      ? [{ k: `${monthLabel}采购`, v: `${fmt(String(data.purchase.amount), 0)} 元 / ${data.purchase.orders} 单` }]
                      : []),
                  ]}
                  columns={[
                    { title: '项目', dataIndex: 'k', width: '40%' },
                    { title: '数值', dataIndex: 'v', align: 'right' },
                  ]}
                />
                {data.production.draftOrders > 0 && (
                  <Button
                    type="link"
                    size="small"
                    style={{ marginTop: 8, paddingLeft: 0 }}
                    onClick={() => nav('/ai-production')}
                  >
                    有待排产工单，去排产建议 <ArrowRightOutlined />
                  </Button>
                )}
              </Card>
            </Col>
          </Row>
        </>
      )}

      {!loading && !data && !loadError && (
        <Card size="small">
          <Empty description="暂无概览数据" />
        </Card>
      )}

      {/* 系统能力说明：保留原来的分层展示（这是产品说明，不是业务数据） */}
      <Card size="small" title="系统能力分层">
        <Space size={[8, 8]} wrap>
          {['多单位体系', '支数换算', '经纬用量公式', '克重反算', '三算对账', '件卡追溯', 'AI 核价', '损耗归因', '排产建议'].map((x) => (
            <Tag key={x}>{x}</Tag>
          ))}
        </Space>
      </Card>

      <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
        <Space split={<Text type="secondary">·</Text>}>
          <span>统计口径：采购/销售按单据创建日，产出按报工日，均为{monthLabel}至今</span>
          <span>
            API 文档：
            <Text
              style={{ cursor: 'pointer', color: '#1D9E75' }}
              onClick={() => window.open(`${window.location.origin}/api/docs`, '_blank')}
            >
              /api/docs
            </Text>
          </span>
        </Space>
      </Paragraph>
    </Space>
  )
}