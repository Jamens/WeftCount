import { useCallback, useEffect, useState } from 'react'
import { App as AntdApp, Alert, Button, Card, Col, Descriptions, Form, InputNumber, Row, Select, Space, Statistic, Table, Tabs, Tag, Typography } from 'antd'
import { ReloadOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { api } from '../lib/api'
import { useLookups } from '../lib/lookups'
import { fmt, LIST_TABLE_SCROLL_Y, type AiInsight, type PredictionData, type ScheduleData, type ScheduleRow } from '../lib/erp'

const { Title, Text } = Typography

/** 共用的 AI 结论卡片（来源/置信度/理由/依据） */
function InsightCard({ insight }: { insight: AiInsight<unknown> }) {
  const confPct = Math.round(insight.confidence * 100)
  return (
    <Card size="small">
      <Space wrap>
        <Tag color={insight.source === 'llm' ? 'purple' : 'blue'}>{insight.source === 'llm' ? 'AI 生成' : '规则兜底'}</Tag>
        <Tag color={confPct >= 60 ? 'green' : 'orange'}>置信度 {confPct}%</Tag>
      </Space>
      <div style={{ marginTop: 8 }}><Text strong>建议/解读：</Text><Text>{insight.reasoning}</Text></div>
      <details style={{ marginTop: 8 }}>
        <summary style={{ cursor: 'pointer' }}><Text type="secondary" style={{ fontSize: 12 }}>推导依据（确定性事实）</Text></summary>
        <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          {insight.derivation.map((x, i) => <li key={i}><Text type="secondary" style={{ fontSize: 12 }}>{x}</Text></li>)}
        </ul>
      </details>
    </Card>
  )
}

/** AI 生产助手：用料预测 + 排产建议 */
export default function AiProductionPage() {
  return (
    <div>
      <Space align="center" style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <div>
          <Title level={4} style={{ margin: 0 }}><ThunderboltOutlined /> AI 生产助手</Title>
          <Text type="secondary" style={{ fontSize: 12 }}>用料预测（算备料缺口）+ 排产建议（交期×产能排机台），AI 给建议、数字来自确定性引擎</Text>
        </div>
      </Space>
      <Tabs items={[{ key: 'pred', label: '用料预测', children: <PredictionTab /> }, { key: 'sched', label: '排产建议', children: <ScheduleTab /> }]} />
    </div>
  )
}

function PredictionTab() {
  const { message } = AntdApp.useApp()
  const { specs } = useLookups()
  const [form] = Form.useForm<{ specId?: string; plannedMeters?: number }>()
  const [loading, setLoading] = useState(false)
  const [insight, setInsight] = useState<AiInsight<PredictionData> | null>(null)
  const d = insight?.data

  const run = async () => {
    const v = await form.validateFields()
    setLoading(true)
    try {
      const res = await api.post<AiInsight<PredictionData>>('/ai/prediction', { specId: v.specId, plannedMeters: v.plannedMeters })
      setInsight(res.data.data)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '用料预测失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Row gutter={[12, 12]}>
      <Col span={8}>
        <Card size="small" title="预测条件">
          <Form form={form} layout="vertical" initialValues={{ plannedMeters: 10000 }}>
            <Form.Item name="specId" label="规格" rules={[{ required: true, message: '请选择规格' }]}>
              <Select showSearch optionFilterProp="label" placeholder="选择坯布规格" options={specs.map((s) => ({ value: s.id, label: `${s.code} ${s.name}` }))} />
            </Form.Item>
            <Form.Item name="plannedMeters" label="计划产量（米）" rules={[{ required: true, message: '请输入产量' }]}>
              <InputNumber style={{ width: '100%' }} min={1} precision={0} />
            </Form.Item>
            <Button type="primary" block loading={loading} onClick={() => void run()}>预测用料</Button>
          </Form>
        </Card>
      </Col>
      <Col span={16}>
        {!insight || !d ? (
          <Card size="small"><Alert type="info" showIcon message="等待预测" description="按规格工艺单耗(含实测系数)算经/纬纱需求，对比库存给采购缺口。" /></Card>
        ) : (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Row gutter={12}>
              <Col span={8}><Card size="small"><Statistic title="总需用料" value={d.totalNeedKg} precision={0} suffix="kg" /></Card></Col>
              <Col span={8}><Card size="small"><Statistic title="采购缺口" value={d.totalGapKg} precision={0} suffix="kg" valueStyle={{ color: d.totalGapKg > 0 ? '#cf1322' : '#3f8600' }} /></Card></Col>
              <Col span={8}><Card size="small"><Statistic title="预计采购成本" value={d.estPurchaseCost ?? '—'} precision={0} prefix={d.estPurchaseCost != null ? '¥' : ''} /></Card></Col>
            </Row>
            <Card size="small" title={`用料明细 · ${d.specName} · 计划 ${fmt(String(d.plannedMeters), 0)}m`}>
              <Descriptions column={2} size="small" bordered>
                <Descriptions.Item label="经纱需求">{d.warp.materialName}：{fmt(String(d.warp.needKg), 0)}kg（单耗 {d.warpKgPer100m.toFixed(2)}kg/100m）</Descriptions.Item>
                <Descriptions.Item label="纬纱需求">{d.weft.materialName}：{fmt(String(d.weft.needKg), 0)}kg（单耗 {d.weftKgPer100m.toFixed(2)}kg/100m）</Descriptions.Item>
                <Descriptions.Item label="经纱库存/缺口">{fmt(String(d.warp.stockKg), 0)} / {d.warp.gapKg > 0 ? <Text type="danger">缺 {fmt(String(d.warp.gapKg), 0)}kg</Text> : '足'}</Descriptions.Item>
                <Descriptions.Item label="纬纱库存/缺口">{fmt(String(d.weft.stockKg), 0)} / {d.weft.gapKg > 0 ? <Text type="danger">缺 {fmt(String(d.weft.gapKg), 0)}kg</Text> : '足'}</Descriptions.Item>
              </Descriptions>
            </Card>
            <InsightCard insight={insight} />
          </Space>
        )}
      </Col>
    </Row>
  )
}

function ScheduleTab() {
  const { message } = AntdApp.useApp()
  const [insight, setInsight] = useState<AiInsight<ScheduleData> | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<AiInsight<ScheduleData>>('/ai/scheduling')
      setInsight(res.data.data)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载排产建议失败')
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => { void load() }, [load])

  const d = insight?.data

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Space>
        <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>刷新排产</Button>
        {d && <Text type="secondary">待排 {d.orderCount} 工单 · 可用机台 {d.machineCount} 台{/* eslint-disable-next-line react/no-unescaped-entities */}</Text>}
        {d && d.atRiskCount > 0 && <Tag color="red">{d.atRiskCount} 个逾期风险</Tag>}
      </Space>
      {!insight || !d ? (
        <Card size="small"><Alert type="info" showIcon message="加载中或无数据" description="需有未排产(draft)的生产工单。" /></Card>
      ) : d.orderCount === 0 ? (
        <Card size="small"><Alert type="info" showIcon message="暂无待排工单" description="生产工单建为草稿(未排产)后，这里会给出机台分配与交期建议。" /></Card>
      ) : (
        <>
          <Card size="small" title="排产建议明细">
            <Table<ScheduleRow>
              rowKey="orderId" size="small" loading={loading} dataSource={d.rows}
              scroll={LIST_TABLE_SCROLL_Y ? { y: LIST_TABLE_SCROLL_Y } : undefined}
              pagination={false}
              columns={[
                { title: '工单号', dataIndex: 'orderNo', width: 150 },
                { title: '规格', dataIndex: 'specName', width: 130, ellipsis: true },
                { title: '计划(米)', dataIndex: 'plannedMeters', width: 90, align: 'right', render: (v: number) => fmt(String(v), 0) },
                { title: '建议机台', dataIndex: 'machineName', width: 120, render: (v: string | null) => v ?? '无机台' },
                { title: '起止(天)', width: 100, render: (_, r) => `第${r.startDay}~${r.endDay}天` },
                { title: '占用(天)', dataIndex: 'days', width: 80, align: 'right' },
                { title: '交期', dataIndex: 'dueInDays', width: 90, align: 'right', render: (v: number | null) => (v == null ? '无' : `还有${v}天`) },
                { title: '按期', dataIndex: 'meetsDue', width: 80, render: (v: boolean | null) => (v == null ? '-' : v ? <Tag color="green">按期</Tag> : <Tag color="red">逾期</Tag>) },
              ]}
            />
          </Card>
          <InsightCard insight={insight} />
        </>
      )}
    </Space>
  )
}
