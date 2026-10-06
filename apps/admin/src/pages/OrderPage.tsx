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
  Progress,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { api } from '../lib/api'
import { useLookups } from '../lib/lookups'
import {
  DOC_TYPE_LABEL,
  ORDER_STATUS_LABEL,
  ORDER_SUGGESTED_UNITS,
  ORDER_TYPE_LABEL,
  ORDER_TYPE_OPTIONS,
  PERM,
  fmt,
  fmtMoney,
  type OrderWire,
  type OrderDetail,
  type PartnerWire,
  type TradeOrderStatusValue,
  type TradeOrderTypeValue,
} from '../lib/erp'
import { useAuthStore } from '../stores/auth.store'

const { Title, Text } = Typography

interface OrderForm {
  orderType?: TradeOrderTypeValue
  partnerId?: string
  materialId?: string
  specId?: string
  orderedUnit?: string
  orderedValue?: number
  unitPrice?: number
  expectedDate?: dayjs.Dayjs | null
  remark?: string
}

export default function OrderPage() {
  const { message } = AntdApp.useApp()
  const canManage = useAuthStore((s) => s.hasPermission(PERM.PURCHASE_MANAGE) || s.hasPermission(PERM.SALES_MANAGE))

  const { materials, specs, materialName, specName } = useLookups()
  const [data, setData] = useState<OrderWire[]>([])
  const [loading, setLoading] = useState(false)
  const [orderType, setOrderType] = useState<TradeOrderTypeValue | undefined>()
  const [status, setStatus] = useState<TradeOrderStatusValue | undefined>()
  const [keyword, setKeyword] = useState('')
  const [detail, setDetail] = useState<OrderDetail | null>(null)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<OrderWire | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [partners, setPartners] = useState<PartnerWire[]>([])
  const [form] = Form.useForm<OrderForm>()

  // 点行看详情：拉订单详情（含已关联履约单据与进度）
  const openDetail = async (id: string) => {
    try {
      const res = await api.get<OrderDetail>(`/orders/${id}`)
      setDetail(res.data.data)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载订单详情失败')
    }
  }

  const formType: TradeOrderTypeValue =
    (Form.useWatch('orderType', form) as TradeOrderTypeValue | undefined) ?? orderType ?? 'purchase'

  useEffect(() => {
    api
      .get<PartnerWire[]>('/partners?status=active')
      .then((res) => setPartners(res.data.data))
      .catch(() => setPartners([]))
  }, [])

  // 往来单位下拉：采购只列供应商(含兼营)，销售只列客户(含兼营)
  const partnerOptions = useMemo(() => {
    const wantSupplier = formType === 'purchase'
    return partners
      .filter((p) => (wantSupplier ? p.type === 'supplier' || p.type === 'both' : p.type === 'customer' || p.type === 'both'))
      .map((p) => ({ value: p.id, label: `${p.name}（${p.code}）` }))
  }, [partners, formType])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (orderType) params.set('orderType', orderType)
      if (status) params.set('status', status)
      if (keyword) params.set('keyword', keyword)
      const res = await api.get<OrderWire[]>(`/orders?${params.toString()}`)
      setData(res.data.data)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载订单失败')
    } finally {
      setLoading(false)
    }
  }, [orderType, status, keyword, message])

  useEffect(() => {
    void load()
  }, [load])

  const openCreate = () => {
    setEditing(null)
    const t = orderType ?? 'purchase'
    form.resetFields()
    form.setFieldsValue({ orderType: t, orderedUnit: ORDER_SUGGESTED_UNITS[t][0] })
    setOpen(true)
  }

  const openEdit = (o: OrderWire) => {
    setEditing(o)
    form.setFieldsValue({
      orderType: o.orderType,
      partnerId: o.partnerId,
      materialId: o.materialId,
      specId: o.specId,
      orderedUnit: o.orderedUnit,
      orderedValue: Number(o.orderedValue),
      unitPrice: o.unitPrice != null ? Number(o.unitPrice) : undefined,
      expectedDate: o.expectedDate ? dayjs(o.expectedDate) : null,
      remark: o.remark ?? undefined,
    })
    setOpen(true)
  }

  const onSubmit = async () => {
    const v = await form.validateFields()
    setSubmitting(true)
    try {
      const payload: Record<string, unknown> = {
        partnerId: v.partnerId,
        materialId: v.materialId,
        specId: v.specId,
        orderedUnit: v.orderedUnit,
        orderedValue: v.orderedValue,
        unitPrice: v.unitPrice ?? null,
        expectedDate: v.expectedDate ? v.expectedDate.format('YYYY-MM-DD') : null,
        remark: v.remark ?? null,
      }
      if (editing) {
        await api.patch(`/orders/${editing.id}`, payload)
        message.success('订单已更新')
      } else {
        await api.post('/orders', { ...payload, orderType: v.orderType })
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

  const doTransition = async (o: OrderWire, to: 'confirmed' | 'completed' | 'cancelled') => {
    try {
      await api.post(`/orders/${o.id}/${to}`)
      message.success('已更新状态')
      setDetail(null)
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '操作失败')
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
          <Title level={4} style={{ margin: 0 }}>
            采购 / 销售订单
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            计划层：先下单（按重量/面积录，系统折米/kg/m²三视图），到货/发货再落三算单据
          </Text>
        </div>
        <Space>
          {canManage && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新建订单
            </Button>
          )}
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>
            刷新
          </Button>
        </Space>
      </Space>

      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap>
          <Select
            allowClear
            placeholder="订单类型"
            style={{ width: 130 }}
            value={orderType}
            onChange={setOrderType}
            options={ORDER_TYPE_OPTIONS}
          />
          <Select
            allowClear
            placeholder="状态"
            style={{ width: 120 }}
            value={status}
            onChange={setStatus}
            options={(Object.keys(ORDER_STATUS_LABEL) as TradeOrderStatusValue[]).map((k) => ({
              value: k,
              label: ORDER_STATUS_LABEL[k].text,
            }))}
          />
          <Input
            placeholder="订单号 / 往来单位"
            allowClear
            style={{ width: 220 }}
            prefix={<SearchOutlined />}
            onChange={(e) => setKeyword(e.target.value)}
            onPressEnter={() => void load()}
          />
          <Button type="primary" onClick={() => void load()}>
            查询
          </Button>
        </Space>
      </Card>

      <Card size="small">
        <Table<OrderWire>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={data}
          onRow={(r) => ({ onClick: () => void openDetail(r.id) })}
          pagination={{ showTotal: (t) => `共 ${t} 条`, showSizeChanger: false, defaultPageSize: 20 }}
          columns={[
            { title: '订单号', dataIndex: 'orderNo', width: 150 },
            {
              title: '类型',
              dataIndex: 'orderType',
              width: 90,
              render: (v: TradeOrderTypeValue) => <Tag color={v === 'purchase' ? 'green' : 'purple'}>{ORDER_TYPE_LABEL[v]}</Tag>,
            },
            { title: '往来单位', dataIndex: 'partnerName', width: 160, ellipsis: true },
            { title: '物料', dataIndex: 'materialId', width: 130, render: (v: string) => materialName(v) },
            { title: '规格', dataIndex: 'specId', width: 130, render: (v: string) => specName(v) },
            {
              title: '订货量',
              dataIndex: 'orderedValue',
              width: 120,
              align: 'right',
              render: (v: string, r) => `${fmt(v, 2)} ${r.orderedUnit}`,
            },
            {
              title: '折米',
              dataIndex: 'quantityM',
              width: 90,
              align: 'right',
              render: (v: string) => fmt(v, 1),
            },
            {
              title: '金额',
              dataIndex: 'totalAmount',
              width: 110,
              align: 'right',
              render: (v: string | null) => (v == null ? '-' : fmtMoney(v)),
            },
            { title: '交期', dataIndex: 'expectedDate', width: 100, render: (v: string | null) => v ?? '-' },
            { title: '状态', dataIndex: 'status', width: 90, render: (v: TradeOrderStatusValue) => statusTag(v) },
            {
              title: '操作',
              width: 170,
              fixed: 'right',
              render: (_, o) =>
                canManage ? (
                  <Space size={2} onClick={(e) => e.stopPropagation()}>
                    {o.status === 'draft' && (
                      <>
                        <Button type="link" size="small" onClick={() => openEdit(o)}>
                          编辑
                        </Button>
                        <Button type="link" size="small" onClick={() => void doTransition(o, 'confirmed')}>
                          确认
                        </Button>
                      </>
                    )}
                    {o.status === 'confirmed' && (
                      <Button type="link" size="small" onClick={() => void doTransition(o, 'completed')}>
                        完成
                      </Button>
                    )}
                    {(o.status === 'draft' || o.status === 'confirmed') && (
                      <Popconfirm title="确认取消该订单？" onConfirm={() => void doTransition(o, 'cancelled')}>
                        <Button type="link" size="small" danger>
                          取消
                        </Button>
                      </Popconfirm>
                    )}
                    {(o.status === 'completed' || o.status === 'cancelled') && <Text type="secondary">-</Text>}
                  </Space>
                ) : (
                  <Text type="secondary">-</Text>
                ),
            },
          ]}
        />
      </Card>

      {/* 详情抽屉 */}
      <Drawer title="订单详情" width={520} open={detail !== null} onClose={() => setDetail(null)}>
        {detail && (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="订单号">{detail.order.orderNo}</Descriptions.Item>
              <Descriptions.Item label="类型">{ORDER_TYPE_LABEL[detail.order.orderType]}</Descriptions.Item>
              <Descriptions.Item label="往来单位">{detail.order.partnerName}</Descriptions.Item>
              <Descriptions.Item label="物料">{materialName(detail.order.materialId)}</Descriptions.Item>
              <Descriptions.Item label="规格">{specName(detail.order.specId)}</Descriptions.Item>
              <Descriptions.Item label="订货量">
                {fmt(detail.order.orderedValue, 2)} {detail.order.orderedUnit}
              </Descriptions.Item>
              <Descriptions.Item label="折算米">{fmt(detail.order.quantityM, 2)} m</Descriptions.Item>
              <Descriptions.Item label="折算重量">{fmt(detail.order.weightKg, 2)} kg</Descriptions.Item>
              <Descriptions.Item label="折算面积">{fmt(detail.order.areaM2, 2)} m²</Descriptions.Item>
              <Descriptions.Item label="单价">
                {detail.order.unitPrice == null ? '-' : `${fmtMoney(detail.order.unitPrice)}/m`}
              </Descriptions.Item>
              <Descriptions.Item label="金额">
                {detail.order.totalAmount == null ? '-' : fmtMoney(detail.order.totalAmount)}
              </Descriptions.Item>
              <Descriptions.Item label="交期">{detail.order.expectedDate ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="状态">{statusTag(detail.order.status)}</Descriptions.Item>
              <Descriptions.Item label="备注">{detail.order.remark ?? '-'}</Descriptions.Item>
            </Descriptions>

            <Card size="small" title="履约进度">
              <Progress
                percent={Math.round(detail.progressPct)}
                status={detail.progressPct >= 100 ? 'success' : 'active'}
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {detail.order.orderType === 'purchase' ? '已到货' : '已发货'} {fmt(detail.fulfilledM, 2)} m / 订单{' '}
                {fmt(detail.orderedM, 2)} m
              </Text>
            </Card>

            <Card size="small" title={`已关联单据（${detail.documents.length}）`}>
              {detail.documents.length === 0 ? (
                <Text type="secondary">暂无关联单据</Text>
              ) : (
                <Table
                  rowKey="id"
                  size="small"
                  pagination={false}
                  dataSource={detail.documents}
                  columns={[
                    { title: '单据号', dataIndex: 'docNo', width: 150 },
                    {
                      title: '类型',
                      dataIndex: 'docType',
                      width: 90,
                      render: (v: keyof typeof DOC_TYPE_LABEL) => DOC_TYPE_LABEL[v]?.text ?? v,
                    },
                    {
                      title: '数量',
                      dataIndex: 'quantityM',
                      width: 90,
                      align: 'right',
                      render: (v: string) => `${fmt(v, 1)} m`,
                    },
                  ]}
                />
              )}
            </Card>
          </Space>
        )}
      </Drawer>

      {/* 新建 / 编辑抽屉 */}
      <Drawer
        title={editing ? '编辑订单（草稿）' : '新建订单'}
        width={480}
        open={open}
        onClose={() => setOpen(false)}
        extra={
          <Space>
            <Button onClick={() => setOpen(false)}>取消</Button>
            {canManage && (
              <Button type="primary" loading={submitting} onClick={() => void onSubmit()}>
                保存
              </Button>
            )}
          </Space>
        }
      >
        <Form<OrderForm> form={form} layout="vertical">
          <Form.Item name="orderType" label="订单类型" rules={[{ required: true }]}>
            <Select
              options={ORDER_TYPE_OPTIONS}
              disabled={!!editing}
              onChange={(t: TradeOrderTypeValue) => form.setFieldValue('orderedUnit', ORDER_SUGGESTED_UNITS[t][0])}
            />
          </Form.Item>
          <Form.Item name="partnerId" label={formType === 'purchase' ? '供应商' : '客户'} rules={[{ required: true, message: '请选择往来单位' }]}>
            <Select showSearch allowClear optionFilterProp="label" options={partnerOptions} placeholder="搜索名称或编码" />
          </Form.Item>
          <Form.Item name="materialId" label="物料" rules={[{ required: true, message: '请选择物料' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={materials.map((m) => ({ value: m.id, label: `${m.code} ${m.name}` }))}
            />
          </Form.Item>
          <Form.Item name="specId" label="坯布规格" rules={[{ required: true, message: '请选择规格' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={specs.map((s) => ({ value: s.id, label: `${s.code} ${s.name}` }))}
            />
          </Form.Item>
          <Form.Item name="orderedUnit" label="录入单位" rules={[{ required: true }]}>
            <Select options={ORDER_SUGGESTED_UNITS[formType].map((u) => ({ value: u, label: u }))} />
          </Form.Item>
          <Form.Item name="orderedValue" label="订货数量" rules={[{ required: true, message: '请输入数量' }]}>
            <InputNumber style={{ width: '100%' }} min={0.0001} placeholder="按录入单位的数量" />
          </Form.Item>
          <Form.Item name="unitPrice" label="单价（元/米，可选）">
            <InputNumber style={{ width: '100%' }} min={0} precision={4} placeholder="可选" />
          </Form.Item>
          <Form.Item name="expectedDate" label="交期（可选）">
            <DatePicker style={{ width: '100%' }} placeholder="选择交期" />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} maxLength={255} />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  )
}
