import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tooltip,
  Typography,
} from 'antd'
import { ThunderboltOutlined } from '@ant-design/icons'
import dayjs, { Dayjs } from 'dayjs'
import { api } from '../lib/api'
import { PERM } from '../lib/erp'
import { useAuthStore } from '../stores/auth.store'

const { Title, Text } = Typography
const { RangePicker } = DatePicker

interface MachineOptionWire {
  id: string
  code: string
  name: string
  status: string
}
interface ReadingWire {
  id: string
  machineId: string
  machineCode: string
  machineName: string
  meterNo: string
  readingDate: string
  reading: number
  tariff: number
  consumedKwh: number | null
  cost: number | null
  isBaseline: boolean
  remark: string | null
}
interface EnergyRowWire {
  machineId: string
  machineCode: string
  machineName: string
  totalKwh: number | null
  outputM: number
  kwhPer100m: number | null
  totalCost: number | null
  costPerMeter: number | null
  lastReadingDate: string | null
}
interface EnergyTotalsWire {
  totalKwh: number
  outputM: number
  kwhPer100m: number | null
  totalCost: number
  costPerMeter: number | null
  readingCount: number
  machineCount: number
}
interface StatsWire {
  periodStart: string
  periodEnd: string
  rows: EnergyRowWire[]
  totals: EnergyTotalsWire
  missingMachines: string[]
}
interface CompareWire {
  current: EnergyTotalsWire
  prev: EnergyTotalsWire
  prevStart: string
  prevEnd: string
  kwhPer100mDelta: number | null
  kwhPer100mDeltaPct: number | null
}

/** 缺数一律显示破折号，绝不让 null 变成 0 或 NaN 混进账里 */
const DASH = '—'
const kwh = (v: number | null | undefined) => (v == null ? DASH : `${(v ?? 0).toLocaleString('zh-CN', { maximumFractionDigits: 1 })}`)
const unit = (v: number | null | undefined) => (v == null ? DASH : `${(v ?? 0).toFixed(2)}`)
const money = (v: number | null | undefined) => (v == null ? DASH : `¥${(v ?? 0).toFixed(2)}`)
const meters = (v: number | null | undefined) => (v == null ? DASH : `${(v ?? 0).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} m`)

/**
 * 单耗环比配色：与股价红涨绿跌**相反**
 * 电耗单耗下降是省电（好→绿），上升是浪费（坏→红）。这里的好/坏由指标性质决定，
 * 不是套用涨跌色。
 */
function deltaColor(delta: number | null): string | undefined {
  if (delta == null || delta === 0) return undefined
  return delta < 0 ? '#52c41a' : '#ff4d4f'
}

/** 设备能耗 */
export default function EnergyPage() {
  const { message } = AntdApp.useApp()
  const canWrite = useAuthStore((s) => s.hasPermission(PERM.COST_MANAGE))
  const [machines, setMachines] = useState<MachineOptionWire[]>([])
  const [readings, setReadings] = useState<ReadingWire[]>([])
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [ms, rs] = await Promise.all([
        api.get<MachineOptionWire[]>('/energy/machines'),
        api.get<ReadingWire[]>('/energy/readings'),
      ])
      setMachines(ms.data.data)
      setReadings(rs.data.data)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载能耗数据失败')
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => { void reload() }, [reload])

  const machineOptions = machines.map((m) => ({ value: m.id, label: `${m.code} ${m.name}` }))

  return (
    <div style={{ padding: 16 }}>
      <Title level={3} style={{ marginTop: 0 }}>
        <ThunderboltOutlined /> 设备能耗
      </Title>

      <Tabs
        items={[
          { key: 'analysis', label: '能耗分析', children: <AnalysisTab /> },
          { key: 'readings', label: '抄表记录', children: <ReadingsTab rows={readings} machineOptions={machineOptions} canWrite={canWrite} loading={loading} onDone={reload} /> },
        ]}
      />
    </div>
  )
}

// ---------- 能耗分析（自持期间与取数，切换 Tab 不连带重载） ----------

