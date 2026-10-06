import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  App as AntdApp,
  Alert,
  Button,
  Card,
  Col,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  type InputRef,
} from 'antd'
import { BarcodeOutlined, DeleteOutlined, SendOutlined } from '@ant-design/icons'
import { api } from '../lib/api'
import { fmt, num, type BatchWire, type GreigeSpecWire, type PartnerWire } from '../lib/types'

const { Title, Text } = Typography

interface Pick {
  batchId: string
  batchNo: string
  specId: string
  specName: string
  quantityM: number
  remaining: number
}

/**
 * 扫码拣货出库（销售）
 *
 * 扫布匹标签上的批次码 → 加入拣货清单 → 确认发货。
 * 与「扫码查询」不同，这里**真正驱动库存**：把扫到的批次按拣货数量出库
 * （发什么扫什么），替代 FIFO 自动拣货。单据限一个规格（首扫批次决定），
 * 后端会校验批次规格一致、剩余充足。
 */
export default function PickPage() {
  const { message } = AntdApp.useApp()
  const inputRef = useRef<InputRef>(null)
  const [code, setCode] = useState('')
  const [batches, setBatches] = useState<BatchWire[]>([])
  const [specs, setSpecs] = useState<GreigeSpecWire[]>([])
  const [customers, setCustomers] = useState<PartnerWire[]>([])
  const [picks, setPicks] = useState<Pick[]>([])
  const [customerId, setCustomerId] = useState<string | undefined>()
  const [unitPrice, setUnitPrice] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    inputRef.current?.focus()
    Promise.all([
      api.get<BatchWire[]>('/inventory/batches'),
      api.get<GreigeSpecWire[]>('/greige-specs'),
      api.get<PartnerWire[]>('/partners?status=active'),
    ])
      .then(([b, s, p]) => {
        setBatches(b)
        setSpecs(s)
        setCustomers(p.filter((x) => x.type === 'customer' || x.type === 'both'))
      })
      .catch(() => undefined)
  }, [])

  const specName = useCallback((id: string) => specs.find((s) => s.id === id)?.name ?? id, [specs])
  const activeBatches = useMemo(() => batches.filter((b) => b.status === 'normal' && num(b.remainingQuantity) > 0), [batches])

  const onScan = () => {
    const c = code.trim().toUpperCase()
    if (!c) return
    const b = activeBatches.find((x) => x.batchNo.toUpperCase() === c)
    if (!b) {
      message.warning(`未找到可用批次「${c}」`)
      setCode('')
      return
    }
    if (picks.some((p) => p.batchId === b.id)) {
      message.info(`批次 ${b.batchNo} 已在拣货清单中`)
      setCode('')
      return
    }
    if (picks.length > 0 && picks[0].specId !== b.specId) {
      message.warning(`批次 ${b.batchNo} 规格与首扫批次不一致（本单限一个规格）`)
      setCode('')
      return
    }
    setPicks((p) => [
      ...p,
      { batchId: b.id, batchNo: b.batchNo, specId: b.specId, specName: specName(b.specId), quantityM: num(b.remainingQuantity), remaining: num(b.remainingQuantity) },
    ])
    setCode('')
    inputRef.current?.focus()
  }

  const totalM = useMemo(() => picks.reduce((s, p) => s + (p.quantityM || 0), 0), [picks])

  const onSubmit = async () => {
    if (!customerId) {
      message.warning('请选择客户')
      return
    }
    if (picks.length === 0 || totalM <= 0) {
      message.warning('拣货清单为空')
      return
    }
    const first = picks[0]
    setSubmitting(true)
    try {
      const res = await api.post<{ docNo: string }>('/inventory/sales-outbound', {
        materialId: batches.find((b) => b.id === first.batchId)!.materialId,
        specId: first.specId,
        enteredUnit: 'm',
        enteredValue: totalM,
        unitPrice: unitPrice,
        partnerId: customerId,
        pickedItems: picks.map((p) => ({ batchId: p.batchId, quantityM: p.quantityM })),
      })
      message.success(`已发货：单据 ${res.docNo}，${picks.length} 个批次共 ${fmt(totalM, 1)}m`)
      setPicks([])
      setUnitPrice(null)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '出库失败')
    } finally {
      setSubmitting(false)
    }
  }

  const removePick = (batchId: string) => setPicks((p) => p.filter((x) => x.batchId !== batchId))

  return (
    <div style={{ padding: 16 }}>
      <Row gutter={[12, 12]}>
        <Col span={24}>
          <Card size="small">
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Title level={4} style={{ margin: 0 }}>扫码出库（拣货发货）</Title>
              <Text type="secondary">扫布匹标签条码加入拣货清单，确认后按扫到的批次发货（发什么扫什么）。单据限一个规格。</Text>
              <Space.Compact style={{ width: 420 }}>
                <Input
                  ref={inputRef}
                  size="large"
                  prefix={<BarcodeOutlined />}
                  placeholder="扫描或输入批次号后回车"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onPressEnter={onScan}
                />
                <Button type="primary" size="large" onClick={onScan}>加入</Button>
              </Space.Compact>
            </Space>
          </Card>
        </Col>

        <Col span={15}>
          <Card size="small" title={`拣货清单（${picks.length} 个批次）`}>
            {picks.length === 0 ? (
              <Text type="secondary">扫批次码加入清单</Text>
            ) : (
              <Table<Pick>
                rowKey="batchId" size="small" pagination={false} dataSource={picks}
                columns={[
                  { title: '批次号', dataIndex: 'batchNo', width: 140 },
                  { title: '规格', dataIndex: 'specName', width: 130 },
                  { title: '剩余(米)', dataIndex: 'remaining', width: 90, align: 'right', render: (v: number) => fmt(v, 1) },
                  {
                    title: '拣货(米)', dataIndex: 'quantityM', width: 120,
                    render: (v: number, r) => (
                      <InputNumber
                        style={{ width: 100 }} min={0.001} max={r.remaining} precision={1} value={v}
                        onChange={(nv) => setPicks((p) => p.map((x) => (x.batchId === r.batchId ? { ...x, quantityM: nv ?? 0 } : x)))}
                      />
                    ),
                  },
                  { title: '操作', width: 60, render: (_, r) => <Button type="text" danger icon={<DeleteOutlined />} onClick={() => removePick(r.batchId)} /> },
                ]}
                footer={() => <Text strong>合计：{fmt(totalM, 1)} m</Text>}
              />
            )}
          </Card>
        </Col>

        <Col span={9}>
          <Card size="small" title="发货信息">
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <div>
                <Text type="secondary">客户</Text>
                <div>
                  <Select
                    showSearch optionFilterProp="label" style={{ width: '100%' }} placeholder="选择客户"
                    value={customerId} onChange={setCustomerId}
                    options={customers.map((c) => ({ value: c.id, label: `${c.name}（${c.code}）` }))}
                  />
                </div>
              </div>
              <div>
                <Text type="secondary">单价（元/米，可选）</Text>
                <div><InputNumber style={{ width: '100%' }} min={0} precision={4} value={unitPrice ?? undefined} onChange={(v) => setUnitPrice(v ?? null)} /></div>
              </div>
              <Button type="primary" block icon={<SendOutlined />} loading={submitting} disabled={picks.length === 0} onClick={() => void onSubmit()}>
                确认出库
              </Button>
              <Alert type="info" showIcon message="拣货后按扫到的批次扣减库存（替代先进先出）。批次规格须一致、剩余须充足，否则后端会拒绝。" />
            </Space>
          </Card>
        </Col>
      </Row>
    </div>
  )
}
