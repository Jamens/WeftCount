import { useCallback, useEffect, useState } from 'react'
import {
  App as AntdApp,
  Button,
  Card,
  Drawer,
  Form,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { api } from '../lib/api'
import { LIST_TABLE_SCROLL_Y, PERM, WAREHOUSE_TYPE_LABEL, type WarehouseTypeValue, type WarehouseWire } from '../lib/erp'
import { useAuthStore } from '../stores/auth.store'

const { Title, Text } = Typography

interface WarehouseForm {
  name?: string
  type?: WarehouseTypeValue
  address?: string
  keeper?: string
  status?: 'active' | 'disabled'
  remark?: string
}

export default function WarehousePage() {
  const { message } = AntdApp.useApp()
  const canManage = useAuthStore((s) => s.hasPermission(PERM.WAREHOUSE_MANAGE))

  const [data, setData] = useState<WarehouseWire[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<WarehouseWire | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm<WarehouseForm>()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<WarehouseWire[]>('/warehouses')
      setData(res.data.data)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载仓库失败')
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    void load()
  }, [load])

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ type: 'other' })
    setOpen(true)
  }

  const openEdit = (w: WarehouseWire) => {
    setEditing(w)
    form.setFieldsValue({
      name: w.name,
      type: w.type,
      address: w.address ?? undefined,
      keeper: w.keeper ?? undefined,
      status: w.status,
      remark: w.remark ?? undefined,
    })
    setOpen(true)
  }

  const onSubmit = async () => {
    const v = await form.validateFields()
    setSubmitting(true)
    try {
      if (editing) {
        await api.patch(`/warehouses/${editing.id}`, v)
        message.success('仓库已更新')
      } else {
        await api.post('/warehouses', v)
        message.success('仓库已创建')
      }
      setOpen(false)
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
            仓库管理
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            原料/坯布/成品/辅料/废料分仓；库存批次归属仓库，调拨即批次在仓间移动
          </Text>
        </div>
        <Space>
          {canManage && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新建仓库
            </Button>
          )}
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>
            刷新
          </Button>
        </Space>
      </Space>

      <Card size="small">
        <Table<WarehouseWire>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={data}
          scroll={{ y: LIST_TABLE_SCROLL_Y }}
          pagination={{ showTotal: (t) => `共 ${t} 个仓库`, showSizeChanger: false }}
          columns={[
            { title: '编码', dataIndex: 'code', width: 90 },
            { title: '名称', dataIndex: 'name', width: 140 },
            {
              title: '类型',
              dataIndex: 'type',
              width: 100,
              render: (v: WarehouseTypeValue) => {
                const m = WAREHOUSE_TYPE_LABEL[v]
                return m ? <Tag color={m.color}>{m.text}</Tag> : v
              },
            },
            { title: '地址', dataIndex: 'address', ellipsis: true, render: (v: string | null) => v ?? '-' },
            { title: '仓管员', dataIndex: 'keeper', width: 90, render: (v: string | null) => v ?? '-' },
            {
              title: '状态',
              dataIndex: 'status',
              width: 80,
              render: (v: string) => (v === 'active' ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>),
            },
            { title: '备注', dataIndex: 'remark', ellipsis: true, render: (v: string | null) => v ?? '-' },
            {
              title: '操作',
              width: 80,
              fixed: 'right',
              render: (_, w) =>
                canManage ? (
                  <Button type="link" size="small" onClick={() => openEdit(w)}>
                    编辑
                  </Button>
                ) : (
                  <Text type="secondary">-</Text>
                ),
            },
          ]}
        />
      </Card>

      <Drawer
        title={editing ? '编辑仓库' : '新建仓库'}
        width={440}
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
        <Form<WarehouseForm> form={form} layout="vertical">
          <Form.Item name="name" label="仓库名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如 坯布库" maxLength={64} />
          </Form.Item>
          <Form.Item name="type" label="类型" rules={[{ required: true }]}>
            <Select
              options={(Object.keys(WAREHOUSE_TYPE_LABEL) as WarehouseTypeValue[]).map((k) => ({
                value: k,
                label: WAREHOUSE_TYPE_LABEL[k].text,
              }))}
            />
          </Form.Item>
          <Form.Item name="address" label="地址">
            <Input maxLength={255} />
          </Form.Item>
          <Form.Item name="keeper" label="仓管员">
            <Input maxLength={64} />
          </Form.Item>
          {editing && (
            <Form.Item name="status" label="状态">
              <Select
                options={[
                  { value: 'active', label: '启用' },
                  { value: 'disabled', label: '停用' },
                ]}
              />
            </Form.Item>
          )}
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} maxLength={255} />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  )
}
