import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { App as AntdApp, Button, Card, Descriptions, Empty, Input, Select, Space, Table, Tag, Typography } from 'antd'
import { NodeIndexOutlined, SearchOutlined } from '@ant-design/icons'
import { api } from '../lib/api'
import {
  PERM,
  fmt,
  type BatchOrigin,
  type BatchTrace,
  type RollTrace,
  type SalesTrace,
  type SpecBrief,
} from '../lib/erp'
import { useAuthStore } from '../stores/auth.store'

const { Title, Text } = Typography

/** 出入库单据类型中文名（追溯页多处用到） */
const DOC_TYPE_CN: Record<string, string> = {
  purchase_inbound: '采购入库',
  production_in: '生产入库',
  sales_outbound: '销售出库',
  material_out: '领用出库',
  stock_transfer: '库存调拨',
  stock_adjust: '库存调整',
  count_gain: '盘盈',
  count_loss: '盘亏',
  production_report: '织造报工',
}
const docTypeLabel = (v: string) => DOC_TYPE_CN[v] ?? v

/** 渲染一条批次来源链（生产/采购/调拨递归） */
function OriginChain({ origin, depth = 0 }: { origin: BatchOrigin | null; depth?: number }) {
  if (!origin) return <Text type="secondary">（来源未知）</Text>
  const pad = { marginLeft: depth * 16 }
  if (origin.kind === 'production') {
    return (
      <div style={pad}>
        <Space wrap>
          <Tag color="purple">织造产出</Tag>
          <Text>工单 </Text>
          <Text strong>{origin.workOrder.orderNo}</Text>
          <Text type="secondary">（{origin.workOrder.status}）</Text>
          {origin.machine && (
            <>
              <Text>· 机台 </Text>
              <Text strong>{origin.machine.name}</Text>
              {origin.machine.model && <Text type="secondary">（{origin.machine.model}）</Text>}
            </>
          )}
        </Space>
        <div style={{ marginTop: 4 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            报工 {origin.report.reportDate} 产出 {fmt(origin.report.outputM, 1)}m
            {origin.report.stopReason ? ` · 停机：${origin.report.stopReason}` : ''}
          </Text>
        </div>
      </div>
    )
  }
  if (origin.kind === 'purchase') {
    return (
      <div style={pad}>
        <Space wrap>
          <Tag color="green">采购入库</Tag>
          <Text>供应商 </Text>
          <Text strong>{origin.supplier?.name ?? '（未关联）'}</Text>
          {origin.purchaseOrder && (
            <>
              <Text>· 采购订单 </Text>
              <Text strong>{origin.purchaseOrder.orderNo}</Text>
            </>
          )}
          <Text type="secondary">· 入库单 {origin.purchaseDoc.docNo}</Text>
        </Space>
      </div>
    )
  }
  if (origin.kind === 'transfer') {
    return (
      <div style={pad}>
        <Space wrap>
          <Tag color="orange">调拨</Tag>
          <Text type="secondary">由批次 {origin.fromBatchNo} 调入 ←</Text>
        </Space>
        <OriginChain origin={origin.origin} depth={depth + 1} />
      </div>
    )
  }
  return (
    <div style={pad}>
      <Tag>来源 {origin.sourceType}</Tag>
      <Text type="secondary">（无关联记录）</Text>
    </div>
  )
}

function SpecCard({ spec }: { spec: SpecBrief | null }) {
  if (!spec) return null
  return (
    <Card size="small" title="规格 / 工艺" style={{ marginBottom: 12 }}>
      <Descriptions column={2} size="small">
        <Descriptions.Item label="规格">{spec.code} {spec.name}</Descriptions.Item>
        <Descriptions.Item label="门幅">{fmt(spec.finishedWidth, 0)} cm</Descriptions.Item>
        <Descriptions.Item label="经纱">{spec.warpCount}</Descriptions.Item>
        <Descriptions.Item label="纬纱">{spec.weftCount}</Descriptions.Item>
        <Descriptions.Item label="克重">{spec.totalGsm} g/m²</Descriptions.Item>
      </Descriptions>
    </Card>
  )
}

export default function TracePage() {
  const { message } = AntdApp.useApp()
  const canView = useAuthStore((s) => s.hasPermission(PERM.REPORT_VIEW))
  const [searchParams, setSearchParams] = useSearchParams()

  const [mode, setMode] = useState<'sales' | 'batch' | 'roll'>('sales')
  const [salesDocs, setSalesDocs] = useState<{ id: string; docNo: string }[]>([])
  const [batches, setBatches] = useState<{ id: string; batchNo: string }[]>([])
  const [selected, setSelected] = useState<string | undefined>()
  const [rollNo, setRollNo] = useState<string>('')
  const [salesTrace, setSalesTrace] = useState<SalesTrace | null>(null)
  const [batchTrace, setBatchTrace] = useState<BatchTrace | null>(null)
  const [rollTrace, setRollTrace] = useState<RollTrace | null>(null)
  const [loading, setLoading] = useState(false)

  const resetTraces = () => {
    setSalesTrace(null)
    setBatchTrace(null)
    setRollTrace(null)
  }

  /**
   * 扫码枪深链：`/traceability?roll=R0001` 直接出追溯结果
   *
   * 现场查一匹布的操作就是「扫条码」，让用户先切到件卡页再手打匹号是不成立的。
   * 用 URL 承载而不是自动 fetch，是因为页面加载顺序不可控——
   * 权限没就绪就发请求必然 403。
   */
  const deepLinkRoll = searchParams.get('roll')
  useEffect(() => {
    if (!deepLinkRoll || !canView) return
    setMode('roll')
    setRollNo(deepLinkRoll)
    setSearchParams({}, { replace: true })
  }, [deepLinkRoll, canView, setSearchParams])

  // 载入可选的销售单 / 批次
  useEffect(() => {
    if (!canView) return
    api
      .get<{ id: string; docNo: string }[]>('/inventory/documents?docType=sales_outbound')
      .then((r) => setSalesDocs(r.data.data.map((d) => ({ id: d.id, docNo: d.docNo }))))
      .catch(() => setSalesDocs([]))
    api
      .get<{ id: string; batchNo: string }[]>('/inventory/batches')
      .then((r) => setBatches(r.data.data.map((b) => ({ id: b.id, batchNo: b.batchNo }))))
      .catch(() => setBatches([]))
  }, [canView])

  const search = useCallback(async () => {
    setLoading(true)
    try {
      if (mode === 'roll') {
        // 件卡按**匹号**查，不是 id——现场只有条码/手写匹号，没有 UUID
        const no = rollNo.trim()
        if (!no) {
          message.warning('请输入件卡号')
          return
        }
        const res = await api.get<RollTrace>(`/inventory/rolls/trace?rollNo=${encodeURIComponent(no)}`)
        setRollTrace(res.data.data)
        setSalesTrace(null)
        setBatchTrace(null)
        return
      }
      if (!selected) {
        message.warning('请先选择要追溯的单据/批次')
        return
      }
      if (mode === 'sales') {
        const res = await api.get<SalesTrace>(`/traceability/sales/${selected}`)
        setSalesTrace(res.data.data)
        setBatchTrace(null)
        setRollTrace(null)
      } else {
        const res = await api.get<BatchTrace>(`/traceability/batch/${selected}`)
        setBatchTrace(res.data.data)
        setSalesTrace(null)
        setRollTrace(null)
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '追溯失败')
    } finally {
      setLoading(false)
    }
  }, [mode, selected, rollNo, message])

  /**
   * 扫码深链填入件卡号后自动查一次
   *
   * 依赖里带上 mode：setMode('roll') 是异步的，若不带上会在 mode 还是 'sales' 时就发请求，
   * 结果查的是销售单而不是件卡——这种错位不会报错，只会返回一堆无关数据。
   */
  const deepLinkFilled = deepLinkRoll !== null
  useEffect(() => {
    if (!deepLinkFilled || !canView || mode !== 'roll' || !rollNo.trim()) return
    void search()
  }, [deepLinkFilled, canView, mode, rollNo, search])

  const options = mode === 'sales' ? salesDocs.map((d) => ({ value: d.id, label: d.docNo })) : batches.map((b) => ({ value: b.id, label: b.batchNo }))

  return (
    <div>
      <Space align="center" style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            全链路追溯
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            一匹布倒查它的来历：经了哪台织机、哪张工单、哪个供应商的纱；也可按件卡号精确到匹查来源与去向
          </Text>
        </div>
      </Space>

      {!canView ? (
        <Card size="small"><Text type="secondary">无报表查看权限</Text></Card>
      ) : (
        <>
          <Card size="small" style={{ marginBottom: 12 }}>
            <Space wrap>
              <Select
                style={{ width: 130 }}
                value={mode}
                onChange={(m) => {
                  setMode(m)
                  setSelected(undefined)
                  resetTraces()
                }}
                options={[
                  { value: 'sales', label: '销售单倒查' },
                  { value: 'batch', label: '批次追溯' },
                  { value: 'roll', label: '件卡追溯' },
                ]}
              />
              {mode === 'roll' ? (
                <Input
                  style={{ width: 260 }}
                  allowClear
                  value={rollNo}
                  onChange={(e) => setRollNo(e.target.value)}
                  onPressEnter={() => void search()}
                  placeholder="输入件卡号（匹号/条码）"
                />
              ) : (
                <Select
                  showSearch
                  allowClear
                  style={{ width: 260 }}
                  placeholder={mode === 'sales' ? '选择销售出库单' : '选择库存批次'}
                  value={selected}
                  onChange={setSelected}
                  options={options}
                  optionFilterProp="label"
                />
              )}
              <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={() => void search()}>
                追溯
              </Button>
              {mode === 'roll' && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  扫码枪可直接扫条码打开：/traceability?roll=匹号
                </Text>
              )}
            </Space>
          </Card>

          {salesTrace && (
            <Card size="small" title={<><NodeIndexOutlined /> 销售单追溯</>}>
              <Descriptions column={2} size="small" bordered style={{ marginBottom: 12 }}>
                <Descriptions.Item label="销售单">{salesTrace.salesDoc.docNo}</Descriptions.Item>
                <Descriptions.Item label="客户">{salesTrace.customer?.name ?? salesTrace.salesDoc.partnerName ?? '-'}</Descriptions.Item>
                <Descriptions.Item label="销售订单">{salesTrace.salesOrder?.orderNo ?? '（未挂订单）'}</Descriptions.Item>
                <Descriptions.Item label="出库量">{fmt(salesTrace.salesDoc.quantityM, 1)} m / {fmt(salesTrace.salesDoc.weightKg, 1)} kg / {fmt(salesTrace.salesDoc.areaM2, 1)} m²</Descriptions.Item>
              </Descriptions>
              <SpecCard spec={salesTrace.spec} />
              <Card size="small" title={`消耗批次（${salesTrace.consumedBatches.length}）`}>
                {salesTrace.consumedBatches.length === 0 ? (
                  <Empty description="无消耗批次" />
                ) : (
                  <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                    {salesTrace.consumedBatches.map((b, i) => (
                      <div key={i} style={{ borderLeft: '2px solid #e8e8e8', paddingLeft: 12 }}>
                        <Space wrap>
                          <Text strong>批次 {b.batchNo}</Text>
                          {b.warehouseName && <Tag>{b.warehouseName}</Tag>}
                          <Text type="secondary">消耗 {fmt(b.consumedM, 1)}m / {fmt(b.consumedKg, 1)}kg</Text>
                        </Space>
                        <div style={{ marginTop: 4 }}>
                          <OriginChain origin={b.origin} />
                        </div>
                      </div>
                    ))}
                  </Space>
                )}
              </Card>
            </Card>
          )}

          {rollTrace && (
            <Card size="small" title={<><NodeIndexOutlined /> 件卡追溯</>}>
              <Descriptions column={2} size="small" bordered style={{ marginBottom: 12 }}>
                <Descriptions.Item label="件卡号">
                  <Text strong>{rollTrace.roll.rollNo}</Text>
                </Descriptions.Item>
                <Descriptions.Item label="状态">
                  <Tag color={rollTrace.roll.status === 'in_stock' ? 'green' : 'default'}>
                    {rollTrace.roll.status === 'in_stock' ? '在库' : rollTrace.roll.status === 'out' ? '已出库' : rollTrace.roll.status}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="长度">
                  {fmt(rollTrace.roll.meters, 1)} m（原长）
                </Descriptions.Item>
                <Descriptions.Item label="剩余">
                  {fmt(rollTrace.roll.remainingM, 1)} m / {fmt(rollTrace.roll.remainingKg, 1)} kg
                </Descriptions.Item>
                <Descriptions.Item label="物料">
                  {rollTrace.material ? `${rollTrace.material.code} ${rollTrace.material.name}` : '-'}
                </Descriptions.Item>
                <Descriptions.Item label="所属批次">{rollTrace.batch.batchNo}</Descriptions.Item>
                <Descriptions.Item label="规格">{rollTrace.spec.specName}</Descriptions.Item>
                <Descriptions.Item label="门幅">
                  {fmt(rollTrace.spec.finishedWidth, 0)} cm
                  {rollTrace.spec.totalGsm != null && ` · ${fmt(rollTrace.spec.totalGsm, 1)} g/m²`}
                </Descriptions.Item>
              </Descriptions>

              <Card size="small" title="来源" style={{ marginBottom: 12 }}>
                {!rollTrace.source ? (
                  <Text type="secondary">（无来源记录）</Text>
                ) : (
                  <Space wrap>
                    <Tag color={rollTrace.source.docType === 'production_report' ? 'purple' : 'green'}>
                      {rollTrace.source.docType === 'production_report' ? '织造产出' : '采购入库'}
                    </Tag>
                    <Text>单据 </Text>
                    <Text strong>{rollTrace.source.docNo}</Text>
                    {rollTrace.source.partnerName && (
                      <>
                        <Text>· 供应商 </Text>
                        <Text strong>{rollTrace.source.partnerName}</Text>
                      </>
                    )}
                    {rollTrace.source.machineName && (
                      <>
                        <Text>· 机台 </Text>
                        <Text strong>{rollTrace.source.machineName}</Text>
                      </>
                    )}
                    <Text type="secondary">
                      · {new Date(rollTrace.source.date).toLocaleString('zh-CN')}
                    </Text>
                  </Space>
                )}
              </Card>

              <Card size="small" title={`去向（${rollTrace.destinations.length} 张单）`}>
                {rollTrace.destinations.length === 0 ? (
                  <Empty description="尚未出库" />
                ) : (
                  <Table
                    rowKey={(r) => r.docNo + r.date}
                    size="small"
                    pagination={false}
                    dataSource={rollTrace.destinations}
                    columns={[
                      { title: '单据号', dataIndex: 'docNo', width: 150 },
                      {
                        title: '类型',
                        dataIndex: 'docType',
                        width: 110,
                        render: (v: string) => docTypeLabel(v),
                      },
                      {
                        title: '出库(m)',
                        dataIndex: 'meters',
                        width: 100,
                        align: 'right',
                        render: (v: number) => fmt(v, 1),
                      },
                      {
                        title: '出库(kg)',
                        dataIndex: 'weightKg',
                        width: 100,
                        align: 'right',
                        render: (v: number) => fmt(v, 1),
                      },
                      {
                        title: '往来单位',
                        dataIndex: 'partnerName',
                        render: (v: string | null) => v ?? '-',
                      },
                      {
                        title: '时间',
                        dataIndex: 'date',
                        render: (v: string) => new Date(v).toLocaleString('zh-CN'),
                      },
                    ]}
                  />
                )}
              </Card>
            </Card>
          )}

          {batchTrace && (
            <Card size="small" title={<><NodeIndexOutlined /> 批次追溯</>}>
              <Descriptions column={2} size="small" bordered style={{ marginBottom: 12 }}>
                <Descriptions.Item label="批次">{batchTrace.batch.batchNo}</Descriptions.Item>
                <Descriptions.Item label="状态">{batchTrace.batch.status}</Descriptions.Item>
                <Descriptions.Item label="入库量">{fmt(batchTrace.batch.quantity, 1)} m / {fmt(batchTrace.batch.weightKg, 1)} kg</Descriptions.Item>
                <Descriptions.Item label="剩余">{fmt(batchTrace.batch.remaining, 1)} m</Descriptions.Item>
              </Descriptions>
              <SpecCard spec={batchTrace.spec} />
              <Card size="small" title="来源" style={{ marginBottom: 12 }}>
                <OriginChain origin={batchTrace.origin} />
              </Card>
              <Card size="small" title={`去向（被 ${batchTrace.consumedBy.length} 张单消耗）`}>
                {batchTrace.consumedBy.length === 0 ? (
                  <Empty description="尚未出库" />
                ) : (
                  <Table
                    rowKey={(r) => r.docNo + r.date}
                    size="small"
                    pagination={false}
                    dataSource={batchTrace.consumedBy}
                    columns={[
                      { title: '单据号', dataIndex: 'docNo', width: 150 },
                      {
                        title: '类型',
                        dataIndex: 'docType',
                        width: 110,
                        render: (v: string) => docTypeLabel(v),
                      },
                      { title: '出库(m)', dataIndex: 'outM', width: 100, align: 'right', render: (v: number) => fmt(v, 1) },
                      { title: '往来单位', dataIndex: 'partnerName', render: (v: string | null) => v ?? '-' },
                      { title: '时间', dataIndex: 'date', render: (v: string) => new Date(v).toLocaleString('zh-CN') },
                    ]}
                  />
                )}
              </Card>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
