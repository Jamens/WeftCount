import { useCallback, useEffect, useState } from 'react'
import {
  App as AntdApp,
  Button,
  Card,
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
import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import { api } from '../lib/api'
import {
  fmt,
  fmtMoney,
  PERM,
  type MaterialWire,
  LIST_TABLE_SCROLL_Y,
} from '../lib/erp'
import { MATERIAL_CATEGORY_LABEL, MEASURE_MODE_LABEL, type MaterialCategoryValue, type MeasureMode } from '@weftcount/shared'
import { useAuthStore } from '../stores/auth.store'

const { Title, Text } = Typography

const CATEGORY_OPTIONS = (Object.keys(MATERIAL_CATEGORY_LABEL) as MaterialCategoryValue[]).map((k) => ({
  value: k,
  label: MATERIAL_CATEGORY_LABEL[k],
}))

const MEASURE_OPTIONS = (Object.keys(MEASURE_MODE_LABEL) as MeasureMode[]).map((k) => ({
  value: k,
  label: MEASURE_MODE_LABEL[k],
}))

interface CreateForm {
  code?: string
  name: string
  category: MaterialCategoryValue
  specification: string
  measureMode?: MeasureMode
  standardPrice?: number
  safetyStock?: number
  remark?: string
}

export default function MaterialPage() {
  const { message } = AntdApp.useApp()
  const canEdit = useAuthStore((s) => s.hasPermission(PERM.MATERIAL_EDIT))

  const [data, setData] = useState<MaterialWire[]>([])
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [category, setCategory] = useState<MaterialCategoryValue | undefined>()
  const [status, setStatus] = useState<'active' | 'discontinued' | undefined>()
  const [detail, setDetail] = useState<MaterialWire | null>(null)
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm<CreateForm>()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (keyword) params.set('keyword', keyword)
      if (category) params.set('category', category)
      if (status) params.set('status', status)
      const res = await api.get<MaterialWire[]>(`/materials?${params.toString()}`)
      setData(res.data.data)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载物料失败')
    } finally {
      setLoading(false)
    }
  }, [keyword, category, status, message])

  useEffect(() => {
    void load()
  }, [load])

  const onCreate = async () => {
    const values = await form.validateFields()
    setSubmitting(true)
    try {
      await api.post('/materials', {
        ...values,
        standardPrice: values.standardPrice ?? null,
        safetyStock: values.safetyStock ?? null,
        remark: values.remark ?? null,
      })
      message.success('物料已创建')
      setOpen(false)
      form.resetFields()
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '创建失败')
    } finally {
      setSubmitting(false)
    }
  }

  const onDiscontinue = async (id: string) => {
    try {
      await api.post(`/materials/${id}/discontinue`)
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
            物料主数据
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            纱线 / 坯布 / 辅料 / 备件的统一档案，决定「一件事三算」按哪个口径走
          </Text>
        </div>
        <Space>
          {canEdit && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
              新建物料
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
            placeholder="名称 / 编码 / 规格"
            allowClear
            style={{ width: 220 }}
            prefix={<SearchOutlined />}
            onChange={(e) => setKeyword(e.target.value)}
            onPressEnter={() => void load()}
          />
          <Select
            allowClear
            placeholder="大类"
            style={{ width: 140 }}
            value={category}
            onChange={setCategory}
            options={CATEGORY_OPTIONS}
          />
          <Select
            allowClear
            placeholder="状态"
            style={{ width: 120 }}
            value={status}
            onChange={setStatus}
            options={[
              { value: 'active', label: '启用' },
              { value: 'discontinued', label: '停用' },
            ]}
          />
          <Button type="primary" onClick={() => void load()}>
            查询
          </Button>
        </Space>
      </Card>

      <Card size="small">
        <Table<MaterialWire>
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
              title: '大类',
              dataIndex: 'category',
              width: 100,
              render: (v: MaterialCategoryValue) => <Tag>{MATERIAL_CATEGORY_LABEL[v] ?? v}</Tag>,
            },
            { title: '规格描述', dataIndex: 'specification', ellipsis: true },
            { title: '主单位', dataIndex: 'primaryUnit', width: 80 },
            {
              title: '主计量',
              dataIndex: 'measureMode',
              width: 90,
              render: (v: MeasureMode) => MEASURE_MODE_LABEL[v] ?? v,
            },
            {
              title: '参考单价',
              dataIndex: 'standardPrice',
              width: 110,
              align: 'right',
              render: (v: string | null) => (v == null ? '-' : fmtMoney(v)),
            },
            {
              title: '安全库存',
              dataIndex: 'safetyStock',
              width: 100,
              align: 'right',
              render: (v: string | null) => (v == null ? '-' : fmt(v, 2)),
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 80,
              render: (v: string) =>
                v === 'active' ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>,
            },
            {
              title: '操作',
              width: 90,
              fixed: 'right',
              render: (_, r) =>
                canEdit && r.status === 'active' ? (
                  <Popconfirm title="确认停用该物料？" onConfirm={() => void onDiscontinue(r.id)}>
                    <Button type="link" size="small" danger>
                      停用
                    </Button>
                  </Popconfirm>
                ) : (
                  <Text type="secondary">-</Text>
                ),
            },
          ]}
        />
      </Card>

      {/* 详情抽屉（只读） */}
      <Drawer title="物料详情" width={460} open={detail !== null} onClose={() => setDetail(null)}>
        {detail && (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Detail label="编码" value={detail.code} />
            <Detail label="名称" value={detail.name} />
            <Detail label="大类" value={MATERIAL_CATEGORY_LABEL[detail.category] ?? detail.category} />
            <Detail label="规格描述" value={detail.specification} />
            <Detail label="主单位" value={detail.primaryUnit} />
            <Detail label="允许单位" value={detail.allowedUnits.join('、')} />
            <Detail label="批次管理" value={detail.batchManaged ? '是' : '否'} />
            <Detail label="参考单价" value={detail.standardPrice == null ? '-' : fmtMoney(detail.standardPrice)} />
            <Detail label="安全库存" value={detail.safetyStock == null ? '-' : fmt(detail.safetyStock, 2)} />
            <Detail label="备注" value={detail.remark ?? '-'} />
          </Space>
        )}
      </Drawer>

      {/* 新建抽屉 */}
      <Drawer
        title="新建物料"
        width={460}
        open={open}
        onClose={() => setOpen(false)}
        extra={
          <Space>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button type="primary" loading={submitting} onClick={() => void onCreate()}>
              保存
            </Button>
          </Space>
        }
      >
        <Form<CreateForm> form={form} layout="vertical" initialValues={{ category: 'greige' }}>
          <Form.Item name="code" label="编码" extra="留空则由系统按大类自动生成（如 G0001）">
            <Input placeholder="可选" maxLength={32} />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如：全棉府绸坯布" maxLength={128} />
          </Form.Item>
          <Form.Item name="category" label="大类" rules={[{ required: true }]}>
            <Select options={CATEGORY_OPTIONS} />
          </Form.Item>
          <Form.Item name="specification" label="规格描述" rules={[{ required: true, message: '请输入规格描述' }]}>
            <Input placeholder="如：40S/2 精梳棉" maxLength={255} />
          </Form.Item>
          <Form.Item name="measureMode" label="主计量方式" extra="留空则按大类默认（纱线→重量，坯布→长度）">
            <Select allowClear placeholder="按大类默认" options={MEASURE_OPTIONS} />
          </Form.Item>
          <Form.Item name="standardPrice" label="参考单价（元）">
            <InputNumber style={{ width: '100%' }} min={0} precision={2} placeholder="可选" />
          </Form.Item>
          <Form.Item name="safetyStock" label="安全库存">
            <InputNumber style={{ width: '100%' }} min={0} precision={2} placeholder="可选" />
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
