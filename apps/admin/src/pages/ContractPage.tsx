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
import { DeleteOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { api } from '../lib/api'
import { useLookups } from '../lib/lookups'
import {
  CONTRACT_STATUS_LABEL,
  PERM,
  fmt,
  fmtMoney,
  type ContractItemWire,
  type ContractStatusValue,
  type ContractWire,
  type PartnerWire,
  LIST_TABLE_SCROLL_Y,
} from '../lib/erp'
import { useAuthStore } from '../stores/auth.store'

const { Title, Text } = Typography

interface ItemForm {
  materialId?: string
  specId?: string
  agreedPrice?: number
  agreedQuantityM?: number
  remark?: string
}

interface ContractForm {
  contractType?: 'purchase' | 'sales'
  partnerId?: string
  startDate?: dayjs.Dayjs | null
  endDate?: dayjs.Dayjs | null
  remark?: string
  items?: ItemForm[]
}

export default function ContractPage() {
  const { message } = AntdApp.useApp()
  const canManage = useAuthStore((s) => s.hasPermission(PERM.CONTRACT_MANAGE))
  const { materials, specs, specName, materialName } = useLookups()

  const [data, setData] = useState<ContractWire[]>([])
  const [partners, setPartners] = useState<PartnerWire[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<ContractWire | null>(null)
  const [detail, setDetail] = useState<{ contract: ContractWire; items: ContractItemWire[] } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm<ContractForm>()

  const contractType = Form.useWatch('contractType', form) ?? 'purchase'
  const items = Form.useWatch('items', form) ?? []

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [cRes, pRes] = await Promise.all([
        api.get<ContractWire[]>('/contracts'),
        api.get<PartnerWire[]>('/partners?status=active'),
      ])
      setData(cRes.data.data)
      setPartners(pRes.data.data)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载合同失败')
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    void load()
  }, [load])

  const partnerOptions = useMemo(() => {
    const wantSupplier = contractType === 'purchase'
    return partners
      .filter((p) => (wantSupplier ? p.type === 'supplier' || p.type === 'both' : p.type === 'customer' || p.type === 'both'))
      .map((p) => ({ value: p.id, label: `${p.name}（${p.code}）` }))
  }, [partners, contractType])

  const totals = useMemo(() => {
    let qty = 0
    let amt = 0
    for (const it of items) {
      qty += it.agreedQuantityM ?? 0
      amt += (it.agreedPrice ?? 0) * (it.agreedQuantityM ?? 0)
    }
    return { qty, amt }
  }, [items])

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ contractType: 'purchase', items: [{ agreedPrice: 0, agreedQuantityM: 0 }] })
    setOpen(true)
  }

  const openEdit = async (c: ContractWire) => {
    try {
      const d = (await api.get<{ contract: ContractWire; items: ContractItemWire[] }>(`/contracts/${c.id}`)).data.data
      setEditing(c)
      form.setFieldsValue({
        contractType: c.contractType,
        partnerId: c.partnerId,
        startDate: c.startDate ? dayjs(c.startDate) : null,
        endDate: c.endDate ? dayjs(c.endDate) : null,
        remark: c.remark ?? undefined,
        items: d.items.map((i) => ({
          materialId: i.materialId,
          specId: i.specId,
          agreedPrice: Number(i.agreedPrice),
          agreedQuantityM: Number(i.agreedQuantityM),
          remark: i.remark ?? undefined,
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
        ...(editing ? {} : { contractType: v.contractType, partnerId: v.partnerId }),
        items: (v.items ?? []).map((i) => ({
          materialId: i.materialId,
          specId: i.specId,
          agreedPrice: i.agreedPrice,
          agreedQuantityM: i.agreedQuantityM,
          remark: i.remark ?? null,
        })),
        startDate: v.startDate ? v.startDate.format('YYYY-MM-DD') : null,
        endDate: v.endDate ? v.endDate.format('YYYY-MM-DD') : null,
        remark: v.remark ?? null,
      }
      if (editing) {
        await api.patch(`/contracts/${editing.id}`, payload)
        message.success('合同已更新')
      } else {
        await api.post('/contracts', payload)
        message.success('合同已创建（草稿）')
      }
      setOpen(false)
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  const transition = async (c: ContractWire, action: string, label: string) => {
    try {
      await api.post(`/contracts/${c.id}/${action}`)
      message.success(`已${label}`)
      setDetail(null)
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '操作失败')
    }
  }

  const statusTag = (s: ContractStatusValue) => {
    const m = CONTRACT_STATUS_LABEL[s]
    return m ? <Tag color={m.color}>{m.text}</Tag> : s
  }

  const materialOptions = useMemo(
    () => materials.filter((m) => m.category === 'greige' || m.category === 'yarn').map((m) => ({ value: m.id, label: `${m.code} ${m.name}` })),
    [materials],
  )
  const specOptions = useMemo(() => specs.map((s) => ({ value: s.id, label: `${s.code} ${s.name}` })), [specs])

  return (
    <div>
      <Space align="center" style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>合同 / 价格</Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            与往来单位签多行框架协议：每个「物料+规格」一条协议价，订单可按合同取价
          </Text>
        </div>
        <Space>
          {canManage && <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建合同</Button>}
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
        </Space>
      </Space>

      <Card size="small">
        <Table<ContractWire>
          rowKey="id" size="small" loading={loading} dataSource={data}
          onRow={(r) => ({
            onClick: () => void api.get<{ items: ContractItemWire[] }>(`/contracts/${r.id}`).then((res) => setDetail({ contract: r, items: res.data.data.items })),
          })}
          scroll={{ y: LIST_TABLE_SCROLL_Y }}
          pagination={{ showTotal: (t) => `共 ${t} 份`, showSizeChanger: false }}
          columns={[
            { title: '合同号', dataIndex: 'contractNo', width: 150 },
            { title: '类型', dataIndex: 'contractType', width: 90, render: (v: string) => (v === 'purchase' ? <Tag color="green">采购</Tag> : <Tag color="purple">销售</Tag>) },
            { title: '往来单位', dataIndex: 'partnerName', width: 160, ellipsis: true },
            { title: '总量(米)', dataIndex: 'totalQuantityM', width: 100, align: 'right', render: (v: string) => fmt(v, 0) },
            { title: '总金额', dataIndex: 'totalAmount', width: 120, align: 'right', render: (v: string) => fmtMoney(v) },
            { title: '有效期', width: 180, render: (_, r) => (r.startDate || r.endDate ? `${r.startDate ?? '—'} ~ ${r.endDate ?? '—'}` : '-') },
            { title: '状态', dataIndex: 'status', width: 90, render: (v: ContractStatusValue) => statusTag(v) },
            {
              title: '操作', width: 170, fixed: 'right',
              render: (_, c) => (
                <Space size={2} onClick={(e) => e.stopPropagation()}>
                  {canManage && c.status === 'draft' && <Button type="link" size="small" onClick={() => void openEdit(c)}>编辑</Button>}
                  {canManage && c.status === 'draft' && <Button type="link" size="small" onClick={() => void transition(c, 'activate', '生效')}>生效</Button>}
                  {canManage && c.status === 'active' && <Button type="link" size="small" onClick={() => void transition(c, 'complete', '完成')}>完成</Button>}
                  {canManage && (c.status === 'draft' || c.status === 'active') && (
                    <Popconfirm title="确认取消该合同？" onConfirm={() => void transition(c, 'cancel', '取消')}>
                      <Button type="link" size="small" danger>取消</Button>
                    </Popconfirm>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Card>

      {/* 合同详情（明细行） */}
      <Drawer title={detail ? `合同 ${detail.contract.contractNo}` : '合同'} width={680} open={detail !== null} onClose={() => setDetail(null)}>
        {detail && (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="类型">{detail.contract.contractType === 'purchase' ? '采购合同' : '销售合同'}</Descriptions.Item>
              <Descriptions.Item label="往来单位">{detail.contract.partnerName}</Descriptions.Item>
              <Descriptions.Item label="协议总量">{fmt(detail.contract.totalQuantityM, 0)} m</Descriptions.Item>
              <Descriptions.Item label="协议总额">{fmtMoney(detail.contract.totalAmount)}</Descriptions.Item>
              <Descriptions.Item label="状态">{statusTag(detail.contract.status)}</Descriptions.Item>
              <Descriptions.Item label="有效期">{detail.contract.startDate ?? '—'} ~ {detail.contract.endDate ?? '—'}</Descriptions.Item>
            </Descriptions>
            <Table<ContractItemWire>
              rowKey="id" size="small" pagination={false} dataSource={detail.items}
              columns={[
                { title: '物料', dataIndex: 'materialId', width: 120, render: (v: string) => materialName(v) },
                { title: '规格', dataIndex: 'specId', width: 120, render: (v: string) => specName(v) },
                { title: '协议价(元/米)', dataIndex: 'agreedPrice', width: 110, align: 'right', render: (v: string) => fmt(v, 4) },
                { title: '协议量(米)', dataIndex: 'agreedQuantityM', width: 100, align: 'right', render: (v: string) => fmt(v, 0) },
                { title: '金额', dataIndex: 'amount', width: 120, align: 'right', render: (v: string) => fmtMoney(v) },
              ]}
            />
          </Space>
        )}
      </Drawer>

      {/* 新建/编辑合同（多行明细） */}
      <Drawer
        title={editing ? `编辑合同 ${editing.contractNo}` : '新建合同'}
        width={760} open={open} onClose={() => setOpen(false)}
        extra={<Space><Button onClick={() => setOpen(false)}>取消</Button>{canManage && <Button type="primary" loading={submitting} onClick={() => void onSubmit()}>保存</Button>}</Space>}
      >
        <Form<ContractForm> form={form} layout="vertical">
          <Space size="middle" align="start">
            <Form.Item name="contractType" label="合同类型" rules={[{ required: true }]}>
              <Select style={{ width: 130 }} disabled={!!editing} options={[{ value: 'purchase', label: '采购合同' }, { value: 'sales', label: '销售合同' }]} />
            </Form.Item>
            {!editing && (
              <Form.Item name="partnerId" label="往来单位" rules={[{ required: true, message: '请选择往来单位' }]}>
                <Select showSearch optionFilterProp="label" style={{ width: 260 }} options={partnerOptions} placeholder={contractType === 'purchase' ? '选择供应商' : '选择客户'} />
              </Form.Item>
            )}
            <Form.Item name="startDate" label="开始日期"><DatePicker style={{ width: 140 }} /></Form.Item>
            <Form.Item name="endDate" label="结束日期"><DatePicker style={{ width: 140 }} /></Form.Item>
          </Space>

          <Form.List name="items">
            {(fields, { add, remove }) => (
              <Card size="small" title="明细行" extra={<Button type="dashed" size="small" icon={<PlusOutlined />} onClick={() => add({ agreedPrice: 0, agreedQuantityM: 0 })}>添加一行</Button>}>
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  {fields.map((field, index) => (
                    <Space key={field.key} align="center" wrap>
                      <Form.Item name={[index, 'materialId']} rules={[{ required: true, message: '选物料' }]} style={{ marginBottom: 0 }}>
                        <Select placeholder="物料" style={{ width: 170 }} options={materialOptions} optionFilterProp="label" showSearch allowClear />
                      </Form.Item>
                      <Form.Item name={[index, 'specId']} rules={[{ required: true, message: '选规格' }]} style={{ marginBottom: 0 }}>
                        <Select placeholder="规格" style={{ width: 170 }} options={specOptions} optionFilterProp="label" showSearch allowClear />
                      </Form.Item>
                      <Form.Item name={[index, 'agreedPrice']} rules={[{ required: true, message: '单价' }]} style={{ marginBottom: 0 }}>
                        <InputNumber placeholder="协议价(元/米)" style={{ width: 130 }} min={0.0001} precision={4} />
                      </Form.Item>
                      <Form.Item name={[index, 'agreedQuantityM']} rules={[{ required: true, message: '数量' }]} style={{ marginBottom: 0 }}>
                        <InputNumber placeholder="数量(米)" style={{ width: 120 }} min={0.001} precision={1} />
                      </Form.Item>
                      <Text type="secondary" style={{ width: 100 }}>
                        = {fmtMoney((items[index]?.agreedPrice ?? 0) * (items[index]?.agreedQuantityM ?? 0))}
                      </Text>
                      {fields.length > 1 && <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(index)} />}
                    </Space>
                  ))}
                  <Text type="secondary">合计：{fmt(totals.qty, 0)} 米 / {fmtMoney(totals.amt)}</Text>
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
