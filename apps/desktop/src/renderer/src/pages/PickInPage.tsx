import { useCallback, useEffect, useRef, useState } from 'react'
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
  Statistic,
  Tag,
  Typography,
  type InputRef,
} from 'antd'
import { BarcodeOutlined, InboxOutlined } from '@ant-design/icons'
import { api } from '../lib/api'
import { fmt, num, type BatchOrigin, type BatchWire, type GreigeSpecWire, type MaterialWire, type PartnerWire, type WarehouseWire } from '../lib/types'

const { Title, Text } = Typography

/** 采购录入单位 */
const UNITS = ['m', 'kg', 'm2']

interface Template {
  batchNo: string
  materialId: string
  specId: string
  /** 模板来源：supplier_code=扫供应商条码识别；batch=扫上批批次码 */
  source: 'supplier_code' | 'batch'
  supplierId?: string
  supplierName?: string
  lastPrice?: number
}

function supplierFromOrigin(origin: BatchOrigin | null): { id?: string; name?: string } {
  if (origin && origin.kind === 'purchase' && origin.supplier) {
    return { id: origin.supplier.id, name: origin.supplier.name }
  }
  return {}
}

/**
 * 扫码入库（收货）
 *
 * 到货商品上没有「我们的」标签（是收货后才打），所以这里不解析外来码，而是
 * **扫「上批同款」的批次标签作模板**：自动带出物料/规格/仓库，若上批是采购入库再带出
 * 供应商，工人只填数量/单价即可建新批次——闭环「上批入库→打标签→下次收货扫上批→快速建本批」。
 * 不扫也能用(手动选物料规格)，扫了更快。
 */
