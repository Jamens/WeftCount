import { useRef, useCallback, useEffect, useMemo, useState, } from 'react'
import {
  App as AntdApp,
  Button,
  Card,
  Col,
  Empty,
  Input,
  InputNumber,
  Progress,
  Radio,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd'
import { BarcodeOutlined, ReloadOutlined, SendOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { api, newReqId } from '../lib/api'
import { fmt, num, type ReportableOrder } from '../lib/types'

const { Title, Text } = Typography

/**
 * 织机报工（挡车工）
 *
 * 只依赖 `/production-orders/reportable`（服务端已带机台名/规格名），
 * 权限只需 production.report——挡车工角色没有 production.view/material.view 也能用。
 */
export default function ReportPage() {
  const { message } = AntdApp.useApp()
  const [orders, setOrders] = useState<ReportableOrder[]>([])
  const [loading, setLoading] = useState(false)
  const [target, setTarget] = useState<ReportableOrder | null>(null)
  const [outputM, setOutputM] = useState<number | null>(null)
  const [stopMin, setStopMin] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  /**
   * 报工幂等键：进入报工页/换工单时生成一次，**提交失败重试时复用同一个**。
   * 车间网络不稳，超时重试很常见；没有幂等键会重复计量——产量虚高、件卡翻倍。
   */
  const reqIdRef = useRef<string>('')
  // 报工按匹：本次产出的件卡（rollNo+米数）
  const [rollMode, setRollMode] = useState(false)
  const [rolls, setRolls] = useState<{ rollNo: string; meters: number }[]>([])
  const [rollNoInput, setRollNoInput] = useState('')
  const [rollMeters, setRollMeters] = useState(30)
  const rollTotal = rolls.reduce((s, r) => s + r.meters, 0)

  const addRoll = () => {
    const no = rollNoInput.trim()
    if (!no) return
    if (rolls.some((r) => r.rollNo === no)) {
      message.warning(`件卡 ${no} 本次已登记`)
      setRollNoInput('')
      return
    }
    setRolls((p) => [...p, { rollNo: no, meters: rollMeters }])
    setRollNoInput('')
  }
  const removeRoll = (no: string) => setRolls((p) => p.filter((r) => r.rollNo !== no))

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setOrders(await api.get<ReportableOrder[]>('/production-orders/reportable'))
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载工单失败')
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    void load()
  }, [load])

  const activeOutputM = useMemo(() => orders.reduce((s, o) => s + num(o.producedQuantityM), 0), [orders])

  const onSubmit = async () => {
    if (!target) return
    // 报工按匹：产出 = 各件卡米数之和（强制以米计）
    const effectiveOutput = rollMode ? rollTotal : outputM
    if (!effectiveOutput || effectiveOutput <= 0) {
      message.warning(rollMode ? '请先登记件卡（至少一匹）' : '请输入本次产出（米）')
      return
    }
    setSubmitting(true)
    try {
      if (!reqIdRef.current) reqIdRef.current = newReqId()
      await api.post(`/production-orders/${target.id}/reports`, {
        clientRequestId: reqIdRef.current,
        outputM: effectiveOutput,
        reportDate: dayjs().format('YYYY-MM-DD'),
        stoppageMinutes: stopMin ?? null,
        ...(rollMode && rolls.length ? { rolls } : {}),
      })
      reqIdRef.current = '' // 本单已完成，下张单用新键
      message.success(`报工成功：${effectiveOutput}m 已入库${rolls.length ? `（${rolls.length} 匹）` : ''}${target.status === 'scheduled' ? '，工单转入生产中' : ''}`)
      setTarget(null)
      setOutputM(null)
      setStopMin(null)
      setRolls([])
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '报工失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col span={8}>
          <Card size="small"><Statistic title="可报工工单" value={orders.length} suffix="单" /></Card>
        </Col>
        <Col span={8}>
          <Card size="small"><Statistic title="这些工单累计产出" value={num(activeOutputM).toFixed(0)} suffix="m" /></Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading} block>刷新工单</Button>
          </Card>
        </Col>
      </Row>

      <Card size="small" title="选择工本报工">
        {orders.length === 0 ? (
          <Empty description="暂无可报工工单（请先在 admin 生产管理建单并排产到机台）" />
        ) : (
          <Table<ReportableOrder>
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={orders}
            columns={[
              { title: '工单号', dataIndex: 'orderNo', width: 150 },
              { title: '规格', dataIndex: 'specName', width: 140, render: (v: string | null) => v ?? '-' },
              { title: '机台', dataIndex: 'machineName', width: 110, render: (v: string | null) => v ?? '-' },
              {
                title: '状态',
                dataIndex: 'status',
                width: 90,
                render: (s: string) => (s === 'in_progress' ? <Tag color="processing">生产中</Tag> : <Tag color="blue">已排产</Tag>),
              },
              { title: '计划(米)', dataIndex: 'plannedQuantityM', width: 90, align: 'right', render: (v: string) => fmt(v, 0) },
              { title: '已产(米)', dataIndex: 'producedQuantityM', width: 90, align: 'right', render: (v: string) => fmt(v, 0) },
              {
                title: '进度',
                dataIndex: 'producedQuantityM',
                width: 150,
                render: (_, o) => {
                  const p = num(o.plannedQuantityM)
                  const pct = p > 0 ? Math.min((num(o.producedQuantityM) / p) * 100, 100) : 0
                  return <Progress percent={Math.round(pct)} size="small" />
                },
              },
              {
                title: '操作',
                width: 90,
                fixed: 'right',
                render: (_, o) => (
                  <Button type="primary" size="small" icon={<SendOutlined />} onClick={() => setTarget(o)}>
                    报工
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Card>

      {target && (
        <Card
          size="small"
          title={`报工 · ${target.orderNo}`}
          style={{ marginTop: 12 }}
          extra={
            <Space>
              <Button onClick={() => setTarget(null)}>取消</Button>
              <Button type="primary" loading={submitting} onClick={() => void onSubmit()}>提交报工</Button>
            </Space>
          }
        >
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Text type="secondary">
              规格 {target.specName ?? '-'} · 机台 {target.machineName ?? '-'} · 计划 {fmt(target.plannedQuantityM, 0)}m · 已产{' '}
              {fmt(target.producedQuantityM, 0)}m
            </Text>
            <Space size="large" wrap>
              <div>
                <Text>报工方式</Text>
                <div>
                  <Radio.Group value={rollMode ? 'roll' : 'meter'} onChange={(e) => { setRollMode((e.target.value as string) === 'roll'); setRolls([]) }} optionType="button" size="small" buttonStyle="solid"
                    options={[{ label: '按米数', value: 'meter' }, { label: '按匹(件卡)', value: 'roll' }]} />
                </div>
              </div>
              <div>
                <Text>本次产出（米）{rollMode ? `= 各匹合计 ${rollTotal.toFixed(1)}m` : ''}</Text>
                <div><InputNumber style={{ width: 180 }} min={0.001} value={rollMode ? (rollTotal || undefined) : outputM} onChange={(v) => !rollMode && setOutputM(v)} readOnly={rollMode} placeholder={rollMode ? '扫件卡自动累计' : '本次织出米数'} /></div>
              </div>
              <div>
                <Text>停机分钟（可选）</Text>
                <div><InputNumber style={{ width: 140 }} min={0} value={stopMin} onChange={setStopMin} placeholder="如 30" /></div>
              </div>
            </Space>
            {rollMode && (
              <Card size="small" title={`本次产出件卡（${rolls.length} 匹）`} style={{ background: '#fafafa' }}>
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  <Space.Compact style={{ width: '100%' }}>
                    <Input
                      size="large" prefix={<BarcodeOutlined />} placeholder="扫描/输入件卡号后回车"
                      value={rollNoInput} onChange={(e) => setRollNoInput(e.target.value)} onPressEnter={addRoll}
                    />
                    <InputNumber size="large" min={0.001} precision={2} style={{ width: 140 }} value={rollMeters} onChange={(v) => setRollMeters(v ?? 30)} addonBefore="每匹m" />
                    <Button type="primary" size="large" onClick={addRoll}>登记一匹</Button>
                  </Space.Compact>
                  {rolls.length > 0 && (
                    <Space wrap size={4}>
                      {rolls.map((r) => (
                        <Tag key={r.rollNo} closable color="blue" onClose={(e) => { e.preventDefault(); removeRoll(r.rollNo) }}>
                          {r.rollNo} · {r.meters}m
                        </Tag>
                      ))}
                    </Space>
                  )}
                  <Text type="secondary" style={{ fontSize: 12 }}>扫一件卡登记一匹织出的布（默认每匹 {rollMeters}m，可改）；各匹合计=本次产出，自动生成件卡可追溯。</Text>
                </Space>
              </Card>
            )}
            <Text type="secondary" style={{ fontSize: 12 }}>提交后本次产出自动入库为坯布批次，并累加工单进度（满额自动完成）。{rollMode ? '按匹报工会为每匹生成件卡。' : ''}</Text>
          </Space>
        </Card>
      )}
    </div>
  )
}
