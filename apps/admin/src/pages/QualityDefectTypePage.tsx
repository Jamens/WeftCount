import { useCallback, useEffect, useState } from 'react'
import {
  App as AntdApp,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { api } from '../lib/api'
import {
  DEFECT_CATEGORY_LABEL,
  DEFECT_PENALTY_MODE_LABEL,
  PERM,
  type DefectCategoryValue,
  type DefectPenaltyModeValue,
  type DefectTypeWire,
} from '../lib/erp'
import { useAuthStore } from '../stores/auth.store'

const { Title, Text } = Typography

interface EditForm {
  code: string
  name: string
  category: DefectCategoryValue
  penaltyMode: DefectPenaltyModeValue
  fixedPenalty: number
}

export default function QualityDefectTypePage() {
  const { message } = AntdApp.useApp()
  const canReview = useAuthStore((s) => s.hasPermission(PERM.QUALITY_REVIEW))

  const [data, setData] = useState<DefectTypeWire[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<DefectTypeWire | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm<EditForm>()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<DefectTypeWire[]>('/quality/defect-types?includeDisabled=true')
      setData(res.data.data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const openCreate = () => {
    setEditing(null)
    form.setFieldsValue({ category: 'other', penaltyMode: 'by_length', fixedPenalty: 4, code: '', name: '' })
    setOpen(true)
  }

  const openEdit = (row: DefectTypeWire) => {
    setEditing(row)
    form.setFieldsValue({
      code: row.code,
      name: row.name,
      category: row.category,
      penaltyMode: row.penaltyMode,
      fixedPenalty: row.fixedPenalty,
    })
    setOpen(true)
  }

  const submit = async () => {
    const v = await form.validateFields()
    setSubmitting(true)
    try {
      if (editing) {
        await api.patch(`/quality/defect-types/${editing.id}`, v)
        message.success('已保存')
      } else {
        await api.post('/quality/defect-types', v)
        message.success('已新增')
      }
      setOpen(false)
      await load()
    } finally {
      setSubmitting(false)
    }
  }

  const toggle = async (row: DefectTypeWire, enabled: boolean) => {
    await api.patch(`/quality/defect-types/${row.id}`, { enabled })
    await load()
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title level={4} style={{ margin: 0 }}>
          疵点类型
        </Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>
            刷新
          </Button>
          {canReview && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增疵点类型
            </Button>
          )}
        </Space>
      </div>

      <Card size="small">
        <Text type="secondary">
          扣分按这里的规则算：选「按长度四档扣分」时，≤3 英寸扣 1 分、3~6 扣 2 分、6~9 扣 3 分、&gt;9 扣 4 分；
          选「固定扣分」则不看来长度（破洞一律 4 分）。名称可按各厂叫法自行修改。
        </Text>
      </Card>

      <Card size="small">
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={data}
          pagination={false}
          scroll={{ y: 'calc(100vh - 420px)' }}
          columns={[
            { title: '代码', dataIndex: 'code', width: 160 },
            { title: '名称', dataIndex: 'name', width: 140 },
            {
              title: '分类',
              dataIndex: 'category',
              width: 90,
              render: (v: DefectCategoryValue) => <Tag>{DEFECT_CATEGORY_LABEL[v]}</Tag>,
            },
            {
              title: '计分方式',
              dataIndex: 'penaltyMode',
              width: 160,
              render: (v: DefectPenaltyModeValue, r) => (
                <Space size={4}>
                  <Text>{DEFECT_PENALTY_MODE_LABEL[v]}</Text>
                  {v === 'fixed' && <Text type="secondary">{r.fixedPenalty} 分</Text>}
                </Space>
              ),
            },
            { title: '排序', dataIndex: 'sortOrder', width: 80, align: 'right' },
            {
              title: '启用',
              dataIndex: 'enabled',
              width: 90,
              render: (v: boolean, r) => (
                <Switch size="small" checked={v} disabled={!canReview} onChange={(c) => void toggle(r, c)} />
              ),
            },
            {
              title: '操作',
              width: 80,
              render: (_: unknown, r: DefectTypeWire) => (
                <Button type="link" size="small" disabled={!canReview} onClick={() => openEdit(r)}>
                  编辑
                </Button>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title={editing ? '编辑疵点类型' : '新增疵点类型'}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
        confirmLoading={submitting}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="code" label="代码" rules={[{ required: true, message: '请填代码' }]}>
            <Input placeholder="如 OIL_STAIN" disabled={!!editing} />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请填名称' }]}>
            <Input placeholder="检验员看到的名字，如 油污" />
          </Form.Item>
          <Form.Item name="category" label="分类" rules={[{ required: true }]}>
            <Select
              options={(['warp', 'weft', 'stain', 'broken', 'other'] as DefectCategoryValue[]).map((v) => ({
                value: v,
                label: DEFECT_CATEGORY_LABEL[v],
              }))}
            />
          </Form.Item>
          <Form.Item name="penaltyMode" label="计分方式" rules={[{ required: true }]}>
            <Select
              options={(['by_length', 'fixed'] as DefectPenaltyModeValue[]).map((v) => ({
                value: v,
                label: DEFECT_PENALTY_MODE_LABEL[v],
              }))}
            />
          </Form.Item>
          <Form.Item name="fixedPenalty" label="固定扣分" extra="仅「固定扣分」时生效，最高 4 分">
            <InputNumber min={0} max={4} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  )
}