export default function PickInPage() {
  const { message } = AntdApp.useApp()
  const inputRef = useRef<InputRef>(null)
  const [code, setCode] = useState('')
  const [batches, setBatches] = useState<BatchWire[]>([])
  const [materials, setMaterials] = useState<MaterialWire[]>([])
  const [specs, setSpecs] = useState<GreigeSpecWire[]>([])
  const [suppliers, setSuppliers] = useState<PartnerWire[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseWire[]>([])

  const [template, setTemplate] = useState<Template | null>(null)
  const [materialId, setMaterialId] = useState<string | undefined>()
  const [specId, setSpecId] = useState<string | undefined>()
  const [supplierId, setSupplierId] = useState<string | undefined>()
  const [unit, setUnit] = useState('m')
  const [qty, setQty] = useState<number | null>(null)
  const [price, setPrice] = useState<number | null>(null)
  const [warehouseId, setWarehouseId] = useState<string | undefined>()
  const [submitting, setSubmitting] = useState(false)
  const [lastBatchNo, setLastBatchNo] = useState<string | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    Promise.all([
      api.get<BatchWire[]>('/inventory/batches'),
      api.get<MaterialWire[]>('/materials'),
      api.get<GreigeSpecWire[]>('/greige-specs'),
      api.get<PartnerWire[]>('/partners?status=active'),
      api.get<WarehouseWire[]>('/warehouses'),
    ])
      .then(([b, m, s, p, w]) => {
        setBatches(b)
        setMaterials(m)
        setSpecs(s)
        setSuppliers(p.filter((x) => x.type === 'supplier' || x.type === 'both'))
        setWarehouses(w)
        setWarehouseId((prev) => prev ?? w[0]?.id)
      })
      .catch((e) => message.error(e instanceof Error ? e.message : '加载基础数据失败'))
  }, [message])

  const specName = useCallback((id: string) => specs.find((s) => s.id === id)?.name ?? id, [specs])
  const materialName = useCallback((id: string) => materials.find((m) => m.id === id)?.name ?? id, [materials])

  const onScan = async () => {
    const c = code.trim()
    if (!c) return

    // 1) 优先按「供应商条码」查映射（选了供应商则在该供应商内精确匹配）
    try {
      const q = new URLSearchParams({ code: c })
      if (supplierId) q.set('supplierId', supplierId)
      const hit = await api.get<
        | { ambiguous: false; supplierId: string; materialId: string; specId: string; supplierCode: string }
        | { ambiguous: true }
        | null
      >(`/supplier-codes/lookup?${q.toString()}`)
      if (hit && 'ambiguous' in hit && hit.ambiguous) {
        message.warning(`条码「${c}」在多个供应商下都有映射，请先选择供应商再扫`)
        setCode('')
        return
      }
      if (hit && 'ambiguous' in hit && !hit.ambiguous) {
        setSupplierId(hit.supplierId)
        setMaterialId(hit.materialId)
        setSpecId(hit.specId)
        setTemplate({ batchNo: hit.supplierCode, materialId: hit.materialId, specId: hit.specId, source: 'supplier_code' })
        setCode('')
        message.success(`供应商条码「${hit.supplierCode}」已识别：${materialName(hit.materialId)} / ${specName(hit.specId)}`)
        inputRef.current?.focus()
        return
      }
    } catch {
      /* 映射接口失败则回退批次模板 */
    }

    // 2) 回退：按批次码当模板（上批同款）
    const b = batches.find((x) => x.batchNo.toUpperCase() === c.toUpperCase())
    if (!b) {
      message.warning(`未识别「${c}」：既非已映射的供应商条码，也非已有批次号`)
      setCode('')
      return
    }
    setTemplate({ batchNo: b.batchNo, materialId: b.materialId, specId: b.specId, source: 'batch' })
    setMaterialId(b.materialId)
    setSpecId(b.specId)
    setWarehouseId(b.warehouseId ?? warehouseId)
    setCode('')
    try {
      const t = await api.get<{ origin: BatchOrigin | null; consumedBy: unknown[] }>(`/traceability/batch/${b.id}`)
      const sup = supplierFromOrigin(t.origin)
      if (sup.id) {
        setSupplierId(sup.id)
        setTemplate((prev) => (prev ? { ...prev, supplierId: sup.id, supplierName: sup.name } : prev))
      }
    } catch {
      /* 追溯查不到供应商不影响主流程 */
    }
    message.success(`已以批次 ${b.batchNo} 为模板带出物料/规格`)
    inputRef.current?.focus()
  }

  const clearTemplate = () => {
    setTemplate(null)
    setMaterialId(undefined)
    setSpecId(undefined)
    setSupplierId(undefined)
    setPrice(null)
  }

  const onSubmit = async () => {
    if (!materialId || !specId) {
      message.warning('请选择物料与规格（或先扫上批标签）')
      return
    }
    if (!supplierId) {
      message.warning('请选择供应商')
      return
    }
    if (!qty || qty <= 0) {
      message.warning('请输入收货数量')
      return
    }
    setSubmitting(true)
    try {
      const res = await api.post<{ id: string; docNo: string }>('/inventory/purchase-inbound', {
        materialId,
        specId,
        enteredUnit: unit,
        enteredValue: qty,
        unitPrice: price,
        partnerId: supplierId,
        warehouseId,
      })
      // 回读新批次号(按来源单据定位)，便于提示打印标签
      let newBatchNo = ''
      try {
        const all = await api.get<BatchWire[]>('/inventory/batches')
        setBatches(all)
        newBatchNo = all.find((x) => x.sourceDocId === res.id)?.batchNo ?? ''
      } catch {
        /* 忽略 */
      }
      setLastBatchNo(newBatchNo || res.docNo)
      message.success(`入库成功：单据 ${res.docNo}${newBatchNo ? `，批次 ${newBatchNo}` : ''}`)
      clearTemplate()
      setQty(null)
      setPrice(null)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '入库失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <Row gutter={[12, 12]}>
        <Col span={24}>
          <Card size="small">
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Title level={4} style={{ margin: 0 }}>扫码入库（收货建批次）</Title>
              <Text type="secondary">
                扫「上批同款」的批次标签作模板，自动带出物料/规格/供应商；再填数量即建新批次。
              </Text>
              <Space.Compact style={{ width: 420 }}>
                <Input
                  ref={inputRef}
                  size="large"
                  prefix={<BarcodeOutlined />}
                  placeholder="扫描上批批次号后回车（可不扫）"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onPressEnter={() => void onScan()}
                />
                <Button type="primary" size="large" onClick={() => void onScan()}>取模板</Button>
              </Space.Compact>
            </Space>
          </Card>
        </Col>

        {template && (
          <Col span={24}>
            <Alert
              type="success"
              showIcon
              message={template.source === 'supplier_code' ? `已识别供应商条码「${template.batchNo}」` : `已以批次 ${template.batchNo} 为模板`}
              description={
                <Space wrap>
                  <Tag color={template.source === 'supplier_code' ? 'purple' : 'default'}>
                    {template.source === 'supplier_code' ? '供应商码' : '批次模板'}
                  </Tag>
                  <Tag>物料 {materialName(template.materialId)}</Tag>
                  <Tag>规格 {specName(template.specId)}</Tag>
                  {template.supplierName && <Tag color="blue">供应商 {template.supplierName}</Tag>}
                </Space>
              }
              action={<Button size="small" onClick={clearTemplate}>清除模板</Button>}
            />
          </Col>
        )}

        <Col span={15}>
          <Card size="small" title="收货信息">
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <Row gutter={12}>
                <Col span={12}>
                  <Text type="secondary">物料</Text>
                  <Select
                    showSearch optionFilterProp="label" style={{ width: '100%' }} placeholder="选择物料"
                    value={materialId} onChange={setMaterialId} disabled={!!template}
                    options={materials.filter((m) => m.category === 'greige' || m.category === 'yarn').map((m) => ({ value: m.id, label: `${m.code} ${m.name}` }))}
                  />
                </Col>
                <Col span={12}>
                  <Text type="secondary">规格</Text>
                  <Select
                    showSearch optionFilterProp="label" style={{ width: '100%' }} placeholder="选择规格"
                    value={specId} onChange={setSpecId} disabled={!!template}
                    options={specs.map((s) => ({ value: s.id, label: `${s.code} ${s.name}` }))}
                  />
                </Col>
              </Row>
              <Row gutter={12}>
                <Col span={12}>
                  <Text type="secondary">供应商</Text>
                  <Select
                    showSearch optionFilterProp="label" style={{ width: '100%' }} placeholder="选择供应商"
                    value={supplierId} onChange={setSupplierId}
                    options={suppliers.map((s) => ({ value: s.id, label: `${s.name}（${s.code}）` }))}
                  />
                </Col>
                <Col span={12}>
                  <Text type="secondary">入库仓库</Text>
                  <Select
                    style={{ width: '100%' }} value={warehouseId} onChange={setWarehouseId}
                    options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
                  />
                </Col>
              </Row>
              <Row gutter={12}>
                <Col span={8}>
                  <Text type="secondary">单位</Text>
                  <Select style={{ width: '100%' }} value={unit} onChange={setUnit} options={UNITS.map((u) => ({ value: u, label: u }))} />
                </Col>
                <Col span={8}>
                  <Text type="secondary">数量</Text>
                  <InputNumber style={{ width: '100%' }} min={0.001} precision={1} value={qty ?? undefined} onChange={(v) => setQty(v ?? null)} placeholder="收货数量" />
                </Col>
                <Col span={8}>
                  <Text type="secondary">单价（元/米，可选）</Text>
                  <InputNumber style={{ width: '100%' }} min={0} precision={4} value={price ?? undefined} onChange={(v) => setPrice(v ?? null)} />
                </Col>
              </Row>
              <Button type="primary" size="large" block icon={<InboxOutlined />} loading={submitting} onClick={() => void onSubmit()}>
                确认入库（建新批次）
              </Button>
              {lastBatchNo && (
                <Alert type="info" showIcon message={`最近入库批次：${lastBatchNo}`} description="可在「标签打印」为该批次打印布匹标签，下次收货即可扫它作模板。" />
              )}
            </Space>
          </Card>
        </Col>

        <Col span={9}>
          <Card size="small" title="说明">
            <Space direction="vertical" size="small">
              <Statistic title="可扫模板批次" value={batches.length} suffix="个" />
              <Text type="secondary" style={{ fontSize: 12 }}>
                到货时商品还没有我们的标签，所以不解析外来码；改为扫「上批同款」批次标签作模板。
              </Text>
            </Space>
          </Card>
        </Col>
      </Row>
    </div>
  )
}
