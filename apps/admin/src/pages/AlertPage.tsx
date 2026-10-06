import { useCallback, useEffect, useState } from 'react'
import { App as AntdApp, Badge, Button, Card, Modal, Segmented, Select, Space, Table, Tag, Tooltip, Typography } from 'antd'
import { BellOutlined, CheckOutlined, ReloadOutlined, ShoppingCartOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { api } from '../lib/api'
import { PERM, fmt, type AlertWire, type AlertSeverity, type PartnerWire } from '../lib/erp'
import { useLookups } from '../lib/lookups'
import { useAuthStore } from '../stores/auth.store'

const { Title, Text } = Typography

const TYPE_LABEL: Record<string, string> = {
  order_overdue: '交期逾期',
  low_stock: '库存低位',
  stale_batch: '呆滞批次',
}
const SEV: Record<AlertSeverity, { color: string; label: string }> = {
  critical: { color: 'red', label: '严重' },
  warning: { color: 'orange', label: '警告' },
  info: { color: 'blue', label: '提示' },
}

/** 预警中心：交期逾期 / 库存低位 / 呆滞批次（确定性规则扫描） */
export default function AlertPage() {
  const { message } = AntdApp.useApp()
  /**规格下拉（补选规格时用） */
  const { specs } = useLookups()
  /** 供应商下拉（useLookups 不含往来单位，单独拉一次） */
  const [suppliers, setSuppliers] = useState<PartnerWire[]>([])
  useEffect(() => {
    void api
      .get<PartnerWire[]>('/partners')
      .then((r) => setSuppliers(r.data.data.filter((x) => x.type === 'supplier' || x.type === 'both')))
      .catch(() => undefined)
  }, [])
  /** 正在生成采购单的预警 id（防连点） */
  const [creating, setCreating] = useState<string | null>(null)
  /** 服务端推断不出规格时，弹窗让用户补选（首次采购的新物料没有历史可推断） */
  const [needSpec, setNeedSpec] = useState<AlertWire | null>(null)
  const [pickedSpec, setPickedSpec] = useState<string | undefined>()
  const [pickedPartner, setPickedPartner] = useState<string | undefined>()
  /** 已由预警生成过采购单的预警 id → {预警id: 订单号}，按钮变成「已生成」避免重复点*/
  const [generated, setGenerated] = useState<Record<string, string>>({})
  const canManage = useAuthStore((s) => s.hasPermission(PERM.INVENTORY_MANAGE))
  const [rows, setRows] = useState<AlertWire[]>([])
  const [open, setOpen] = useState<number>(0)
  const [scope, setScope] = useState<'open' | 'all'>('open')
  const [loading, setLoading] = useState(false)
  const [scanning, setScanning] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [list, sum] = await Promise.all([
        api.get<AlertWire[]>(`/alerts${scope === 'all' ? '?all=true' : ''}`),
        api.get<{ open: number }>('/alerts/summary'),
      ])
      setRows(list.data.data)
      setOpen(sum.data.data.open)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载预警失败')
    } finally {
      setLoading(false)
    }
  }, [scope, message])

  useEffect(() => { void load() }, [load])

  const scan = async () => {
    setScanning(true)
    try {
      const r = await api.post<{ created: number; stats: Record<string, number> }>('/alerts/scan')
      const { created, stats } = r.data.data
      message.success(`扫描完成，新增 ${created} 条（逾期 ${stats.orderOverdue} / 低库存 ${stats.lowStock} / 呆滞 ${stats.staleBatch}）`)
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '扫描失败')
    } finally {
      setScanning(false)
    }
  }

  /** 预警一键生成采购订单：数量/交期/单价都来自补货建议，生成后是草稿需人工确认 */

  const createOrder = async (a: AlertWire, opts?: { specId?: string; partnerId?: string }) => {

    setCreating(a.id)

    try {

      const res = await api.post<{ id: string; orderNo: string }>(

        `/orders/from-alert/${a.id}`, opts ?? {},

      )

      const data = res.data.data

      setGenerated((g) => ({ ...g, [a.id]: data.orderNo }))

      setNeedSpec(null)

      setPickedSpec(undefined)

      message.success(`已生成采购订单 ${data.orderNo}（草稿），请到订单页确认`)

      void load()

    } catch (e) {

      const msg = e instanceof Error ? e.message : '生成采购单失败'

      // 服务端明确说「推断不出规格」→ 弹窗让用户补选，而不是甩一个死错误

      // 服务端可能缺「规格」或「供应商」（首次采购的新物料两者都无历史）——
      // 任一缺失都让用户补，不要只处理规格然后又卡在供应商上
      if (msg.includes('无法确定采购规格') || msg.includes('的供应商')) {

        setNeedSpec(a)

        setPickedSpec(undefined)

        return

      }

      message.error(msg)

    } finally {

      setCreating(null)

    }

  }


  const ack = async (id: string) => {
    try {
      await api.post(`/alerts/${id}/ack`)
      message.success('已确认')
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '确认失败')
    }
  }

  return (
    <div>
      <Space align="center" style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            <Badge count={open} size="small" offset={[10, 0]}><BellOutlined /></Badge>{' '}
            预警中心
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>交期逾期 / 库存低于安全库存 / 呆滞批次——规则扫描，确定性不猜测</Text>
        </div>
        <Space>
          {canManage && <Button type="primary" icon={<ThunderboltOutlined />} loading={scanning} onClick={() => void scan()}>扫描预警</Button>}
          <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>刷新</Button>
        </Space>
      </Space>

      <Card size="small">
        <Segmented
          value={scope}
          onChange={(v) => setScope(v as 'open' | 'all')}
          options={[
            { label: `未确认 (${open})`, value: 'open' },
            { label: '全部', value: 'all' },
          ]}
          style={{ marginBottom: 12 }}
        />
        <Table<AlertWire>
          rowKey="id" size="small" loading={loading} dataSource={rows}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          columns={[
            {
              title: '级别', dataIndex: 'severity', width: 80,
              render: (v: AlertSeverity) => <Tag color={SEV[v].color}>{SEV[v].label}</Tag>,
            },
            { title: '类型', dataIndex: 'type', width: 100, render: (v: string) => TYPE_LABEL[v] ?? v },
            { title: '标题', dataIndex: 'title', width: 220, ellipsis: true },
            {
              title: '详情',
              dataIndex: 'message',
              ellipsis: true,
              // 低库存预警带补货建议：建议量用醒目标签提出，依据折叠在下面供核对
              render: (v: string, r: AlertWire) => {
                const d = r.data
                if (!d || d.suggestQty == null) return v
                return (
                  <Space direction="vertical" size={2} style={{ width: '100%' }}>
                    <Space size={6} wrap>
                      <Tag color="volcano">建议补货 {fmt(d.suggestQty)} {d.unit}</Tag>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        补货点 {fmt(d.reorderPoint)} · 日均 {fmt(d.dailyUsage)}/天 · 覆盖 {fmt(d.coverDays)} 天
                      </Text>
                    </Space>
                    <Tooltip title={d.basis ?? ''}>
                      <Text type="secondary" style={{ fontSize: 11 }} ellipsis>
                        {v}
                      </Text>
                    </Tooltip>
                  </Space>
                )
              },
            },
            { title: '状态', dataIndex: 'acknowledged', width: 80, render: (v: boolean) => (v ? <Tag>已确认</Tag> : <Tag color="gold">待处理</Tag>) },
            ...(canManage
              ? [{
                  title: '操作', width: 190,
                  render: (_: unknown, r: AlertWire) => {
                    // 「生成采购单」只对**带补货建议的低库存预警**开放——
                    // 其余预警类型（逾期/呆滞）没有可执行建议，给按钮是误导
                    const canOrder = r.type === 'low_stock' && r.data?.suggestQty != null && Number(r.data.suggestQty) > 0
                    return (
                      <Space size={0}>
                        {canOrder &&
                          (generated[r.id] ? (
                            <Tag color="success" style={{ margin: 0 }}>{generated[r.id]}</Tag>
                          ) : (
                            <Button
                              size="small"
                              type="link"
                              icon={<ShoppingCartOutlined />}
                              loading={creating === r.id}
                              onClick={() => void createOrder(r)}
                            >
                              生成采购单
                            </Button>
                          ))}
                        {r.acknowledged ? null : (
                          <Button size="small" type="link" icon={<CheckOutlined />} onClick={() => void ack(r.id)}>
                            确认
                          </Button>
                        )}
                      </Space>
                    )
                  },
                }]
              : []),
          ]}
        />
      </Card>

      {/* 推断不出规格时：让用户补选（首次采购的新物料没有历史入库可依据） */}
      <Modal
        open={needSpec !== null}
        title="补全采购信息"
        okText="生成采购单"
        cancelText="取消"
        okButtonProps={{
          disabled: !pickedSpec || !pickedPartner,
          loading: creating === needSpec?.id,
        }}
        onOk={() => {
          if (needSpec && pickedSpec && pickedPartner) {
            void createOrder(needSpec, { specId: pickedSpec, partnerId: pickedPartner })
          }
        }}
        onCancel={() => {
          setNeedSpec(null)
          setPickedSpec(undefined)
          setPickedPartner(undefined)
        }}
      >
        <Text type="secondary" style={{ fontSize: 12 }}>
          该物料没有历史入库记录，规格与供应商都无法推断。
          请补全——<b>系统不替你猜</b>。
        </Text>
        <div style={{ marginTop: 12 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>采购规格</Text>
          <Select
            style={{ width: '100%', marginTop: 4 }}
            placeholder="请选择规格"
            showSearch
            optionFilterProp="label"
            value={pickedSpec}
            onChange={setPickedSpec}
            options={specs.map((sp) => ({ value: sp.id, label: `${sp.code} ${sp.name}` }))}
          />
        </div>
        <div style={{ marginTop: 12 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>供应商</Text>
          <Select
            style={{ width: '100%', marginTop: 4 }}
            placeholder="请选择供应商"
            showSearch
            optionFilterProp="label"
            value={pickedPartner}
            onChange={setPickedPartner}
            options={suppliers.map((x) => ({ value: x.id, label: `${x.name}（${x.code}）` }))}
          />
        </div>
      </Modal>
    </div>
  )
}
