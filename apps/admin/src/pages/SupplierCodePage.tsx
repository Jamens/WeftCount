import { useCallback, useEffect, useMemo, useState } from 'react'
import { App as AntdApp, Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd'
import { DeleteOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { api } from '../lib/api'
import { useLookups } from '../lib/lookups'
import { PERM, type PartnerWire, type SupplierCodeMappingWire } from '../lib/erp'
import { useAuthStore } from '../stores/auth.store'

const { Title, Text } = Typography

interface FormVals {
  supplierId?: string
  supplierCode?: string
  materialId?: string
  specId?: string
  remark?: string
}

/**
 * 供应商条码映射管理
 *
 * 到货商品带的是**供应商自己的条码**，系统不认识。维护「供应商条码 → 我方物料+规格」映射，
 * 桌面端「扫码入库」扫供应商条码即可查映射识别、自动带出建批次信息。
 */
export default function SupplierCodePage() {
  const { message } = AntdApp.useApp()
  const canEdit = useAuthStore((s) => s.hasPermission(PERM.PARTNER_EDIT))
  const { materials, specs, specName, materialName } = useLookups()
  const [data, setData] = useState<SupplierCodeMappingWire[]>([])
  const [suppliers, setSuppliers] = useState<PartnerWire[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm<FormVals>()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [m, p] = await Promise.all([
        api.get<SupplierCodeMappingWire[]>('/supplier-codes'),
        api.get<PartnerWire[]>('/partners?status=active'),
      ])
      setData(m.data.data)
      setSuppliers(p.data.data.filter((x) => x.type === 'supplier' || x.type === 'both'))
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载映射失败')
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    void load()
  }, [load])

  const supplierOptions = useMemo(
    () => suppliers.map((s) => ({ value: s.id, label: `${s.name}（${s.code}）` })),
    [suppliers],
  )

  const onCreate = async () => {
    const v = await form.validateFields()
    setSaving(true)
    try {
      await api.post('/supplier-codes', {
        supplierId: v.supplierId,
        supplierCode: (v.supplierCode ?? '').trim(),
        materialId: v.materialId,
        specId: v.specId,
        remark: v.remark ?? null,
      })
      message.success('映射已新增，收货时扫该条码即可识别')
      setOpen(false)
      form.resetFields()
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '新增失败')
    } finally {
      setSaving(false)
    }
  }

  const onDelete = async (id: string) => {
    try {
      await api.delete(`/supplier-codes/${id}`)
      message.success('已删除')
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '删除失败')
    }
  }

  return (
    <div>
      <Space align="center" style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>供应商条码映射</Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            把供应商自己的条码映射到我方物料/规格，收货时扫供应商条码即可识别入库
          </Text>
        </div>
        <Space>
          {canEdit && <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setOpen(true) }}>新增映射</Button>}
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
        </Space>
      </Space>

      <Card size="small">
        <Table<SupplierCodeMappingWire>
          rowKey="id" size="small" loading={loading} dataSource={data}
          pagination={{ pageSize: 20, showSizeChanger: false, showTotal: (t) => `共 ${t} 条映射` }}
          columns={[
            { title: '供应商条码', dataIndex: 'supplierCode', width: 180, render: (v: string) => <Tag>{v}</Tag> },
            { title: '供应商', dataIndex: 'supplierId', width: 160, render: (v: string) => suppliers.find((s) => s.id === v)?.name ?? '-' },
            { title: '物料', dataIndex: 'materialId', width: 140, render: (v: string) => materialName(v) },
            { title: '规格', dataIndex: 'specId', width: 140, render: (v: string) => specName(v) },
            { title: '备注', dataIndex: 'remark', ellipsis: true, render: (v: string | null) => v ?? '-' },
            ...(canEdit
              ? [{
                  title: '操作', width: 80,
                  render: (_: unknown, r: SupplierCodeMappingWire) => (
                    <Popconfirm title="删除该映射？" onConfirm={() => void onDelete(r.id)}>
                      <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
                    </Popconfirm>
                  ),
                }]
              : []),
          ]}
        />
      </Card>

      <Modal
        title="新增供应商条码映射"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => void onCreate()}
        confirmLoading={saving}
        okText="保存"
      >
        <Form<FormVals> form={form} layout="vertical">
          <Form.Item name="supplierId" label="供应商" rules={[{ required: true, message: '请选择供应商' }]}>
            <Select showSearch optionFilterProp="label" options={supplierOptions} placeholder="选择供应商" />
          </Form.Item>
          <Form.Item name="supplierCode" label="供应商条码（收货时扫到的码）" rules={[{ required: true, message: '请输入条码' }]}>
            <Input placeholder="如 6901234567890" />
          </Form.Item>
          <Form.Item name="materialId" label="我方物料" rules={[{ required: true, message: '请选择物料' }]}>
            <Select showSearch optionFilterProp="label" options={materials.map((m) => ({ value: m.id, label: `${m.code} ${m.name}` }))} placeholder="选择物料" />
          </Form.Item>
          <Form.Item name="specId" label="我方规格" rules={[{ required: true, message: '请选择规格' }]}>
            <Select showSearch optionFilterProp="label" options={specs.map((s) => ({ value: s.id, label: `${s.code} ${s.name}` }))} placeholder="选择规格" />
          </Form.Item>
          <Form.Item name="remark" label="备注"><Input placeholder="可选" /></Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
