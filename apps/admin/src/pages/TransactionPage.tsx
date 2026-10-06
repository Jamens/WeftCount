import { useCallback, useEffect, useMemo, useState } from 'react'
import { App as AntdApp, Button, Card, Select, Space, Table, Tag, Typography } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { api } from '../lib/api'
import { useLookups } from '../lib/lookups'
import { dec, fmt, type TxnWire } from '../lib/erp'
import { STOCK_TXN_LABEL, type StockTxnTypeValue } from '@weftcount/shared'

const { Title, Text } = Typography

export default function TransactionPage() {
  const { message } = AntdApp.useApp()
  const { specs, specName, materialName } = useLookups()

  const [data, setData] = useState<TxnWire[]>([])
  const [loading, setLoading] = useState(false)
  const [specId, setSpecId] = useState<string | undefined>()
  const [direction, setDirection] = useState<'in' | 'out' | undefined>()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<TxnWire[]>('/inventory/transactions')
      setData(res.data.data)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载流水失败')
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(
    () =>
      data.filter(
        (t) =>
          (!specId || t.specId === specId) && (!direction || t.direction === direction),
      ),
    [data, specId, direction],
  )

  return (
    <div>
      <Space align="center" style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            库存事务流水
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            每一次出入库落一条流水，方向 + 变化量 + 变化后余额三件套；同一笔移动用米/公斤/平方米三本账记录
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
            placeholder="方向"
            style={{ width: 120 }}
            value={direction}
            onChange={setDirection}
            options={[
              { value: 'in', label: '入库' },
              { value: 'out', label: '出库' },
            ]}
          />
        </Space>
      </Card>

      <Card size="small">
        <Table<TxnWire>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={filtered}
          scroll={{ x: 1200 }}
          pagination={{ showTotal: (t) => `共 ${t} 条`, showSizeChanger: false, defaultPageSize: 30 }}
          columns={[
            {
              title: '时间',
              dataIndex: 'createdAt',
              width: 160,
              render: (v: string) => new Date(v).toLocaleString('zh-CN'),
            },
            {
              title: '方向',
              dataIndex: 'direction',
              width: 70,
              render: (v: 'in' | 'out') =>
                v === 'in' ? <Tag color="green">入</Tag> : <Tag color="red">出</Tag>,
            },
            {
              title: '类型',
              dataIndex: 'txnType',
              width: 110,
              render: (v: StockTxnTypeValue) => STOCK_TXN_LABEL[v] ?? v,
            },
            { title: '规格', dataIndex: 'specId', width: 160, render: (v: string) => specName(v) },
            { title: '物料', dataIndex: 'materialId', width: 130, render: (v: string) => materialName(v) },
            {
              title: '变化量(m)',
              dataIndex: 'changeQuantity',
              width: 100,
              align: 'right',
              render: (v: string) => {
                const n = dec(v)
                return <Text type={n >= 0 ? 'success' : 'danger'}>{fmt(v, 2)}</Text>
              },
            },
            {
              title: '变化重(kg)',
              dataIndex: 'changeWeightKg',
              width: 110,
              align: 'right',
              render: (v: string) => fmt(v, 2),
            },
            {
              title: '变化面积(m²)',
              dataIndex: 'changeAreaM2',
              width: 120,
              align: 'right',
              render: (v: string) => fmt(v, 2),
            },
            {
              title: '剩余(m)',
              dataIndex: 'afterQuantity',
              width: 100,
              align: 'right',
              render: (v: string) => fmt(v, 2),
            },
            {
              title: '剩余重(kg)',
              dataIndex: 'afterWeightKg',
              width: 100,
              align: 'right',
              render: (v: string) => fmt(v, 2),
            },
            {
              title: '来源单据',
              dataIndex: 'docId',
              width: 120,
              render: (v: string) => <Text code style={{ fontSize: 11 }}>{v.slice(0, 8)}…</Text>,
            },
          ]}
        />
      </Card>
    </div>
  )
}
