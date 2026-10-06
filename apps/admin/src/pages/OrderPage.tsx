import { useCallback, useEffect, useMemo, useState } from 'react'
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
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { api } from '../lib/api'
import { useLookups } from '../lib/lookups'
import {
  ORDER_STATUS_LABEL,
  ORDER_SUGGESTED_UNITS,
  ORDER_TYPE_LABEL,
  ORDER_TYPE_OPTIONS,
  PERM,
  fmt,
  fmtMoney,
  type ContractItemWire,
  type ContractWire,
  type OrderItemWire,
  type OrderWire,
  type PartnerWire,
  type TradeOrderStatusValue,
  type TradeOrderTypeValue,
  LIST_TABLE_SCROLL_Y,
} from '../lib/erp'
import { useAuthStore } from '../stores/auth.store'

const { Title, Text } = Typography

interface ItemForm {
  materialId?: string
  specId?: string
  orderedUnit?: string
  orderedValue?: number
  unitPrice?: number
  contractItemId?: string
}

interface OrderForm {
  orderType?: TradeOrderTypeValue
  partnerId?: string
  contractId?: string
  expectedDate?: dayjs.Dayjs | null
  remark?: string
  items?: ItemForm[]
}

export default function OrderPage() {
  const { message } = AntdApp.useApp()
  const canManage = useAuthStore((s) => s.hasPermission(PERM.PURCHASE_MANAGE) || s.hasPermission(PERM.SALES_MANAGE))
  const { materials, specs, specName, materialName } = useLookups()

  const [data, setData] = useState<OrderWire[]>([])
  const [partners, setPartners] = useState<PartnerWire[]>([])
  const [contracts, setContracts] = useState<ContractWire[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<OrderWire | null>(null)
  const [detail, setDetail] = useState<{ order: OrderWire; items: OrderItemWire[]; fulfilledM: number; orderedM: number; progressPct: number } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm<OrderForm>()

  const orderType = Form.useWatch('orderType', form) ?? 'purchase'
  const items = Form.useWatch('items', form) ?? []

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [o, p, c] = await Promise.all([
        api.get<OrderWire[]>('/orders'),
        api.get<PartnerWire[]>('/partners?status=active'),
        api.get<ContractWire[]>('/contracts?status=active'),
      ])
      setData(o.data.data)
      setPartners(p.data.data)
      setContracts(c.data.data)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载订单失败')
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    void load()
  }, [load])

  const partnerOptions = useMemo(() => {
    const wantSupplier = orderType === 'purchase'
    return partners
      .filter((p) => (wantSupplier ? p.type === 'supplier' || p.type === 'both' : p.type === 'customer' || p.type === 'both'))
      .map((p) => ({ value: p.id, label: `${p.name}（${p.code}）` }))
  }, [partners, orderType])

  const materialOptions = useMemo(
    () => materials.filter((m) => m.category === 'greige' || m.category === 'yarn').map((m) => ({ value: m.id, label: `${m.code} ${m.name}` })),
    [materials],
  )
  const specOptions = useMemo(() => specs.map((s) => ({ value: s.id, label: `${s.code} ${s.name}` })), [specs])

  // 前端实时算明细合计（服务端再算一次为准）
  const totalM = useMemo(() => items.reduce((s, i) => s + (i.orderedValue ?? 0), 0), [items])
  const totalAmt = useMemo(() => items.reduce((s, i) => s + (i.unitPrice ?? 0) * (i.orderedValue ?? 0), 0), [items])

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ orderType: 'purchase', items: [{ orderedUnit: ORDER_SUGGESTED_UNITS.purchase[0], orderedValue: 0, unitPrice: 0 }] })
    setOpen(true)
  }

  /** 从合同建单：带出合同明细行 + 协议价(单位统一米) */
  const onPickContract = async (contractId?: string) => {
    form.setFieldValue('contractId', contractId)
    if (!contractId) return
    try {
      const d = await api.get<{ items: ContractItemWire[] }>(`/contracts/${contractId}`)
      const ct = contracts.find((c) => c.id === contractId)
      if (ct) form.setFieldValue('partnerId', ct.partnerId)
      form.setFieldValue('items', d.data.data.items.map((ci) => ({
        materialId: ci.materialId,
        specId: ci.specId,
        orderedUnit: 'm',
        orderedValue: Number(ci.agreedQuantityM),
        unitPrice: Number(ci.agreedPrice),
        contractItemId: ci.id,
      })))
      message.success('已带出合同明细与协议价，可调整数量')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载合同明细失败')
    }
  }

  const openEdit = async (o: OrderWire) => {
    try {
      const d = await api.get<{ order: OrderWire; items: OrderItemWire[] }>(`/orders/${o.id}`)
      setEditing(o)
      form.setFieldsValue({
        orderType: o.orderType,
        partnerId: o.partnerId,
        contractId: o.contractId ?? undefined,
        expectedDate: o.expectedDate ? dayjs(o.expectedDate) : null,
        remark: o.remark ?? undefined,
        items: d.data.data.items.map((i) => ({
          materialId: i.materialId,
          specId: i.specId,
          orderedUnit: i.orderedUnit,
          orderedValue: Number(i.orderedValue),
          unitPrice: i.unitPrice != null ? Number(i.unitPrice) : undefined,
          contractItemId: i.contractItemId ?? undefined,
        })),
      })
      setOpen(true)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载详情失败')
    }
  }

  const onSubmit = async () => {
    const v = await form.validateFields()
    setSubmitting(true)
    try {
      const payload = {
        ...(editing ? {} : { orderType: v.orderType }),
        partnerId: v.partnerId,
        contractId: v.contractId ?? null,
        items: (v.items ?? []).map((i) => ({
          materialId: i.materialId,
          specId: i.specId,
          orderedUnit: i.orderedUnit,
          orderedValue: i.orderedValue,
          unitPrice: i.unitPrice ?? null,
          contractItemId: i.contractItemId ?? null,
        })),
        expectedDate: v.expectedDate ? v.expectedDate.format('YYYY-MM-DD') : null,
        remark: v.remark ?? null,
      }
      if (editing) {
        await api.patch(`/orders/${editing.id}`, payload)
        message.success('订单已更新')
      } else {
        await api.post('/orders', payload)
        message.success('订单已创建（草稿）')
      }
      setOpen(false)
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  const transition = async (o: OrderWire, action: string, label: string) => {
    try {
      await api.post(`/orders/${o.id}/${action}`)
      message.success(`已${label}`)
      setDetail(null)
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '操作失败')
    }
  }

  const openDetail = async (id: string) => {
    try {
      const d = await api.get<{ order: OrderWire; items: OrderItemWire[]; fulfilledM: number; orderedM: number; progressPct: number }>(`/orders/${id}`)
      setDetail(d.data.data)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载详情失败')
    }
  }

  const statusTag = (s: TradeOrderStatusValue) => {
    const m = ORDER_STATUS_LABEL[s]
    return m ? <Tag color={m.color}>{m.text}</Tag> : s
  }

  return (
    <div>
      <Space align="center" style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>采购 / 销售订单</Title>
          <Text type="secondary" style={{ fontSize: 12 }}>计划层：多明细订单（可从合同带出协议价），到货/发货再落三算单据</Text>
        </div>
        <Space>
          {canManage && <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建订单</Button>}
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
        </Space>
      </Space>

      <Card size="small">
        <Table<OrderWire>
          rowKey="id" size="small" loading={loading} dataSource={data}
          onRow={(r) => ({ onClick: () => void openDetail(r.id) })}
          scroll={{ y: LIST_TABLE_SCROLL_Y }}
          pagination={{ showTotal: (t) => `共 ${t} 条`, showSizeChanger: false, defaultPageSize: 20 }}
          columns={[
            { title: '订单号', dataIndex: 'orderNo', width: 150 },
            { title: '类型', dataIndex: 'orderType', width: 90, render: (v: TradeOrderTypeValue) => <Tag color={v === 'purchase' ? 'green' : 'purple'}>{ORDER_TYPE_LABEL[v]}</Tag> },
            { title: '往来单位', dataIndex: 'partnerName', width: 160, ellipsis: true },
            { title: '汇总(米)', dataIndex: 'totalQuantityM', width: 100, align: 'right', render: (v: string) => fmt(v, 0) },
            { title: '总金额', dataIndex: 'totalAmount', width: 120, align: 'right', render: (v: string | null) => (v == null ? '-' : fmtMoney(v)) },
            { title: '合同', dataIndex: 'contractId', width: 80, render: (v: string | null) => (v ? <Tag color="blue">合同</Tag> : '-') },
            { title: '交期', dataIndex: 'expectedDate', width: 100, render: (v: string | null) => v ?? '-' },
            { title: '状态', dataIndex: 'status', width: 90, render: (v: TradeOrderStatusValue) => statusTag(v) },
            {
              title: '操作', width: 170, fixed: 'right',
              render: (_, o) => (
                <Space size={2} onClick={(e) => e.stopPropagation()}>
                  {canManage && o.status === 'draft' && <Button type="link" size="small" onClick={() => void openEdit(o)}>编辑</Button>}
                  {canManage && o.status === 'draft' && <Button type="link" size="small" onClick={() => void transition(o, 'confirm', '确认')}>确认</Button>}
                  {canManage && o.status === 'confirmed' && <Button type="link" size="small" onClick={() => void transition(o, 'complete', '完成')}>完成</Button>}
                  {canManage && (o.status === 'draft' || o.status === 'confirmed') && (
                    <Popconfirm title="确认取消该订单？" onConfirm={() => void transition(o, 'cancel', '取消')}>
                      <Button type="link" size="small" danger>取消</Button>
                    </Popconfirm>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Card>

      {/* 订单详情：多明细 + 履约进度 */}
      <Drawer title={detail ? `订单 ${detail.order.orderNo}` : '订单'} width={720} open={detail !== null} onClose={() => setDetail(null)}>
        {detail && (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="类型">{ORDER_TYPE_LABEL[detail.order.orderType]}</Descriptions.Item>
              <Descriptions.Item label="往来单位">{detail.order.partnerName}</Descriptions.Item>
              <Descriptions.Item label="汇总数量">{fmt(detail.order.totalQuantityM, 0)} m</Descriptions.Item>
              <Descriptions.Item label="总金额">{detail.order.totalAmount == null ? '-' : fmtMoney(detail.order.totalAmount)}</Descriptions.Item>
              <Descriptions.Item label="状态">{statusTag(detail.order.status)}</Descriptions.Item>
              <Descriptions.Item label="交期">{detail.order.expectedDate ?? '-'}</Descriptions.Item>
            </Descriptions>
            <Card size="small" title={`明细行（${detail.items.length}）`}>
              <Table<OrderItemWire>
                rowKey="id" size="small" pagination={false} dataSource={detail.items}
                columns={[
                  { title: '物料', dataIndex: 'materialId', width: 120, render: (v: string) => materialName(v) },
                  { title: '规格', dataIndex: 'specId', width: 120, render: (v: string) => specName(v) },
                  { title: '数量', dataIndex: 'orderedValue', width: 90, align: 'right', render: (v: string, r) => `${fmt(v, 0)} ${r.orderedUnit}` },
                  { title: '折米', dataIndex: 'quantityM', width: 90, align: 'right', render: (v: string) => fmt(v, 0) },
                  { title: '单价', dataIndex: 'unitPrice', width: 90, align: 'right', render: (v: string | null) => (v == null ? '-' : fmt(v, 2)) },
                  { title: '行金额', dataIndex: 'lineAmount', width: 110, align: 'right', render: (v: string | null) => (v == null ? '-' : fmtMoney(v)) },
                  { title: '合同行', dataIndex: 'contractItemId', width: 70, render: (v: string | null) => (v ? <Tag color="blue">是</Tag> : '-') },
                ]}
              />
            </Card>
            <Card size="small" title="履约进度">
              <Text>已履约 {fmt(detail.fulfilledM, 0)} m / 订单 {fmt(detail.orderedM, 0)} m（{detail.progressPct.toFixed(0)}%）</Text>
            </Card>
          </Space>
        )}
      </Drawer>

      {/* 新建/编辑订单（多明细） */}
      <Drawer
        title={editing ? `编辑订单 ${editing.orderNo}` : '新建订单'}
        width={820} open={open} onClose={() => setOpen(false)}
        extra={<Space><Button onClick={() => setOpen(false)}>取消</Button>{canManage && <Button type="primary" loading={submitting} onClick={() => void onSubmit()}>保存</Button>}</Space>}
      >
        <Form<OrderForm> form={form} layout="vertical">
          <Space size="middle" align="start" wrap>
            <Form.Item name="orderType" label="订单类型" rules={[{ required: true }]}>
              <Select style={{ width: 130 }} disabled={!!editing} options={ORDER_TYPE_OPTIONS} />
            </Form.Item>
            <Form.Item name="partnerId" label="往来单位" rules={[{ required: true, message: '请选择往来单位' }]}>
              <Select showSearch optionFilterProp="label" style={{ width: 220 }} options={partnerOptions} placeholder={orderType === 'purchase' ? '选择供应商' : '选择客户'} />
            </Form.Item>
            {!editing && (
              <Form.Item name="contractId" label="从合同建单（可选，带出协议价）">
                <Select allowClear showSearch optionFilterProp="label" style={{ width: 220 }} onChange={(v) => void onPickContract(v)} options={contracts.map((c) => ({ value: c.id, label: `${c.contractNo} ${c.partnerName}` }))} placeholder="选择生效合同" />
              </Form.Item>
            )}
            <Form.Item name="expectedDate" label="交期"><DatePicker style={{ width: 140 }} /></Form.Item>
          </Space>

          <Form.List name="items">
            {(fields, { add, remove }) => (
              <Card size="small" title="明细行" extra={<Button type="dashed" size="small" icon={<PlusOutlined />} onClick={() => add({ orderedUnit: ORDER_SUGGESTED_UNITS[orderType][0], orderedValue: 0, unitPrice: 0 })}>添加一行</Button>}>
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  {fields.map((field, index) => (
                    <Space key={field.key} align="center" wrap>
                      <Form.Item name={[index, 'materialId']} rules={[{ required: true, message: '选物料' }]} style={{ marginBottom: 0 }}>
                        <Select placeholder="物料" style={{ width: 160 }} options={materialOptions} optionFilterProp="label" showSearch allowClear />
                      </Form.Item>
                      <Form.Item name={[index, 'specId']} rules={[{ required: true, message: '选规格' }]} style={{ marginBottom: 0 }}>
                        <Select placeholder="规格" style={{ width: 160 }} options={specOptions} optionFilterProp="label" showSearch allowClear />
                      </Form.Item>
                      <Form.Item name={[index, 'orderedUnit']} style={{ marginBottom: 0 }}>
                        <Select style={{ width: 80 }} options={ORDER_SUGGESTED_UNITS[orderType].map((u) => ({ value: u, label: u }))} />
                      </Form.Item>
                      <Form.Item name={[index, 'orderedValue']} rules={[{ required: true, message: '数量' }]} style={{ marginBottom: 0 }}>
                        <InputNumber placeholder="数量" style={{ width: 110 }} min={0.001} precision={1} />
                      </Form.Item>
                      <Form.Item name={[index, 'unitPrice']} style={{ marginBottom: 0 }}>
                        <InputNumber placeholder="单价(元/米)" style={{ width: 110 }} min={0} precision={4} />
                      </Form.Item>
                      <Text type="secondary" style={{ width: 100 }}>= {fmtMoney((items[index]?.unitPrice ?? 0) * (items[index]?.orderedValue ?? 0))}</Text>
                      {fields.length > 1 && <Button type="text" danger onClick={() => remove(index)}>删除</Button>}
                    </Space>
                  ))}
                  <Text type="secondary">合计：{fmt(totalM, 0)}（录入单位合计，服务器按规格折米汇总）/ {fmtMoney(totalAmt)}</Text>
                </Space>
              </Card>
            )}
          </Form.List>

          <Form.Item name="remark" label="备注" style={{ marginTop: 12 }}>
            <Input.TextArea rows={2} maxLength={255} />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  )
}
