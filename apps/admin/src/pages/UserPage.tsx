import { useCallback, useEffect, useState } from 'react'
import {
  App as AntdApp,
  Alert,
  Button,
  Card,
  Drawer,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { api } from '../lib/api'
import {
  PERM,
  WORKSHOP_VIEW_LABEL,
  USER_STATUS_LABEL,
  type CompanyOption,
  type RoleWire,
  type UserStatusValue,
  type UserWire,
  LIST_TABLE_SCROLL_Y,
} from '../lib/erp'
import { useAuthStore } from '../stores/auth.store'

const { Title, Text } = Typography

interface UserForm {
  username?: string
  realName: string
  password?: string
  phone?: string
  email?: string
  companyIds: string[]
  roleCodes: string[]
  status?: UserStatusValue
}

export default function UserPage() {
  const { message } = AntdApp.useApp()
  const canManage = useAuthStore((s) => s.hasPermission(PERM.USER_MANAGE))

  const [users, setUsers] = useState<UserWire[]>([])
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [roles, setRoles] = useState<RoleWire[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<UserWire | null>(null)
  // 账号有效权限（多角色并集）
  const [permUser, setPermUser] = useState<UserWire | null>(null)
  const [permData, setPermData] = useState<{ roles: { code: string; name: string; permissions: string[] }[]; effective: string[]; workshopViews: string[] } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm<UserForm>()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [uRes, rRes] = await Promise.all([
        api.get<{ users: UserWire[]; companies: CompanyOption[] }>('/users'),
        api.get<RoleWire[]>('/roles'),
      ])
      setUsers(uRes.data.data.users)
      setCompanies(uRes.data.data.companies)
      setRoles(rRes.data.data)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载用户失败')
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
    form.setFieldsValue({ companyIds: [], roleCodes: [], status: 'active' })
    setOpen(true)
  }

  const openPermissions = async (u: UserWire) => {
    setPermUser(u)
    setPermData(null)
    try {
      const res = await api.get<{ roles: { code: string; name: string; permissions: string[] }[]; effective: string[]; workshopViews: string[] }>(
        `/users/${u.id}/permissions`
      )
      setPermData(res.data.data)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载账号权限失败')
    }
  }

  const openEdit = (u: UserWire) => {
    setEditing(u)
    form.setFieldsValue({
      username: u.username,
      realName: u.realName,
      password: undefined,
      phone: u.phone ?? undefined,
      email: u.email ?? undefined,
      companyIds: u.companyIds,
      roleCodes: u.roleCodes,
      status: u.status,
    })
    setOpen(true)
  }

  const onSubmit = async () => {
    const values = await form.validateFields()
    setSubmitting(true)
    try {
      const payload: Record<string, unknown> = {
        realName: values.realName,
        phone: values.phone ?? null,
        email: values.email ?? null,
        companyIds: values.companyIds,
        roleCodes: values.roleCodes,
      }
      if (values.password) payload.password = values.password
      if (editing) {
        if (values.status) payload.status = values.status
        await api.patch(`/users/${editing.id}`, payload)
        message.success('用户已更新')
      } else {
        await api.post('/users', { ...payload, username: values.username, password: values.password })
        message.success('用户已创建')
      }
      setOpen(false)
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  const onToggleStatus = async (u: UserWire) => {
    const next: UserStatusValue = u.status === 'active' ? 'disabled' : 'active'
    try {
      await api.patch(`/users/${u.id}`, { status: next })
      message.success(next === 'active' ? '已启用' : '已停用')
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '操作失败')
    }
  }

  const companyOptions = companies.map((c) => ({ value: c.id, label: `${c.name}（${c.code}）` }))
  const roleOptions = roles.map((r) => ({ value: r.code, label: `${r.name}（${r.code}）` }))

  return (
    <div>
      <Space align="center" style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            用户管理
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            创建账号、分配公司与角色、重置密码
          </Text>
        </div>
        <Space>
          {canManage && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新建用户
            </Button>
          )}
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>
            刷新
          </Button>
        </Space>
      </Space>

      <Card size="small">
        <Table<UserWire>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={users}
          scroll={{ y: LIST_TABLE_SCROLL_Y }}
          pagination={{ showTotal: (t) => `共 ${t} 人`, showSizeChanger: false, defaultPageSize: 20 }}
          columns={[
            { title: '账号', dataIndex: 'username', width: 120 },
            { title: '姓名', dataIndex: 'realName', width: 110 },
            { title: '电话', dataIndex: 'phone', width: 130, render: (v: string | null) => v ?? '-' },
            { title: '邮箱', dataIndex: 'email', ellipsis: true, render: (v: string | null) => v ?? '-' },
            {
              title: '所属公司',
              dataIndex: 'companyNames',
              render: (names: string[]) =>
                names.length ? <Space size={[2, 2]} wrap>{names.map((n) => <Tag key={n}>{n}</Tag>)}</Space> : '-',
            },
            {
              title: '角色',
              dataIndex: 'roleNames',
              render: (names: string[]) =>
                names.length ? <Space size={[2, 2]} wrap>{names.map((n) => <Tag color="blue" key={n}>{n}</Tag>)}</Space> : '-',
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 80,
              render: (v: UserStatusValue) => {
                const s = USER_STATUS_LABEL[v]
                return s ? <Tag color={s.color}>{s.text}</Tag> : v
              },
            },
            {
              title: '操作',
              width: 200,
              fixed: 'right',
              render: (_, u) =>
                canManage ? (
                  <Space size={4}>
                    <Button type="link" size="small" onClick={() => void openPermissions(u)}>
                      权限
                    </Button>
                    <Button type="link" size="small" onClick={() => openEdit(u)}>
                      编辑
                    </Button>
                    <Popconfirm
                      title={u.status === 'active' ? '确认停用该用户？' : '确认启用该用户？'}
                      onConfirm={() => void onToggleStatus(u)}
                    >
                      <Button type="link" size="small" danger={u.status === 'active'}>
                        {u.status === 'active' ? '停用' : '启用'}
                      </Button>
                    </Popconfirm>
                  </Space>
                ) : (
                  <Button type="link" size="small" onClick={() => void openPermissions(u)}>
                    权限
                  </Button>
                ),
            },
          ]}
        />
      </Card>

      <Drawer
        title={editing ? '编辑用户' : '新建用户'}
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
        <Form<UserForm> form={form} layout="vertical" initialValues={{ companyIds: [], roleCodes: [] }}>
          <Form.Item name="username" label="登录账号" rules={[{ required: !editing, message: '请输入账号' }]}>
            <Input placeholder="如：zhangsan" maxLength={64} disabled={!!editing} />
          </Form.Item>
          <Form.Item name="realName" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input placeholder="如：张三" maxLength={64} />
          </Form.Item>
          <Form.Item
            name="password"
            label={editing ? '重置密码（留空则不修改）' : '初始密码'}
            rules={[
              {
                validator: (_rule, val: string | undefined) => {
                  if (!val) return Promise.resolve()
                  if (val.length < 8) return Promise.reject(new Error('密码至少 8 位'))
                  if (!/[a-zA-Z]/.test(val) || !/[0-9]/.test(val)) {
                    return Promise.reject(new Error('密码须同时包含字母和数字'))
                  }
                  return Promise.resolve()
                },
              },
            ]}
          >
            <Input.Password placeholder={editing ? '留空则不修改' : '至少 8 位，字母+数字'} />
          </Form.Item>
          <Form.Item name="phone" label="电话">
            <Input placeholder="可选" maxLength={32} />
          </Form.Item>
          <Form.Item name="email" label="邮箱">
            <Input placeholder="可选" maxLength={128} />
          </Form.Item>
          <Form.Item name="companyIds" label="所属公司" rules={[{ required: true, message: '至少选择一个公司' }]}>
            <Select mode="multiple" allowClear placeholder="选择公司" options={companyOptions} />
          </Form.Item>
          <Form.Item name="roleCodes" label="角色" rules={[{ required: true, message: '至少分配一个角色' }]}>
            <Select mode="multiple" allowClear placeholder="选择角色" options={roleOptions} />
          </Form.Item>
          {editing && (
            <Form.Item name="status" label="状态">
              <Select
                options={[
                  { value: 'active', label: '启用' },
                  { value: 'disabled', label: '停用' },
                  { value: 'locked', label: '锁定' },
                ]}
              />
            </Form.Item>
          )}
        </Form>
      </Drawer>

      <Modal
        open={permUser !== null}
        onCancel={() => setPermUser(null)}
        footer={null}
        width={720}
        title={permUser ? `账号有效权限 · ${permUser.realName || permUser.username}` : ''}
      >
        {!permData ? (
          <div style={{ padding: 24, textAlign: 'center' }}>
            <Spin />
          </div>
        ) : (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Alert
              type="info"
              showIcon
              message={`共 ${permData.effective.length} 项有效权限（由 ${permData.roles.length} 个角色的权限取并集）`}
              description="账号可挂多个角色，实际权限是各角色权限的并集。调整权限请到「角色管理」改角色。"
            />
            <div>
              <Text strong>车间工作台可见页面</Text>
              <div style={{ marginTop: 6 }}>
                {permData.workshopViews.length ? (
                  <Space size={[4, 4]} wrap>
                    {permData.workshopViews.map((v) => (
                      <Tag color="blue" key={v}>{WORKSHOP_VIEW_LABEL[v] ?? v}</Tag>
                    ))}
                  </Space>
                ) : (
                  <Text type="secondary">无（该账号看不到任何车间页面）</Text>
                )}
              </div>
            </div>
            <div>
              <Text strong>角色来源</Text>
              <Space direction="vertical" size={6} style={{ width: '100%', marginTop: 6 }}>
                {permData.roles.map((r) => (
                  <div key={r.code}>
                    <Tag color="blue">{r.name}</Tag>
                    <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                      {r.permissions.join('、') || '（无权限）'}
                    </Text>
                  </div>
                ))}
              </Space>
            </div>
            <div>
              <Text strong>有效权限明细（{permData.effective.length}）</Text>
              <div style={{ marginTop: 6, maxHeight: 200, overflow: 'auto' }}>
                <Space size={[4, 4]} wrap>
                  {permData.effective.map((p) => (
                    <Tag key={p}>{p}</Tag>
                  ))}
                </Space>
              </div>
            </div>
          </Space>
        )}
      </Modal>
    </div>
  )
}
