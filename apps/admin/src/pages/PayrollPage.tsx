import { useCallback, useEffect, useState } from 'react'
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
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd'
import { DollarOutlined } from '@ant-design/icons'
import { Dayjs } from 'dayjs'
import { api } from '../lib/api'
import { PERM } from '../lib/erp'
import { useAuthStore } from '../stores/auth.store'

const { Title, Text } = Typography
const { RangePicker } = DatePicker

interface UserWire {
  id: string
  username: string
  realName: string
}
interface ProfileWire {
  id: string
  userId: string
  username: string
  realName: string
  jobType: string
  baseWage: number
  unitPrice: number
  remark: string | null
}
interface SlipItemWire {
  id: string
  orderId: string
  orderNo: string
  machineId: string
  machineName: string
  outputM: number
  reportCount: number
  amount: number
}
interface SlipWire {
  id: string
  slipNo: string
  userId: string
  realName: string
  periodStart: string
  periodEnd: string
  totalOutputM: number
  reportCount: number
  stoppageMin: number
  baseAmount: number
  pieceAmount: number
  bonus: number
  deduction: number
  netAmount: number
  status: 'draft' | 'confirmed' | 'paid'
  paidAt: string | null
  remark: string | null
  items: SlipItemWire[]
}
interface PeriodRowWire {
  userId: string
  username: string
  realName: string
  reportCount: number
  totalOutputM: number
  stoppageMin: number
  hasProfile: boolean
  unitPrice: number
  estimatedAmount: number
  slipNo: string | null
}
interface OverviewWire {
  profileCount: number
  draftCount: number
  confirmedCount: number
  pendingAmount: number
  paidAmount: number
}

const SLIP_STATUS_LABEL: Record<string, string> = { draft: '草稿', confirmed: '已确认', paid: '已发放' }
const SLIP_STATUS_COLOR: Record<string, string> = { draft: 'blue', confirmed: 'gold', paid: 'green' }

const money = (n: number | null | undefined) => `¥${(n ?? 0).toFixed(2)}`
const meters = (n: number | null | undefined) => `${(n ?? 0).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} m`

/** 计件工资 */
export default function PayrollPage() {
  const { message } = AntdApp.useApp()
  const canWrite = useAuthStore((s) => s.hasPermission(PERM.COST_MANAGE))
  const [users, setUsers] = useState<UserWire[]>([])
  const [profiles, setProfiles] = useState<ProfileWire[]>([])
  const [slips, setSlips] = useState<SlipWire[]>([])
  const [overview, setOverview] = useState<OverviewWire | null>(null)
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [u, p, s, o] = await Promise.all([
        api.get<{ users: UserWire[] }>('/users'),
        api.get<ProfileWire[]>('/wages/profiles'),
        api.get<SlipWire[]>('/wages/slips'),
        api.get<OverviewWire>('/wages/overview'),
      ])
      setUsers(u.data.data.users ?? [])
      setProfiles(p.data.data)
      setSlips(s.data.data)
      setOverview(o.data.data)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载工资数据失败')
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => { void reload() }, [reload])

  const profiledUserIds = new Set(profiles.map((p) => p.userId))
  const userOptions = users
    .filter((u) => !profiledUserIds.has(u.id))
    .map((u) => ({ value: u.id, label: `${u.realName}（${u.username}）` }))

  return (
    <div style={{ padding: 16 }}>
      <Title level={3} style={{ marginTop: 0 }}>
        <DollarOutlined /> 计件工资
      </Title>

      <Space size={16} wrap style={{ marginBottom: 16 }}>
        <Card size="small" title="工资档案"><Text strong style={{ fontSize: 20 }}>{overview?.profileCount ?? 0}</Text></Card>
        <Card size="small" title="草稿单"><Text strong style={{ fontSize: 20 }}>{overview?.draftCount ?? 0}</Text></Card>
        <Card size="small" title="待确认" style={{ borderColor: (overview?.confirmedCount ?? 0) > 0 ? '#faad14' : undefined }}>
          <Text strong style={{ fontSize: 20, color: (overview?.confirmedCount ?? 0) > 0 ? '#faad14' : undefined }}>{overview?.confirmedCount ?? 0}</Text>
        </Card>
        <Card size="small" title="待发金额" style={{ borderColor: (overview?.pendingAmount ?? 0) > 0 ? '#faad14' : undefined }}>
          <Text strong style={{ fontSize: 20, color: (overview?.pendingAmount ?? 0) > 0 ? '#faad14' : undefined }}>{money(overview?.pendingAmount)}</Text>
        </Card>
        <Card size="small" title="已发金额"><Text strong style={{ fontSize: 20 }}>{money(overview?.paidAmount)}</Text></Card>
      </Space>

      <Tabs
        items={[
          { key: 'profiles', label: '工资档案', children: <ProfilesTab rows={profiles} userOptions={userOptions} canWrite={canWrite} loading={loading} onDone={reload} /> },
          { key: 'slips', label: '工资单', children: <SlipsTab rows={slips} canWrite={canWrite} loading={loading} onDone={reload} /> },
        ]}
      />
    </div>
  )
}

