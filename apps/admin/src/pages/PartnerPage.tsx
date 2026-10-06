import { useCallback, useEffect, useState } from 'react'
import {
  App as AntdApp,
  Button,
  Card,
  Drawer,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import { api } from '../lib/api'
import {
  PARTNER_STATUS_LABEL,
  PARTNER_TYPE_LABEL,
  PARTNER_TYPE_OPTIONS,
  PERM,
  type PartnerStatusValue,
  type PartnerTypeValue,
  type PartnerWire,
  LIST_TABLE_SCROLL_Y,
} from '../lib/erp'
import { useAuthStore } from '../stores/auth.store'

const { Title, Text } = Typography

interface PartnerForm {
  code?: string
  name: string
  type?: PartnerTypeValue
  contact?: string
  phone?: string
  taxNo?: string
  address?: string
  bankName?: string
  bankAccount?: string
  remark?: string
}

export default function PartnerPage() {
  const { message } = AntdApp.useApp()
  const canEdit = useAuthStore((s) => s.hasPermission(PERM.PARTNER_EDIT))

  const [data, setData] = useState<PartnerWire[]>([])
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [type, setType] = useState<PartnerTypeValue | undefined>()
  const [status, setStatus] = useState<PartnerStatusValue | undefined>()
  const [detail, setDetail] = useState<PartnerWire | null>(null)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<PartnerWire | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm<PartnerForm>()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (keyword) params.set('keyword', keyword)
      if (type) params.set('type', type)
      if (status) params.set('status', status)
      const res = await api.get<PartnerWire[]>(`/partners?${params.toString()}`)
      setData(res.data.data)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载往来单位失败')
    } finally {
      setLoading(false)
    }
  }, [keyword, type, status, message])

  useEffect(() => {
    void load()
  }, [load])

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ type: 'supplier' })
    setOpen(true)
  }

  const openEdit = (r: PartnerWire) => {
    setEditing(r)
    form.setFieldsValue({
      code: r.code,
      name: r.name,
      type: r.type,
      contact: r.contact ?? undefined,
      phone: r.phone ?? undefined,
      taxNo: r.taxNo ?? undefined,
      address: r.address ?? undefined,
      bankName: r.bankName ?? undefined,
      bankAccount: r.bankAccount ?? undefined,
      remark: r.remark ?? undefined,
    })
    setOpen(true)
  }

  const onSubmit = async () => {
    const values = await form.validateFields()
    setSubmitting(true)
    try {
      if (editing) {
        await api.patch(`/partners/${editing.id}`, {
          ...values,
          contact: values.contact ?? null,
          phone: values.phone ?? null,
          taxNo: values.taxNo ?? null,
          address: values.address ?? null,
          bankName: values.bankName ?? null,
          bankAccount: values.bankAccount ?? null,
          remark: values.remark ?? null,
        })
        message.success('已保存')
      } else {
        await api.post('/partners', {
          ...values,
          contact: values.contact ?? null,
          phone: values.phone ?? null,
          taxNo: values.taxNo ?? null,
          address: values.address ?? null,
          bankName: values.bankName ?? null,
          bankAccount: values.bankAccount ?? null,
          remark: values.remark ?? null,
        })
        message.success('往来单位已创建')
      }
      setOpen(false)
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  const onDisable = async (id: string) => {
    try {
      await api.post(`/partners/${id}/disable`)
      message.success('已停用')
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '停用失败')
    }
  }

  return (
    <div>
      <Space align="center" style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            往来单位
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            供应商 / 客户档案，采购与销售单据的交易对手均指向此处
          </Text>
        </div>
        <Space>
          {canEdit && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新建往来单位
            </Button>
          )}
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>
            刷新
          </Button>
        </Space>
      </Space>

      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap>
          <Input
            placeholder="名称 / 编码 / 联系人 / 电话"
            allowClear
            style={{ width: 240 }}
            prefix={<SearchOutlined />}
            onChange={(e) => setKeyword(e.target.value)}
            onPressEnter={() => void load()}
          />
          <Select
            allowClear
            placeholder="类型"
            style={{ width: 160 }}
            value={type}
            onChange={setType}
            options={PARTNER_TYPE_OPTIONS}
          />
          <Select
            allowClear
            placeholder="状态"
            style={{ width: 120 }}
            value={status}
            onChange={setStatus}
            options={[
              { value: 'active', label: '启用' },
              { value: 'disabled', label: '停用' },
            ]}
          />
          <Button type="primary" onClick={() => void load()}>
            查询
          </Button>
        </Space>
      </Card>

      <Card size="small">
        <Table<PartnerWire>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={data}
          onRow={(r) => ({ onClick: () => setDetail(r) })}
          scroll={{ y: LIST_TABLE_SCROLL_Y }}
          pagination={{ showTotal: (t) => `共 ${t} 条`, showSizeChanger: false, defaultPageSize: 20 }}
          columns={[
            { title: '编码', dataIndex: 'code', width: 90 },
            { title: '名称', dataIndex: 'name', width: 160 },
            {
              title: '类型',
              dataIndex: 'type',
              width: 130,
              render: (v: PartnerTypeValue) => <Tag color="blue">{PARTNER_TYPE_LABEL[v] ?? v}</Tag>,
            },
            { title: '联系人', dataIndex: 'contact', width: 90, render: (v: string | null) => v ?? '-' },
            { title: '电话', dataIndex: 'phone', width: 130, render: (v: string | null) => v ?? '-' },
            { title: '税号', dataIndex: 'taxNo', width: 140, ellipsis: true, render: (v: string | null) => v ?? '-' },
            {
              title: '状态',
              dataIndex: 'status',
              width: 80,
              render: (v: PartnerStatusValue) => {
                const s = PARTNER_STATUS_LABEL[v]
                return s ? <Tag color={s.color}>{s.text}</Tag> : v
              },
            },
            {
              title: '操作',
              width: 130,
              fixed: 'right',
              render: (_, r) =>
                canEdit && r.status === 'active' ? (
                  <Space size={4}>
                    <Button type="link" size="small" onClick={(e) => { e.stopPropagation(); openEdit(r) }}>
                      编辑
                    </Button>
                    <Popconfirm title="确认停用该往来单位？" onConfirm={() => void onDisable(r.id)}>
                      <Button type="link" size="small" danger onClick={(e) => e.stopPropagation()}>
                        停用
                      </Button>
                    </Popconfirm>
                  </Space>
                ) : (
                  <Text type="secondary">-</Text>
                ),
            },
          ]}
        />
      </Card>

      {/* 详情抽屉（只读） */}
      <Drawer title="往来单位详情" width={480} open={detail !== null} onClose={() => setDetail(null)}>
        {detail && (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Detail label="编码" value={detail.code} />
            <Detail label="名称" value={detail.name} />
            <Detail label="类型" value={PARTNER_TYPE_LABEL[detail.type] ?? detail.type} />
            <Detail label="联系人" value={detail.contact ?? '-'} />
            <Detail label="电话" value={detail.phone ?? '-'} />
            <Detail label="税号" value={detail.taxNo ?? '-'} />
            <Detail label="地址" value={detail.address ?? '-'} />
            <Detail label="开户行" value={detail.bankName ?? '-'} />
            <Detail label="银行账号" value={detail.bankAccount ?? '-'} />
            <Detail label="状态" value={PARTNER_STATUS_LABEL[detail.status]?.text ?? detail.status} />
            <Detail label="备注" value={detail.remark ?? '-'} />
          </Space>
        )}
      </Drawer>

      {/* 新建 / 编辑抽屉 */}
      <Drawer
        title={editing ? '编辑往来单位' : '新建往来单位'}
        width={480}
        open={open}
        onClose={() => setOpen(false)}
        extra={
          <Space>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button type="primary" loading={submitting} onClick={() => void onSubmit()}>
              保存
            </Button>
          </Space>
        }
      >
        <Form<PartnerForm> form={form} layout="vertical" initialValues={{ type: 'supplier' }}>
          <Form.Item name="code" label="编码" extra="留空则由系统按 P + 流水自动生成（如 P0001）">
            <Input placeholder="可选" maxLength={32} />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入单位名称' }]}>
            <Input placeholder="如：绍兴某某纺织有限公司" maxLength={128} />
          </Form.Item>
          <Form.Item name="type" label="类型" rules={[{ required: true }]}>
            <Select options={PARTNER_TYPE_OPTIONS} />
          </Form.Item>
          <Form.Item name="contact" label="联系人">
            <Input placeholder="可选" maxLength={64} />
          </Form.Item>
          <Form.Item name="phone" label="电话">
            <Input placeholder="可选" maxLength={32} />
          </Form.Item>
          <Form.Item name="taxNo" label="税号">
            <Input placeholder="统一社会信用代码 / 税号" maxLength={32} />
          </Form.Item>
          <Form.Item name="address" label="地址">
            <Input placeholder="可选" maxLength={255} />
          </Form.Item>
          <Form.Item name="bankName" label="开户行">
            <Input placeholder="可选" maxLength={128} />
          </Form.Item>
          <Form.Item name="bankAccount" label="银行账号">
            <Input placeholder="可选" maxLength={64} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={3} maxLength={255} />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <Text type="secondary">{label}</Text>
      <Text strong>{value}</Text>
    </div>
  )
}
