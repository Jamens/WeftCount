import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  App as AntdApp,
  Alert,
  Button,
  Card,
  Col,
  Input,
  InputNumber,
  Radio,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  type InputRef,
} from 'antd'
import { BarcodeOutlined, DeleteOutlined, SendOutlined } from '@ant-design/icons'
import { api, postOrQueue } from '../lib/api'
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

/** 件卡发货清单项（扫件卡条码；**支持拆匹**：可只发部分米数，残匹留库） */
interface RollPick {
  rollNo: string
  /** 该匹原始米数 */
  meters: number
  /** 该匹当前剩余米数（拆匹前=米数） */
  remainM: number
  /** 本次实际发货米数（默认整匹=remainM，可改小=拆匹） */
  shipM: number
  specId: string
  specName: string
  batchNo: string
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
  // 件卡模式：扫件卡发货（整匹出库，走 pickedRolls）
  const [rollMode, setRollMode] = useState(false)
  const [rollPicks, setRollPicks] = useState<RollPick[]>([])

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
    if (rollMode) { void onScanRoll(c); return }
    const b = activeBatches.find((x) => x.batchNo.toUpperCase() === c)
    if (!b) {
      // 区分「压根没这个批次」与「批次存在但已耗尽/不可用」——都说「未找到」会误导排查
      const any = batches.find((x) => x.batchNo.toUpperCase() === c)
      if (!any) {
        message.warning(`未找到批次「${c}」，请确认单号是否正确`)
      } else if (num(any.remainingQuantity) <= 0) {
        message.warning(`批次「${c}」已耗尽（剩余 0），不能拣货`)
      } else {
        message.warning(`批次「${c}」当前不可用（状态：${any.status}）`)
      }
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
  const totalRollM = useMemo(() => rollPicks.reduce((s, p) => s + p.shipM, 0), [rollPicks])

  /** 件卡扫码：查件卡 → 加入发货清单（整匹） */
  const onScanRoll = async (rollNo: string) => {
    try {
      const info = await api.get<{ rollNo: string; meters: string; remainingM: string; status: string; specId: string; specName: string; batchNo: string }>(
        `/inventory/rolls/lookup?rollNo=${encodeURIComponent(rollNo)}`
      )
      if (info.status !== 'in_stock') {
        message.warning(`件卡 ${info.rollNo} 不可用（已出库）`)
        setCode('')
        return
      }
      if (rollPicks.some((p) => p.rollNo === info.rollNo)) {
        message.info(`件卡 ${info.rollNo} 已在发货清单`)
        setCode('')
        return
      }
      if (rollPicks.length > 0 && rollPicks[0].specId !== info.specId) {
        message.warning(`件卡 ${info.rollNo} 规格与首件不一致（本单限一个规格）`)
        setCode('')
        return
      }
      setRollPicks((p) => [
        ...p,
        {
        rollNo: info.rollNo,
        meters: num(info.meters),
        remainM: num(info.remainingM ?? info.meters),
        shipM: num(info.remainingM ?? info.meters), // 默认整匹发
        specId: info.specId,
        specName: info.specName,
        batchNo: info.batchNo,
      },
      ])
      setCode('')
      inputRef.current?.focus()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '件卡查询失败')
      setCode('')
    }
  }