function AnalysisTab() {
  const { message } = AntdApp.useApp()
  // 默认上一个完整月：本月还没走完，单耗会偏低，看着像「省电了」的假象
  const [period, setPeriod] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(1, 'month').startOf('month'),
    dayjs().subtract(1, 'month').endOf('month'),
  ])
  const [stats, setStats] = useState<StatsWire | null>(null)
  const [cmp, setCmp] = useState<CompareWire | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (p: [Dayjs, Dayjs]) => {
    setLoading(true)
    try {
      const params = { periodStart: p[0].format('YYYY-MM-DD'), periodEnd: p[1].format('YYYY-MM-DD') }
      const [s, c] = await Promise.all([
        api.get<StatsWire>('/energy/stats', { params }),
        api.get<CompareWire>('/energy/compare', { params }),
      ])
      setStats(s.data.data)
      setCmp(c.data.data)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载能耗统计失败')
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => { void load(period) }, [load, period])

  const totals = stats?.totals

  return (
    <>
      <Space style={{ marginBottom: 16 }} wrap>
        <RangePicker value={period} onChange={(v) => { if (v) setPeriod(v as [Dayjs, Dayjs]) }} allowClear={false} />
        <Text type="secondary">
          上期 {cmp?.prevStart ?? DASH} ~ {cmp?.prevEnd ?? DASH}
        </Text>
      </Space>

      <Space size={16} wrap style={{ marginBottom: 16 }}>
        <Card size="small" title="总用电"><Text strong style={{ fontSize: 20 }}>{kwh(totals?.totalKwh)}</Text> <Text type="secondary">kWh</Text></Card>
        <Card
          size="small"
          title="单位电耗"
          style={{ borderColor: deltaColor(cmp?.kwhPer100mDelta ?? null) }}
        >
          <Tooltip title="总 kWh ÷（总产量 ÷ 100），即每百米耗电">
            <Text strong style={{ fontSize: 20, color: deltaColor(cmp?.kwhPer100mDelta ?? null) }}>
              {unit(totals?.kwhPer100m)}
            </Text>
          </Tooltip>
          <Text type="secondary"> kWh/百米</Text>
          {cmp?.kwhPer100mDelta != null && (
            <div>
              <Text style={{ color: deltaColor(cmp.kwhPer100mDelta), fontSize: 12 }}>
                环比 {cmp.kwhPer100mDelta > 0 ? '+' : ''}{cmp.kwhPer100mDelta}
                {cmp.kwhPer100mDeltaPct != null ? `（${cmp.kwhPer100mDeltaPct > 0 ? '+' : ''}${cmp.kwhPer100mDeltaPct}%）` : ''}
              </Text>
            </div>
          )}
        </Card>
        <Card size="small" title="总电费"><Text strong style={{ fontSize: 20 }}>{money(totals?.totalCost)}</Text></Card>
        <Card size="small" title="电费/米">
          <Tooltip title="总电费 ÷ 总产量">
            <Text strong style={{ fontSize: 20 }}>{money(totals?.costPerMeter)}</Text>
          </Tooltip>
        </Card>
        <Card size="small" title="抄表数"><Text strong style={{ fontSize: 20 }}>{totals?.readingCount ?? 0}</Text> <Text type="secondary">条 / {totals?.machineCount ?? 0} 块表</Text></Card>
      </Space>

      {stats && stats.missingMachines.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="有产量但本期无抄表，单耗未计入"
          description={`${stats.missingMachines.join('、')} —— 「没抄表」不等于「零耗电」，补抄表后单耗才准`}
        />
      )}

      <Table<EnergyRowWire>
        rowKey="machineId"
        loading={loading}
        dataSource={stats?.rows ?? []}
        summary={() => (
          <Table.Summary fixed>
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={2}>
                <Text strong>合计</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={2} align="right">
                <Text strong>{kwh(totals?.totalKwh)}</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={3} align="right">
                <Text strong>{meters(totals?.outputM)}</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={4} align="right">
                <Text strong>{unit(totals?.kwhPer100m)}</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={5} align="right">
                <Text strong>{money(totals?.totalCost)}</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={6} align="right">
                <Text strong>{money(totals?.costPerMeter)}</Text>
              </Table.Summary.Cell>
            </Table.Summary.Row>
          </Table.Summary>
        )}
        columns={[
          { title: '机台', key: 'm', render: (_: unknown, r: EnergyRowWire) => <Text strong>{r.machineCode} {r.machineName}</Text> },
          { title: '最后抄表', dataIndex: 'lastReadingDate', render: (v: string | null) => v ?? DASH },
          { title: '用电量 kWh', dataIndex: 'totalKwh', align: 'right', render: (v: number | null) => kwh(v) },
          { title: '产量', dataIndex: 'outputM', align: 'right', render: (v: number) => meters(v) },
          {
            title: 'kWh/百米',
            dataIndex: 'kwhPer100m',
            align: 'right',
            render: (v: number | null) => (v == null ? <Text type="secondary">{DASH}</Text> : <Text strong>{unit(v)}</Text>),
          },
          { title: '电费', dataIndex: 'totalCost', align: 'right', render: (v: number | null) => money(v) },
          { title: '元/米', dataIndex: 'costPerMeter', align: 'right', render: (v: number | null) => money(v) },
        ]}
      />
      <Text type="secondary" style={{ fontSize: 12 }}>
        合计按总用量 ÷ 总产量算，不是各机台单耗取平均——平均会把高耗机台的异常摊平。
        用量按抄表日归期（末次抄表法），跨期补抄不会被劈成两半。
      </Text>
    </>
  )
}

// ---------- 抄表记录 ----------

