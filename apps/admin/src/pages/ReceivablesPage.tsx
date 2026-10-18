import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  App as AntdApp,
  Button,
  Card,
  DatePicker,
  InputNumber,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd'
import { DollarOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { api } from '../lib/api'
import { PERM, fmtMoney } from '../lib/erp'
import { useAuthStore } from '../stores/auth.store'

const { Title, Text } = Typography

interface PartnerWire {
  id: string
  name: string
  type: 'supplier' | 'customer' | 'both'
}
interface LedgerRow {
  docId: string
  docNo: string
  partnerId: string
  partnerName: string
  totalAmount: number
  settledAmount: number
  uncollected: number
  dueDate: string | null
  agingDays: number | null
  overdue: boolean
}
interface AgingRow {
  partnerId: string
  partnerName: string
  total: number
  segments: { current: number; d1_30: number; d31_60: number; d61_90: number; d90plus: number }
}
interface StatementLine {
  date: string
  docNo: string
  kind: 'invoice' | 'receipt'
  debit: number
  credit: number
  balance: number
}
interface Overview {
  totalReceivable: number
  totalCollected: number
  overdueAmount: number
  receiptTotal: number
}

const METHOD_LABEL: Record<string, string> = { cash: '现金', bank: '银行', acceptance: '承兑', other: '其他' }

/** 应收账款 / 客户对账 */
export default function ReceivablesPage() {
  const { message } = AntdApp.useApp()
  const canWrite = useAuthStore((s) => s.hasPermission(PERM.SALES_MANAGE))
  const [partners, setPartners] = useState<PartnerWire[]>([])
  const [overview, setOverview] = useState<Overview | null>(null)
  const [ledger, setLedger] = useState<LedgerRow[]>([])
  const [aging, setAging] = useState<AgingRow[]>([])
  const [loading, setLoading] = useState(false)

  const customers = useMemo(() => partners.filter((p) => p.type === 'customer' || p.type === 'both'), [partners])

  const loadBasics = useCallback(async () => {
    setLoading(true)
    try {
      const [ps, ov, lg, ag] = await Promise.all([
        api.get<PartnerWire[]>('/partners'),
        api.get<Overview>('/receivables/overview'),
        api.get<LedgerRow[]>('/receivables/ledger'),
        api.get<AgingRow[]>('/receivables/aging'),
      ])
      setPartners(ps.data.data)
      setOverview(ov.data.data)
      setLedger(lg.data.data)
      setAging(ag.data.data)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载应收数据失败')
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => { void loadBasics() }, [loadBasics])

  return (
    <div style={{ padding: 16 }}>
      <Title level={3} style={{ marginTop: 0 }}>
        <DollarOutlined /> 应收账款 / 客户对账
      </Title>

      <Space size={16} wrap style={{ marginBottom: 16 }}>
        <Card size="small" title="总应收"><Text strong style={{ fontSize: 20 }}>{fmtMoney(overview?.totalReceivable ?? 0)}</Text></Card>
        <Card size="small" title="已收"><Text strong style={{ fontSize: 20 }}>{fmtMoney(overview?.totalCollected ?? 0)}</Text></Card>
        <Card size="small" title="逾期金额" style={{ borderColor: (overview?.overdueAmount ?? 0) > 0 ? '#ff4d4f' : undefined }}>
          <Text strong style={{ fontSize: 20, color: (overview?.overdueAmount ?? 0) > 0 ? '#ff4d4f' : undefined }}>{fmtMoney(overview?.overdueAmount ?? 0)}</Text>
        </Card>
        <Card size="small" title="收款合计"><Text strong style={{ fontSize: 20 }}>{fmtMoney(overview?.receiptTotal ?? 0)}</Text></Card>
      </Space>

      <Tabs
        items={[
          { key: 'ledger', label: '应收台账', children: <LedgerTab rows={ledger} loading={loading} onReload={loadBasics} /> },
          { key: 'aging', label: '账龄分析', children: <AgingTab rows={aging} loading={loading} /> },
          { key: 'create', label: '收款录入', children: <CreateTab customers={customers} canWrite={canWrite} onDone={loadBasics} /> },
          { key: 'statement', label: '对账单', children: <StatementTab customers={customers} /> },
        ]}
      />
    </div>
  )
}

function LedgerTab({ rows, loading, onReload }: { rows: LedgerRow[]; loading: boolean; onReload: () => void }) {
  return (
    <Table<LedgerRow>
      rowKey="docId"
      loading={loading}
      dataSource={rows}
      pagination={{ pageSize: 20 }}
      title={() => <Space><Text strong>未结清销售出库单（共 {rows.length} 张）</Text><Button size="small" onClick={onReload}>刷新</Button></Space>}
      columns={[
        { title: '出库单号', dataIndex: 'docNo' },
        { title: '客户', dataIndex: 'partnerName' },
        { title: '应收', dataIndex: 'totalAmount', render: (v: number) => fmtMoney(v), align: 'right' },
        { title: '已收', dataIndex: 'settledAmount', render: (v: number) => fmtMoney(v), align: 'right' },
        { title: '未收', dataIndex: 'uncollected', render: (v: number) => <Text strong>{fmtMoney(v)}</Text>, align: 'right' },
        { title: '到期日', dataIndex: 'dueDate', render: (v: string | null) => v ?? '—' },
        {
          title: '账龄(天)',
          dataIndex: 'agingDays',
          render: (v: number | null, r: LedgerRow) =>
            v == null ? '—' : <Tag color={r.overdue ? 'red' : 'default'}>{v > 0 ? `${v}（逾期）` : '未到期'}</Tag>,
        },
      ]}
    />
  )
}

function AgingTab({ rows, loading }: { rows: AgingRow[]; loading: boolean }) {
  const columns = [
    { title: '客户', dataIndex: 'partnerName' },
    { title: '未到期', dataIndex: ['segments', 'current'], render: (v: number) => fmtMoney(v), align: 'right' as const },
    { title: '1-30天', dataIndex: ['segments', 'd1_30'], render: (v: number) => fmtMoney(v), align: 'right' as const },
    { title: '31-60天', dataIndex: ['segments', 'd31_60'], render: (v: number) => fmtMoney(v), align: 'right' as const },
    { title: '61-90天', dataIndex: ['segments', 'd61_90'], render: (v: number) => fmtMoney(v), align: 'right' as const },
    { title: '90天以上', dataIndex: ['segments', 'd90plus'], render: (v: number) => fmtMoney(v), align: 'right' as const },
    {
      title: '合计未收',
      dataIndex: 'total',
      render: (v: number) => <Text strong>{fmtMoney(v)}</Text>,
      align: 'right' as const,
    },
  ]
  return <Table<AgingRow> rowKey="partnerId" loading={loading} dataSource={rows} pagination={false} columns={columns} />
}

function CreateTab({ customers, canWrite, onDone }: { customers: PartnerWire[]; canWrite: boolean; onDone: () => void }) {
  const { message } = AntdApp.useApp()
  const [partnerId, setPartnerId] = useState<string | undefined>()
  const [receiptDate, setReceiptDate] = useState<dayjs.Dayjs>(dayjs())
  const [amount, setAmount] = useState<number | null>(null)
  const [method, setMethod] = useState<string>('bank')
  const [remark, setRemark] = useState<string>('')
  const [docs, setDocs] = useState<LedgerRow[]>([])
  const [alloc, setAlloc] = useState<Record<string, number>>({})
  const [submitting, setSubmitting] = useState(false)

  const loadDocs = useCallback(async (pid: string) => {
    try {
      const r = await api.get<LedgerRow[]>('/receivables/ledger', { params: { partnerId: pid } })
      setDocs(r.data.data)
      setAlloc({})
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载未结清单失败')
    }
  }, [message])

  const allocated = useMemo(() => Object.values(alloc).reduce((s, v) => s + (v || 0), 0), [alloc])
  const allocOk = amount != null && Math.abs(allocated - amount) < 0.01

  const submit = async () => {
    if (!partnerId) return message.warning('请选择客户')
    if (amount == null || amount <= 0) return message.warning('请填写收款金额')
    if (docs.length === 0) return message.warning('该客户没有未结清出库单')
    if (!allocOk) return message.warning(`核销分配合计 ${fmtMoney(allocated)} 与收款额 ${fmtMoney(amount)} 不一致`)
    const applications = docs
      .filter((d) => (alloc[d.docId] ?? 0) > 0)
      .map((d) => ({ docId: d.docId, appliedAmount: alloc[d.docId] }))
    if (applications.length === 0) return message.warning('请至少分配一张单')
    setSubmitting(true)
    try {
      await api.post('/receivables/receipts', {
        partnerId,
        receiptDate: receiptDate.format('YYYY-MM-DD'),
        amount,
        method,
        remark: remark || null,
        applications,
      })
      message.success('收款已录入并核销')
      setAmount(null)
      setRemark('')
      setAlloc({})
      setDocs([])
      setPartnerId(undefined)
      void onDone()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '录入失败')
    } finally {
      setSubmitting(false)
    }
  }

  const allocColumns = [
    { title: '出库单号', dataIndex: 'docNo' },
    { title: '未收', dataIndex: 'uncollected', render: (v: number) => fmtMoney(v), align: 'right' as const },
    {
      title: '本次核销',
      dataIndex: 'docId',
      render: (_: string, r: LedgerRow) => (
        <InputNumber
          min={0}
          max={r.uncollected}
          step={0.01}
          value={alloc[r.docId] ?? 0}
          disabled={!canWrite}
          onChange={(v) => setAlloc((a) => ({ ...a, [r.docId]: Number(v) || 0 }))}
          style={{ width: 140 }}
        />
      ),
      align: 'right' as const,
    },
  ]

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Card size="small" title="录入收款">
        <Space wrap>
          <Select
            placeholder="选择客户"
            style={{ width: 220 }}
            disabled={!canWrite}
            value={partnerId}
            options={customers.map((c) => ({ value: c.id, label: c.name }))}
            onChange={(v) => { setPartnerId(v); void loadDocs(v) }}
          />
          <DatePicker value={receiptDate} disabled={!canWrite} onChange={(d) => d && setReceiptDate(d)} />
          <InputNumber
            placeholder="收款金额"
            min={0.01}
            step={0.01}
            style={{ width: 160 }}
            disabled={!canWrite}
            value={amount}
            onChange={(v) => setAmount(v as number | null)}
          />
          <Select value={method} disabled={!canWrite} style={{ width: 120 }} onChange={setMethod} options={Object.entries(METHOD_LABEL).map(([k, v]) => ({ value: k, label: v }))} />
          <InputNumber placeholder="备注" style={{ width: 200 }} disabled={!canWrite} value={remark} onChange={(v) => setRemark(String(v ?? ''))} />
        </Space>
        <div style={{ marginTop: 12 }}>
          <Text>核销分配合计：<Text strong type={allocOk ? undefined : 'danger'}>{fmtMoney(allocated)}</Text></Text>
          {amount != null && <Text type="secondary"> / 收款额 {fmtMoney(amount)}</Text>}
        </div>
        <div style={{ marginTop: 8 }}>
          <Button type="primary" disabled={!canWrite || !allocOk} loading={submitting} onClick={submit}>提交核销</Button>
          {!canWrite && <Text type="secondary" style={{ marginLeft: 12 }}>无收款权限（需 sales.manage）</Text>}
        </div>
      </Card>
      <Card size="small" title="分配冲抵（从该客户未结清出库单中选择）">
        {docs.length === 0 ? (
          <Text type="secondary">{partnerId ? '该客户暂无未结清出库单' : '请先选择客户'}</Text>
        ) : (
          <Table<LedgerRow> rowKey="docId" dataSource={docs} pagination={false} columns={allocColumns} />
        )}
      </Card>
    </Space>
  )
}

function StatementTab({ customers }: { customers: PartnerWire[] }) {
  const { message } = AntdApp.useApp()
  const [partnerId, setPartnerId] = useState<string | undefined>()
  const [from, setFrom] = useState<dayjs.Dayjs | null>(null)
  const [to, setTo] = useState<dayjs.Dayjs | null>(null)
  const [lines, setLines] = useState<StatementLine[]>([])
  const [totalDebit, setTotalDebit] = useState(0)
  const [totalCredit, setTotalCredit] = useState(0)
  const [closing, setClosing] = useState(0)
  const [loading, setLoading] = useState(false)

  const query = async () => {
    if (!partnerId) return message.warning('请选择客户')
    setLoading(true)
    try {
      const params: Record<string, string> = { partnerId }
      if (from) params.from = from.format('YYYY-MM-DD')
      if (to) params.to = to.format('YYYY-MM-DD')
      const r = await api.get<{ lines: StatementLine[]; totalDebit: number; totalCredit: number; closingBalance: number }>('/receivables/statement', { params })
      setLines(r.data.data.lines)
      setTotalDebit(r.data.data.totalDebit)
      setTotalCredit(r.data.data.totalCredit)
      setClosing(r.data.data.closingBalance)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '查询失败')
    } finally {
      setLoading(false)
    }
  }

  const columns = [
    { title: '日期', dataIndex: 'date' },
    { title: '单号', dataIndex: 'docNo' },
    { title: '类型', dataIndex: 'kind', render: (v: string) => (v === 'invoice' ? <Tag color="blue">发货</Tag> : <Tag color="green">收款</Tag>) },
    { title: '借方', dataIndex: 'debit', render: (v: number) => (v > 0 ? fmtMoney(v) : ''), align: 'right' as const },
    { title: '贷方', dataIndex: 'credit', render: (v: number) => (v > 0 ? fmtMoney(v) : ''), align: 'right' as const },
    { title: '余额', dataIndex: 'balance', render: (v: number) => fmtMoney(v), align: 'right' as const },
  ]
  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Card size="small">
        <Space wrap>
          <Select placeholder="选择客户" style={{ width: 220 }} value={partnerId} options={customers.map((c) => ({ value: c.id, label: c.name }))} onChange={setPartnerId} />
          <DatePicker placeholder="起始" value={from} onChange={setFrom} />
          <DatePicker placeholder="截止" value={to} onChange={setTo} />
          <Button type="primary" onClick={query}>查询</Button>
        </Space>
      </Card>
      <Table<StatementLine> rowKey={(r, i) => `${r.docNo}-${i}`} loading={loading} dataSource={lines} pagination={{ pageSize: 30 }} columns={columns}
        summary={() => (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0} colSpan={3}>合计</Table.Summary.Cell>
            <Table.Summary.Cell index={3} align="right">{fmtMoney(totalDebit)}</Table.Summary.Cell>
            <Table.Summary.Cell index={4} align="right">{fmtMoney(totalCredit)}</Table.Summary.Cell>
            <Table.Summary.Cell index={5} align="right"><Text strong>{fmtMoney(closing)}</Text></Table.Summary.Cell>
          </Table.Summary.Row>
        )}
      />
    </Space>
  )
}
