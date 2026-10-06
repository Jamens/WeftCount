import { useCallback, useEffect, useState } from 'react'
import { App as AntdApp, Button, Card, Space, Table, Tag, Tooltip, Typography } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { api } from '../lib/api'
import { PERM, YARN_PRICE_SOURCE_LABEL, type CostRow, type YarnPriceSource } from '../lib/erp'
import { useAuthStore } from '../stores/auth.store'

const { Title, Text } = Typography

const yuan = (v: number | null | undefined, scale = 4): string =>
  v == null ? '-' : `¥${v.toFixed(scale)}`

export default function CostPage() {
  const { message } = AntdApp.useApp()
  const canView = useAuthStore((s) => s.hasPermission(PERM.COST_VIEW))

  const [data, setData] = useState<CostRow[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!canView) return
    setLoading(true)
    try {
      const res = await api.get<CostRow[]>('/cost/analysis')
      setData(res.data.data)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载成本报表失败')
    } finally {
      setLoading(false)
    }
  }, [canView, message])

  useEffect(() => {
    void load()
  }, [load])

  const priceTag = (src: YarnPriceSource) => {
    const m = YARN_PRICE_SOURCE_LABEL[src]
    return m ? <Tag color={m.color}>{m.text}</Tag> : src
  }

  const marginCell = (v: number | null) => {
    if (v == null) return <Text type="secondary">-</Text>
    const pct = v * 100
    const color = pct < 0 ? 'red' : pct < 10 ? 'orange' : 'green'
    return <Text strong style={{ color }}>{pct.toFixed(2)}%</Text>
  }

  return (
    <div>
      <Space align="center" style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            成本报表
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            制造成本 = 纱线成本 + 加工费。纱线用量来自工艺内核快照（确定性），这里只做「用量 × 单价」的确定性核算
          </Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void load()}>
          刷新
        </Button>
      </Space>

      {!canView ? (
        <Card size="small">
          <Text type="secondary">无成本查看权限</Text>
        </Card>
      ) : (
        <Card size="small">
          <Table<CostRow>
            rowKey="specId"
            size="small"
            loading={loading}
            dataSource={data}
            pagination={{ showTotal: (t) => `共 ${t} 个规格`, showSizeChanger: false }}
            columns={[
              {
                title: '规格',
                dataIndex: 'specName',
                width: 150,
                render: (v: string, r) => (
                  <Space direction="vertical" size={0}>
                    <Text strong>{v}</Text>
                    <Text type="secondary" style={{ fontSize: 11 }}>{r.specCode}</Text>
                  </Space>
                ),
              },
              {
                title: '经纱',
                dataIndex: 'warpMaterialName',
                width: 130,
                render: (v: string | null, r) => (
                  <Space direction="vertical" size={0}>
                    <Text>{v ?? '未指定'}</Text>
                    <Space size={2}>
                      <Text type="secondary" style={{ fontSize: 11 }}>{yuan(r.warpYarnPrice, 2)}/kg</Text>
                      {priceTag(r.warpPriceSource)}
                    </Space>
                  </Space>
                ),
              },
              {
                title: '纬纱',
                dataIndex: 'weftMaterialName',
                width: 130,
                render: (v: string | null, r) => (
                  <Space direction="vertical" size={0}>
                    <Text>{v ?? '未指定'}</Text>
                    <Space size={2}>
                      <Text type="secondary" style={{ fontSize: 11 }}>{yuan(r.weftYarnPrice, 2)}/kg</Text>
                      {priceTag(r.weftPriceSource)}
                    </Space>
                  </Space>
                ),
              },
              {
                title: '经纱用量',
                dataIndex: 'warpKgPer100m',
                width: 90,
                align: 'right',
                render: (v: number) => `${v.toFixed(2)} kg/百m`,
              },
              {
                title: '纬纱用量',
                dataIndex: 'weftKgPer100m',
                width: 90,
                align: 'right',
                render: (v: number) => `${v.toFixed(2)} kg/百m`,
              },
              { title: '经纱成本/米', dataIndex: 'warpCostPerM', width: 100, align: 'right', render: (v: number) => yuan(v) },
              { title: '纬纱成本/米', dataIndex: 'weftCostPerM', width: 100, align: 'right', render: (v: number) => yuan(v) },
              {
                title: '物成本/米',
                dataIndex: 'materialCostPerM',
                width: 100,
                align: 'right',
                render: (v: number) => <Text>{yuan(v)}</Text>,
              },
              { title: '加工费/米', dataIndex: 'overheadPerM', width: 90, align: 'right', render: (v: number) => yuan(v) },
              {
                title: '制造成本/米',
                dataIndex: 'totalCostPerM',
                width: 110,
                align: 'right',
                render: (v: number) => <Text strong>{yuan(v)}</Text>,
              },
              { title: '成本/kg', dataIndex: 'totalCostPerKg', width: 95, align: 'right', render: (v: number) => yuan(v, 2) },
              { title: '成本/m²', dataIndex: 'totalCostPerM2', width: 95, align: 'right', render: (v: number) => yuan(v, 2) },
              {
                title: '售价/米',
                dataIndex: 'salesPricePerM',
                width: 95,
                align: 'right',
                render: (v: number | null) => (v == null ? <Tooltip title="尚无销售出库单价"><Text type="secondary">-</Text></Tooltip> : yuan(v, 2)),
              },
              {
                title: '毛利/米',
                dataIndex: 'grossProfitPerM',
                width: 95,
                align: 'right',
                render: (v: number | null) => (v == null ? <Text type="secondary">-</Text> : yuan(v, 2)),
              },
              { title: '毛利率', dataIndex: 'grossMarginRate', width: 85, align: 'right', render: (v: number | null) => marginCell(v) },
            ]}
          />
        </Card>
      )}
    </div>
  )
}