function ReadingsTab({ rows, machineOptions, canWrite, loading, onDone }: {
  rows: ReadingWire[]
  machineOptions: { value: string; label: string }[]
  canWrite: boolean
  loading: boolean
  onDone: () => void
}) {
  const { message } = AntdApp.useApp()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<ReadingWire | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm()

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ readingDate: dayjs(), tariff: 0.65 })
    setOpen(true)
  }
  const openEdit = (r: ReadingWire) => {
    setEditing(r)
    form.setFieldsValue({ tariff: r.tariff, remark: r.remark })
    setOpen(true)
  }

  const submit = async () => {
    const values = await form.validateFields()
    setSubmitting(true)
    try {
      if (editing) {
        await api.put(`/energy/readings/${editing.id}`, values)
        message.success('已更新')
      } else {
        await api.post('/energy/readings', {
          ...values,
          readingDate: (values.readingDate as Dayjs).format('YYYY-MM-DD'),
        })
        message.success('抄表已录入，用量按与上期表底的差值计算')
      }
      setOpen(false)
      onDone()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  const remove = async (id: string) => {
    setSubmitting(true)
    try {
      await api.delete(`/energy/readings/${id}`)
      message.success('已删除，后续读数的用量会自动重算')
      onDone()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '删除失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Space style={{ marginBottom: 12 }} wrap>
        {canWrite && <Button type="primary" onClick={openCreate}>录抄表</Button>}
        <Text type="secondary">
          存的是电表累计表底，用量 = 本期 − 同表上期；换表请换电表号（读数可从 0 起算）
        </Text>
      </Space>
      <Table<ReadingWire>
        rowKey="id"
        loading={loading}
        dataSource={rows}
        columns={[
          { title: '机台', key: 'm', render: (_: unknown, r: ReadingWire) => `${r.machineCode} ${r.machineName}` },
          { title: '电表号', dataIndex: 'meterNo' },
          { title: '抄表日', dataIndex: 'readingDate' },
          { title: '表底读数 kWh', dataIndex: 'reading', align: 'right', render: (v: number) => v.toLocaleString('zh-CN') },
          {
            title: '用量 kWh',
            dataIndex: 'consumedKwh',
            align: 'right',
            render: (v: number | null) =>
              v == null ? (
                <Tooltip title="该表首条读数，只建基线；没有上期就没有用量">
                  <Text type="secondary">基线</Text>
                </Tooltip>
              ) : (
                kwh(v)
              ),
          },
          { title: '电价 元/kWh', dataIndex: 'tariff', align: 'right', render: (v: number) => v.toFixed(4) },
          { title: '电费', dataIndex: 'cost', align: 'right', render: (v: number | null) => money(v) },
          { title: '备注', dataIndex: 'remark', render: (v: string | null) => v ?? DASH },
          {
            title: '操作',
            key: 'actions',
            width: 140,
            render: (_: unknown, r: ReadingWire) =>
              canWrite ? (
                <Space size={4}>
                  <Button size="small" onClick={() => openEdit(r)}>改电价</Button>
                  <Popconfirm title="删除后用量重算，确定？" onConfirm={() => void remove(r.id)} okText="删除">
                    <Button size="small" danger loading={submitting}>删</Button>
                  </Popconfirm>
                </Space>
              ) : null,
          },
        ]}
      />
      <Modal
        open={open}
        title={editing ? `改抄表 · ${editing.machineName} ${editing.meterNo}` : '录抄表'}
        onOk={submit}
        confirmLoading={submitting}
        onCancel={() => setOpen(false)}
        okText="保存"
      >
        <Form form={form} layout="vertical" preserve>
          {!editing && (
            <>
              <Form.Item name="machineId" label="机台" rules={[{ required: true, message: '请选择机台' }]}>
                <Select showSearch optionFilterProp="label" options={machineOptions} />
              </Form.Item>
              <Form.Item name="meterNo" label="电表号" rules={[{ required: true, message: '请填电表号' }]} tooltip="同一块表务必用同一个号；换表开新号，读数可从 0 开始">
                <Input maxLength={32} placeholder="如 M01-1" />
              </Form.Item>
              <Form.Item name="readingDate" label="抄表日期" rules={[{ required: true, message: '请选抄表日' }]}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="reading" label="累计表底读数（kWh）" rules={[{ required: true, message: '请填读数' }]} tooltip="不是用量！用量由系统用与上期的差值算">
                <InputNumber min={0} precision={2} style={{ width: '100%' }} addonAfter="kWh" />
              </Form.Item>
            </>
          )}
          <Form.Item name="tariff" label="当期电价（元/kWh）" rules={[{ required: true, message: '请填电价' }]} tooltip="逐条记录，不拿现价回算历史（电价分峰分季）">
            <InputNumber min={0.0001} precision={4} style={{ width: '100%' }} addonAfter="元/kWh" />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input maxLength={255} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}