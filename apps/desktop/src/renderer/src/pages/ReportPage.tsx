import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  App as AntdApp,
  Button,
  Card,
  Col,
  Empty,
  InputNumber,
  Progress,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd'
import { ReloadOutlined, SendOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { api } from '../lib/api'
import { fmt, num, type ReportableOrder } from '../lib/types'

const { Title, Text } = Typography

/**
 * 织机报工（挡车工）
 *
 * 只依赖 `/production-orders/reportable`（服务端已带机台名/规格名），
 * 权限只需 production.report——挡车工角色没有 production.view/material.view 也能用。
 */
export default function ReportPage() {
  const { message } = AntdApp.useApp()
  const [orders, setOrders] = useState<ReportableOrder[]>([])
  const [loading, setLoading] = useState(false)
  const [target, setTarget] = useState<ReportableOrder | null>(null)
  const [outputM, setOutputM] = useState<number | null>(null)
  const [stopMin, setStopMin] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setOrders(await api.get<ReportableOrder[]>('/production-orders/reportable'))
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载工单失败')
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    void load()
  }, [load])

  const activeOutputM = useMemo(() => orders.reduce((s, o) => s + num(o.producedQuantityM), 0), [orders])

  const onSubmit = async () => {
    if (!target) return
    if (!outputM || outputM <= 0) {
      message.warning('请输入本次产出（米）')
      return
    }
    setSubmitting(true)
    try {
      await api.post(`/production-orders/${target.id}/reports`, {
        outputM,
        reportDate: dayjs().format('YYYY-MM-DD'),
        stoppageMinutes: stopMin ?? null,
      })
      message.success(`报工成功：${outputM}m 已入库${target.status === 'scheduled' ? '，工单转入生产中' : ''}`)
      setTarget(null)
      setOutputM(null)
      setStopMin(null)
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '报工失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col span={8}>
          <Card size="small"><Statistic title="可报工工单" value={orders.length} suffix="单" /></Card>
        </Col>
        <Col span={8}>
          <Card size="small"><Statistic title="这些工单累计产出" value={num(activeOutputM).toFixed(0)} suffix="m" /></Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading} block>刷新工单</Button>
          </Card>
        </Col>
      </Row>

      <Card size="small" title="选择工本报工">
        {orders.length === 0 ? (
          <Empty description="暂无可报工工单（请先在 admin 生产管理建单并排产到机台）" />
        ) : (
          <Table<ReportableOrder>
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={orders}
            columns={[
              { title: '工单号', dataIndex: 'orderNo', width: 150 },
              { title: '规格', dataIndex: 'specName', width: 140, render: (v: string | null) => v ?? '-' },
              { title: '机台', dataIndex: 'machineName', width: 110, render: (v: string | null) => v ?? '-' },
              {
                title: '状态',
                dataIndex: 'status',
                width: 90,
                render: (s: string) => (s === 'in_progress' ? <Tag color="processing">生产中</Tag> : <Tag color="blue">已排产</Tag>),
              },
              { title: '计划(米)', dataIndex: 'plannedQuantityM', width: 90, align: 'right', render: (v: string) => fmt(v, 0) },
              { title: '已产(米)', dataIndex: 'producedQuantityM', width: 90, align: 'right', render: (v: string) => fmt(v, 0) },
              {
                title: '进度',
                dataIndex: 'producedQuantityM',
                width: 150,
                render: (_, o) => {
                  const p = num(o.plannedQuantityM)
                  const pct = p > 0 ? Math.min((num(o.producedQuantityM) / p) * 100, 100) : 0
                  return <Progress percent={Math.round(pct)} size="small" />
                },
              },
              {
                title: '操作',
                width: 90,
                fixed: 'right',
                render: (_, o) => (
                  <Button type="primary" size="small" icon={<SendOutlined />} onClick={() => setTarget(o)}>
                    报工
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Card>

      {target && (
        <Card
          size="small"
          title={`报工 · ${target.orderNo}`}
          style={{ marginTop: 12 }}
          extra={
            <Space>
              <Button onClick={() => setTarget(null)}>取消</Button>
              <Button type="primary" loading={submitting} onClick={() => void onSubmit()}>提交报工</Button>
            </Space>
          }
        >
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Text type="secondary">
              规格 {target.specName ?? '-'} · 机台 {target.machineName ?? '-'} · 计划 {fmt(target.plannedQuantityM, 0)}m · 已产{' '}
              {fmt(target.producedQuantityM, 0)}m
            </Text>
            <Space size="large" wrap>
              <div>
                <Text>本次产出（米）</Text>
                <div><InputNumber style={{ width: 180 }} min={0.001} value={outputM} onChange={setOutputM} placeholder="本次织出米数" /></div>
              </div>
              <div>
                <Text>停机分钟（可选）</Text>
                <div><InputNumber style={{ width: 140 }} min={0} value={stopMin} onChange={setStopMin} placeholder="如 30" /></div>
              </div>
            </Space>
            <Text type="secondary" style={{ fontSize: 12 }}>提交后本次产出自动入库为坯布批次，并累加工单进度（满额自动完成）。</Text>
          </Space>
        </Card>
      )}
    </div>
  )
}