// ---------- 工资档案 ----------

function ProfilesTab({ rows, userOptions, canWrite, loading, onDone }: {
  rows: ProfileWire[]
  userOptions: { value: string; label: string }[]
  canWrite: boolean
  loading: boolean
  onDone: () => void
}) {
  const { message } = AntdApp.useApp()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<ProfileWire | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm()

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ jobType: '挡车工', baseWage: 0 })
    setOpen(true)
  }
  const openEdit = (p: ProfileWire) => {
    setEditing(p)
    form.setFieldsValue({ jobType: p.jobType, baseWage: p.baseWage, unitPrice: p.unitPrice, remark: p.remark })
    setOpen(true)
  }

  const submit = async () => {
    const values = await form.validateFields()
    setSubmitting(true)
    try {
      if (editing) {
        await api.put(`/wages/profiles/${editing.id}`, values)
        message.success('档案已更新，已生成的工资单不受影响')
      } else {
        await api.post('/wages/profiles', values)
        message.success('档案已创建')
      }
      setOpen(false)
      onDone()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        {canWrite && <Button type="primary" onClick={openCreate}>新建档案</Button>}
        <Text type="secondary">按登录账号建档，报工即计件依据；调价只影响之后生成的工资单</Text>
      </Space>
      <Table<ProfileWire>
        rowKey="id"
        loading={loading}
        dataSource={rows}
        columns={[
          { title: '姓名', dataIndex: 'realName', render: (v: string) => <Text strong>{v}</Text> },
          { title: '账号', dataIndex: 'username' },
          { title: '工种', dataIndex: 'jobType' },
          { title: '底薪/周期', dataIndex: 'baseWage', align: 'right', render: (v: number) => money(v) },
          { title: '计件单价/米', dataIndex: 'unitPrice', align: 'right', render: (v: number) => money(v) },
          { title: '备注', dataIndex: 'remark', render: (v: string | null) => v ?? '-' },
          {
            title: '操作',
            key: 'actions',
            width: 90,
            render: (_: unknown, r: ProfileWire) =>
              canWrite ? <Button size="small" onClick={() => openEdit(r)}>编辑</Button> : null,
          },
        ]}
      />
      <Modal
        open={open}
        title={editing ? `编辑档案 · ${editing.realName}` : '新建工资档案'}
        onOk={submit}
        confirmLoading={submitting}
        onCancel={() => setOpen(false)}
        okText="保存"
      >
        <Form form={form} layout="vertical" preserve autoComplete="off">
          {!editing && (
            <Form.Item name="userId" label="选择账号" rules={[{ required: true, message: '请选择账号' }]}>
              <Select showSearch optionFilterProp="label" options={userOptions} placeholder="只列未有档案的账号" />
            </Form.Item>
          )}
          <Form.Item name="jobType" label="工种">
            <Input maxLength={32} placeholder="挡车工" />
          </Form.Item>
          <Form.Item name="baseWage" label="底薪 / 固定补贴（元/周期）" tooltip="无底薪填 0；工资单生成时按此快照">
            <InputNumber min={0} precision={2} style={{ width: '100%' }} addonAfter="元" />
          </Form.Item>
          <Form.Item name="unitPrice" label="计件单价（元/米）" rules={[{ required: true, message: '单价必填' }]} tooltip="必须大于 0；金额=产出米数×单价，服务端计算">
            <InputNumber min={0} precision={4} style={{ width: '100%' }} addonAfter="元/米" />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input maxLength={255} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

// ---------- 工资单 ----------

function SlipsTab({ rows, canWrite, loading, onDone }: {
  rows: SlipWire[]
  canWrite: boolean
  loading: boolean
  onDone: () => void
}) {
  const { message } = AntdApp.useApp()
  const [genOpen, setGenOpen] = useState(false)
  const [detail, setDetail] = useState<SlipWire | null>(null)
  const [adjusting, setAdjusting] = useState<SlipWire | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm()

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setSubmitting(true)
    try {
      await fn()
      message.success(ok)
      onDone()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '操作失败')
    } finally {
      setSubmitting(false)
    }
  }

  const openAdjust = (s: SlipWire) => {
    setAdjusting(s)
    form.setFieldsValue({ bonus: s.bonus, deduction: s.deduction })
  }

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        {canWrite && <Button type="primary" onClick={() => setGenOpen(true)}>生成工资单</Button>}
        <Text type="secondary">按结算周期批量生成；无档案的人跳过，重复周期幂等保护</Text>
      </Space>
      <Table<SlipWire>
        rowKey="id"
        loading={loading}
        dataSource={rows}
        columns={[
          { title: '单号', dataIndex: 'slipNo', render: (v: string) => <Text strong>{v}</Text> },
          { title: '姓名', dataIndex: 'realName' },
          {
            title: '周期',
            key: 'period',
            render: (_: unknown, r: SlipWire) => `${r.periodStart} ~ ${r.periodEnd}`,
          },
          { title: '产出', dataIndex: 'totalOutputM', align: 'right', render: (v: number) => meters(v) },
          { title: '计件额', dataIndex: 'pieceAmount', align: 'right', render: (v: number) => money(v) },
          { title: '实发', key: 'net', align: 'right', render: (_: unknown, r: SlipWire) => <Text strong>{money(r.netAmount)}</Text> },
          {
            title: '状态',
            dataIndex: 'status',
            render: (v: string) => <Tag color={SLIP_STATUS_COLOR[v]}>{SLIP_STATUS_LABEL[v]}</Tag>,
          },
          {
            title: '操作',
            key: 'actions',
            width: 220,
            render: (_: unknown, r: SlipWire) => (
              <Space size={4} wrap>
                <Button size="small" onClick={() => setDetail(r)}>明细</Button>
                {canWrite && r.status === 'draft' && (
                  <>
                    <Button size="small" onClick={() => openAdjust(r)}>奖扣</Button>
                    <Popconfirm title="确认后金额锁定，不可再改" onConfirm={() => void act(() => api.post(`/wages/slips/${r.id}/confirm`), '已确认')} okText="确认">
                      <Button size="small" loading={submitting}>确认</Button>
                    </Popconfirm>
                    <Popconfirm title="删除后需重新生成，确定删除草稿单？" onConfirm={() => void act(() => api.delete(`/wages/slips/${r.id}`), '已删除')} okText="删除">
                      <Button size="small" danger loading={submitting}>删除</Button>
                    </Popconfirm>
                  </>
                )}
                {canWrite && r.status === 'confirmed' && (
                  <Popconfirm title="发放后不可回退，确认已发放？" onConfirm={() => void act(() => api.post(`/wages/slips/${r.id}/pay`), '已标记发放')} okText="发放">
                    <Button size="small" type="primary" loading={submitting}>发放</Button>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ]}
      />

      <GenerateModal open={genOpen} onClose={() => setGenOpen(false)} onDone={onDone} />
      <SlipDetail slip={detail} onClose={() => setDetail(null)} />
      <Modal
        open={Boolean(adjusting)}
        title="修改奖金 / 扣款"
        confirmLoading={submitting}
        onOk={async () => {
          if (!adjusting) return
          const values = await form.validateFields()
          await act(() => api.put(`/wages/slips/${adjusting.id}`, values), '已更新')
          setAdjusting(null)
        }}
        onCancel={() => setAdjusting(null)}
        okText="保存"
      >
        <Form form={form} layout="vertical" preserve>
          <Form.Item name="bonus" label="奖金（元）" tooltip="实发 = 底薪 + 计件 + 奖金 − 扣款">
            <InputNumber min={0} precision={2} style={{ width: '100%' }} addonAfter="元" />
          </Form.Item>
          <Form.Item name="deduction" label="扣款（元）" tooltip="停机扣款等规则各厂不同，一律显式给，不按停机分钟自动扣">
            <InputNumber min={0} precision={2} style={{ width: '100%' }} addonAfter="元" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

function GenerateModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { message } = AntdApp.useApp()
  const [period, setPeriod] = useState<[Dayjs, Dayjs] | null>(null)
  const [rows, setRows] = useState<PeriodRowWire[] | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const doPreview = async () => {
    if (!period) {
      message.warning('请先选择结算周期')
      return
    }
    setPreviewing(true)
    try {
      const res = await api.get<PeriodRowWire[]>('/wages/payroll/preview', {
        params: { periodStart: period[0].format('YYYY-MM-DD'), periodEnd: period[1].format('YYYY-MM-DD') },
      })
      setRows(res.data.data)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '预览失败')
    } finally {
      setPreviewing(false)
    }
  }

  const doGenerate = async () => {
    if (!period) {
      message.warning('请先选择结算周期')
      return
    }
    setSubmitting(true)
    try {
      const res = await api.post<{ created: SlipWire[]; skipped: { userId: string; realName: string; reason: string }[] }>(
        '/wages/slips',
        { periodStart: period[0].format('YYYY-MM-DD'), periodEnd: period[1].format('YYYY-MM-DD') },
      )
      const { created, skipped } = res.data.data
      message.success(`已生成 ${created.length} 张工资单${skipped.length ? `，跳过 ${skipped.length} 人` : ''}`)
      setPeriod(null)
      setRows(null)
      onDone()
      onClose()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '生成失败')
    } finally {
      setSubmitting(false)
    }
  }

  const newableCount = rows?.filter((r) => r.hasProfile && !r.slipNo).length ?? 0

  return (
    <Modal
      open={open}
      title="生成工资单"
      width={720}
      onCancel={onClose}
      onOk={doGenerate}
      confirmLoading={submitting}
      okText={`生成 ${newableCount > 0 ? `（${newableCount} 张）` : ''}`}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Space wrap>
          <RangePicker
            value={period}
            onChange={(v) => { setPeriod(v as [Dayjs, Dayjs] | null); setRows(null) }}
            allowClear
          />
          <Button onClick={() => void doPreview()} loading={previewing}>预览本期计件</Button>
          <Text type="secondary">跨度不能超过 62 天</Text>
        </Space>
        {rows && rows.length === 0 && <Text type="secondary">该周期内没有报工记录</Text>}
        {rows && rows.length > 0 && (
          <Table<PeriodRowWire>
            rowKey="userId"
            size="small"
            pagination={false}
            dataSource={rows}
            columns={[
              { title: '姓名', dataIndex: 'realName', render: (v: string) => <Text strong>{v}</Text> },
              { title: '账号', dataIndex: 'username' },
              { title: '报工次数', dataIndex: 'reportCount', align: 'right' },
              { title: '产出', dataIndex: 'totalOutputM', align: 'right', render: (v: number) => meters(v) },
              { title: '停机(分)', dataIndex: 'stoppageMin', align: 'right' },
              {
                title: '预估金额',
                key: 'est',
                align: 'right',
                render: (_: unknown, r: PeriodRowWire) => r.hasProfile ? <Text strong>{money(r.estimatedAmount)}</Text> : <Text type="secondary">-</Text>,
              },
              {
                title: '状态',
                key: 'st',
                render: (_: unknown, r: PeriodRowWire) =>
                  r.slipNo ? <Tag color="blue">已有 {r.slipNo}</Tag>
                    : r.hasProfile ? <Tag color="green">可生成</Tag>
                      : <Tag color="orange">缺工资档案</Tag>,
              },
            ]}
          />
        )}
      </Space>
    </Modal>
  )
}

function SlipDetail({ slip, onClose }: { slip: SlipWire | null; onClose: () => void }) {
  return (
    <Drawer open={Boolean(slip)} onClose={onClose} width={640} title={slip ? `工资单 · ${slip.slipNo}` : ''}>
      {slip && (
        <>
          <Descriptions column={2} size="small" bordered style={{ marginBottom: 16 }}>
            <Descriptions.Item label="姓名">{slip.realName}</Descriptions.Item>
            <Descriptions.Item label="周期">{slip.periodStart} ~ {slip.periodEnd}</Descriptions.Item>
            <Descriptions.Item label="产出合计">{meters(slip.totalOutputM)}</Descriptions.Item>
            <Descriptions.Item label="报工次数">{slip.reportCount} 次</Descriptions.Item>
            <Descriptions.Item label="停机合计">{slip.stoppageMin} 分钟（不自动扣款）</Descriptions.Item>
            <Descriptions.Item label="状态">{SLIP_STATUS_LABEL[slip.status]}</Descriptions.Item>
            <Descriptions.Item label="底薪">{money(slip.baseAmount)}</Descriptions.Item>
            <Descriptions.Item label="计件额">{money(slip.pieceAmount)}</Descriptions.Item>
            <Descriptions.Item label="奖金">{money(slip.bonus)}</Descriptions.Item>
            <Descriptions.Item label="扣款">{money(slip.deduction)}</Descriptions.Item>
            <Descriptions.Item label="实发" span={2}><Text strong style={{ fontSize: 16 }}>{money(slip.netAmount)}</Text></Descriptions.Item>
            {slip.paidAt && <Descriptions.Item label="发放时间" span={2}>{slip.paidAt}</Descriptions.Item>}
          </Descriptions>
          <Text strong>计件明细（按工单聚合）</Text>
          <Table<SlipItemWire>
            rowKey="id"
            size="small"
            style={{ marginTop: 8 }}
            dataSource={slip.items}
            pagination={false}
            summary={(pageData) => (
              <Table.Summary fixed>
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={2}>合计</Table.Summary.Cell>
                  <Table.Summary.Cell index={2} align="right">{pageData.reduce((s, i) => s + (i.reportCount ?? 0), 0)} 次</Table.Summary.Cell>
                  <Table.Summary.Cell index={3} align="right">{meters(pageData.reduce((s, i) => s + (i.outputM ?? 0), 0))}</Table.Summary.Cell>
                  <Table.Summary.Cell index={4} align="right">{money(pageData.reduce((s, i) => s + (i.amount ?? 0), 0))}</Table.Summary.Cell>
                </Table.Summary.Row>
              </Table.Summary>
            )}
            columns={[
              { title: '工单', dataIndex: 'orderNo' },
              { title: '机台', dataIndex: 'machineName' },
              { title: '次数', dataIndex: 'reportCount', align: 'right' },
              { title: '产出', dataIndex: 'outputM', align: 'right', render: (v: number) => meters(v) },
              { title: '金额', dataIndex: 'amount', align: 'right', render: (v: number) => money(v) },
            ]}
          />
        </>
      )}
    </Drawer>
  )
}
