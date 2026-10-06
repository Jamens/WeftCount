import { useCallback, useEffect, useRef, useState } from 'react'
import { App as AntdApp, Alert, Button, Card, Col, Descriptions, Input, Row, Space, Table, Tag, Typography, type InputRef } from 'antd'
import { BarcodeOutlined, SearchOutlined, NodeIndexOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { api } from '../lib/api'
import { fmt, num, type BatchOrigin, type BatchTrace, type BatchWire, type MaterialWire, type GreigeSpecWire, type WarehouseWire } from '../lib/types'

const { Title, Text } = Typography

/** 渲染一条批次来源链（生产/采购/调拨递归） */
function OriginChain({ origin, depth = 0 }: { origin: BatchOrigin | null; depth?: number }) {
  if (!origin) return <Text type="secondary">（来源未知）</Text>
  const pad = { marginLeft: depth * 14 }
  if (origin.kind === 'production') {
    return (
      <div style={pad}>
        <Space wrap>
          <Tag color="purple">织造产出</Tag>
          <Text>工单 <Text strong>{origin.workOrder.orderNo}</Text></Text>
          {origin.machine && <Text>· 机台 <Text strong>{origin.machine.name}</Text></Text>}
          <Text type="secondary">· 报工 {origin.report.reportDate} 产 {fmt(origin.report.outputM, 0)}m</Text>
        </Space>
      </div>
    )
  }
  if (origin.kind === 'purchase') {
    return (
      <div style={pad}>
        <Space wrap>
          <Tag color="green">采购入库</Tag>
          <Text>供应商 <Text strong>{origin.supplier?.name ?? '-'}</Text></Text>
          <Text type="secondary">· 入库单 {origin.purchaseDoc.docNo}{origin.purchaseOrder ? ` · 订单 ${origin.purchaseOrder.orderNo}` : ''}</Text>
        </Space>
      </div>
    )
  }
  if (origin.kind === 'transfer') {
    return (
      <div style={pad}>
        <Space wrap><Tag color="orange">调拨</Tag><Text type="secondary">由批次 {origin.fromBatchNo} 调入 ←</Text></Space>
        <OriginChain origin={origin.origin} depth={depth + 1} />
      </div>
    )
  }
  return <div style={pad}><Tag>来源 {origin.sourceType}</Tag></div>
}

/** 扫码查询：扫/输批次码 → 查批次档案 + 全链路来源（配合标签打印形成闭环） */
export default function ScanPage() {
  const { message } = AntdApp.useApp()
  const inputRef = useRef<InputRef>(null)
  const [code, setCode] = useState('')
  const [batches, setBatches] = useState<BatchWire[]>([])
  const [materials, setMaterials] = useState<MaterialWire[]>([])
  const [specs, setSpecs] = useState<GreigeSpecWire[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseWire[]>([])
  const [target, setTarget] = useState<BatchWire | null>(null)
  const [trace, setTrace] = useState<BatchTrace | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    inputRef.current?.focus()
    // 预载批次/名称，便于本地按码定位与展示
    Promise.all([
      api.get<BatchWire[]>('/inventory/batches'),
      api.get<MaterialWire[]>('/materials'),
      api.get<GreigeSpecWire[]>('/greige-specs'),
      api.get<WarehouseWire[]>('/warehouses'),
    ])
      .then(([b, m, s, w]) => {
        setBatches(b)
        setMaterials(m)
        setSpecs(s)
        setWarehouses(w)
      })
      .catch(() => undefined)
  }, [])

  const onScan = useCallback(async () => {
    const c = code.trim().toUpperCase()
    if (!c) return
    setLoading(true)
    try {
      const b = batches.find((x) => x.batchNo.toUpperCase() === c)
      if (!b) {
        message.warning(`未找到批次「${c}」`)
        setTarget(null)
        setTrace(null)
        return
      }
      setTarget(b)
      setTrace(await api.get<BatchTrace>(`/traceability/batch/${b.id}`))
      message.success('已找到批次')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '查询失败')
    } finally {
      setLoading(false)
    }
  }, [code, batches, message])

  return (
    <div style={{ padding: 16 }}>
      <Row gutter={[12, 12]}>
        <Col span={24}>
          <Card size="small">
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Title level={4} style={{ margin: 0 }}>扫码查询</Title>
              <Text type="secondary">扫描布匹标签上的条码（或手动输入批次号后回车），查这批布的档案与全链路来源。</Text>
              <Space.Compact style={{ width: 420 }}>
                <Input
                  ref={inputRef}
                  size="large"
                  prefix={<BarcodeOutlined />}
                  placeholder="扫描或输入批次号后回车"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onPressEnter={() => void onScan()}
                />
                <Button type="primary" size="large" icon={<SearchOutlined />} loading={loading} onClick={() => void onScan()}>
                  查询
                </Button>
              </Space.Compact>
            </Space>
          </Card>
        </Col>

        {target && (
          <Col span={24}>
            <Card size="small" title={<><BarcodeOutlined /> 批次档案</>}>
              <Descriptions column={3} size="small" bordered>
                <Descriptions.Item label="批次号">{target.batchNo}</Descriptions.Item>
                <Descriptions.Item label="物料">{materials.find((m) => m.id === target.materialId)?.name ?? '-'}</Descriptions.Item>
                <Descriptions.Item label="规格">{specs.find((s) => s.id === target.specId)?.name ?? '-'}</Descriptions.Item>
                <Descriptions.Item label="数量">{fmt(target.quantity, 1)} m / {fmt(target.weightKg, 1)} kg</Descriptions.Item>
                <Descriptions.Item label="剩余">{fmt(target.remainingQuantity, 1)} m</Descriptions.Item>
                <Descriptions.Item label="仓库">
                  {target.warehouseId ? (warehouses.find((w) => w.id === target.warehouseId)?.name ?? '-') : '未指定'}
                </Descriptions.Item>
                <Descriptions.Item label="入库时间">{dayjs(target.inboundAt).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>
                <Descriptions.Item label="克重">{trace?.spec ? `${trace.spec.totalGsm} g/m²` : '-'}</Descriptions.Item>
              </Descriptions>
            </Card>
          </Col>
        )}

        {trace && (
          <Col span={24}>
            <Card size="small" title={<><NodeIndexOutlined /> 全链路来源</>}>
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <div>
                  <Text strong>来源：</Text>
                  <OriginChain origin={trace.origin} />
                </div>
                <div>
                  <Text strong>去向：</Text>
                  {trace.consumedBy.length === 0 ? (
                    <Text type="secondary">尚未出库</Text>
                  ) : (
                    <Table
                      rowKey={(r) => r.docNo + r.outM}
                      size="small"
                      pagination={false}
                      dataSource={trace.consumedBy}
                      columns={[
                        { title: '单据号', dataIndex: 'docNo', width: 150 },
                        { title: '类型', dataIndex: 'docType', width: 110 },
                        { title: '出库(m)', dataIndex: 'outM', width: 90, align: 'right', render: (v: number) => fmt(v, 1) },
                        { title: '往来单位', dataIndex: 'partnerName', render: (v: string | null) => v ?? '-' },
                      ]}
                    />
                  )}
                </div>
              </Space>
            </Card>
          </Col>
        )}

        {!target && !loading && (
          <Col span={24}>
            <Alert type="info" showIcon message="等待扫码" description="扫标签条码即可查看该批布的物料/规格/数量/仓库，以及它来自哪张工单/哪台织机或哪个供应商。" />
          </Col>
        )}
      </Row>
    </div>
  )
}
