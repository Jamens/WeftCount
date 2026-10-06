import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import { api } from '../lib/api'
import { useLookups } from '../lib/lookups'
import {
  DOC_TYPE_LABEL,
  DOC_TYPE_OPTIONS,
  fmt,
  fmtMoney,
  PERM,
  SUGGESTED_UNITS,
  type DocWire,
  type InventoryDocType,
  type OrderWire,
  type PartnerWire,
  type TxnWire,
} from '../lib/erp'
import { useAuthStore } from '../stores/auth.store'

const { Title, Text } = Typography

interface DocForm {
  materialId: string
  specId: string
  enteredUnit: string
  enteredValue: number
  unitPrice?: number
  partnerId?: string
  orderId?: string
  remark?: string
}

const ENDPOINT: Record<InventoryDocType, string> = {
  purchase_inbound: '/inventory/purchase-inbound',
  production_issue: '/inventory/production-issue',
  sales_outbound: '/inventory/sales-outbound',
}

export default function DocPage() {
  const { message } = AntdApp.useApp()
  const canManage = useAuthStore((s) => s.hasPermission(PERM.INVENTORY_MANAGE))
  const { materials, specs, specName, materialName } = useLookups()

  const [data, setData] = useState<DocWire[]>([])
  const [loading, setLoading] = useState(false)
  const [docType, setDocType] = useState<InventoryDocType | undefined>()
  const [specFilter, setSpecFilter] = useState<string | undefined>()
  const [detail, setDetail] = useState<{ doc: DocWire; transactions: TxnWire[] } | null>(null)
  const [creating, setCreating] = useState<InventoryDocType | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [partners, setPartners] = useState<PartnerWire[]>([])
  const [form] = Form.useForm<DocForm>()

  // 往来单位下拉：只取启用单位；采购只显示供应商(含兼营)，销售只显示客户(含兼营)
  useEffect(() => {
    api
      .get<PartnerWire[]>('/partners?status=active')
      .then((res) => setPartners(res.data.data))
      .catch(() => setPartners([]))
  }, [])

  const partnerOptions = useMemo(() => {
    if (!creating || creating === 'production_issue') return []
    const wantSupplier = creating === 'purchase_inbound'
    return partners
      .filter((p) => (wantSupplier ? p.type === 'supplier' || p.type === 'both' : p.type === 'customer' || p.type === 'both'))
      .map((p) => ({ value: p.id, label: `${p.name}（${p.code}）` }))
  }, [partners, creating])

  // 已确认订单下拉（用于把本单挂到订单上累计履约）：采购单挂采购订单、销售单挂销售订单
  const [orders, setOrders] = useState<OrderWire[]>([])
  useEffect(() => {
    api
      .get<OrderWire[]>('/orders?status=confirmed')
      .then((res) => setOrders(res.data.data))
      .catch(() => setOrders([]))
  }, [])

  const orderOptions = useMemo(() => {
    if (!creating || creating === 'production_issue') return []
    const want = creating === 'purchase_inbound' ? 'purchase' : 'sales'
    return orders
      .filter((o) => o.orderType === want)
      .map((o) => ({ value: o.id, label: `${o.orderNo} ${o.partnerName}（${fmt(o.quantityM, 0)}m）` }))
  }, [orders, creating])

  // 选中订单自动带出往来单位/物料/规格，省去重复选择、也保证与订单一致（后端会强校验）
  const onOrderChange = (orderId?: string) => {
    form.setFieldValue('orderId', orderId)
    const o = orders.find((x) => x.id === orderId)
    if (o) {
      form.setFieldsValue({ partnerId: o.partnerId, materialId: o.materialId, specId: o.specId })
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (docType) params.set('docType', docType)
      if (specFilter) params.set('specId', specFilter)
      const res = await api.get<DocWire[]>(`/inventory/documents?${params.toString()}`)
      setData(res.data.data)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载单据失败')
    } finally {
      setLoading(false)
    }
  }, [docType, specFilter, message])

  useEffect(() => {
    void load()
  }, [load])

  const openDetail = async (id: string) => {
    try {
      const res = await api.get<{ doc: DocWire; transactions: TxnWire[] }>(`/inventory/documents/${id}`)
      setDetail(res.data.data)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载详情失败')
    }
  }

  const onUnitChange = (u: string) => {
    form.setFieldValue('enteredUnit', u)
  }

  /** 打开新建抽屉：以当前筛选的单据类型为准，并重置表单避免上一次的往来单位残留 */
  const openCreate = () => {
    const type = docType ?? 'purchase_inbound'
    form.resetFields()
    form.setFieldValue('enteredUnit', SUGGESTED_UNITS[type][0])
    setCreating(type)
  }

  const onCreate = async () => {
    if (!creating) return
    const v = await form.validateFields()
    setSubmitting(true)
    try {
      await api.post(ENDPOINT[creating], {
        materialId: v.materialId,
        specId: v.specId,
        enteredUnit: v.enteredUnit,
        enteredValue: v.enteredValue,
        unitPrice: v.unitPrice ?? null,
        partnerId: v.partnerId ?? null,
        orderId: v.orderId ?? null,
        remark: v.remark ?? null,
      })
      message.success(`已保存${DOC_TYPE_LABEL[creating].text}单据`)
      setCreating(null)
      form.resetFields()
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <Space align="center" style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            三算单据
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            采购按重量、生产按米数、销售按面积录入，系统折算到统一基准；三本账必须闭合
          </Text>
        </div>
        <Space>
          {canManage && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新建单据
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
            placeholder="单据类型"
            style={{ width: 140 }}
            value={docType}
            onChange={setDocType}
            options={DOC_TYPE_OPTIONS}
          />
          <Select
            allowClear
            placeholder="按规格筛选"
            style={{ width: 220 }}
            value={specFilter}
            onChange={setSpecFilter}
            showSearch
            optionFilterProp="label"
            options={specs.map((s) => ({ value: s.id, label: `${s.code} ${s.name}` }))}
          />
          <Button type="primary" icon={<SearchOutlined />} onClick={() => void load()}>
            查询
          </Button>
        </Space>
      </Card>

      <Card size="small">
        <Table<DocWire>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={data}
          onRow={(r) => ({ onClick: () => void openDetail(r.id), style: { cursor: 'pointer' } })}
          scroll={{ x: 1300 }}
          pagination={{ showTotal: (t) => `共 ${t} 条`, showSizeChanger: false, defaultPageSize: 20 }}
          columns={[
            { title: '单据号', dataIndex: 'docNo', width: 140, fixed: 'left' },
            {
              title: '类型',
              dataIndex: 'docType',
              width: 90,
              render: (v: InventoryDocType) => (
                <Tag color={DOC_TYPE_LABEL[v].color}>{DOC_TYPE_LABEL[v].text}</Tag>
              ),
            },
            { title: '规格', dataIndex: 'specId', width: 170, render: (v: string) => specName(v) },
            { title: '物料', dataIndex: 'materialId', width: 130, render: (v: string) => materialName(v) },
            {
              title: '录入',
              width: 110,
              align: 'right',
              render: (_, r) => `${fmt(r.enteredValue, 2)} ${r.enteredUnit}`,
            },
            { title: '折算米数', dataIndex: 'quantityM', width: 100, align: 'right', render: (v: string) => `${fmt(v, 2)} m` },
            { title: '折算重量', dataIndex: 'weightKg', width: 100, align: 'right', render: (v: string) => `${fmt(v, 2)} kg` },
            { title: '折算面积', dataIndex: 'areaM2', width: 110, align: 'right', render: (v: string) => `${fmt(v, 2)} m²` },
            {
              title: '金额',
              dataIndex: 'totalAmount',
              width: 110,
              align: 'right',
              render: (v: string | null) => (v == null ? '-' : fmtMoney(v)),
            },
            { title: '往来单位', dataIndex: 'partnerName', width: 120, ellipsis: true, render: (v: string | null) => v ?? '-' },
            {
              title: '时间',
              dataIndex: 'createdAt',
              width: 160,
              render: (v: string) => new Date(v).toLocaleString('zh-CN'),
            },
          ]}
        />
      </Card>

      {/* 详情抽屉 */}
      <Drawer title="单据详情" width={680} open={detail !== null} onClose={() => setDetail(null)}>
        {detail && (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="单据号">{detail.doc.docNo}</Descriptions.Item>
              <Descriptions.Item label="类型">
                <Tag color={DOC_TYPE_LABEL[detail.doc.docType].color}>
                  {DOC_TYPE_LABEL[detail.doc.docType].text}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="规格">{specName(detail.doc.specId)}</Descriptions.Item>
              <Descriptions.Item label="物料">{materialName(detail.doc.materialId)}</Descriptions.Item>
              <Descriptions.Item label="录入">
                {fmt(detail.doc.enteredValue, 2)} {detail.doc.enteredUnit}
              </Descriptions.Item>
              <Descriptions.Item label="规格版本">v{detail.doc.specSnapshot.specVersion}</Descriptions.Item>
              <Descriptions.Item label="折算米数">{fmt(detail.doc.quantityM, 2)} m</Descriptions.Item>
              <Descriptions.Item label="折算重量">{fmt(detail.doc.weightKg, 2)} kg</Descriptions.Item>
              <Descriptions.Item label="折算面积">{fmt(detail.doc.areaM2, 2)} m²</Descriptions.Item>
              <Descriptions.Item label="金额">
                {detail.doc.totalAmount == null ? '-' : fmtMoney(detail.doc.totalAmount)}
              </Descriptions.Item>
              <Descriptions.Item label="往来单位" span={2}>
                {detail.doc.partnerName ?? '-'}
              </Descriptions.Item>
              <Descriptions.Item label="备注" span={2}>
                {detail.doc.remark ?? '-'}
              </Descriptions.Item>
            </Descriptions>

            <Card size="small" title={`关联交易流水（${detail.transactions.length}）`}>
              <Table<TxnWire>
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={detail.transactions}
                columns={[
                  {
                    title: '方向',
                    dataIndex: 'direction',
                    width: 60,
                    render: (v: 'in' | 'out') =>
                      v === 'in' ? <Tag color="green">入</Tag> : <Tag color="red">出</Tag>,
                  },
                  {
                    title: '变化量(m)',
                    dataIndex: 'changeQuantity',
                    align: 'right',
                    render: (v: string) => fmt(v, 2),
                  },
                  {
                    title: '变化重(kg)',
                    dataIndex: 'changeWeightKg',
                    align: 'right',
                    render: (v: string) => fmt(v, 2),
                  },
                  {
                    title: '变化面积(m²)',
                    dataIndex: 'changeAreaM2',
                    align: 'right',
                    render: (v: string) => fmt(v, 2),
                  },
                  {
                    title: '剩余(m)',
                    dataIndex: 'afterQuantity',
                    align: 'right',
                    render: (v: string) => fmt(v, 2),
                  },
                  {
                    title: '时间',
                    dataIndex: 'createdAt',
                    width: 150,
                    render: (v: string) => new Date(v).toLocaleString('zh-CN'),
                  },
                ]}
              />
            </Card>
          </Space>
        )}
      </Drawer>

      {/* 新建单据抽屉 */}
      <Drawer
        title={creating ? `新建${DOC_TYPE_LABEL[creating].text}单据` : '新建单据'}
        width={520}
        open={creating !== null}
        onClose={() => setCreating(null)}
        extra={
          <Space>
            <Button onClick={() => setCreating(null)}>取消</Button>
            <Button type="primary" loading={submitting} onClick={() => void onCreate()}>
              保存
            </Button>
          </Space>
        }
      >
        {creating && (
          <>
            <Alert
              style={{ marginBottom: 16 }}
              type="info"
              showIcon
              message={DOC_TYPE_LABEL[creating].unitHint}
            />
            <Form<DocForm>
              form={form}
              layout="vertical"
              initialValues={{ enteredUnit: SUGGESTED_UNITS[creating][0] }}
            >
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
              <Space size={12} style={{ display: 'flex' }}>
                <Form.Item
                  name="enteredUnit"
                  label="录入单位"
                  rules={[{ required: true }]}
                  style={{ flex: 1 }}
                >
                  <Select onChange={onUnitChange} options={SUGGESTED_UNITS[creating].map((u) => ({ value: u, label: u }))} />
                </Form.Item>
                <Form.Item
                  name="enteredValue"
                  label="录入数量"
                  rules={[{ required: true, message: '请输入数量' }]}
                  style={{ flex: 2 }}
                >
                  <InputNumber style={{ width: '100%' }} min={0.0001} precision={3} placeholder="按上述单位录入" />
                </Form.Item>
              </Space>
              <Form.Item name="unitPrice" label="单价（元/米，可选）">
                <InputNumber style={{ width: '100%' }} min={0} precision={4} placeholder="可选" />
              </Form.Item>
              {creating && creating !== 'production_issue' && (
                <Form.Item name="orderId" label="关联订单（可选，选后自动带出往来单位/物料/规格）">
                  <Select
                    showSearch
                    allowClear
                    placeholder="选择已确认订单以累计履约"
                    optionFilterProp="label"
                    options={orderOptions}
                    onChange={onOrderChange}
                  />
                </Form.Item>
              )}
              {creating && creating !== 'production_issue' && (
                <Form.Item
                  name="partnerId"
                  label={creating === 'purchase_inbound' ? '供应商' : '客户'}
                  rules={[{ required: true, message: `请选择${creating === 'purchase_inbound' ? '供应商' : '客户'}` }]}
                >
                  <Select
                    showSearch
                    allowClear
                    placeholder={creating === 'purchase_inbound' ? '选择供应商' : '选择客户'}
                    optionFilterProp="label"
                    options={partnerOptions}
                  />
                </Form.Item>
              )}
              <Form.Item name="remark" label="备注">
                <Input.TextArea rows={2} maxLength={255} />
              </Form.Item>
            </Form>
          </>
        )}
      </Drawer>
    </div>
  )
}
