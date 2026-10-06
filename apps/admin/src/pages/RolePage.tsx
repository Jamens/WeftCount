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
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { api } from '../lib/api'
import {
  PERM,
  PERMISSION_CATALOG,
  type RoleWire,
} from '../lib/erp'
import { useAuthStore } from '../stores/auth.store'

const { Title, Text } = Typography

interface RoleForm {
  code?: string
  name: string
  description?: string
  permissions: string[]
}

export default function RolePage() {
  const { message } = AntdApp.useApp()
  const canManage = useAuthStore((s) => s.hasPermission(PERM.ROLE_MANAGE))

  const [data, setData] = useState<RoleWire[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<RoleWire | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm<RoleForm>()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<RoleWire[]>('/roles')
      setData(res.data.data)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载角色失败')
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
    setOpen(true)
  }

  const openEdit = (r: RoleWire) => {
    setEditing(r)
    form.setFieldsValue({
      code: r.code,
      name: r.name,
      description: r.description ?? undefined,
      permissions: r.permissions,
    })
    setOpen(true)
  }

  const onSubmit = async () => {
    const values = await form.validateFields()
    setSubmitting(true)
    try {
      if (editing) {
        await api.patch(`/roles/${editing.id}`, {
          name: values.name,
          description: values.description ?? null,
          permissions: values.permissions,
        })
        message.success('角色已更新')
      } else {
        await api.post('/roles', {
          code: values.code,
          name: values.name,
          description: values.description ?? null,
          permissions: values.permissions,
        })
        message.success('角色已创建')
      }
      setOpen(false)
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  const onDelete = async (r: RoleWire) => {
    try {
      await api.delete(`/roles/${r.id}`)
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
          <Title level={4} style={{ margin: 0 }}>
            角色管理
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            配置权限组合，再分配给人。内置角色不可删除，可改权限
          </Text>
        </div>
        <Space>
          {canManage && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新建角色
            </Button>
          )}
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>
            刷新
          </Button>
        </Space>
      </Space>

      <Card size="small">
        <Table<RoleWire>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={data}
          pagination={{ showTotal: (t) => `共 ${t} 个`, showSizeChanger: false, defaultPageSize: 20 }}
          columns={[
            { title: '编码', dataIndex: 'code', width: 140 },
            { title: '名称', dataIndex: 'name', width: 150 },
            {
              title: '类型',
              dataIndex: 'builtin',
              width: 90,
              render: (b: boolean) => (b ? <Tag color="blue">内置</Tag> : <Tag>自定义</Tag>),
            },
            { title: '描述', dataIndex: 'description', ellipsis: true, render: (v: string | null) => v ?? '-' },
            {
              title: '权限',
              dataIndex: 'permissions',
              render: (perms: string[]) => (
                <Space size={[4, 4]} wrap>
                  {perms.length === 0 ? (
                    <Text type="secondary">无</Text>
                  ) : (
                    perms.map((p) => <Tag key={p}>{p}</Tag>)
                  )}
                </Space>
              ),
            },
            {
              title: '操作',
              width: 130,
              fixed: 'right',
              render: (_, r) =>
                canManage ? (
                  <Space size={4}>
                    <Button type="link" size="small" onClick={() => openEdit(r)}>
                      {r.builtin ? '查看/编辑' : '编辑'}
                    </Button>
                    {!r.builtin && (
                      <Popconfirm title="确认删除该自定义角色？" onConfirm={() => void onDelete(r)}>
                        <Button type="link" size="small" danger>
                          删除
                        </Button>
                      </Popconfirm>
                    )}
                  </Space>
                ) : (
                  <Button type="link" size="small" onClick={() => openEdit(r)}>
                    查看
                  </Button>
                ),
            },
          ]}
        />
      </Card>

      <Drawer
        title={editing ? (editing.builtin ? '查看 / 编辑内置角色' : '编辑角色') : '新建角色'}
        width={520}
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
        <Form<RoleForm> form={form} layout="vertical" initialValues={{ permissions: [] }}>
          <Form.Item name="code" label="角色编码" rules={[{ required: !editing, message: '请输入编码' }]}>
            <Input placeholder="如：workshop_manager" maxLength={32} disabled={!!editing} />
          </Form.Item>
          <Form.Item name="name" label="角色名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如：车间主任" maxLength={64} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} maxLength={255} placeholder="可选" />
          </Form.Item>
          <Form.Item name="permissions" label="权限" rules={[{ required: true, message: '至少选择一项权限' }]}>
            <Select
              mode="multiple"
              allowClear
              placeholder="选择权限（支持后续在角色上叠加通配）"
              optionFilterProp="label"
              options={PERMISSION_CATALOG.map((g) => ({
                label: g.group,
                options: g.options,
              }))}
            />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  )
}