  const onSubmit = async () => {
    if (!customerId) {
      message.warning('请选择客户')
      return
    }
    if (rollMode) return submitRolls()
    if (picks.length === 0 || totalM <= 0) {
      message.warning('拣货清单为空')
      return
    }
    const first = picks[0]
    setSubmitting(true)
    try {
      const res = await postOrQueue<{ docNo: string }>('扫码出库', '/inventory/sales-outbound', {
        materialId: batches.find((b) => b.id === first.batchId)!.materialId,
        specId: first.specId,
        enteredUnit: 'm',
        enteredValue: totalM,
        unitPrice: unitPrice,
        partnerId: customerId,
        pickedItems: picks.map((p) => ({ batchId: p.batchId, quantityM: p.quantityM })),
      })
      const tag = res.queued ? '（网络中断，已离线暂存待同步）' : ''
      if (res.queued) { message.warning(`已离线暂存出库：${fmt(totalM, 1)}m${tag}`) } else message.success(`已发货：单据 ${res.data.docNo}，${picks.length} 个批次共 ${fmt(totalM, 1)}m`)
      setPicks([])
      setUnitPrice(null)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '出库失败')
    } finally {
      setSubmitting(false)
    }
  }

  const removePick = (batchId: string) => setPicks((p) => p.filter((x) => x.batchId !== batchId))
  const removeRoll = (rollNo: string) => setRollPicks((p) => p.filter((x) => x.rollNo !== rollNo))

  /** 件卡发货提交：整匹出库（pickedRolls） */
  const submitRolls = async () => {
    if (rollPicks.length === 0 || totalRollM <= 0) {
      message.warning('件卡发货清单为空')
      return
    }
    setSubmitting(true)
    try {
      const res = await postOrQueue<{ docNo: string }>('扫码出库', '/inventory/sales-outbound', {
        materialId: batches.find((b) => b.specId === rollPicks[0].specId)?.materialId,
        specId: rollPicks[0].specId,
        enteredUnit: 'm',
        enteredValue: totalRollM,
        unitPrice: unitPrice,
        partnerId: customerId,
        // shipM < remainM 即拆匹发货，服务端会校验不得超剩余量
        pickedRolls: rollPicks.map((p) => ({ rollNo: p.rollNo, meters: p.shipM })),
      })
      const splitCnt = rollPicks.filter((p) => p.shipM < p.remainM - 1e-6).length
      if (res.queued) {
        message.warning(
          `网络中断，件卡发货已离线暂存（${rollPicks.length} 匹共 ${fmt(totalRollM, 1)}m），恢复后自动同步`,
        )
      } else {
        message.success(
          splitCnt > 0
            ? `已发货：单据 ${res.data.docNo}，${rollPicks.length} 匹共 ${fmt(totalRollM, 1)}m（其中 ${splitCnt} 匹拆匹发，残匹留库）`
            : `已发货：单据 ${res.data.docNo}，${rollPicks.length} 匹共 ${fmt(totalRollM, 1)}m`,
        )
      }
      setRollPicks([])
      setUnitPrice(null)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '件卡发货失败')
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
              <Title level={4} style={{ margin: 0 }}>扫码出库（拣货发货）</Title>
              <Space>
                <Radio.Group value={rollMode ? 'roll' : 'batch'} onChange={(e) => { setRollMode((e.target.value as string) === 'roll'); setCode('') }} optionType="button" size="small" buttonStyle="solid"
                  options={[{ label: '按批次', value: 'batch' }, { label: '按件卡(整匹)', value: 'roll' }]} />
              </Space>
              <Text type="secondary">{rollMode ? '扫件卡条码整匹发货（发什么扫什么），单据限一个规格。' : '扫布匹标签条码加入拣货清单，确认后按扫到的批次发货（发什么扫什么）。单据限一个规格。'}</Text>
              <Space.Compact style={{ width: 420 }}>
                <Input
                  ref={inputRef}
                  size="large"
                  prefix={<BarcodeOutlined />}
                  placeholder={rollMode ? '扫描或输入件卡号后回车' : '扫描或输入批次号后回车'}
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
          <Card size="small" title={rollMode ? `件卡发货清单（${rollPicks.length} 匹）` : `拣货清单（${picks.length} 个批次）`}>
            {rollMode ? (
              rollPicks.length === 0 ? (
                <Text type="secondary">扫件卡码加入清单（默认整匹发货；可改小=拆匹发，残匹留库）</Text>
              ) : (
                <Table<RollPick>
                  rowKey="rollNo" size="small" pagination={false} dataSource={rollPicks}
                  columns={[
                    { title: '件卡号', dataIndex: 'rollNo', width: 140 },
                    { title: '规格', dataIndex: 'specName', width: 120 },
                    { title: '所属批次', dataIndex: 'batchNo', width: 120 },
                    {
                      title: '剩余(米)', dataIndex: 'remainM', width: 88, align: 'right',
                      render: (v: number) => fmt(v, 1),
                    },
                    {
                      title: '发货(米)', dataIndex: 'shipM', width: 130,
                      render: (v: number, r) => (
                        <InputNumber
                          style={{ width: 104 }} min={0.001} max={r.remainM} precision={1} value={v}
                          onChange={(nv) =>
                            setRollPicks((p) =>
                              p.map((x) => (x.rollNo === r.rollNo ? { ...x, shipM: Math.min(nv ?? 0, x.remainM) } : x))
                            )
                          }
                        />
                      ),
                    },
                    {
                      title: '', width: 66, align: 'center',
                      // 一键在「整匹」与「拆匹」间切换
                      render: (_: unknown, r: RollPick) =>
                        r.shipM < r.remainM - 1e-6 ? (
                          <Button type="link" size="small" onClick={() => setRollPicks((p) => p.map((x) => (x.rollNo === r.rollNo ? { ...x, shipM: x.remainM } : x)))}>
                            整匹
                          </Button>
                        ) : (
                          <Text type="secondary" style={{ fontSize: 11 }}>整匹</Text>
                        ),
                    },
                    { title: '操作', width: 60, render: (_, r) => <Button type="text" danger icon={<DeleteOutlined />} onClick={() => removeRoll(r.rollNo)} /> },
                  ]}
                  footer={() => {
                    const split = rollPicks.filter((p) => p.shipM < p.remainM - 1e-6).length
                    return (
                      <Text strong>
                        合计：{fmt(totalRollM, 1)} m（{rollPicks.length} 匹
                        {split > 0 ? `，其中 ${split} 匹拆匹发` : ''}）
                      </Text>
                    )
                  }}
                />
              )
            ) : picks.length === 0 ? (
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
              <Button type="primary" block icon={<SendOutlined />} loading={submitting} disabled={rollMode ? rollPicks.length === 0 : picks.length === 0} onClick={() => void onSubmit()}>
                {rollMode ? `确认出库（${rollPicks.length} 匹 / ${fmt(totalRollM, 1)}m）` : '确认出库'}
              </Button>
              <Alert type="info" showIcon message={rollMode ? '按件卡整匹发货：件卡状态置为已售出，扫过/已售的件卡不可重复发；件卡规格须与单据一致，否则后端拒绝。' : '拣货后按扫到的批次扣减库存（替代先进先出）。批次规格须一致、剩余须充足，否则后端会拒绝。'} />
            </Space>
          </Card>
        </Col>
      </Row>
    </div>
  )
}
