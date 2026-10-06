import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Col,
  InputNumber,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd'
import { ReloadOutlined, FundOutlined } from '@ant-design/icons'
import { api } from '../lib/api'
import { useLookups } from '../lib/lookups'
import {
  dec,
  fmt,
  fmtPct,
  type ReconcileWire,
} from '../lib/erp'
import { DEFAULT_TOLERANCE_RATE } from '@weftcount/shared'

const { Title, Text } = Typography

export default function ReconcilePage() {
  const { message } = AntdApp.useApp()
  const { specs, specName } = useLookups()

  const [data, setData] = useState<ReconcileWire | null>(null)
  const [loading, setLoading] = useState(false)
  const [specId, setSpecId] = useState<string | undefined>()
  const [tolerance, setTolerance] = useState<number>(DEFAULT_TOLERANCE_RATE * 100)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (specId) params.set('specId', specId)
      params.set('toleranceRate', String(tolerance / 100))
      const res = await api.get<ReconcileWire>(`/inventory/reconcile?${params.toString()}`)
      setData(res.data.data)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '对账失败')
    } finally {
      setLoading(false)
    }
  }, [specId, tolerance, message])

  useEffect(() => {
    void load()
  }, [load])

  const l = data?.ledger

  return (
    <div>
      <Space align="center" style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            一件事三算对账
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            同一批布的采购重量 / 生产长度 / 销售面积，折算到重量基准必须闭合：采购 = 生产折算 + 销售折算 + 结存
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
          <Space size={4}>
            <Text type="secondary">容差</Text>
            <InputNumber
              min={0}
              max={100}
              precision={1}
              value={tolerance}
              onChange={(v) => setTolerance(v ?? 0)}
              addonAfter="%"
              style={{ width: 110 }}
            />
          </Space>
          <Button type="primary" icon={<FundOutlined />} onClick={() => void load()}>
            对账
          </Button>
        </Space>
      </Card>

      {data && l && (
        <Row gutter={12} style={{ marginBottom: 12 }}>
          <Col span={4}>
            <Card size="small">
              <Statistic title="采购入库重量" value={dec(l.purchaseKg)} suffix="kg" precision={2} />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic title="生产领用折算" value={dec(l.productionOutKg)} suffix="kg" precision={2} />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic title="销售出库折算" value={dec(l.salesOutKg)} suffix="kg" precision={2} />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic title="期末结存" value={dec(l.remainingKg)} suffix="kg" precision={2} />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic
                title="差异重量"
                value={dec(l.unexplainedKg)}
                suffix="kg"
                precision={2}
                valueStyle={{ color: dec(l.unexplainedKg) === 0 ? '#3f8600' : '#cf1322' }}
              />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic
                title="差异占比"
                value={dec(l.unexplainedRate) * 100}
                suffix="%"
                precision={2}
                valueStyle={{ color: data.check.withinTolerance ? '#3f8600' : '#cf1322' }}
              />
            </Card>
          </Col>
        </Row>
      )}

      {data && !data.check.withinTolerance && (
        <Alert
          style={{ marginBottom: 12 }}
          type="warning"
          showIcon
          message="超出容差预警"
          description={
            <Space direction="vertical">
              {data.check.warnings.map((w, i) => (
                <Text key={i}>{w}</Text>
              ))}
            </Space>
          }
        />
      )}

      <Card size="small" title="分规格对账明细">
        <Table<ReconcileWire['bySpec'][number]>
          rowKey="specId"
          size="small"
          loading={loading}
          dataSource={data?.bySpec ?? []}
          pagination={false}
          columns={[
            { title: '规格', dataIndex: 'specId', render: (v: string) => specName(v) },
            { title: '采购(kg)', dataIndex: 'purchaseKg', align: 'right', render: (v: string) => fmt(v, 2) },
            {
              title: '生产折算(kg)',
              dataIndex: 'productionOutKg',
              align: 'right',
              render: (v: string) => fmt(v, 2),
            },
            {
              title: '销售折算(kg)',
              dataIndex: 'salesOutKg',
              align: 'right',
              render: (v: string) => fmt(v, 2),
            },
            { title: '结存(kg)', dataIndex: 'remainingKg', align: 'right', render: (v: string) => fmt(v, 2) },
            {
              title: '差异(kg)',
              dataIndex: 'unexplainedKg',
              align: 'right',
              render: (v: string) => fmt(v, 2),
            },
            {
              title: '占比',
              dataIndex: 'unexplainedRate',
              align: 'right',
              render: (v: string) => fmtPct(v, 2),
            },
            {
              title: '容差内',
              dataIndex: 'withinTolerance',
              width: 90,
              render: (v: boolean) => (v ? <Tag color="green">是</Tag> : <Tag color="red">否</Tag>),
            },
          ]}
        />
      </Card>
    </div>
  )
}
