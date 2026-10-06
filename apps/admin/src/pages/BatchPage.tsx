import { useCallback, useEffect, useState } from 'react'
import {
  App as AntdApp,
  Button,
  Card,
  Form,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import { ReloadOutlined, DatabaseOutlined, SwapOutlined } from '@ant-design/icons'
import { api } from '../lib/api'
import { useLookups } from '../lib/lookups'
import {
  BATCH_STATUS_LABEL,
  fmt,
  fmtMoney,
  LIST_TABLE_SCROLL_Y,
  PERM,
  SOURCE_TYPE_LABEL,
  type BatchWire,
  type WarehouseWire,
} from '../lib/erp'
import { useAuthStore } from '../stores/auth.store'

const { Title, Text } = Typography

export default function BatchPage() {
  const { message } = AntdApp.useApp()
  const { specs, specName, materialName } = useLookups()

  const [data, setData] = useState<BatchWire[]>([])
  const [loading, setLoading] = useState(false)
  const [specId, setSpecId] = useState<string | undefined>()
  // 默认只显示「正常」批次：耗尽批次是**历史凭证**(对账/追溯要用)，不是垃圾数据，
  // 但混在在用批次里会干扰日常查询，故默认折叠、需显式筛选才展示。
  const [status, setStatus] = useState<BatchWire['status'] | 'all' | undefined>('normal')
  const [warehouseId, setWarehouseId] = useState<string | undefined>()
  const [warehouses, setWarehouses] = useState<WarehouseWire[]>([])
  const [transferring, setTransferring] = useState<BatchWire | null>(null)
  const [transferForm] = Form.useForm<{ toWarehouseId?: string; quantityM?: number }>()

  useEffect(() => {
    api
      .get<WarehouseWire[]>('/warehouses?status=active')
      .then((res) => setWarehouses(res.data.data))
      .catch(() => setWarehouses([]))
  }, [])

  const warehouseName = (id: string | null) => (id ? (warehouses.find((w) => w.id === id)?.name ?? id) : '未指定')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (specId) params.set('specId', specId)
      if (status && status !== 'all') params.set('status', status)
      if (warehouseId) params.set('warehouseId', warehouseId)
      const res = await api.get<BatchWire[]>(`/inventory/batches?${params.toString()}`)
      setData(res.data.data)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载批次失败')
    } finally {
      setLoading(false)
    }
  }, [specId, status, warehouseId, message])

  useEffect(() => {
    void load()
  }, [load])

  const canManage = useAuthStore((s) => s.hasPermission(PERM.INVENTORY_MANAGE))

  const openTransfer = (b: BatchWire) => {
    setTransferring(b)
    transferForm.resetFields()
  }

  const onTransfer = async () => {
    if (!transferring) return
    const v = await transferForm.validateFields()
    try {
      await api.post('/inventory/transfer', {
        sourceBatchId: transferring.id,
        toWarehouseId: v.toWarehouseId,
        quantityM: v.quantityM,
      })
      message.success('调拨完成')
      setTransferring(null)
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '调拨失败')
    }
  }

  return (
    <div>
      <Space align="center" style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            库存批次
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            以「米」为主单位，同时冗余重量(kg)与面积(m²)两个视图，换算依据锁死在规格快照
          </Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void load()}>
          刷新
        </Button>
      </Space>

      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap>
          <Select
            allowClear
            placeholder="按规格筛选"
            style={{ width: 220 }}
            value={specId}
            onChange={setSpecId}
            showSearch
            optionFilterProp="label"
            options={specs.map((s) => ({ value: s.id, label: `${s.code} ${s.name}` }))}
          />
          <Select
            allowClear
            placeholder="状态"
            style={{ width: 150 }}
            value={status}
            onChange={setStatus}
            options={[
              ...(Object.keys(BATCH_STATUS_LABEL) as BatchWire['status'][]).map((k) => ({
                value: k,
                // 耗尽批次文案点明它仍可查——避免被误解为「垃圾数据」而想删
                label: k === 'depleted' ? `${BATCH_STATUS_LABEL[k].text}（已归档，仍可追溯）` : BATCH_STATUS_LABEL[k].text,
              })),
              { value: 'all', label: '全部（含已归档）' },
            ]}
          />
          <Select
            allowClear
            placeholder="按仓库筛选"
            style={{ width: 160 }}
            value={warehouseId}
            onChange={setWarehouseId}
            showSearch
            optionFilterProp="label"
            options={warehouses.map((w) => ({ value: w.id, label: `${w.name}（${w.code}）` }))}
          />
          <Button type="primary" icon={<DatabaseOutlined />} onClick={() => void load()}>
            查询
          </Button>
        </Space>
      </Card>

      <Card size="small">
        <Table<BatchWire>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={data}
          scroll={{ x: 1100, y: LIST_TABLE_SCROLL_Y }}
          pagination={{ showTotal: (t) => `共 ${t} 条`, showSizeChanger: false, defaultPageSize: 20 }}
          columns={[
            { title: '批次号', dataIndex: 'batchNo', width: 130, fixed: 'left' },
            {
              title: '规格',
              dataIndex: 'specId',
              width: 180,
              render: (v: string) => specName(v),
            },
            {
              title: '物料',
              dataIndex: 'materialId',
              width: 140,
              render: (v: string) => materialName(v),
            },
            {
              title: '仓库',
              dataIndex: 'warehouseId',
              width: 110,
              render: (v: string | null) => (v ? <Tag>{warehouseName(v)}</Tag> : <Text type="secondary">未指定</Text>),
            },
            {
              title: '操作',
              width: 80,
              fixed: 'right',
              render: (_, r) =>
                canManage && r.remainingQuantity !== '0.000' && Number(r.remainingQuantity) > 0 ? (
                  <Button type="link" size="small" icon={<SwapOutlined />} onClick={() => openTransfer(r)}>
                    调拨
                  </Button>
                ) : (
                  <Text type="secondary">-</Text>
                ),
            },
            { title: '门幅', dataIndex: 'widthCm', width: 80, align: 'right', render: (v: string) => `${fmt(v, 1)}cm` },
            {
              title: '入库量',
              width: 110,
              align: 'right',
              render: (_, r) => `${fmt(r.quantity, 2)} m`,
            },
            {
              title: '入库重',
              width: 100,
              align: 'right',
              render: (_, r) => `${fmt(r.weightKg, 2)} kg`,
            },
            {
              title: '入库面积',
              width: 110,
              align: 'right',
              render: (_, r) => `${fmt(r.areaM2, 2)} m²`,
            },
            {
              title: '剩余量',
              width: 110,
              align: 'right',
              render: (_, r) => (
                <Text strong>{`${fmt(r.remainingQuantity, 2)} m`}</Text>
              ),
            },
            {
              title: '剩余重',
              width: 100,
              align: 'right',
              render: (_, r) => `${fmt(r.remainingWeightKg, 2)} kg`,
            },
            {
              title: '单位成本',
              dataIndex: 'unitCost',
              width: 100,
              align: 'right',
              render: (v: string | null) => (v == null ? '-' : fmtMoney(v)),
            },
            {
              title: '来源',
              dataIndex: 'sourceType',
              width: 90,
              render: (v: BatchWire['sourceType']) => SOURCE_TYPE_LABEL[v] ?? v,
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 90,
              render: (v: BatchWire['status']) => (
                <Tag color={BATCH_STATUS_LABEL[v].color}>{BATCH_STATUS_LABEL[v].text}</Tag>
              ),
            },
            {
              title: '入库时间',
              dataIndex: 'inboundAt',
              width: 160,
              render: (v: string) => new Date(v).toLocaleString('zh-CN'),
            },
          ]}
        />
      </Card>

      {/* 调拨弹窗 */}
      <Modal
        title={transferring ? `调拨 · ${transferring.batchNo}` : '调拨'}
        open={transferring !== null}
        onCancel={() => setTransferring(null)}
        onOk={() => void onTransfer()}
        okText="确认调拨"
        destroyOnClose
      >
        {transferring && (
          <Form form={transferForm} layout="vertical" style={{ marginTop: 16 }}>
            <Form.Item label="源批次剩余">
              <Text strong>{fmt(transferring.remainingQuantity, 2)} m</Text>
            </Form.Item>
            <Form.Item name="toWarehouseId" label="目标仓库" rules={[{ required: true, message: '请选择目标仓库' }]}>
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="选择目标仓库"
                options={warehouses
                  .filter((w) => w.id !== transferring.warehouseId)
                  .map((w) => ({ value: w.id, label: `${w.name}（${w.code}）` }))}
              />
            </Form.Item>
            <Form.Item name="quantityM" label="调拨数量（米）" rules={[{ required: true, message: '请输入调拨数量' }]}>
              <InputNumber
                style={{ width: '100%' }}
                min={0.0001}
                max={Number(transferring.remainingQuantity)}
                placeholder={`不超过 ${fmt(transferring.remainingQuantity, 2)} m`}
              />
            </Form.Item>
          </Form>
        )}
      </Modal>
    </div>
  )
}
