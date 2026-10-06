import { useCallback, useEffect, useMemo, useState } from 'react'
import { App as AntdApp, Badge, Card, Col, Empty, Progress, Row, Space, Statistic, Tag, Typography } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { api } from '../lib/api'
import { fmt, num, type GreigeSpecWire, type MachineWire, type ProductionOrderWire } from '../lib/types'

const { Title, Text } = Typography

const MACHINE_STATUS: Record<MachineWire['status'], { text: string; color: string }> = {
  idle: { text: '空闲', color: 'default' },
  running: { text: '运转', color: 'green' },
  maintenance: { text: '维修', color: 'orange' },
  retired: { text: '报废', color: 'red' },
}

export default function BoardPage() {
  const { message } = AntdApp.useApp()
  const [orders, setOrders] = useState<ProductionOrderWire[]>([])
  const [machines, setMachines] = useState<MachineWire[]>([])
  const [specs, setSpecs] = useState<GreigeSpecWire[]>([])
  const [loading, setLoading] = useState(false)

  const specName = useCallback((id: string) => specs.find((s) => s.id === id)?.name ?? id, [specs])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [o, m, s] = await Promise.all([
        api.get<ProductionOrderWire[]>('/production-orders'),
        api.get<MachineWire[]>('/machines'),
        api.get<GreigeSpecWire[]>('/greige-specs'),
      ])
      setOrders(o)
      setMachines(m.filter((x) => x.status !== 'retired'))
      setSpecs(s)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载大屏数据失败')
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 15000) // 15s 自动刷新
    return () => clearInterval(t)
  }, [load])

  // 每台机台当前工单：优先在产(scheduled/in_progress)，其次已排产
  const orderByMachine = useMemo(() => {
    const map = new Map<string, ProductionOrderWire>()
    for (const o of orders) {
      if (!o.machineId) continue
      if (o.status === 'in_progress' || o.status === 'scheduled') map.set(o.machineId, o)
    }
    return map
  }, [orders])

  const runningCount = useMemo(() => machines.filter((m) => m.status === 'running').length, [machines])
  const activeOrders = useMemo(() => orders.filter((o) => o.status === 'in_progress' || o.status === 'scheduled'), [orders])
  const overdue = useMemo(
    () => {
      const today = dayjs().format('YYYY-MM-DD')
      return activeOrders.filter((o) => o.dueDate && o.dueDate < today)
    },
    [activeOrders],
  )

  return (
    <div style={{ padding: 16, background: '#0f1115', minHeight: '100vh' }}>
      <Row align="middle" justify="space-between" style={{ marginBottom: 16 }}>
        <Col>
          <Title level={3} style={{ color: '#fff', margin: 0 }}>
            车间生产大屏
          </Title>
          <Text style={{ color: 'rgba(255,255,255,0.5)' }}>
            机台状态 · 在产工单进度 · 异常提示（每 15 秒自动刷新）
          </Text>
        </Col>
        <Col>
          <Space>
            {overdue.length > 0 && <Tag color="red">逾期工单 {overdue.length}</Tag>}
            <Tag color="green" onClick={() => void load()} style={{ cursor: 'pointer' }}>
              <ReloadOutlined /> 刷新
            </Tag>
          </Space>
        </Col>
      </Row>

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col span={6}><Card size="small"><Statistic title="机台总数" value={machines.length} suffix="台" valueStyle={{ color: '#fff' }} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="运转中" value={runningCount} suffix="台" valueStyle={{ color: '#52c41a' }} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="在产工单" value={activeOrders.length} suffix="单" valueStyle={{ color: '#1890ff' }} /></Card></Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="在产累计产出"
              value={activeOrders.reduce((s, o) => s + num(o.producedQuantityM), 0).toFixed(0)}
              suffix="m"
              valueStyle={{ color: '#faad14' }}
            />
          </Card>
        </Col>
      </Row>

      {machines.length === 0 ? (
        <Empty description="暂无机台（请在 admin 生产管理维护机台）" style={{ marginTop: 60 }} />
      ) : (
        <Row gutter={[12, 12]}>
          {machines.map((m) => {
            const o = orderByMachine.get(m.id)
            const st = MACHINE_STATUS[m.status]
            const pct = o && num(o.plannedQuantityM) > 0 ? Math.min((num(o.producedQuantityM) / num(o.plannedQuantityM)) * 100, 100) : 0
            return (
              <Col key={m.id} span={6}>
                <Card
                  size="small"
                  title={<Space><span style={{ color: '#fff' }}>{m.name}</span>{m.model && <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>{m.model}</Text>}</Space>}
                  extra={<Badge status={m.status === 'running' ? 'processing' : 'default'} text={<span style={{ color: st.color }}>{st.text}</span>} />}
                  style={{ background: '#1a1d24', borderColor: '#2a2e38' }}
                >
                  {o ? (
                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                      <Space>
                        <Tag color="processing" style={{ margin: 0 }}>{o.orderNo}</Tag>
                        <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>{specName(o.specId)}</Text>
                      </Space>
                      <Progress percent={Math.round(pct)} size="small" strokeColor="#1890ff" trailColor="#2a2e38" />
                      <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>
                        {fmt(o.producedQuantityM, 0)} / {fmt(o.plannedQuantityM, 0)} m
                        {o.dueDate && <span style={{ marginLeft: 8 }}>交期 {o.dueDate}</span>}
                      </Text>
                    </Space>
                  ) : (
                    <Text style={{ color: 'rgba(255,255,255,0.35)' }}>
                      {m.status === 'maintenance' ? '维修中，暂不排产' : '空闲，无在产工单'}
                    </Text>
                  )}
                </Card>
              </Col>
            )
          })}
        </Row>
      )}
    </div>
  )
}
