import { useCallback, useEffect, useMemo, useState } from 'react'
import { App as AntdApp, Button, Card, Form, Modal, Select, Space, Table, Tag, Typography } from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import {
  fmtPct,
  fmt,
  INSPECTION_MODE_LABEL,
  INSPECTION_STATUS_LABEL,
  LIST_TABLE_SCROLL_Y,
  PERM,
  type InspectionStatusValue,
  type InspectionWire,
} from '../lib/erp'
import { useAuthStore } from '../stores/auth.store'

const { Title, Text } = Typography

interface CreateForm {
  batchId?: string
}

interface BatchOption {
  id: string
  batchNo: string
}

export default function QualityInspectionPage() {
  const { message } = AntdApp.useApp()
  const navigate = useNavigate()
  const canInspect = useAuthStore((s) => s.hasPermission(PERM.QUALITY_INSPECT))

  const [data, setData] = useState<InspectionWire[]>([])
  const [loading, setLoading] = useState(false)
  const [batches, setBatches] = useState<BatchOption[]>([])
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState<InspectionStatusValue | ''>('')
  const [form] = Form.useForm<CreateForm>()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (status) params.set('status', status)
      const res = await api.get<InspectionWire[]>(`/quality/inspections?${params.toString()}`)
      setData(res.data.data)
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!open) return
    api
      .get<BatchOption[]>('/inventory/batches')
      .then((res) => setBatches(res.data.data.map((b) => ({ id: b.id, batchNo: b.batchNo }))))
      .catch(() => setBatches([]))
  }, [open])

  const create = async () => {
    const v = await form.validateFields()
    setSubmitting(true)
    try {
      const res = await api.post<InspectionWire>('/quality/inspections', {
        batchId: v.batchId ?? null,
        mode: 'full',
      })
      message.success('检验单已建')
      setOpen(false)
      form.resetFields()
      navigate(`/quality/inspections/${res.data.data.id}`)
    } finally {
      setSubmitting(false)
    }
  }

  const columns = useMemo(
    () => [
      {
        title: '检验单号',
        dataIndex: 'inspectionNo',
        width: 170,
        render: (v: string) => <Text strong>{v}</Text>,
      },
      { title: '检验日期', dataIndex: 'inspectedAt', width: 120 },
      {
        title: '状态',
        dataIndex: 'status',
        width: 100,
        render: (v: InspectionStatusValue) => {
          const s = INSPECTION_STATUS_LABEL[v]
          return <Tag color={s.color}>{s.text}</Tag>
        },
      },
      { title: '方式', dataIndex: 'mode', width: 80, render: (v: 'full' | 'sampling') => INSPECTION_MODE_LABEL[v] },
      { title: '匹数', dataIndex: 'rollCount', width: 80, align: 'right' as const },
      { title: '总扣分', dataIndex: 'totalPoints', width: 90, align: 'right' as const },
      {
        title: '平均扣分密度',
        dataIndex: 'avgPenaltyDensity',
        width: 130,
        align: 'right' as const,
        render: (v: string) => fmt(v, 2),
      },
      {
        title: '合格率',
        dataIndex: 'passRate',
        width: 100,
        align: 'right' as const,
        render: (v: string | null) => (v == null ? '—' : fmtPct(v)),
      },
      {
        title: '操作',
        width: 90,
        render: (_: unknown, row: InspectionWire) => (
          <Button type="link" size="small" onClick={() => navigate(`/quality/inspections/${row.id}`)}>
            查看
          </Button>
        ),
      },
    ],
    [navigate],
  )

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title level={4} style={{ margin: 0 }}>
          坯布检验分等
        </Title>
        <Space>
          <Select
            allowClear
            placeholder="状态"
            style={{ width: 120 }}
            value={status || undefined}
            onChange={(v) => setStatus(v ?? '')}
            options={[
              { value: 'draft', label: '录入中' },
              { value: 'done', label: '已定等' },
              { value: 'void', label: '已作废' },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>
            刷新
          </Button>
          {canInspect && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
              新建检验单
            </Button>
          )}
        </Space>
      </div>

      <Card size="small">
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={data}
          columns={columns}
          scroll={{ x: 960, y: LIST_TABLE_SCROLL_Y }}
          locale={{ emptyText: '还没有检验单。坯布入库后建单验布，定等结果会写回件卡。' }}
        />
      </Card>

      <Modal
        title="新建检验单"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => void create()}
        confirmLoading={submitting}
        okText="建单并开始验布"
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="batchId"
            label="被检批次"
            extra="不选则为散匹检验，建单后手动加入件卡"
          >
            <Select
              allowClear
              showSearch
              placeholder="选择批次"
              optionFilterProp="label"
              options={batches.map((b) => ({ value: b.id, label: b.batchNo }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  )
}
