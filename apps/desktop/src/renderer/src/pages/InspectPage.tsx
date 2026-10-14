import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  App as AntdApp,
  Button,
  Card,
  Col,
  Empty,
  Input,
  InputNumber,
  Popconfirm,
  Row,
  Select,
  Space,
  Statistic,
  Tag,
  Typography,
} from 'antd'
import { CheckCircleOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { api } from '../lib/api'
import { GRADE_LABELS, type GreigeGrade } from '@weftcount/shared'

const { Title, Text } = Typography

/**
 * 验布录入（质检员 · 车间触摸屏）
 *
 * ## 为什么疵点类型做成大按钮网格，而不是下拉框
 * 车间戴手套、屏幕有油污、验布机旁站着操作。下拉要点两次、还要在长列表里找，
 * 一天几百次操作下来很累。**点一下就是记一条**，位置和长度是可选补充。
 *
 * ## 交互顺序（按实际验布动作排）
 * 1. 扫件卡（或手输件卡号）→ 加入待检
 * 2. 输入疵点位置（可选）→ 点疵点类型按钮
 * 3. 右下角实时显示 扣分/密度/品等 —— 录完就知道这匹几等，不用等提交
 * 4. 整匹验完点下一匹；全部验完点「定等」，等级写回件卡
 *
 * ## 在线要求
 * 疵点与定等都走同步请求，**没有离线兜底**（不同于报工）。
 * 原因：验布是质检室里的桌面作业，网络条件比车间挡车工端稳定；
 * 且定等是有状态推进的，乱序重放会让「已定等的单又收到疵点」这种矛盾状态。
 */
interface DefectTypeWire {
  id: string
  code: string
  name: string
  category: string
  penaltyMode: 'by_length' | 'fixed'
  fixedPenalty: number
}

interface DefectWire {
  id: string
  defectTypeId: string
  defectCode: string
  positionM: number | null
  lengthInch: number | null
  penalty: number
}

interface RollWire {
  rollId: string
  rollNo: string
  meters: number
  widthInch: number
  sqYards: number
  totalPoints: number
  penaltyDensity: number
  overReceivingLimit: boolean
  grade: GreigeGrade | null
  defects: DefectWire[]
}

interface InspectionWire {
  id: string
  inspectionNo: string
  status: 'draft' | 'done' | 'void'
  rollCount: number
  totalPoints: number
  totalSqYd: string
  avgPenaltyDensity: string
  passRate: string | null
}

const GRADE_COLOR: Record<GreigeGrade, string> = {
  A: 'success',
  B: 'cyan',
  C: 'orange',
  D: 'error',
}

export default function InspectPage() {
  const { message } = AntdApp.useApp()

  const [inspections, setInspections] = useState<InspectionWire[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [rolls, setRolls] = useState<RollWire[]>([])
  const [defectTypes, setDefectTypes] = useState<DefectTypeWire[]>([])
  const [activeRollId, setActiveRollId] = useState<string | null>(null)

  const [rollNoInput, setRollNoInput] = useState('')
  const [positionM, setPositionM] = useState<number | null>(null)
  const [lengthInch, setLengthInch] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  const current = inspections.find((i) => i.id === currentId) ?? null
  const activeRoll = rolls.find((r) => r.rollId === activeRollId) ?? null

  const loadInspections = useCallback(async () => {
    const list = await api.get<InspectionWire[]>('/quality/inspections?status=draft')
    setInspections(list)
    setCurrentId((prev) => prev ?? list[0]?.id ?? null)
  }, [])

  const loadDetail = useCallback(async (id: string) => {
    const d = await api.get<{ inspection: InspectionWire; rolls: RollWire[] }>(`/quality/inspections/${id}`)
    setRolls(d.rolls)
    setActiveRollId((prev) => prev ?? d.rolls[0]?.rollId ?? null)
  }, [])

  useEffect(() => {
    void loadInspections()
    api
      .get<DefectTypeWire[]>('/quality/defect-types')
      .then(setDefectTypes)
      .catch(() => setDefectTypes([]))
  }, [loadInspections])

  useEffect(() => {
    if (currentId) void loadDetail(currentId)
    else setRolls([])
  }, [currentId, loadDetail])

  const createInspection = async () => {
    setBusy(true)
    try {
      const created = await api.post<InspectionWire>('/quality/inspections', { mode: 'full' })
      await loadInspections()
      setCurrentId(created.id)
      message.success(`已建检验单 ${created.inspectionNo}`)
    } finally {
      setBusy(false)
    }
  }

  const addRoll = async () => {
    const no = rollNoInput.trim()
    if (!no || !currentId) return
    setBusy(true)
    try {
      // addRolls 收的是 rollId，而验布机上拿到的是件卡号，先查一次。
      // 走质检自己的 lookup（只要 quality.inspect），不用库存那个要 inventory.manage 的。
      const hit = await api.get<{ id: string; grade: GreigeGrade | null; status: string }>(
        `/quality/rolls/lookup?rollNo=${encodeURIComponent(no)}`,
      )
      if (hit.status !== 'in_stock') {
        message.warning(`件卡 ${no} 当前状态 ${hit.status}，通常只验在库的布`)
      }
      await api.post(`/quality/inspections/${currentId}/rolls`, { rollIds: [hit.id] })
      await loadDetail(currentId)
      setActiveRollId(hit.id)
      setRollNoInput('')
      setPositionM(null)
      setLengthInch(null)
      message.success(
        hit.grade ? `件卡 ${no} 已加入（复验，当前${GRADE_LABELS[hit.grade]}）` : `件卡 ${no} 已加入`,
      )
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加入失败')
    } finally {
      setBusy(false)
    }
  }

  /** 点疵点类型按钮 = 记一条；位置/长度取输入框当前值（可为空） */
  const addDefect = async (dt: DefectTypeWire) => {
    if (!currentId || !activeRoll) return
    if (dt.penaltyMode === 'by_length' && lengthInch == null) {
      message.warning(`${dt.name} 按长度扣分，请先填长度（英寸）`)
      return
    }
    setBusy(true)
    try {
      await api.put(`/quality/inspections/${currentId}/rolls/${activeRoll.rollId}/defects`, {
        items: [
          ...activeRoll.defects.map((d) => ({
            defectTypeId: d.defectTypeId,
            positionM: d.positionM,
            lengthInch: d.lengthInch,
            remark: null,
          })),
          { defectTypeId: dt.id, positionM, lengthInch, remark: null },
        ],
      })
      await loadDetail(currentId)
      // 长度清了、位置留着：同一匹上常有一处连续疵点，位置不同但长度各自填
      setLengthInch(null)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '记录失败')
    } finally {
      setBusy(false)
    }
  }

  const removeDefect = async (index: number) => {
    if (!currentId || !activeRoll) return
    setBusy(true)
    try {
      await api.put(`/quality/inspections/${currentId}/rolls/${activeRoll.rollId}/defects`, {
        items: activeRoll.defects.filter((_, i) => i !== index).map((d) => ({
          defectTypeId: d.defectTypeId,
          positionM: d.positionM,
          lengthInch: d.lengthInch,
          remark: null,
        })),
      })
      await loadDetail(currentId)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '删除失败')
    } finally {
      setBusy(false)
    }
  }

  const finalize = async () => {
    if (!currentId) return
    setBusy(true)
    try {
      await api.post(`/quality/inspections/${currentId}/finalize`)
      message.success('已定等，等级写回件卡')
      setCurrentId(null)
      setRolls([])
      setActiveRollId(null)
      await loadInspections()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '定等失败')
    } finally {
      setBusy(false)
    }
  }

  const totalMeters = useMemo(() => rolls.reduce((s, r) => s + r.meters, 0), [rolls])
  const nameOf = (id: string) => defectTypes.find((t) => t.id === id)?.name ?? id

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Row gutter={12} align="middle">
        <Col flex="auto">
          <Space size="middle" wrap>
            <Title level={5} style={{ margin: 0 }}>
              验布录入
            </Title>
            <Select
              style={{ minWidth: 220 }}
              placeholder="选择进行中的检验单"
              value={currentId ?? undefined}
              onChange={(v) => {
                setCurrentId(v)
                setActiveRollId(null)
              }}
              options={inspections.map((i) => ({
                value: i.id,
                label: `${i.inspectionNo} · ${i.rollCount} 匹`,
              }))}
            />
            <Button icon={<PlusOutlined />} onClick={() => void createInspection()} loading={busy}>
              新建检验单
            </Button>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => {
                void loadInspections()
                if (currentId) void loadDetail(currentId)
              }}
            />
          </Space>
        </Col>
        <Col>
          <Popconfirm
            title={`将把 ${rolls.length} 匹的等级写回件卡，之后不能再改疵点。确认？`}
            onConfirm={() => void finalize()}
          >
            <Button
              type="primary"
              size="large"
              icon={<CheckCircleOutlined />}
              disabled={!currentId || rolls.length === 0}
              loading={busy}
            >
              定等
            </Button>
          </Popconfirm>
        </Col>
      </Row>

      <Row gutter={12}>
        <Col xs={24} lg={9}>
          <Card size="small" title="扫件卡加入待检">
            <Space.Compact style={{ width: '100%' }}>
              <Input
                size="large"
                placeholder="件卡号，回车加入"
                value={rollNoInput}
                onChange={(e) => setRollNoInput(e.target.value)}
                onPressEnter={() => void addRoll()}
                disabled={!currentId}
              />
              <Button size="large" type="primary" onClick={() => void addRoll()} loading={busy} disabled={!currentId}>
                加入
              </Button>
            </Space.Compact>

            <div style={{ marginTop: 12, maxHeight: 380, overflowY: 'auto' }}>
              {rolls.length === 0 ? (
                <Empty description="还没有加入件卡" />
              ) : (
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  {rolls.map((r) => (
                    <Card
                      key={r.rollId}
                      size="small"
                      hoverable
                      onClick={() => setActiveRollId(r.rollId)}
                      style={{
                        borderColor: r.rollId === activeRollId ? '#D98A1F' : undefined,
                        background: r.rollId === activeRollId ? 'rgba(217,138,31,0.10)' : undefined,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text strong>{r.rollNo}</Text>
                        <Space size={4}>
                          {r.grade ? (
                            <Tag color={GRADE_COLOR[r.grade]}>{GRADE_LABELS[r.grade]}</Tag>
                          ) : (
                            <Text type="secondary">未定</Text>
                          )}
                          {r.overReceivingLimit && <Tag color="red">超红线</Tag>}
                        </Space>
                      </div>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {r.meters.toFixed(1)} m · {r.widthInch.toFixed(1)} 英寸 · 扣分 {r.totalPoints} · 密度{' '}
                        {r.penaltyDensity.toFixed(1)}
                      </Text>
                    </Card>
                  ))}
                </Space>
              )}
            </div>
          </Card>
        </Col>

        <Col xs={24} lg={15}>
          <Card
            size="small"
            title={activeRoll ? `疵点录入 · ${activeRoll.rollNo}` : '疵点录入'}
            extra={
              activeRoll && (
                <Space size="middle" wrap>
                  <Space size={4}>
                    <Text type="secondary">位置(米)</Text>
                    <InputNumber
                      size="large"
                      style={{ width: 110 }}
                      min={0}
                      value={positionM}
                      onChange={(v) => setPositionM(v == null ? null : Number(v))}
                    />
                  </Space>
                  <Space size={4}>
                    <Text type="secondary">长度(英寸)</Text>
                    <InputNumber
                      size="large"
                      style={{ width: 110 }}
                      min={0}
                      value={lengthInch}
                      onChange={(v) => setLengthInch(v == null ? null : Number(v))}
                    />
                  </Space>
                </Space>
              )
            }
          >
            {!activeRoll ? (
              <Empty description="先在左侧选择一件卡" />
            ) : (
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {defectTypes.map((dt) => (
                    <Button
                      key={dt.id}
                      size="large"
                      style={{ height: 56, minWidth: 108, fontSize: 16 }}
                      onClick={() => void addDefect(dt)}
                      loading={busy}
                    >
                      {dt.name}
                      {dt.penaltyMode === 'fixed' && (
                        <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>
                          {dt.fixedPenalty}分
                        </Text>
                      )}
                    </Button>
                  ))}
                </div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  按长度扣分的疵点需先填长度（英寸）；固定分的直接点即可。
                </Text>

                <div style={{ marginTop: 12, maxHeight: 240, overflowY: 'auto' }}>
                  {activeRoll.defects.length === 0 ? (
                    <Empty description="该匹暂无疵点（无疵点即可定为一等品）" />
                  ) : (
                    <Space direction="vertical" size={6} style={{ width: '100%' }}>
                      {activeRoll.defects.map((d, i) => (
                        <div
                          key={d.id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '6px 10px',
                            border: '1px solid rgba(255,255,255,0.12)',
                            borderRadius: 8,
                          }}
                        >
                          <Space size="middle" wrap>
                            <Text strong>{nameOf(d.defectTypeId)}</Text>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {d.positionM == null ? '位置未记' : `${d.positionM} m 处`}
                              {d.lengthInch == null ? '' : ` · ${d.lengthInch} 英寸`}
                            </Text>
                          </Space>
                          <Space size="middle">
                            <Tag color="volcano">{d.penalty} 分</Tag>
                            <Button type="link" size="small" danger onClick={() => void removeDefect(i)}>
                              删除
                            </Button>
                          </Space>
                        </div>
                      ))}
                    </Space>
                  )}
                </div>
              </>
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={12}>
        <Col flex="1 1 140px">
          <Card size="small">
            <Statistic title="匹数" value={rolls.length} />
          </Card>
        </Col>
        <Col flex="1 1 140px">
          <Card size="small">
            <Statistic title="总米数" value={totalMeters.toFixed(1)} suffix="m" />
          </Card>
        </Col>
        <Col flex="1 1 140px">
          <Card size="small">
            <Statistic title="总扣分" value={rolls.reduce((s, r) => s + r.totalPoints, 0)} />
          </Card>
        </Col>
        <Col flex="1 1 200px">
          <Card size="small">
            <Statistic
              title="平均扣分密度"
              value={
                rolls.length === 0
                  ? '—'
                  : (rolls.reduce((s, r) => s + r.totalPoints, 0) * 100) /
                    (rolls.reduce((s, r) => s + r.sqYards, 0) || 1)
              }
              precision={2}
              suffix="分/100平方码"
            />
          </Card>
        </Col>
        <Col flex="1 1 160px">
          <Card size="small">
            <Statistic
              title="合格率"
              value={
                rolls.length === 0
                  ? '—'
                  : ((rolls.filter((r) => !r.overReceivingLimit).length / rolls.length) * 100).toFixed(0)
              }
              suffix="%"
            />
          </Card>
        </Col>
      </Row>

      {activeRoll && (
        <Card size="small">
          <Space size="large" wrap>
            <Space size={6}>
              <Text type="secondary">扣分合计</Text>
              <Text strong style={{ fontSize: 18 }}>
                {activeRoll.totalPoints}
              </Text>
            </Space>
            <Space size={6}>
              <Text type="secondary">面积</Text>
              <Text>{activeRoll.sqYards.toFixed(2)} 平方码</Text>
            </Space>
            <Space size={6}>
              <Text type="secondary">密度</Text>
              <Text strong style={{ fontSize: 18 }}>
                {activeRoll.penaltyDensity.toFixed(2)}
              </Text>
              <Text type="secondary">分/100平方码</Text>
            </Space>
            <Space size={6}>
              <Text type="secondary">品等</Text>
              {activeRoll.grade ? (
                <Tag color={GRADE_COLOR[activeRoll.grade]} style={{ fontSize: 16, padding: '4px 10px' }}>
                  {GRADE_LABELS[activeRoll.grade]}
                </Tag>
              ) : (
                <Text>未定</Text>
              )}
            </Space>
          </Space>
        </Card>
      )}
    </Space>
  )
}
