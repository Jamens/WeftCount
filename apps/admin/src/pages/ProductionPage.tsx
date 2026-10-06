import { useCallback, useEffect, useState } from 'react'
import {
  App as AntdApp,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Progress,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { api } from '../lib/api'
import { useLookups } from '../lib/lookups'
import {
  MACHINE_STATUS_LABEL,
  PRODUCTION_STATUS_LABEL,
  PERM,
  fmt,
  type MachineWire,
  type ProductionOrderDetail,
  type ProductionOrderStatusValue,
  type ProductionOrderWire,
  type MachineStatusValue,
} from '../lib/erp'
import { useAuthStore } from '../stores/auth.store'

const { Title, Text } = Typography

interface OrderForm {
  materialId?: string
  specId?: string
  plannedQuantityM?: number
  machineId?: string
  plannedStartDate?: dayjs.Dayjs | null
  dueDate?: dayjs.Dayjs | null
  remark?: string
}

interface ReportForm {
  outputM?: number
  reportDate?: dayjs.Dayjs | null
  stoppageMinutes?: number
  stopReason?: string
}

interface MachineForm {
  name?: string
  model?: string
  status?: MachineStatusValue
  remark?: string
}

export default function ProductionPage() {
  const { message } = AntdApp.useApp()
  const canEdit = useAuthStore((s) => s.hasPermission(PERM.PRODUCTION_ORDER_EDIT))
  const canReport = useAuthStore((s) => s.hasPermission(PERM.PRODUCTION_REPORT))
  const { materials, specs, specName } = useLookups()

  const [orders, setOrders] = useState<ProductionOrderWire[]>([])
  const [machines, setMachines] = useState<MachineWire[]>([])
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState<ProductionOrderStatusValue | undefined>()
  const [detail, setDetail] = useState<ProductionOrderDetail | null>(null)
  const [open, setOpen] = useState(false) // 新建/编辑工单
  const [editing, setEditing] = useState<ProductionOrderWire | null>(null)
  const [reporting, setReporting] = useState<ProductionOrderWire | null>(null) // 报工目标
  const [machineOpen, setMachineOpen] = useState(false)
  const [machineEdit, setMachineEdit] = useState<MachineWire | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm<OrderForm>()
  const [reportForm] = Form.useForm<ReportForm>()
  const [machineForm] = Form.useForm<MachineForm>()

  const loadOrders = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (statusFilter) params.set('status', statusFilter)
      const res = await api.get<ProductionOrderWire[]>(`/production-orders?${params.toString()}`)
      setOrders(res.data.data)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载工单失败')
    } finally {
      setLoading(false)
    }
  }, [statusFilter, message])

  const loadMachines = useCallback(async () => {
    try {
      const res = await api.get<MachineWire[]>('/machines')
      setMachines(res.data.data)
    } catch {
      setMachines([])
    }
  }, [])

  useEffect(() => {
    void loadOrders()
  }, [loadOrders])
  useEffect(() => {
    void loadMachines()
  }, [loadMachines])

  const machineName = (id: string | null) => (id ? (machines.find((m) => m.id === id)?.name ?? id) : '-')
  const machineOptions = machines
    .filter((m) => m.status !== 'retired')
    .map((m) => ({ value: m.id, label: `${m.name}（${m.code}）` }))

  const openDetail = async (id: string) => {
    try {
      const res = await api.get<ProductionOrderDetail>(`/production-orders/${id}`)
      setDetail(res.data.data)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载详情失败')
    }
  }

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    setOpen(true)
  }

  const openEdit = (o: ProductionOrderWire) => {
    setEditing(o)
    form.setFieldsValue({
      materialId: o.materialId,
      specId: o.specId,
      plannedQuantityM: Number(o.plannedQuantityM),
      machineId: o.machineId ?? undefined,
      plannedStartDate: o.plannedStartDate ? dayjs(o.plannedStartDate) : null,
      dueDate: o.dueDate ? dayjs(o.dueDate) : null,
      remark: o.remark ?? undefined,
    })
    setOpen(true)
  }

  const onSubmit = async () => {
    const v = await form.validateFields()
    setSubmitting(true)
    try {
      const payload: Record<string, unknown> = {
        materialId: v.materialId,
        specId: v.specId,
        plannedQuantityM: v.plannedQuantityM,
        machineId: v.machineId ?? null,
        plannedStartDate: v.plannedStartDate ? v.plannedStartDate.format('YYYY-MM-DD') : null,
        dueDate: v.dueDate ? v.dueDate.format('YYYY-MM-DD') : null,
        remark: v.remark ?? null,
      }
      if (editing) {
        await api.patch(`/production-orders/${editing.id}`, payload)
        message.success('工单已更新')
      } else {
        await api.post('/production-orders', payload)
        message.success('工单已创建（草稿）')
      }
      setOpen(false)
      await loadOrders()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  const doTransition = async (o: ProductionOrderWire, action: string, label: string) => {
    try {
      await api.post(`/production-orders/${o.id}/${action}`)
      message.success(`已${label}`)
      setDetail(null)
      await loadOrders()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '操作失败')
    }
  }

  const openReport = (o: ProductionOrderWire) => {
    setReporting(o)
    reportForm.resetFields()
    reportForm.setFieldsValue({ reportDate: dayjs() })
  }

  const onReport = async () => {
    if (!reporting) return
    const v = await reportForm.validateFields()
    setSubmitting(true)
    try {
      await api.post(`/production-orders/${reporting.id}/reports`, {
        outputM: v.outputM,
        reportDate: v.reportDate ? v.reportDate.format('YYYY-MM-DD') : null,
        stoppageMinutes: v.stoppageMinutes ?? null,
        stopReason: v.stopReason ?? null,
      })
      message.success('报工已记录')
      setReporting(null)
      setDetail(null)
      await loadOrders()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '报工失败')
    } finally {
      setSubmitting(false)
    }
  }

  const openMachineCreate = () => {
    setMachineEdit(null)
    machineForm.resetFields()
    machineForm.setFieldsValue({ status: 'idle' })
    setMachineOpen(true)
  }

  const openMachineEdit = (m: MachineWire) => {
    setMachineEdit(m)
    machineForm.setFieldsValue({ name: m.name, model: m.model ?? undefined, status: m.status, remark: m.remark ?? undefined })
    setMachineOpen(true)
  }

  const onMachineSubmit = async () => {
    const v = await machineForm.validateFields()
    setSubmitting(true)
    try {
      if (machineEdit) {
        await api.patch(`/machines/${machineEdit.id}`, v)
        message.success('机台已更新')
      } else {
        await api.post('/machines', v)
        message.success('机台已创建')
      }
      setMachineOpen(false)
      await loadMachines()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  const statusTag = (s: ProductionOrderStatusValue) => {
    const m = PRODUCTION_STATUS_LABEL[s]
    return m ? <Tag color={m.color}>{m.text}</Tag> : s
  }
  const machineStatusTag = (s: MachineStatusValue) => {
    const m = MACHINE_STATUS_LABEL[s]
    return m ? <Tag color={m.color}>{m.text}</Tag> : s
  }

  const orderProgress = (o: ProductionOrderWire) => {
    const planned = Number(o.plannedQuantityM)
    return planned > 0 ? Math.min((Number(o.producedQuantityM) / planned) * 100, 100) : 0
  }

  // 工单操作按钮（按状态）
  const orderActions = (o: ProductionOrderWire) => (
    <Space size={2} onClick={(e) => e.stopPropagation()}>
      {o.status === 'draft' && (
        <>
          <Button type="link" size="small" onClick={() => openEdit(o)}>编辑</Button>
          <Button type="link" size="small" onClick={() => void doTransition(o, 'schedule', '排产')}>排产</Button>
        </>
      )}
      {o.status === 'scheduled' && (
        <>
          <Button type="link" size="small" onClick={() => openEdit(o)}>编辑</Button>
          <Button type="link" size="small" onClick={() => void doTransition(o, 'start', '开工')}>开工</Button>
        </>
      )}
      {canReport && (o.status === 'scheduled' || o.status === 'in_progress') && (
        <Button type="link" size="small" onClick={() => openReport(o)}>报工</Button>
      )}
      {o.status === 'in_progress' && canEdit && (
        <Button type="link" size="small" onClick={() => void doTransition(o, 'complete', '完成')}>完成</Button>
      )}
      {(o.status === 'draft' || o.status === 'scheduled' || o.status === 'in_progress') && canEdit && (
        <Popconfirm title="确认取消该工单？" onConfirm={() => void doTransition(o, 'cancel', '取消')}>
          <Button type="link" size="small" danger>取消</Button>
        </Popconfirm>
      )}
      {(o.status === 'completed' || o.status === 'cancelled') && <Text type="secondary">-</Text>}
    </Space>
  )

  const ordersTab = (
    <div>
      <Space style={{ marginBottom: 12 }} wrap>
        <Select
          allowClear placeholder="状态" style={{ width: 130 }} value={statusFilter} onChange={setStatusFilter}
          options={(Object.keys(PRODUCTION_STATUS_LABEL) as ProductionOrderStatusValue[]).map((k) => ({ value: k, label: PRODUCTION_STATUS_LABEL[k].text }))}
        />
        {canEdit && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建工单</Button>
        )}
        <Button icon={<ReloadOutlined />} onClick={() => void loadOrders()}>刷新</Button>
      </Space>
      <Card size="small">
        <Table<ProductionOrderWire>
          rowKey="id" size="small" loading={loading} dataSource={orders}
          onRow={(r) => ({ onClick: () => void openDetail(r.id) })}
          pagination={{ showTotal: (t) => `共 ${t} 条`, showSizeChanger: false, defaultPageSize: 20 }}
          columns={[
            { title: '工单号', dataIndex: 'orderNo', width: 150 },
            { title: '规格', dataIndex: 'specId', width: 130, render: (v: string) => specName(v) },
            { title: '机台', dataIndex: 'machineId', width: 120, render: (v: string | null) => machineName(v) },
            { title: '计划(米)', dataIndex: 'plannedQuantityM', width: 90, align: 'right', render: (v: string) => fmt(v, 0) },
            { title: '已产(米)', dataIndex: 'producedQuantityM', width: 90, align: 'right', render: (v: string) => fmt(v, 0) },
            {
              title: '进度', dataIndex: 'producedQuantityM', width: 130,
              render: (_, o) => <Progress percent={Math.round(orderProgress(o))} size="small" />,
            },
            { title: '交期', dataIndex: 'dueDate', width: 100, render: (v: string | null) => v ?? '-' },
            { title: '状态', dataIndex: 'status', width: 90, render: (v: ProductionOrderStatusValue) => statusTag(v) },
            { title: '操作', width: 220, fixed: 'right', render: (_, o) => orderActions(o) },
          ]}
        />
      </Card>
    </div>
  )

  const machinesTab = (
    <Card size="small">
      <Space style={{ marginBottom: 12 }}>
        {canEdit && <Button type="primary" icon={<PlusOutlined />} onClick={openMachineCreate}>新建机台</Button>}
        <Button icon={<ReloadOutlined />} onClick={() => void loadMachines()}>刷新</Button>
      </Space>
      <Table<MachineWire>
        rowKey="id" size="small" dataSource={machines}
        pagination={{ showTotal: (t) => `共 ${t} 台`, showSizeChanger: false }}
        columns={[
          { title: '编码', dataIndex: 'code', width: 100 },
          { title: '名称', dataIndex: 'name', width: 140 },
          { title: '型号', dataIndex: 'model', width: 140, render: (v: string | null) => v ?? '-' },
          { title: '状态', dataIndex: 'status', width: 90, render: (v: MachineStatusValue) => machineStatusTag(v) },
          { title: '备注', dataIndex: 'remark', ellipsis: true, render: (v: string | null) => v ?? '-' },
          {
            title: '操作', width: 80, fixed: 'right',
            render: (_, m) => (canEdit ? <Button type="link" size="small" onClick={() => openMachineEdit(m)}>编辑</Button> : <Text type="secondary">-</Text>),
          },
        ]}
      />
    </Card>
  )

  return (
    <div>
      <Space align="center" style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>生产管理</Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            生产工单（织造任务）指派机台，挡车工报工累计产出，满额自动完成
          </Text>
        </div>
      </Space>

      <Tabs items={[{ key: 'orders', label: '生产工单', children: ordersTab }, { key: 'machines', label: '机台', children: machinesTab }]} />

      {/* 工单详情 */}
      <Drawer title="工单详情" width={560} open={detail !== null} onClose={() => setDetail(null)}>
        {detail && (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="工单号">{detail.order.orderNo}</Descriptions.Item>
              <Descriptions.Item label="规格">{specName(detail.order.specId)}</Descriptions.Item>
              <Descriptions.Item label="机台">{machineName(detail.order.machineId)}</Descriptions.Item>
              <Descriptions.Item label="计划产量">{fmt(detail.order.plannedQuantityM, 1)} m</Descriptions.Item>
              <Descriptions.Item label="累计产出">{fmt(detail.order.producedQuantityM, 1)} m</Descriptions.Item>
              <Descriptions.Item label="计划开始">{detail.order.plannedStartDate ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="交期">{detail.order.dueDate ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="状态">{statusTag(detail.order.status)}</Descriptions.Item>
              <Descriptions.Item label="备注">{detail.order.remark ?? '-'}</Descriptions.Item>
            </Descriptions>
            <Card size="small" title="生产进度">
              <Progress percent={Math.round(detail.progressPct)} status={detail.progressPct >= 100 ? 'success' : 'active'} />
            </Card>
            <Card size="small" title={`报工记录（${detail.reports.length}）`}>
              {detail.reports.length === 0 ? (
                <Text type="secondary">暂无报工</Text>
              ) : (
                <Table
                  rowKey="id" size="small" pagination={false} dataSource={detail.reports}
                  columns={[
                    { title: '日期', dataIndex: 'reportDate', width: 100 },
                    { title: '机台', dataIndex: 'machineId', width: 100, render: (v: string) => machineName(v) },
                    { title: '产出(米)', dataIndex: 'outputM', width: 90, align: 'right', render: (v: string) => fmt(v, 1) },
                    { title: '停机(分)', dataIndex: 'stoppageMinutes', width: 80, align: 'right', render: (v: number | null) => v ?? '-' },
                    { title: '停机原因', dataIndex: 'stopReason', ellipsis: true, render: (v: string | null) => v ?? '-' },
                  ]}
                />
              )}
            </Card>
          </Space>
        )}
      </Drawer>

      {/* 新建/编辑工单 */}
      <Drawer
        title={editing ? '编辑工单' : '新建生产工单'}
        width={480} open={open} onClose={() => setOpen(false)}
        extra={<Space><Button onClick={() => setOpen(false)}>取消</Button><Button type="primary" loading={submitting} onClick={() => void onSubmit()}>保存</Button></Space>}
      >
        <Form<OrderForm> form={form} layout="vertical">
          <Form.Item name="materialId" label="产出物料（坯布）" rules={[{ required: true, message: '请选择物料' }]}>
            <Select
              showSearch optionFilterProp="label"
              options={materials.filter((m) => m.category === 'greige').map((m) => ({ value: m.id, label: `${m.code} ${m.name}` }))}
              placeholder="选择坯布物料"
            />
          </Form.Item>
          <Form.Item name="specId" label="坯布规格" rules={[{ required: true, message: '请选择规格' }]}>
            <Select showSearch optionFilterProp="label" options={specs.map((s) => ({ value: s.id, label: `${s.code} ${s.name}` }))} />
          </Form.Item>
          <Form.Item name="plannedQuantityM" label="计划产量（米）" rules={[{ required: true, message: '请输入计划产量' }]}>
            <InputNumber style={{ width: '100%' }} min={0.001} placeholder="米" />
          </Form.Item>
          <Form.Item name="machineId" label="指派机台" extra="排产/开工前需指派机台">
            <Select showSearch allowClear optionFilterProp="label" options={machineOptions} placeholder="选择机台" />
          </Form.Item>
          <Form.Item name="plannedStartDate" label="计划开始">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="dueDate" label="交期">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} maxLength={255} />
          </Form.Item>
        </Form>
      </Drawer>

      {/* 报工弹窗 */}
      <Modal
        title={`报工${reporting ? ` · ${reporting.orderNo}` : ''}`}
        open={reporting !== null}
        onCancel={() => setReporting(null)}
        onOk={() => void onReport()}
        confirmLoading={submitting}
        okText="提交报工"
        destroyOnClose
      >
        <Form<ReportForm> form={reportForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="outputM" label="本次产出（米）" rules={[{ required: true, message: '请输入产出' }]}>
            <InputNumber style={{ width: '100%' }} min={0.001} placeholder="米" />
          </Form.Item>
          <Form.Item name="reportDate" label="报工日期">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="stoppageMinutes" label="停机分钟（可选）">
            <InputNumber style={{ width: '100%' }} min={0} placeholder="如 30" />
          </Form.Item>
          <Form.Item name="stopReason" label="停机原因/备注（可选）">
            <Input maxLength={255} placeholder="如 断经 / 换纬 / 等待配色" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 机台新建/编辑 */}
      <Drawer
        title={machineEdit ? '编辑机台' : '新建机台'}
        width={420} open={machineOpen} onClose={() => setMachineOpen(false)}
        extra={<Space><Button onClick={() => setMachineOpen(false)}>取消</Button><Button type="primary" loading={submitting} onClick={() => void onMachineSubmit()}>保存</Button></Space>}
      >
        <Form<MachineForm> form={machineForm} layout="vertical">
          <Form.Item name="name" label="机台名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如 3 号织机" maxLength={64} />
          </Form.Item>
          <Form.Item name="model" label="型号">
            <Input placeholder="如 1515 多剑杆" maxLength={64} />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select options={(Object.keys(MACHINE_STATUS_LABEL) as MachineStatusValue[]).map((k) => ({ value: k, label: MACHINE_STATUS_LABEL[k].text }))} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} maxLength={255} />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  )
}
