import { useCallback, useEffect, useState } from 'react'
import {
  App as AntdApp,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd'
import { ToolOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { api } from '../lib/api'
import { PERM } from '../lib/erp'
import { useAuthStore } from '../stores/auth.store'

const { Title, Text } = Typography

interface MachineWire {
  id: string
  code: string
  name: string
  model?: string | null
  status: string
}
interface PlanWire {
  id: string
  planNo: string
  machineId: string
  machineName: string
  machineCode: string
  planName: string
  type: 'inspect' | 'lubricate' | 'repair' | 'overhaul'
  cycleType: 'day' | 'run_hour'
  cycleValue: number
  lastDoneDate: string | null
  nextDueDate: string | null
  responsible: string | null
  status: 'active' | 'paused'
  remark: string | null
}
interface SpareUsageWire {
  id: string
  partId: string
  partName: string
  qty: number
  cost: number
}
interface RecordWire {
  id: string
  recordNo: string
  machineId: string
  machineName: string
  planId: string | null
  planName: string | null
  type: 'planned' | 'breakdown'
  category: string
  date: string
  operatorId: string | null
  operatorName: string | null
  durationMin: number | null
  downtimeMin: number | null
  cost: number
  result: 'ok' | 'pending' | 'failed'
  remark: string | null
  spareParts: SpareUsageWire[]
}
interface SparePartWire {
  id: string
  partCode: string
  name: string
  spec: string | null
  unit: string
  stock: number
  minStock: number
  location: string | null
  remark: string | null
  lowStock: boolean
}
interface MtbfWire {
  machineId: string
  machineName: string
  breakdownCount: number
  totalDowntimeMin: number
  mtbfDays: number | null
  lastBreakdownDate: string | null
}
interface Overview {
  totalMachines: number
  activePlans: number
  dueSoonPlans: number
  overduePlans: number
  breakdownThisMonth: number
  lowStockParts: number
}

const PLAN_TYPE_LABEL: Record<string, string> = { inspect: '巡检', lubricate: '润滑', repair: '维修', overhaul: '大修' }
const RECORD_TYPE_LABEL: Record<string, string> = { planned: '计划保养', breakdown: '故障停机' }
const RESULT_LABEL: Record<string, string> = { ok: '正常', pending: '待跟进', failed: '失败' }

/** 设备维保 */
export default function MachineMaintenancePage() {
  const { message } = AntdApp.useApp()
  const canWrite = useAuthStore((s) => s.hasPermission(PERM.PRODUCTION_ORDER_EDIT))
  const [machines, setMachines] = useState<MachineWire[]>([])
  const [overview, setOverview] = useState<Overview | null>(null)
  const [plans, setPlans] = useState<PlanWire[]>([])
  const [records, setRecords] = useState<RecordWire[]>([])
  const [parts, setParts] = useState<SparePartWire[]>([])
  const [mtbf, setMtbf] = useState<MtbfWire[]>([])
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [ms, ov, pl, rc, pt, mt] = await Promise.all([
        api.get<MachineWire[]>('/machines'),
        api.get<Overview>('/machine-maintenance/overview'),
        api.get<{ records: PlanWire[] }>('/machine-maintenance/plans'),
        api.get<{ records: RecordWire[] }>('/machine-maintenance/records'),
        api.get<{ records: SparePartWire[] }>('/machine-maintenance/spare-parts'),
        api.get<MtbfWire[]>('/machine-maintenance/mtbf'),
      ])
      setMachines(ms.data.data)
      setOverview(ov.data.data)
      setPlans(pl.data.data.records)
      setRecords(rc.data.data.records)
      setParts(pt.data.data.records)
      setMtbf(mt.data.data)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载维保数据失败')
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => { void reload() }, [reload])

  const machineOptions = machines.map((m) => ({ value: m.id, label: `${m.code} ${m.name}` }))

  return (
    <div style={{ padding: 16 }}>
      <Title level={3} style={{ marginTop: 0 }}>
        <ToolOutlined /> 设备维保
      </Title>

      <Space size={16} wrap style={{ marginBottom: 16 }}>
        <Card size="small" title="设备数"><Text strong style={{ fontSize: 20 }}>{overview?.totalMachines ?? 0}</Text></Card>
        <Card size="small" title="启用计划"><Text strong style={{ fontSize: 20 }}>{overview?.activePlans ?? 0}</Text></Card>
        <Card size="small" title="7天内到期" style={{ borderColor: (overview?.dueSoonPlans ?? 0) > 0 ? '#faad14' : undefined }}>
          <Text strong style={{ fontSize: 20, color: (overview?.dueSoonPlans ?? 0) > 0 ? '#faad14' : undefined }}>{overview?.dueSoonPlans ?? 0}</Text>
        </Card>
        <Card size="small" title="已逾期" style={{ borderColor: (overview?.overduePlans ?? 0) > 0 ? '#ff4d4f' : undefined }}>
          <Text strong style={{ fontSize: 20, color: (overview?.overduePlans ?? 0) > 0 ? '#ff4d4f' : undefined }}>{overview?.overduePlans ?? 0}</Text>
        </Card>
        <Card size="small" title="本月故障"><Text strong style={{ fontSize: 20 }}>{overview?.breakdownThisMonth ?? 0}</Text></Card>
        <Card size="small" title="备件预警" style={{ borderColor: (overview?.lowStockParts ?? 0) > 0 ? '#ff4d4f' : undefined }}>
          <Text strong style={{ fontSize: 20, color: (overview?.lowStockParts ?? 0) > 0 ? '#ff4d4f' : undefined }}>{overview?.lowStockParts ?? 0}</Text>
        </Card>
      </Space>

      <Tabs
        items={[
          { key: 'plans', label: '保养计划', children: <PlansTab rows={plans} machineOptions={machineOptions} canWrite={canWrite} loading={loading} onDone={reload} /> },
          { key: 'records', label: '维保记录', children: <RecordsTab rows={records} machineOptions={machineOptions} planOptions={plans.map((p) => ({ value: p.id, label: `${p.planNo} ${p.planName}` }))} partOptions={parts.map((p) => ({ value: p.id, label: `${p.partCode} ${p.name}` }))} canWrite={canWrite} loading={loading} onDone={reload} /> },
          { key: 'parts', label: '备件库存', children: <SparePartsTab rows={parts} canWrite={canWrite} loading={loading} onDone={reload} /> },
          { key: 'mtbf', label: '故障统计 MTBF', children: <MtbfTab rows={mtbf} loading={loading} /> },
        ]}
      />
    </div>
  )
}

// ---------- 保养计划 ----------

function PlansTab({ rows, machineOptions, canWrite, loading, onDone }: {
  rows: PlanWire[]
  machineOptions: { value: string; label: string }[]
  canWrite: boolean
  loading: boolean
  onDone: () => void
}) {
  const { message } = AntdApp.useApp()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<PlanWire | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm()

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ type: 'inspect', cycleType: 'day', cycleValue: 1, status: 'active' })
    setOpen(true)
  }
  const openEdit = (p: PlanWire) => {
    setEditing(p)
    form.setFieldsValue({
      machineId: p.machineId,
      planName: p.planName,
      type: p.type,
      cycleType: p.cycleType,
      cycleValue: p.cycleValue,
      lastDoneDate: p.lastDoneDate ? dayjs(p.lastDoneDate) : null,
      responsible: p.responsible ?? undefined,
      status: p.status,
      remark: p.remark ?? undefined,
    })
    setOpen(true)
  }

  const submit = async () => {
    const v = await form.validateFields()
    const payload = {
      machineId: v.machineId,
      planName: v.planName,
      type: v.type,
      cycleType: v.cycleType,
      cycleValue: v.cycleValue,
      lastDoneDate: v.lastDoneDate ? v.lastDoneDate.format('YYYY-MM-DD') : null,
      responsible: v.responsible || null,
      status: v.status,
      remark: v.remark || null,
    }
    setSubmitting(true)
    try {
      if (editing) await api.put(`/machine-maintenance/plans/${editing.id}`, payload)
      else await api.post('/machine-maintenance/plans', payload)
      message.success(editing ? '计划已更新' : '计划已创建')
      setOpen(false)
      void onDone()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  const columns = [
    { title: '机台', render: (_: unknown, r: PlanWire) => `${r.machineCode} ${r.machineName}` },
    { title: '计划号', dataIndex: 'planNo' },
    { title: '名称', dataIndex: 'planName' },
    { title: '类型', dataIndex: 'type', render: (t: string) => <Tag>{PLAN_TYPE_LABEL[t]}</Tag> },
    { title: '周期', render: (_: unknown, r: PlanWire) => (r.cycleType === 'day' ? `每 ${r.cycleValue} 天` : `每 ${r.cycleValue} 运转小时`) },
    { title: '上次执行', dataIndex: 'lastDoneDate', render: (v: string | null) => v ?? '—' },
    { title: '下次到期', dataIndex: 'nextDueDate', render: (v: string | null) => {
      if (!v) return '—'
      const due = dayjs(v)
      const overdue = due.isBefore(dayjs(), 'day')
      return <Tag color={overdue ? 'red' : due.diff(dayjs(), 'day') <= 7 ? 'orange' : 'default'}>{v}</Tag>
    } },
    { title: '责任人', dataIndex: 'responsible', render: (v: string | null) => v ?? '—' },
    { title: '状态', dataIndex: 'status', render: (s: string) => <Tag color={s === 'active' ? 'green' : 'default'}>{s === 'active' ? '启用' : '暂停'}</Tag> },
    {
      title: '操作',
      render: (_: unknown, r: PlanWire) => canWrite ? <Button size="small" onClick={() => openEdit(r)}>编辑</Button> : null,
    },
  ]

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" disabled={!canWrite} onClick={openCreate}>新建计划</Button>
        {!canWrite && <Text type="secondary">无维护权限（需 production.order.edit）</Text>}
      </Space>
      <Table<PlanWire> rowKey="id" loading={loading} dataSource={rows} pagination={{ pageSize: 20 }} columns={columns} />
      <Modal
        title={editing ? '编辑保养计划' : '新建保养计划'}
        open={open}
        onOk={submit}
        confirmLoading={submitting}
        onCancel={() => setOpen(false)}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="machineId" label="机台" rules={[{ required: true, message: '请选择机台' }]}>
            <Select options={machineOptions} placeholder="选择机台" showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item name="planName" label="计划名称" rules={[{ required: true, message: '请填写计划名称' }]}>
            <Input placeholder="如 3 号织机周巡检" />
          </Form.Item>
          <Space>
            <Form.Item name="type" label="类型" rules={[{ required: true }]}>
              <Select options={Object.entries(PLAN_TYPE_LABEL).map(([k, v]) => ({ value: k, label: v }))} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="cycleType" label="循环依据" rules={[{ required: true }]}>
              <Select options={[{ value: 'day', label: '按天' }, { value: 'run_hour', label: '按运转小时' }]} style={{ width: 130 }} />
            </Form.Item>
            <Form.Item name="cycleValue" label="循环值" rules={[{ required: true }]}>
              <InputNumber min={1} style={{ width: 100 }} />
            </Form.Item>
          </Space>
          <Form.Item name="lastDoneDate" label="上次执行日（用于推算下次到期）">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="responsible" label="责任人">
            <Input placeholder="选填" />
          </Form.Item>
          <Form.Item name="status" label="状态" rules={[{ required: true }]}>
            <Select options={[{ value: 'active', label: '启用' }, { value: 'paused', label: '暂停' }]} style={{ width: 120 }} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

// ---------- 维保执行 / 故障停机 ----------

function RecordsTab({ rows, machineOptions, planOptions, partOptions, canWrite, loading, onDone }: {
  rows: RecordWire[]
  machineOptions: { value: string; label: string }[]
  planOptions: { value: string; label: string }[]
  partOptions: { value: string; label: string }[]
  canWrite: boolean
  loading: boolean
  onDone: () => void
}) {
  const { message } = AntdApp.useApp()
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm()
  const recordType = Form.useWatch('type', form)

  const openCreate = () => {
    form.resetFields()
    form.setFieldsValue({ type: 'planned', date: dayjs(), result: 'ok' })
    setOpen(true)
  }

  const submit = async () => {
    const v = await form.validateFields()
    const spareParts = (v.spareParts ?? [])
      .filter((s: { partId?: string; qty?: number }) => s.partId && s.qty != null && s.qty > 0)
      .map((s: { partId: string; qty: number | undefined; cost?: number }) => ({ partId: s.partId, qty: s.qty ?? 0, cost: s.cost ?? 0 }))
    const payload = {
      machineId: v.machineId,
      planId: v.type === 'planned' ? (v.planId ?? null) : null,
      type: v.type,
      category: v.category,
      date: v.date.format('YYYY-MM-DD'),
      durationMin: v.durationMin ?? null,
      downtimeMin: v.type === 'breakdown' ? (v.downtimeMin ?? null) : null,
      cost: v.cost ?? 0,
      result: v.result,
      remark: v.remark || null,
      spareParts,
    }
    setSubmitting(true)
    try {
      await api.post('/machine-maintenance/records', payload)
      message.success('维保记录已保存')
      setOpen(false)
      void onDone()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  const columns = [
    { title: '记录号', dataIndex: 'recordNo' },
    { title: '机台', dataIndex: 'machineName' },
    { title: '类型', dataIndex: 'type', render: (t: string) => <Tag color={t === 'breakdown' ? 'red' : 'blue'}>{RECORD_TYPE_LABEL[t]}</Tag> },
    { title: '项目/故障', dataIndex: 'category' },
    { title: '日期', dataIndex: 'date' },
    { title: '操作人', dataIndex: 'operatorName', render: (v: string | null) => v ?? '—' },
    { title: '停机(分)', dataIndex: 'downtimeMin', render: (v: number | null) => v ?? '—' },
    { title: '费用', dataIndex: 'cost', render: (v: number) => `¥${v.toFixed(2)}`, align: 'right' as const },
    { title: '结果', dataIndex: 'result', render: (r: string) => <Tag color={r === 'ok' ? 'green' : r === 'pending' ? 'orange' : 'red'}>{RESULT_LABEL[r]}</Tag> },
    { title: '耗用备件', render: (_: unknown, r: RecordWire) => r.spareParts.length ? r.spareParts.map((s) => `${s.partName}×${s.qty}`).join('、') : '—' },
  ]

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" disabled={!canWrite} onClick={openCreate}>录维保 / 故障</Button>
        {!canWrite && <Text type="secondary">无维护权限（需 production.order.edit）</Text>}
      </Space>
      <Table<RecordWire> rowKey="id" loading={loading} dataSource={rows} pagination={{ pageSize: 20 }} columns={columns} />
      <Modal title="录维保执行 / 故障停机" open={open} onOk={submit} confirmLoading={submitting} onCancel={() => setOpen(false)} width={640} destroyOnClose>
        <Form form={form} layout="vertical">
          <Form.Item name="machineId" label="机台" rules={[{ required: true, message: '请选择机台' }]}>
            <Select options={machineOptions} placeholder="选择机台" showSearch optionFilterProp="label" />
          </Form.Item>
          <Space>
            <Form.Item name="type" label="类型" rules={[{ required: true }]}>
              <Select options={Object.entries(RECORD_TYPE_LABEL).map(([k, v]) => ({ value: k, label: v }))} style={{ width: 140 }} />
            </Form.Item>
            {recordType === 'planned' && (
              <Form.Item name="planId" label="关联计划">
                <Select options={planOptions} placeholder="选填" showSearch optionFilterProp="label" allowClear style={{ width: 220 }} />
              </Form.Item>
            )}
          </Space>
          <Form.Item name="category" label="保养项目 / 故障描述" rules={[{ required: true, message: '请填写' }]}>
            <Input placeholder="如 更换综丝 / 经轴卡死" />
          </Form.Item>
          <Space>
            <Form.Item name="date" label="执行日期" rules={[{ required: true }]}>
              <DatePicker />
            </Form.Item>
            <Form.Item name="durationMin" label="作业时长(分)">
              <InputNumber min={0} style={{ width: 120 }} />
            </Form.Item>
            {recordType === 'breakdown' && (
              <Form.Item name="downtimeMin" label="停机时长(分)">
                <InputNumber min={0} style={{ width: 120 }} />
              </Form.Item>
            )}
            <Form.Item name="cost" label="费用(元)">
              <InputNumber min={0} step={0.01} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="result" label="结果" rules={[{ required: true }]}>
              <Select options={Object.entries(RESULT_LABEL).map(([k, v]) => ({ value: k, label: v }))} style={{ width: 120 }} />
            </Form.Item>
          </Space>
          <Form.Item label="耗用备件">
            <Form.List name="spareParts">
              {(fields, { add, remove }) => (
                <>
                  {fields.map(({ key, name, ...rest }) => (
                    <Space key={key} align="baseline" style={{ display: 'flex', marginBottom: 8 }}>
                      <Form.Item {...rest} name={[name, 'partId']} rules={[{ required: true, message: '备件' }]} style={{ marginBottom: 0 }}>
                        <Select options={partOptions} placeholder="备件" showSearch optionFilterProp="label" style={{ width: 200 }} />
                      </Form.Item>
                      <Form.Item {...rest} name={[name, 'qty']} rules={[{ required: true, message: '数量' }]} style={{ marginBottom: 0 }}>
                        <InputNumber min={0.01} placeholder="数量" style={{ width: 100 }} />
                      </Form.Item>
                      <Form.Item {...rest} name={[name, 'cost']} style={{ marginBottom: 0 }}>
                        <InputNumber min={0} step={0.01} placeholder="金额" style={{ width: 100 }} />
                      </Form.Item>
                      <Button type="link" danger onClick={() => remove(name)}>删</Button>
                    </Space>
                  ))}
                  <Button type="dashed" onClick={() => add()} block>添加耗用备件</Button>
                </>
              )}
            </Form.List>
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

// ---------- 备件 ----------

function SparePartsTab({ rows, canWrite, loading, onDone }: {
  rows: SparePartWire[]
  canWrite: boolean
  loading: boolean
  onDone: () => void
}) {
  const { message } = AntdApp.useApp()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<SparePartWire | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm()

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ unit: '个', stock: 0, minStock: 0 })
    setOpen(true)
  }
  const openEdit = (p: SparePartWire) => {
    setEditing(p)
    form.setFieldsValue({
      partCode: p.partCode,
      name: p.name,
      spec: p.spec ?? undefined,
      unit: p.unit,
      stock: p.stock,
      minStock: p.minStock,
      location: p.location ?? undefined,
      remark: p.remark ?? undefined,
    })
    setOpen(true)
  }

  const submit = async () => {
    const v = await form.validateFields()
    const payload = {
      partCode: v.partCode,
      name: v.name,
      spec: v.spec || null,
      unit: v.unit || '个',
      stock: v.stock ?? 0,
      minStock: v.minStock ?? 0,
      location: v.location || null,
      remark: v.remark || null,
    }
    setSubmitting(true)
    try {
      if (editing) await api.put(`/machine-maintenance/spare-parts/${editing.id}`, payload)
      else await api.post('/machine-maintenance/spare-parts', payload)
      message.success(editing ? '备件已更新' : '备件已创建')
      setOpen(false)
      void onDone()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  const columns = [
    { title: '备件编码', dataIndex: 'partCode' },
    { title: '名称', dataIndex: 'name' },
    { title: '规格', dataIndex: 'spec', render: (v: string | null) => v ?? '—' },
    { title: '单位', dataIndex: 'unit' },
    { title: '库存', dataIndex: 'stock', align: 'right' as const },
    { title: '安全库存', dataIndex: 'minStock', align: 'right' as const },
    { title: '位置', dataIndex: 'location', render: (v: string | null) => v ?? '—' },
    { title: '状态', render: (_: unknown, r: SparePartWire) => r.lowStock ? <Tag color="red">低于安全库存</Tag> : <Tag color="green">正常</Tag> },
    {
      title: '操作',
      render: (_: unknown, r: SparePartWire) => canWrite ? <Button size="small" onClick={() => openEdit(r)}>编辑</Button> : null,
    },
  ]

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" disabled={!canWrite} onClick={openCreate}>新建备件</Button>
        {!canWrite && <Text type="secondary">无维护权限（需 production.order.edit）</Text>}
      </Space>
      <Table<SparePartWire> rowKey="id" loading={loading} dataSource={rows} pagination={{ pageSize: 50 }} columns={columns} />
      <Modal
        title={editing ? '编辑备件' : '新建备件'}
        open={open}
        onOk={submit}
        confirmLoading={submitting}
        onCancel={() => setOpen(false)}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="partCode" label="备件编码" rules={[{ required: true, message: '请填写编码' }]}>
            <Input disabled={!!editing} placeholder="公司内唯一" />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请填写名称' }]}>
            <Input />
          </Form.Item>
          <Space>
            <Form.Item name="spec" label="规格"><Input placeholder="选填" /></Form.Item>
            <Form.Item name="unit" label="单位"><Input style={{ width: 100 }} /></Form.Item>
            <Form.Item name="stock" label="库存"><InputNumber min={0} step={0.01} style={{ width: 120 }} /></Form.Item>
            <Form.Item name="minStock" label="安全库存"><InputNumber min={0} step={0.01} style={{ width: 120 }} /></Form.Item>
          </Space>
          <Form.Item name="location" label="存放位置"><Input placeholder="选填" /></Form.Item>
          <Form.Item name="remark" label="备注"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
    </>
  )
}

// ---------- 故障统计 MTBF ----------

function MtbfTab({ rows, loading }: { rows: MtbfWire[]; loading: boolean }) {
  const columns = [
    { title: '机台', dataIndex: 'machineName' },
    { title: '故障次数', dataIndex: 'breakdownCount', align: 'right' as const },
    { title: '总停机(分)', dataIndex: 'totalDowntimeMin', align: 'right' as const, render: (v: number) => v || '—' },
    { title: '平均间隔(天) MTBF', dataIndex: 'mtbfDays', align: 'right' as const, render: (v: number | null) => v == null ? '样本不足' : v },
    { title: '最近故障', dataIndex: 'lastBreakdownDate', render: (v: string | null) => v ?? '—' },
  ]
  return (
    <Card size="small" title="按机台的故障统计（MTBF = 平均故障间隔，需 ≥2 次故障样本）">
      <Table<MtbfWire> rowKey="machineId" loading={loading} dataSource={rows} pagination={false} columns={columns} />
    </Card>
  )
}
