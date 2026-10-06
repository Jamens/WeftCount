import { useCallback, useEffect, useState } from 'react'
import {
  App as AntdApp,
  Button,
  Card,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import { ReloadOutlined, DatabaseOutlined } from '@ant-design/icons'
import { api } from '../lib/api'
import { useLookups } from '../lib/lookups'
import {
  BATCH_STATUS_LABEL,
  fmt,
  fmtMoney,
  SOURCE_TYPE_LABEL,
  type BatchWire,
} from '../lib/erp'

const { Title, Text } = Typography

export default function BatchPage() {
  const { message } = AntdApp.useApp()
  const { specs, specName, materialName } = useLookups()

  const [data, setData] = useState<BatchWire[]>([])
  const [loading, setLoading] = useState(false)
  const [specId, setSpecId] = useState<string | undefined>()
  const [status, setStatus] = useState<BatchWire['status'] | undefined>()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (specId) params.set('specId', specId)
      if (status) params.set('status', status)
      const res = await api.get<BatchWire[]>(`/inventory/batches?${params.toString()}`)
      setData(res.data.data)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载批次失败')
    } finally {
      setLoading(false)
    }
  }, [specId, status, message])

  useEffect(() => {
    void load()
  }, [load])

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
            style={{ width: 120 }}
            value={status}
            onChange={setStatus}
            options={(Object.keys(BATCH_STATUS_LABEL) as BatchWire['status'][]).map((k) => ({
              value: k,
              label: BATCH_STATUS_LABEL[k].text,
            }))}
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
          scroll={{ x: 1100 }}
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
    </div>
  )
}
