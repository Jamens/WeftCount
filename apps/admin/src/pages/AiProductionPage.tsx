import { useCallback, useEffect, useState } from 'react'
import { App as AntdApp, Alert, Button, Card, Col, Descriptions, Form, InputNumber, Row, Select, Space, Statistic, Table, Tabs, Tag, Typography } from 'antd'
import { ReloadOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { api } from '../lib/api'
import { useLookups } from '../lib/lookups'
import { fmt, type AiInsight, type GanttBar, type GanttData, type PredictionData, type ScheduleData } from '../lib/erp'
import { GanttChart } from '../components/GanttChart'

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
  const { message, modal } = AntdApp.useApp()
  const [insight, setInsight] = useState<AiInsight<ScheduleData> | null>(null)
  const [gantt, setGantt] = useState<GanttData | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // 与建议表同源：甘特多含在产/已排实占，建议表只有待排。任一失败都不该让另一半空白，故各自兜底。
      const [adv, g] = await Promise.allSettled([
        api.get<AiInsight<ScheduleData>>('/ai/scheduling'),
        api.get<GanttData>('/ai/scheduling/gantt'),
      ])
      if (adv.status === 'fulfilled') setInsight(adv.value.data.data)
      else message.error(adv.reason instanceof Error ? adv.reason.message : '加载排产建议失败')
      if (g.status === 'fulfilled') setGantt(g.value.data.data)
      else message.error(g.reason instanceof Error ? g.reason.message : '加载甘特图失败')
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => { void load() }, [load])

  // 待确认的建议条（draft）才可勾选，已落库的不可重复确认
  const draftBars = (gantt?.bars ?? []).filter((b) => b.status === 'draft' && b.machineId)

  /** 批量确认排产建议：一次事务落库，全部成功或全部不动 */
  const applySelected = () => {
    const items = draftBars
      .filter((b) => selected.includes(b.orderId))
      .map((b) => ({ orderId: b.orderId, machineId: b.machineId as string, startDay: b.startDay }))
    if (items.length === 0) return
    modal.confirm({
      title: `确认排产 ${items.length} 个工单？`,
      content: '将按甘特图指派机台并写入计划开工日，工单状态转为「已排产」。若期间有工单被他人改动，会跳过并在结果中列出。',
      okText: '确认排产',
      cancelText: '取消',
      onOk: async () => {
        setApplying(true)
        try {
          const res = await api.post<{ applied: number; skipped: string[] }>('/ai/scheduling/apply', { items })
          const r = res.data.data
          if (r.skipped.length > 0) {
            message.warning(`已排 ${r.applied} 个，跳过 ${r.skipped.length} 个（${r.skipped.join('、')}）`)
          } else {
            message.success(`已确认排产 ${r.applied} 个工单`)
          }
          setSelected([])
          await load()
        } catch (e) {
          message.error(e instanceof Error ? e.message : '批量排产失败')
        } finally {
          setApplying(false)
        }
      },
    })
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Space wrap>
        <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>刷新排产</Button>
        <Button type="primary" disabled={selected.length === 0} loading={applying} onClick={applySelected}>
          确认选中排产{selected.length > 0 ? `（${selected.length}）` : ''}
        </Button>
        {gantt && (
          <Text type="secondary">
            机台 {gantt.machines.length} 台 · 已占{/* eslint-disable-next-line react/no-unescaped-entities */}
            <Text strong>{gantt.committedCount}</Text> 条 · 建议<Text strong>{gantt.suggestedCount}</Text> 条 · 跨度{gantt.horizonDays}天
          </Text>
        )}
        {gantt && gantt.atRiskCount > 0 && <Tag color="red">{gantt.atRiskCount} 个逾期风险</Tag>}
      </Space>
      {!insight && !gantt ? (
        <Card size="small"><Alert type="info" showIcon message="加载中或无数据" description="需有生产工单（在产/已排产/草稿）才能排产。" /></Card>
      ) : (
        <>
          {gantt && gantt.bars.length > 0 && (
            <Card
              size="small"
              title="排产甘特图"
              extra={
                draftBars.length > 0 && (
                  <Space>
                    <Button size="small" type="link" onClick={() => setSelected(selected.length === draftBars.length ? [] : draftBars.map((b) => b.orderId))}>
                      {selected.length === draftBars.length ? '取消全选' : '全选建议'}
                    </Button>
                    <Text type="secondary" style={{ fontSize: 12 }}>勾选虚线「建议」条可批量确认</Text>
                  </Space>
                )
              }
            >
              <GanttChart machines={gantt.machines} bars={gantt.bars} horizonDays={gantt.horizonDays} />
              {/* 勾选区：图上不好点选，单独列一份可勾选清单 */}
              {draftBars.length > 0 && (
                <Table<GanttBar>
                  rowKey="orderId"
                  size="small"
                  style={{ marginTop: 12 }}
                  dataSource={draftBars}
                  pagination={false}
                  scroll={{ y: 220 }}
                  rowSelection={{
                    selectedRowKeys: selected,
                    onChange: (keys) => setSelected(keys as string[]),
                  }}
                  columns={[
                    { title: '工单号', dataIndex: 'orderNo', width: 150 },
                    { title: '规格', dataIndex: 'specName', width: 130, ellipsis: true },
                    { title: '计划(米)', dataIndex: 'plannedMeters', width: 90, align: 'right', render: (v: number) => fmt(String(v), 0) },
                    {
                      title: '建议机台',
                      width: 120,
                      render: (_, r) => gantt.machines.find((m) => m.id === r.machineId)?.name ?? '无机台',
                    },
                    { title: '起止(天)', width: 100, render: (_, r) => `第${r.startDay}~${r.endDay}天` },
                    { title: '占用(天)', dataIndex: 'days', width: 80, align: 'right' },
                    { title: '交期', dataIndex: 'dueInDays', width: 90, align: 'right', render: (v: number | null) => (v == null ? '无' : `还有${v}天`) },
                    {
                      title: '按期',
                      dataIndex: 'meetsDue',
                      width: 80,
                      render: (v: boolean | null) => (v == null ? '-' : v ? <Tag color="green">按期</Tag> : <Tag color="red">逾期</Tag>),
                    },
                  ]}
                />
              )}
            </Card>
          )}
          {insight && (
            <InsightCard insight={insight} />
          )}
        </>
      )}
    </Space>
  )
}
