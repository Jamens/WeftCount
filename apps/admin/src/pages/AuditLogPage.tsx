import { useCallback, useEffect, useState } from 'react'
import {
  Button,
  Card,
  Col,
  DatePicker,
  Input,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Drawer,
  Descriptions,
  Empty,
} from 'antd'
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { api } from '../lib/api'
import type { AuditActionType } from '@weftcount/shared'

const { Title, Text, Paragraph } = Typography
const { RangePicker } = DatePicker

interface AuditRecord {
  id: string
  username: string
  realName: string
  action: AuditActionType
  module: string
  summary: string | null
  targetType: string | null
  targetId: string | null
  httpMethod: string
  path: string
  ip: string | null
  userAgent: string | null
  diff: Record<string, { before: unknown; after: unknown }> | null
  durationMs: number | null
  createdAt: string
}

interface AuditPage {
  records: AuditRecord[]
  total: number
  page: number
  pageSize: number
}

const ACTION_LABELS: Record<AuditActionType, { text: string; color: string }> = {
  create: { text: '新建', color: 'green' },
  update: { text: '修改', color: 'blue' },
  delete: { text: '删除', color: 'red' },
  submit: { text: '提交', color: 'cyan' },
  approve: { text: '审核通过', color: 'green' },
  reject: { text: '审核驳回', color: 'orange' },
  cancel: { text: '作废', color: 'default' },
  login: { text: '登录', color: 'purple' },
  logout: { text: '登出', color: 'default' },
  export: { text: '导出', color: 'geekblue' },
  print: { text: '打印', color: 'cyan' },
  ai_call: { text: 'AI 调用', color: 'magenta' },
}

