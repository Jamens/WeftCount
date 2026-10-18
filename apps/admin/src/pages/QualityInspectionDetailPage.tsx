import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  App as AntdApp,
  Button,
  Card,
  Col,
  Empty,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import {
  fmt,
  fmtPct,
  GRADE_COLOR,
  INSPECTION_MODE_LABEL,
  INSPECTION_STATUS_LABEL,
  PERM,
  type DefectTypeWire,
  type InspectionDetailWire,
  type InspectionDefectView,
  type InspectionRollView,
} from '../lib/erp'
import { GRADE_LABELS, type GreigeGrade } from '@weftcount/shared'
import { useAuthStore } from '../stores/auth.store'

const { Title, Text } = Typography

interface RollOption {
  id: string
  rollNo: string
}

export default function QualityInspectionDetailPage() {
  const { id = '' } = useParams()
  const { message } = AntdApp.useApp()
  const navigate = useNavigate()
  const canInspect = useAuthStore((s) => s.hasPermission(PERM.QUALITY_INSPECT))
  const canReview = useAuthStore((s) => s.hasPermission(PERM.QUALITY_REVIEW))

  const [detail, setDetail] = useState<InspectionDetailWire | null>(null)
  const [defectTypes, setDefectTypes] = useState<DefectTypeWire[]>([])
  const [rollOptions, setRollOptions] = useState<RollOption[]>([])
  const [selectedRollId, setSelectedRollId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [addRollIds, setAddRollIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await api.get<InspectionDetailWire>(`/quality/inspections/${id}`)
    setDetail(res.data.data)
    setSelectedRollId((prev) => prev ?? res.data.data.rolls[0]?.rollId ?? null)
  }, [id])

  useEffect(() => {
    void load()
    api.get<DefectTypeWire[]>('/quality/defect-types').then((r) => setDefectTypes(r.data.data)).catch(() => undefined)
    api
      .get<RollOption[]>('/inventory/rolls?status=in_stock')
      .then((r) => setRollOptions(r.data.data.map((x) => ({ id: x.id, rollNo: x.rollNo }))))
      .catch(() => setRollOptions([]))
  }, [load])

  const inspection = detail?.inspection
  const rolls = detail?.rolls ?? []
  const current = rolls.find((r) => r.rollId === selectedRollId) ?? null
  const editable = inspection?.status === 'draft'

  const typeOptions = useMemo(
    () => defectTypes.map((t) => ({ value: t.id, label: `${t.name}（${t.code}）` })),
    [defectTypes],
  )

  const addRolls = async () => {
    if (addRollIds.length === 0) return
    setBusy(true)
    try {
      await api.post(`/quality/inspections/${id}/rolls`, { rollIds: addRollIds })
      message.success(`已加入 ${addRollIds.length} 匹`)
      setAddOpen(false)
      setAddRollIds([])
      await load()
      setSelectedRollId(addRollIds[0] ?? null)
    } finally {
      setBusy(false)
    }
  }

  /** 疵点整匹替换：改一条就整匹 PUT，语义最简单 */
  const saveDefects = async (next: InspectionDefectView[]) => {
    if (!current) return
    await api.put(`/quality/inspections/${id}/rolls/${current.rollId}/defects`, {
      items: next.map((d) => ({
        defectTypeId: d.defectTypeId,
        positionM: d.positionM,
        lengthInch: d.lengthInch,
        remark: d.remark ?? null,
      })),
    })
    await load()
  }

  const patchMeasure = async (patch: { meters?: number; widthInch?: number }) => {
    if (!current) return
    await api.patch(`/quality/inspections/${id}/rolls/${current.rollId}`, patch)
    await load()
  }

  const finalize = async () => {
    setBusy(true)
    try {
      await api.post(`/quality/inspections/${id}/finalize`)
      message.success('已定等，等级已写回件卡')
      await load()
    } finally {
      setBusy(false)
    }
  }

  const voidIt = async () => {
    setBusy(true)
    try {
      await api.post(`/quality/inspections/${id}/void`)
      message.success('已作废，件卡等级已回退')
      await load()
    } finally {
      setBusy(false)
    }
  }

  if (!detail || !inspection) {
    return (
      <Card size="small" loading>
        <Empty />
      </Card>
    )
  }

  const st = INSPECTION_STATUS_LABEL[inspection.status]

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <Space size="middle">
          <Button onClick={() => navigate('/quality/inspections')}>返回</Button>
          <Title level={4} style={{ margin: 0 }}>
            {inspection.inspectionNo}
          </Title>
          <Tag color={st.color}>{st.text}</Tag>
          <Text type="secondary">
            {inspection.inspectedAt} · {INSPECTION_MODE_LABEL[inspection.mode]}
          </Text>
        </Space>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>
            刷新
          </Button>
          {editable && canInspect && (
            <Button icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
              加入件卡
            </Button>
          )}
          {inspection.status === 'draft' && canReview && (
            <Popconfirm
              title="定等后等级将写回件卡，且不能再改疵点。确认？"
              onConfirm={() => void finalize()}
            >
              <Button type="primary" loading={busy}>
                定等
              </Button>
            </Popconfirm>
          )}
          {inspection.status === 'done' && canReview && (
            <Popconfirm title="作废后件卡等级回退到上一版或置为未检验。确认？" onConfirm={() => void voidIt()}>
              <Button danger loading={busy}>
                作废
              </Button>
            </Popconfirm>
          )}
        </Space>
      </div>

      <Row gutter={12}>
        <Col flex="1 1 150px">
          <Card size="small">
            <Statistic title="匹数" value={inspection.rollCount} />
          </Card>
        </Col>
        <Col flex="1 1 150px">
          <Card size="small">
            <Statistic title="总扣分" value={inspection.totalPoints} />
          </Card>
        </Col>
        <Col flex="1 1 190px">
          <Card size="small">
            <Statistic
              title="平均扣分密度"
              value={fmt(inspection.avgPenaltyDensity, 2)}
              suffix="分/100平方码"
            />
          </Card>
        </Col>
        <Col flex="1 1 150px">
          <Card size="small">
            <Statistic title="合格率" value={inspection.passRate == null ? '—' : fmtPct(inspection.passRate)} />
          </Card>
        </Col>
      </Row>

      <Row gutter={12}>
        <Col xs={24} lg={10}>
          <Card size="small" title="待检件卡" extra={<Text type="secondary">点击一行录入疵点</Text>}>
            <Table<InspectionRollView>
              rowKey="rollId"
              size="small"
              dataSource={rolls}
              pagination={false}
              scroll={{ y: 420 }}
              onRow={(r) => ({ onClick: () => setSelectedRollId(r.rollId) })}
              rowClassName={(r) => (r.rollId === selectedRollId ? 'weft-row-active' : '')}
              locale={{ emptyText: '还没有加入件卡' }}
              columns={[
                { title: '件卡号', dataIndex: 'rollNo', width: 150 },
                {
                  title: '实测米数',
                  dataIndex: 'meters',
                  width: 90,
                  align: 'right',
                  render: (v: number) => fmt(v, 1),
                },
                {
                  title: '扣分',
                  dataIndex: 'totalPoints',
                  width: 70,
                  align: 'right',
                },
                {
                  title: '密度',
                  dataIndex: 'penaltyDensity',
                  width: 80,
                  align: 'right',
                  render: (v: number) => fmt(v, 1),
                },
                {
                  title: '品等',
                  dataIndex: 'grade',
                  width: 90,
                  render: (v: GreigeGrade | null, r) => (
                    <Space size={4}>
                      {v ? <Tag color={GRADE_COLOR[v]}>{GRADE_LABELS[v]}</Tag> : <Text type="secondary">未定</Text>}
                      {r.overReceivingLimit && <Tag color="red">超红线</Tag>}
                    </Space>
                  ),
                },
              ]}
            />
          </Card>
        </Col>

        <Col xs={24} lg={14}>
          <Card
            size="small"
            title={current ? `疵点录入 · ${current.rollNo}` : '疵点录入'}
            extra={
              current && editable ? (
                <Space size="middle">
                  <Space size={4}>
                    <Text type="secondary">实测米数</Text>
                    <InputNumber
                      size="small"
                      style={{ width: 90 }}
                      min={0}
                      value={current.meters}
                      onChange={(v) => v != null && void patchMeasure({ meters: Number(v) })}
                    />
                  </Space>
                  <Space size={4}>
                    <Text type="secondary">门幅(英寸)</Text>
                    <InputNumber
                      size="small"
                      style={{ width: 80 }}
                      min={0}
                      value={current.widthInch}
                      onChange={(v) => v != null && void patchMeasure({ widthInch: Number(v) })}
                    />
                  </Space>
                </Space>
              ) : null
            }
          >
            {!current ? (
              <Empty description="先在左侧选择一匹布" />
            ) : (
              <Table<InspectionDefectView>
                rowKey={(r) => `${r.defectTypeId}-${r.positionM ?? 'x'}-${r.id}`}
                size="small"
                dataSource={current.defects}
                pagination={false}
                scroll={{ y: 380 }}
                locale={{ emptyText: '该匹未记录疵点（无疵点即可定为一等品）' }}
                columns={[
                  {
                    title: '疵点类型',
                    dataIndex: 'defectTypeId',
                    render: (v: string, r, i) => (
                      <Select
                        size="small"
                        style={{ width: '100%' }}
                        value={v}
                        options={typeOptions}
                        disabled={!editable}
                        onChange={(nv) => {
                          const next = [...current.defects]
                          next[i] = { ...r, defectTypeId: nv }
                          void saveDefects(next)
                        }}
                      />
                    ),
                  },
                  {
                    title: '距匹头(米)',
                    dataIndex: 'positionM',
                    width: 110,
                    render: (v: number | null, r, i) => (
                      <InputNumber
                        size="small"
                        style={{ width: '100%' }}
                        min={0}
                        value={v}
                        disabled={!editable}
                        onChange={(nv) => {
                          const next = [...current.defects]
                          next[i] = { ...r, positionM: nv == null ? null : Number(nv) }
                          void saveDefects(next)
                        }}
                      />
                    ),
                  },
                  {
                    title: '长度(英寸)',
                    dataIndex: 'lengthInch',
                    width: 110,
                    render: (v: number | null, r, i) => (
                      <InputNumber
                        size="small"
                        style={{ width: '100%' }}
                        min={0}
                        value={v}
                        disabled={!editable}
                        onChange={(nv) => {
                          const next = [...current.defects]
                          next[i] = { ...r, lengthInch: nv == null ? null : Number(nv) }
                          void saveDefects(next)
                        }}
                      />
                    ),
                  },
                  { title: '扣分', dataIndex: 'penalty', width: 70, align: 'right' },
                  {
                    title: '操作',
                    width: 60,
                    render: (_: unknown, _r, i) => (
                      <Button
                        type="link"
                        size="small"
                        danger
                        disabled={!editable}
                        onClick={() => {
                          const next = current.defects.filter((_, k) => k !== i)
                          void saveDefects(next)
                        }}
                      >
                        删除
                      </Button>
                    ),
                  },
                ]}
                footer={() =>
                  editable ? (
                    <Button
                      size="small"
                      icon={<PlusOutlined />}
                      disabled={defectTypes.length === 0}
                      onClick={() => {
                        const first = defectTypes[0]
                        if (!first) return
                        void saveDefects([
                          ...current.defects,
                          {
                            id: `new-${Date.now()}`,
                            defectTypeId: first.id,
                            defectCode: first.code,
                            positionM: null,
                            lengthInch: null,
                            penalty: 0,
                            remark: null,
                          },
                        ])
                      }}
                    >
                      加一条疵点
                    </Button>
                  ) : null
                }
              />
            )}

            {current && (
              <div style={{ marginTop: 12 }}>
                <Space size="middle" wrap>
                  <Text type="secondary">扣分合计</Text>
                  <Text strong>{current.totalPoints}</Text>
                  <Text type="secondary">面积</Text>
                  <Text>{fmt(current.sqYards, 2)} 平方码</Text>
                  <Text type="secondary">密度</Text>
                  <Text strong>{fmt(current.penaltyDensity, 2)} 分/100平方码</Text>
                  <Text type="secondary">品等</Text>
                  {current.grade ? (
                    <Tag color={GRADE_COLOR[current.grade]}>{GRADE_LABELS[current.grade]}</Tag>
                  ) : (
                    <Text>未定</Text>
                  )}
                </Space>
              </div>
            )}
          </Card>
        </Col>
      </Row>

      <Modal
        title="加入待检件卡"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={() => void addRolls()}
        confirmLoading={busy}
        okText="加入"
        okButtonProps={{ disabled: addRollIds.length === 0 }}
      >
        <Select
          mode="multiple"
          style={{ width: '100%', marginTop: 16 }}
          placeholder="选择件卡（可多选）"
          showSearch
          optionFilterProp="label"
          value={addRollIds}
          onChange={setAddRollIds}
          options={rollOptions.map((r) => ({ value: r.id, label: r.rollNo }))}
        />
      </Modal>
    </Space>
  )
}
