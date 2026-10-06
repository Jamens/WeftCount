import { useCallback, useEffect, useState } from 'react'
import {
  App as AntdApp,
  Button,
  Card,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
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
  STOCKTAKE_STATUS_LABEL,
  fmt,
  type StocktakeItemView,
  type StocktakeStatusValue,
  type StocktakeWire,
  type WarehouseWire,
  LIST_TABLE_SCROLL_Y,
} from '../lib/erp'
import { useAuthStore } from '../stores/auth.store'

const { Title, Text } = Typography

interface CreateForm {
  warehouseId?: string
  mode?: 'batch' | 'roll'
  remark?: string
}

export default function StocktakePage() {
  const { message } = AntdApp.useApp()
  const canManage = useAuthStore((s) => s.hasPermission(PERM.INVENTORY_MANAGE))

  const [data, setData] = useState<StocktakeWire[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseWire[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  // 详情：单 + 明细（可录实盘数）
  const [detail, setDetail] = useState<{ stocktake: StocktakeWire; items: StocktakeItemView[] } | null>(null)
  // 录入中的实盘数 itemId -> 值
  const [counts, setCounts] = useState<Record<string, number | undefined>>({})
  const [form] = Form.useForm<CreateForm>()

  const warehouseName = (id: string) => warehouses.find((w) => w.id === id)?.name ?? id

  useEffect(() => {
    api
      .get<WarehouseWire[]>('/warehouses?status=active')
      .then((res) => setWarehouses(res.data.data))
      .catch(() => setWarehouses([]))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<StocktakeWire[]>('/stocktakes')
      setData(res.data.data)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载盘点单失败')
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    void load()
  }, [load])

  const onCreate = async () => {
    const v = await form.validateFields()
    setSubmitting(true)
    try {
      await api.post('/stocktakes', { warehouseId: v.warehouseId, remark: v.remark ?? null, mode: v.mode ?? 'batch' })
      message.success('盘点单已创建（已快照账面量）')
      setOpen(false)
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '创建失败')
    } finally {
      setSubmitting(false)
    }
  }

  const openDetail = async (id: string) => {
    try {
      const res = await api.get<{ stocktake: StocktakeWire; items: StocktakeItemView[] }>(`/stocktakes/${id}`)
      setDetail(res.data.data)
      // 预填已有实盘数
      const init: Record<string, number | undefined> = {}
      for (const it of res.data.data.items) init[it.id] = it.countedQuantityM ?? undefined
      setCounts(init)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载详情失败')
    }
  }

  const saveCounts = async () => {
    if (!detail) return
    const records = Object.entries(counts)
      .filter(([, v]) => v != null)
      .map(([itemId, v]) => ({ itemId, countedQuantityM: v as number }))
    try {
      await api.post(`/stocktakes/${detail.stocktake.id}/counts`, { records })
      message.success('实盘数已保存')
      await openDetail(detail.stocktake.id)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    }
  }

  const doComplete = async () => {
    if (!detail) return
    // 先保存已录的数，再过账
    const records = Object.entries(counts)
      .filter(([, v]) => v != null)
      .map(([itemId, v]) => ({ itemId, countedQuantityM: v as number }))
    try {
      if (records.length > 0) await api.post(`/stocktakes/${detail.stocktake.id}/counts`, { records })
      await api.post(`/stocktakes/${detail.stocktake.id}/complete`)
      message.success('盘点已过账，差异已调整批次与流水')
      setDetail(null)
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '过账失败')
    }
  }

  const doCancel = async (id: string) => {
    try {
      await api.post(`/stocktakes/${id}/cancel`)
      message.success('已取消')
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '取消失败')
    }
  }

  const statusTag = (s: StocktakeStatusValue) => {
    const m = STOCKTAKE_STATUS_LABEL[s]
    return m ? <Tag color={m.color}>{m.text}</Tag> : s
  }

  // 明细差异单元格
  const diffCell = (it: StocktakeItemView) => {
    const counted = counts[it.id] ?? it.countedQuantityM
    if (counted == null) return <Text type="secondary">未录</Text>
    const diff = counted - it.bookQuantityM
    if (Math.abs(diff) < 0.005) return <Tag color="green">账实相符</Tag>
    return diff > 0 ? (
      <Tag color="orange">盘盈 {fmt(diff, 2)}m</Tag>
    ) : (
      <Tag color="red">盘亏 {fmt(-diff, 2)}m</Tag>
    )
  }

  return (
    <div>
      <Space align="center" style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            库存盘点
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            建单冻结仓内批次账面量，录实盘数，完成过账：盘盈/盘亏自动调批次剩余并记流水
          </Text>
        </div>
        <Space>
          {canManage && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
              建盘点单
            </Button>
          )}
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>
            刷新
          </Button>
        </Space>
      </Space>

      <Card size="small">
        <Table<StocktakeWire>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={data}
          onRow={(r) => ({ onClick: () => void openDetail(r.id) })}
          scroll={{ y: LIST_TABLE_SCROLL_Y }}
          pagination={{ showTotal: (t) => `共 ${t} 单`, showSizeChanger: false }}
          columns={[
            { title: '盘点单号', dataIndex: 'stocktakeNo', width: 150 },
            { title: '仓库', dataIndex: 'warehouseId', width: 120, render: (v: string) => warehouseName(v) },
            { title: '盘点日期', dataIndex: 'stocktakeDate', width: 110 },
            { title: '状态', dataIndex: 'status', width: 90, render: (v: StocktakeStatusValue) => statusTag(v) },
            { title: '备注', dataIndex: 'remark', ellipsis: true, render: (v: string | null) => v ?? '-' },
            {
              title: '操作',
              width: 130,
              fixed: 'right',
              render: (_, r) => (
                <Space size={2} onClick={(e) => e.stopPropagation()}>
                  <Button type="link" size="small" onClick={() => void openDetail(r.id)}>
                    {r.status === 'draft' ? '盘点' : '查看'}
                  </Button>
                  {canManage && r.status === 'draft' && (
                    <Popconfirm title="确认取消该盘点单？" onConfirm={() => void doCancel(r.id)}>
                      <Button type="link" size="small" danger>
                        取消
                      </Button>
                    </Popconfirm>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Card>

      {/* 建盘点单 */}
      <Modal title="建盘点单" open={open} onCancel={() => setOpen(false)} onOk={() => void onCreate()} confirmLoading={submitting} okText="创建" destroyOnClose>
        <Form<CreateForm> form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="warehouseId" label="盘点仓库" rules={[{ required: true, message: '请选择仓库' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="选择要盘点的仓库"
              options={warehouses.map((w) => ({ value: w.id, label: `${w.name}（${w.code}）` }))}
            />
          </Form.Item>
          <Form.Item name="mode" label="盘点粒度" initialValue="batch">
            <Radio.Group>
              <Radio.Button value="batch">按批次（按米数核销）</Radio.Button>
              <Radio.Button value="roll">按件卡（逐匹核销）</Radio.Button>
            </Radio.Group>
            <div style={{ marginTop: 6 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                拆匹发货后同批次混着已发过的匹与在库残匹，
                <b>按件卡</b>能定位到「缺哪一匹」；按批次只记总米数差异。
              </Text>
            </div>
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} maxLength={255} placeholder="如 月度盘点" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 盘点详情 / 录数 */}
      <Drawer
        title={detail ? `盘点 · ${detail.stocktake.stocktakeNo}` : '盘点'}
        width={720}
        open={detail !== null}
        onClose={() => setDetail(null)}
        extra={
          detail && canManage && detail.stocktake.status === 'draft' ? (
            <Space>
              <Button onClick={() => void saveCounts()}>保存实盘数</Button>
              <Popconfirm title="完成盘点并将差异过账？过账后不可再改" onConfirm={() => void doComplete()}>
                <Button type="primary">完成过账</Button>
              </Popconfirm>
            </Space>
          ) : null
        }
      >
        {detail && (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Space wrap>
              <Tag>{warehouseName(detail.stocktake.warehouseId)}</Tag>
              <Tag>{detail.stocktake.stocktakeDate}</Tag>
              {statusTag(detail.stocktake.status)}
              <Text type="secondary">共 {detail.items.length} 个批次</Text>
            </Space>
            <Table<StocktakeItemView>
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={detail.items}
              columns={[
                { title: '批次号', dataIndex: 'batchNo', width: 140 },
                {
                  title: '件卡号',
                  dataIndex: 'rollNo',
                  width: 170,
                  render: (v: string | null, it: StocktakeItemView) =>
                    v ? (
                      <Space size={4}>
                        <Text code>{v}</Text>
                        {/* 件卡级：没录实盘= 这一匹没盘到，过账会按剩余量写损 */}
                        {it.countedQuantityM == null && detail.stocktake.status === 'draft' ? (
                          <Tag color="warning">未盘到</Tag>
                        ) : null}
                      </Space>
                    ) : (
                      <Text type="secondary">（批次级）</Text>
                    ),
                },
                {
                  title: '账面量(m)',
                  dataIndex: 'bookQuantityM',
                  width: 100,
                  align: 'right',
                  render: (v: number) => fmt(v, 2),
                },
                {
                  title: '实盘量(m)',
                  dataIndex: 'id',
                  width: 130,
                  render: (_, it) =>
                    detail.stocktake.status === 'draft' && canManage ? (
                      <InputNumber
                        style={{ width: '100%' }}
                        min={0}
                        placeholder="实盘"
                        value={counts[it.id] ?? it.countedQuantityM ?? null}
                        onChange={(v) => setCounts((c) => ({ ...c, [it.id]: v ?? undefined }))}
                      />
                    ) : (
                      <Text>{it.countedQuantityM == null ? '-' : fmt(it.countedQuantityM, 2)}</Text>
                    ),
                },
                { title: '差异', dataIndex: 'id', width: 130, render: (_, it) => diffCell(it) },
              ]}
            />
          </Space>
        )}
      </Drawer>
    </div>
  )
}