export default function AuditLogPage() {
  const [data, setData] = useState<AuditPage>({ records: [], total: 0, page: 1, pageSize: 20 })
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [module, setModule] = useState<string | undefined>()
  const [action, setAction] = useState<AuditActionType | undefined>()
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null)
  const [detail, setDetail] = useState<AuditRecord | null>(null)

  const load = useCallback(
    async (page = 1) => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: '20' })
        if (keyword) params.set('keyword', keyword)
        if (module) params.set('module', module)
        if (action) params.set('action', action)
        if (range) {
          params.set('from', range[0].format('YYYY-MM-DD'))
          params.set('to', range[1].format('YYYY-MM-DD'))
        }
        const res = await api.get<AuditPage>(`/audit-logs?${params.toString()}`)
        setData(res.data.data)
      } finally {
        setLoading(false)
      }
    },
    [keyword, module, action, range],
  )

  useEffect(() => {
    void load(1)
    // 首次挂载按默认条件拉一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div>
      <Row align="middle" justify="space-between" style={{ marginBottom: 16 }}>
        <Col>
          <Title level={4} style={{ margin: 0 }}>
            审计日志
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            记录所有写操作，可按操作人、模块、动作、时间筛选
          </Text>
        </Col>
        <Col>
          <Button icon={<ReloadOutlined />} onClick={() => void load(data.page)}>
            刷新
          </Button>
        </Col>
      </Row>

      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap>
          <Input
            placeholder="操作人 / 摘要"
            allowClear
            style={{ width: 200 }}
            prefix={<SearchOutlined />}
            onChange={(e) => setKeyword(e.target.value)}
            onPressEnter={() => void load(1)}
          />
          <Select
            allowClear
            placeholder="模块"
            style={{ width: 140 }}
            value={module}
            onChange={setModule}
            options={[
              { value: 'auth', label: 'auth 认证' },
              { value: 'purchase', label: 'purchase 采购' },
              { value: 'sales', label: 'sales 销售' },
              { value: 'inventory', label: 'inventory 库存' },
              { value: 'production', label: 'production 生产' },
            ]}
          />
          <Select
            allowClear
            placeholder="动作"
            style={{ width: 130 }}
            value={action}
            onChange={setAction}
            options={(Object.keys(ACTION_LABELS) as AuditActionType[]).map((k) => ({
              value: k,
              label: ACTION_LABELS[k].text,
            }))}
          />
          <RangePicker
            value={range as never}
            onChange={(v) => setRange(v as [Dayjs, Dayjs] | null)}
            presets={[
              { label: '今天', value: [dayjs().startOf('d'), dayjs().endOf('d')] },
              { label: '近 7 天', value: [dayjs().subtract(6, 'd'), dayjs()] },
              { label: '近 30 天', value: [dayjs().subtract(29, 'd'), dayjs()] },
            ]}
          />
          <Button type="primary" onClick={() => void load(1)}>
            查询
          </Button>
        </Space>
      </Card>

      <Card size="small">
        <Table<AuditRecord>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={data.records}
          pagination={{
            current: data.page,
            pageSize: data.pageSize,
            total: data.total,
            showSizeChanger: false,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p) => void load(p),
          }}
          onRow={(r) => ({ onClick: () => setDetail(r), style: { cursor: 'pointer' } })}
          columns={[
            {
              title: '时间',
              dataIndex: 'createdAt',
              width: 160,
              render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm:ss'),
            },
            {
              title: '操作人',
              width: 130,
              render: (_, r) => (
                <Space size={4}>
                  <Text>{r.realName}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {r.username}
                  </Text>
                </Space>
              ),
            },
            {
              title: '动作',
              dataIndex: 'action',
              width: 90,
              render: (v: AuditActionType) => (
                <Tag color={ACTION_LABELS[v]?.color ?? 'default'}>{ACTION_LABELS[v]?.text ?? v}</Tag>
              ),
            },
            { title: '模块', dataIndex: 'module', width: 120 },
            {
              title: '摘要',
              dataIndex: 'summary',
              ellipsis: true,
              render: (v: string | null) => v ?? '-',
            },
            {
              title: '耗时',
              dataIndex: 'durationMs',
              width: 80,
              align: 'right',
              render: (v: number | null) => (v == null ? '-' : `${v}ms`),
            },
          ]}
        />
      </Card>

      <Drawer
        title="审计详情"
        width={720}
        open={detail !== null}
        onClose={() => setDetail(null)}
      >
        {detail && (
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="操作人">
                {detail.realName}（{detail.username}）
              </Descriptions.Item>
              <Descriptions.Item label="时间">
                {dayjs(detail.createdAt).format('YYYY-MM-DD HH:mm:ss')}
              </Descriptions.Item>
              <Descriptions.Item label="动作">
                <Tag color={ACTION_LABELS[detail.action]?.color ?? 'default'}>
                  {ACTION_LABELS[detail.action]?.text ?? detail.action}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="模块">{detail.module}</Descriptions.Item>
              <Descriptions.Item label="请求">{detail.httpMethod}</Descriptions.Item>
              <Descriptions.Item label="路径">
                <Text code style={{ fontSize: 12 }}>
                  {detail.path}
                </Text>
              </Descriptions.Item>
              <Descriptions.Item label="IP">{detail.ip ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="耗时">
                {detail.durationMs == null ? '-' : `${detail.durationMs}ms`}
              </Descriptions.Item>
              {detail.targetId && (
                <Descriptions.Item label="操作对象">
                  {detail.targetType} #{detail.targetId}
                </Descriptions.Item>
              )}
            </Descriptions>

            {detail.diff && Object.keys(detail.diff).length > 0 ? (
              <Card size="small" title="变更明细">
                <Table
                  rowKey="field"
                  size="small"
                  pagination={false}
                  dataSource={Object.entries(detail.diff).map(([field, v]) => ({
                    field,
                    before: JSON.stringify(v.before),
                    after: JSON.stringify(v.after),
                  }))}
                  columns={[
                    { title: '字段', dataIndex: 'field', width: 140 },
                    {
                      title: '变更前',
                      dataIndex: 'before',
                      render: (v: string) => (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {v}
                        </Text>
                      ),
                    },
                    {
                      title: '变更后',
                      dataIndex: 'after',
                      render: (v: string) => (
                        <Text style={{ fontSize: 12 }}>{v}</Text>
                      ),
                    },
                  ]}
                />
              </Card>
            ) : (
              <Empty description="无字段级变更记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}

            <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
              审计日志只增不改不删。密码、令牌类字段在写入前已脱敏。
            </Paragraph>
          </Space>
        )}
      </Drawer>
    </div>
  )
}
