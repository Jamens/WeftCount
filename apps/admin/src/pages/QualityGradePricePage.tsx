import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  App as AntdApp,
  Button,
  Card,
  Col,
  Empty,
  InputNumber,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import { ReloadOutlined, SaveOutlined } from '@ant-design/icons'
import { api } from '../lib/api'
import {
  dec,
  fmt,
  GRADE_COLOR,
  GRADE_PRICE_MODE_LABEL,
  GRADE_PRICE_SCOPE_LABEL,
  PERM,
  type ContractItemWire,
  type ContractWire,
  type GradePriceModeValue,
  type GradePriceScopeValue,
  type GradePriceWire,
  type GreigeSpecWire,
} from '../lib/erp'
import { calcGradePrice, GRADE_LABELS, GREIGE_GRADES, type GreigeGrade } from '@weftcount/shared'
import { useAuthStore } from '../stores/auth.store'

const { Title, Text } = Typography

interface RowState {
  grade: GreigeGrade
  mode: GradePriceModeValue
  value: number | null
}

const EMPTY_ROWS: RowState[] = GREIGE_GRADES.map((g) => ({ grade: g, mode: 'delta', value: g === 'A' ? 0 : null }))

export default function QualityGradePricePage() {
  const { message } = AntdApp.useApp()
  const canReview = useAuthStore((s) => s.hasPermission(PERM.QUALITY_REVIEW))

  const [scope, setScope] = useState<GradePriceScopeValue>('contract_item')
  const [contracts, setContracts] = useState<ContractWire[]>([])
  const [contractId, setContractId] = useState<string | null>(null)
  const [items, setItems] = useState<ContractItemWire[]>([])
  const [itemId, setItemId] = useState<string | null>(null)
  const [specs, setSpecs] = useState<GreigeSpecWire[]>([])
  const [specId, setSpecId] = useState<string | null>(null)
  const [basePrice, setBasePrice] = useState<number>(10)
  const [rows, setRows] = useState<RowState[]>(EMPTY_ROWS)
  const [busy, setBusy] = useState(false)

  const refId = scope === 'contract_item' ? itemId : specId

  useEffect(() => {
    api.get<ContractWire[]>('/contracts').then((r) => setContracts(r.data.data)).catch(() => setContracts([]))
    api.get<GreigeSpecWire[]>('/greige-specs').then((r) => setSpecs(r.data.data)).catch(() => setSpecs([]))
  }, [])

  useEffect(() => {
    if (!contractId) {
      setItems([])
      setItemId(null)
      return
    }
    api
      .get<{ contract: ContractWire; items: ContractItemWire[] }>(`/contracts/${contractId}`)
      .then((r) => {
        setItems(r.data.data.items)
        setItemId(r.data.data.items[0]?.id ?? null)
      })
      .catch(() => setItems([]))
  }, [contractId])

  const loadRules = useCallback(async () => {
    if (!refId) {
      setRows(EMPTY_ROWS)
      return
    }
    const res = await api.get<GradePriceWire[]>(`/quality/grade-prices?scope=${scope}&refId=${refId}`)
    const byGrade = new Map(res.data.data.map((r) => [r.grade, r]))
    setRows(
      GREIGE_GRADES.map((g) => {
        const hit = byGrade.get(g)
        return { grade: g, mode: hit?.mode ?? 'delta', value: hit ? dec(hit.value) : null }
      }),
    )
  }, [scope, refId])

  useEffect(() => {
    void loadRules()
  }, [loadRules])

  const basePriceActual = useMemo(() => {
    if (scope === 'contract_item') {
      const it = items.find((i) => i.id === itemId)
      return it ? dec(it.agreedPrice) : basePrice
    }
    return basePrice
  }, [scope, items, itemId, basePrice])

  const save = async () => {
    if (!refId) return
    const rules = rows
      .filter((r) => r.value != null)
      .map((r) => ({ grade: r.grade, mode: r.mode, value: Number(r.value) }))
    for (const r of rules) {
      if (r.mode === 'discount' && (r.value <= 0 || r.value > 1)) {
        message.error(`${GRADE_LABELS[r.grade]} 的折扣率必须在 (0,1] 之间`)
        return
      }
    }
    setBusy(true)
    try {
      await api.put('/quality/grade-prices', { scope, refId, rules })
      message.success('分等价目已保存')
      await loadRules()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  const patch = (grade: GreigeGrade, p: Partial<RowState>) =>
    setRows((prev) => prev.map((r) => (r.grade === grade ? { ...r, ...p } : r)))

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title level={4} style={{ margin: 0 }}>
          分等价目
        </Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void loadRules()}>
            刷新
          </Button>
          {canReview && (
            <Button type="primary" icon={<SaveOutlined />} loading={busy} disabled={!refId} onClick={() => void save()}>
              保存
            </Button>
          )}
        </Space>
      </div>

      <Card size="small">
        <Text type="secondary">
          定等只有接到价格上才产生价值：等级价差 5~15%，不配价目就等于白验。
          取价优先级为「合同明细协议价 &gt; 规格挂牌价 &gt; 不分等原价」。
        </Text>
      </Card>

      <Card size="small">
        <Row gutter={12}>
          <Col flex="1 1 220px">
            <Text type="secondary">挂载范围</Text>
            <Select
              style={{ width: '100%', marginTop: 4 }}
              value={scope}
              onChange={(v) => {
                setScope(v)
                setRows(EMPTY_ROWS)
              }}
              options={(['contract_item', 'spec'] as GradePriceScopeValue[]).map((v) => ({
                value: v,
                label: GRADE_PRICE_SCOPE_LABEL[v],
              }))}
            />
          </Col>

          {scope === 'contract_item' ? (
            <>
              <Col flex="1 1 220px">
                <Text type="secondary">合同</Text>
                <Select
                  style={{ width: '100%', marginTop: 4 }}
                  showSearch
                  optionFilterProp="label"
                  placeholder="选择合同"
                  value={contractId ?? undefined}
                  onChange={setContractId}
                  options={contracts.map((c) => ({ value: c.id, label: `${c.contractNo} · ${c.partnerName}` }))}
                />
              </Col>
              <Col flex="1 1 260px">
                <Text type="secondary">合同明细</Text>
                <Select
                  style={{ width: '100%', marginTop: 4 }}
                  placeholder="选择明细行"
                  value={itemId ?? undefined}
                  onChange={setItemId}
                  options={items.map((it, i) => ({
                    value: it.id,
                    label: `第 ${i + 1} 行 · 协议价 ${fmt(it.agreedPrice, 4)} 元/米`,
                  }))}
                />
              </Col>
            </>
          ) : (
            <>
              <Col flex="1 1 260px">
                <Text type="secondary">坯布规格</Text>
                <Select
                  style={{ width: '100%', marginTop: 4 }}
                  showSearch
                  optionFilterProp="label"
                  placeholder="选择规格"
                  value={specId ?? undefined}
                  onChange={setSpecId}
                  options={specs.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))}
                />
              </Col>
              <Col flex="1 1 180px">
                <Text type="secondary">基准价（元/米）</Text>
                <InputNumber
                  style={{ width: '100%', marginTop: 4 }}
                  min={0}
                  value={basePrice}
                  onChange={(v) => setBasePrice(Number(v ?? 0))}
                />
              </Col>
            </>
          )}
        </Row>
      </Card>

      <Card size="small" title="各品等价格规则">
        {!refId ? (
          <Empty description="先选择要挂价目的对象" />
        ) : (
          <Table<RowState>
            rowKey="grade"
            size="small"
            dataSource={rows}
            pagination={false}
            columns={[
              {
                title: '品等',
                dataIndex: 'grade',
                width: 110,
                render: (v: GreigeGrade) => <Tag color={GRADE_COLOR[v]}>{GRADE_LABELS[v]}</Tag>,
              },
              {
                title: '调价方式',
                dataIndex: 'mode',
                width: 220,
                render: (v: GradePriceModeValue, r) => (
                  <Select
                    size="small"
                    style={{ width: '100%' }}
                    value={v}
                    disabled={!canReview}
                    onChange={(nv) => patch(r.grade, { mode: nv })}
                    options={(['fixed', 'discount', 'delta'] as GradePriceModeValue[]).map((m) => ({
                      value: m,
                      label: GRADE_PRICE_MODE_LABEL[m],
                    }))}
                  />
                ),
              },
              {
                title: '数值',
                dataIndex: 'value',
                width: 160,
                render: (v: number | null, r) => (
                  <InputNumber
                    size="small"
                    style={{ width: '100%' }}
                    value={v}
                    disabled={!canReview}
                    onChange={(nv) => patch(r.grade, { value: nv == null ? null : Number(nv) })}
                  />
                ),
              },
              {
                title: '计算后单价（元/米）',
                width: 180,
                align: 'right',
                render: (_: unknown, r) => {
                  if (r.value == null) return <Text type="secondary">沿用基准价 {fmt(basePriceActual, 4)}</Text>
                  const price = calcGradePrice(basePriceActual, { grade: r.grade, mode: r.mode, value: r.value })
                  return <Text strong>{fmt(price, 4)}</Text>
                },
              },
            ]}
          />
        )}
        {refId && (
          <div style={{ marginTop: 12 }}>
            <Text type="secondary">基准价 {fmt(basePriceActual, 4)} 元/米</Text>
            <Text type="secondary"> · 留空表示该等级不分等计价，沿用基准价</Text>
          </div>
        )}
      </Card>
    </Space>
  )
}
