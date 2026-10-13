import { useCallback, useEffect, useState } from 'react'
import { App as AntdApp, Alert, Button, Card, Empty, Segmented, Space, Tag, Typography } from 'antd'
import { FileExcelOutlined, ReloadOutlined } from '@ant-design/icons'
import { api, tokenStore, contextStore } from '../lib/api'
import { PERM } from '../lib/erp'
import { useAuthStore } from '../stores/auth.store'

const { Title, Text } = Typography

interface ReportMeta {
  key: string
  label: string
  description: string
  supportsDays: boolean
}

/** 时间窗预设：与趋势页的档位一致 */
const DAY_PRESETS = [
  { label: '不限', value: 0 },
  { label: '近7天', value: 7 },
  { label: '近30天', value: 30 },
  { label: '近90天', value: 90 },
  { label: '近一年', value: 365 },
]

/**
 * 带鉴权头下载并从响应头读回行数
 *
 * 导出是文件下载而非 JSON，走不到 axios 拦截器，所以只能自己 fetch + 带三个头。
 * 后端把行数放在 `X-Row-Count`（前端读不到 xlsx 内部），据此提示"导出了多少行"，
 * 避免用户导出后不知道是空表还是数据本来就这么少。
 */
async function downloadReport(key: string, days: number): Promise<number> {
  const qs = days > 0 ? `?days=${days}` : ''
  const res = await fetch(`/api/import-export/reports/${key}/export${qs}`, {
    headers: {
      Authorization: `Bearer ${tokenStore.get()}`,
      'X-Tenant-Id': contextStore.getTenantId() ?? '',
      'X-Company-Id': contextStore.getCompanyId() ?? '',
    },
  })
  if (!res.ok) {
    // 失败时后端返回 JSON（含 code/message），比"下载失败(403)"有用得多
    let msg = `导出失败(${res.status})`
    try {
      const body = (await res.json()) as { message?: string | string[] }
      if (body?.message) msg = Array.isArray(body.message) ? body.message.join('、') : body.message
    } catch {
      /* 非 JSON 响应（如网关错误页）就用默认文案 */
    }
    throw new Error(msg)
  }
  const rowCount = Number(res.headers.get('X-Row-Count') ?? '0')
  const blob = await res.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${key}-${new Date().toISOString().slice(0, 10)}.xlsx`
  a.click()
  URL.revokeObjectURL(a.href)
  return rowCount
}

/**
 * 通用报表导出
 *
 * 此前只有物料能导出，库存批次/流水/对账/成本/趋势/审计等只能在页面看表格，
 * 业务方要交月报时只能手抄。这里把服务端注册的报表清单拉下来自动渲染，
 * **新增报表只需在服务端 REPORTS + REPORT_PERMISSION 登记，前端零改动**。
 */
export default function ReportExportPage() {
  const { message } = AntdApp.useApp()
  const hasPermission = useAuthStore((s) => s.hasPermission)
  const [reports, setReports] = useState<ReportMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [days, setDays] = useState<number>(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<ReportMeta[]>('/import-export/reports')
      setReports(res.data.data)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载报表清单失败')
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * 前端按权限过滤清单。
   * 这**只是隐藏入口，不是安全边界**——真正的校验在服务端按 key 逐个查权限
   * （ReportExport 控制器里的 requireReportPermission），前端过滤纯粹为了不
   * 让用户点进去撞 403。口径与后端 REPORT_PERMISSION 保持一致。
   */
  const PERM_OF: Record<string, string[]> = {
      'inventory-batches': [PERM.INVENTORY_VIEW],
      'inventory-transactions': [PERM.INVENTORY_VIEW],
      'inventory-documents': [PERM.INVENTORY_VIEW],
      rolls: [PERM.INVENTORY_VIEW],
      materials: [PERM.MATERIAL_VIEW],
      specs: [PERM.MATERIAL_VIEW],
      warehouses: [PERM.WAREHOUSE_VIEW],
      orders: [PERM.PURCHASE_VIEW, PERM.SALES_VIEW],
      'production-orders': [PERM.PRODUCTION_VIEW],
      'production-reports': [PERM.PRODUCTION_VIEW],
      cost: [PERM.COST_VIEW, PERM.REPORT_VIEW],
      trends: [PERM.REPORT_VIEW, PERM.COST_VIEW],
      stocktakes: [PERM.INVENTORY_VIEW],
      'audit-logs': [PERM.AUDIT_VIEW],
    }

  const allowed = reports.filter((r) => {
    const need = PERM_OF[r.key]
    if (!need) return false
    return need.some((p) => hasPermission(p))
  })

  const doExport = async (r: ReportMeta) => {
    setBusyKey(r.key)
    try {
      const n = await downloadReport(r.key, r.supportsDays ? days : 0)
      message.success(`已导出「${r.label}」${n} 行`)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '导出失败')
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <div>
      <Space align="center" style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <div>
          <Title level={4} style={{ margin: 0 }}><FileExcelOutlined /> 报表导出</Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            库存/流水/单据/件卡/主数据/订单/生产/成本/趋势/盘点/审计 → 一键导出 XLSX（口径与对应页面完全一致）
          </Text>
        </div>
        <Space>
          <Segmented
            value={days}
            onChange={(v) => setDays(Number(v))}
            options={DAY_PRESETS}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading} />
        </Space>
      </Space>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="时间窗只作用于带时间维度的报表"
        description={
          <>
            当前时间窗：<Text strong>{DAY_PRESETS.find((p) => p.value === days)?.label}</Text>。
            库存批次、物料、规格等是当前状态类报表，时间窗对它们无效（导出的仍是全量当前状态），
            这与页面口径一致——批次是「现在还有多少」，不是「某天有多少」。
          </>
        }
      />

      {allowed.length === 0 ? (
        <Card size="small">
          <Empty description={loading ? '加载中…' : '当前账号没有可导出的报表（需 inventory.view / material.view / report.view / audit.view 等）'} />
        </Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
          {allowed.map((r) => (
            <Card
              key={r.key}
              size="small"
              title={
                <Space>
                  <FileExcelOutlined style={{ color: '#0F6E56' }} />
                  {r.label}
                  {r.supportsDays && days > 0 && <Tag color="blue">近{days}天</Tag>}
                </Space>
              }
              extra={
                <Button
                  type="primary"
                  ghost
                  size="small"
                  icon={<FileExcelOutlined />}
                  loading={busyKey === r.key}
                  onClick={() => void doExport(r)}
                >
                  导出
                </Button>
              }
            >
              <Text type="secondary" style={{ fontSize: 12 }}>{r.description}</Text>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}