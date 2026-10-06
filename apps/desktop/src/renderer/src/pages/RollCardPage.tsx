import { useCallback, useEffect, useMemo, useState } from 'react'
import { App as AntdApp, Button, Card, Col, Empty, Row, Select, Space, Table, Tag, Typography, theme } from 'antd'
import { PrinterOutlined, ReloadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { api } from '../lib/api'
import { buildRollCardsHtml, type RollCardData } from '../lib/rollCard'
import { fmt, type BatchWire } from '../lib/types'

const { Title, Text } = Typography

interface RollWire {
  id: string
  rollNo: string
  meters: string
  /** 剩余米数（拆匹后 < meters） */
  remainingM: string
  status: string
  batchId: string
  batchNo: string
  specId: string | null
  specName: string
  widthCm: string | null
  inboundAt: string
}

/** 件卡标签打印（仓管员，离线打印：一匹一张卡，CODE128 含件卡号） */
export default function RollCardPage() {
  const { message } = AntdApp.useApp()
  const { token } = theme.useToken()
  const [batches, setBatches] = useState<BatchWire[]>([])
  const [rolls, setRolls] = useState<RollWire[]>([])
  const [target, setTarget] = useState<BatchWire | null>(null)
  const [printing, setPrinting] = useState(false)

  const load = useCallback(async () => {
    try {
      const b = await api.get<BatchWire[]>('/inventory/batches')
      setBatches(b.filter((x) => x.status === 'normal'))
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载批次失败')
    }
  }, [message])

  const loadRolls = useCallback(async (batchId: string) => {
    try {
      const r = await api.get<RollWire[]>(`/inventory/rolls?batchId=${batchId}`)
      setRolls(r)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载件卡失败')
      setRolls([])
    }
  }, [message])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (target) void loadRolls(target.id)
    else setRolls([])
  }, [target, loadRolls])

  // 只给「在库」的件卡打印（已售/已耗的不用再打）
  const printable = useMemo(() => rolls.filter((r) => r.status === 'in_stock'), [rolls])

  const cardsHtml = useMemo<RollCardData[]>(
    () =>
      printable.map((r) => ({
        rollNo: r.rollNo,
        // 拆匹后标签应印**剩余量**（原始米数会误导拣货工）
        meters: fmt(r.remainingM ?? r.meters, 1),
        specName: r.specName,
        batchNo: r.batchNo,
        widthCm: r.widthCm ? fmt(r.widthCm, 0) : '-',
        date: dayjs(r.inboundAt).format('YYYY-MM-DD'),
      })),
    [printable]
  )
  const html = useMemo(() => (cardsHtml.length ? buildRollCardsHtml(cardsHtml) : ''), [cardsHtml])

  const onPrint = async () => {
    if (!html) return
    setPrinting(true)
    try {
      const res = await window.weftDesktop?.printLabel(html)
      if (res?.ok) message.success(`已发送 ${cardsHtml.length} 张件卡到打印机`)
      else message.error(res?.reason ?? '打印失败或被取消')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '打印失败')
    } finally {
      setPrinting(false)
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <Row gutter={[12, 12]}>
        <Col span={24}>
          <Card size="small">
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <Title level={4} style={{ margin: 0 }}>件卡标签打印（一匹一张）</Title>
              <Text type="secondary">
                按匹打印：选一个批次 → 列出它的件卡 → 批量打印。件卡号是唯一条码，扫到即定位这一匹（入库/发货/追溯）。
              </Text>
            </Space>
          </Card>
        </Col>

        <Col span={10}>
          <Card size="small" title="选择批次" extra={<Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>}>
            {batches.length === 0 ? (
              <Empty description="暂无在库批次（需仓管权限）" />
            ) : (
              <Select
                showSearch optionFilterProp="label" style={{ width: '100%' }} placeholder="选择批次"
                value={target?.id}
                onChange={(v) => setTarget(batches.find((b) => b.id === v) ?? null)}
                options={batches.map((b) => ({ value: b.id, label: `${b.batchNo} · ${fmt(b.quantity, 0)}m` }))}
              />
            )}
          </Card>

          <Card size="small" title={`该批次的件卡（在库 ${printable.length} / 共 ${rolls.length}）`} style={{ marginTop: 12 }}>
            {rolls.length === 0 ? (
              <Empty description={target ? '该批次暂无件卡（未按匹入库/报工）' : '先选批次'} />
            ) : (
              <Table<RollWire>
                rowKey="id" size="small" dataSource={rolls} pagination={{ pageSize: 8, showSizeChanger: false }}
                columns={[
                  { title: '件卡号', dataIndex: 'rollNo', width: 130 },
                  { title: '剩余(米)', dataIndex: 'remainingM', width: 84, align: 'right', render: (v: string, r) => fmt(v ?? r.meters, 1) },
                  { title: '原米数', dataIndex: 'meters', width: 78, align: 'right', render: (v: string) => fmt(v, 1) },
                  { title: '状态', dataIndex: 'status', width: 80, render: (s: string) => <Tag color={s === 'in_stock' ? 'blue' : 'default'}>{s === 'in_stock' ? '在库' : s === 'sold' ? '已售' : '已耗'}</Tag> },
                ]}
              />
            )}
          </Card>
        </Col>

        <Col span={14}>
          <Card
            size="small"
            title={`件卡预览（每页 4 张 · 共 ${cardsHtml.length} 张）`}
            extra={
              <Button type="primary" icon={<PrinterOutlined />} loading={printing} disabled={!html} onClick={() => void onPrint()}>
                打印 {cardsHtml.length} 张
              </Button>
            }
          >
            {html ? (
              <>
                <iframe
                  title="rollcard-preview"
                  srcDoc={html}
                  style={{ width: '100%', height: 520, border: `1px solid ${token.colorBorder}`, borderRadius: 4 }}
                />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  打印走本地系统打印机（离线可用）。扫件卡号可在「扫码查询」查这匹的档案，或在「扫码出库/入库」逐匹操作。
                </Text>
              </>
            ) : (
              <Empty description="选择有在库件卡的批次后预览" />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  )
}
