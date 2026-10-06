import { useCallback, useEffect, useState } from 'react'
import { App as AntdApp, Alert, Button, Card, InputNumber, Popconfirm, Space, Table, Tag, Tooltip, Typography } from 'antd'
import { ReloadOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { api } from '../lib/api'
import { fmt, LIST_TABLE_SCROLL_Y, PERM, type AiInsight, type CoefficientData, type SpecCoefficientRow } from '../lib/erp'
import { useAuthStore } from '../stores/auth.store'

const { Title, Text } = Typography

/**
 * 系数自学习
 *
 * 从「生产领用(投料当量) / 报工(产出)」反推各规格实测多耗倍数 F(=领用/报工)，
 * 建议校准系数；应用后写入规格 learned_loss_factor——算快照时按 (1+设计损耗)×F−1
 * 折算有效损耗率，**反哺成本/用料/三算的确定性引擎**。
 */
export default function AiCoefficientPage() {
  const { message } = AntdApp.useApp()
  const canApply = useAuthStore((s) => s.hasPermission(PERM.MATERIAL_EDIT))
  const [insight, setInsight] = useState<AiInsight<CoefficientData> | null>(null)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState<string | null>(null)
  const [editing, setEditing] = useState<Record<string, number>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<AiInsight<CoefficientData>>('/ai/coefficients')
      setInsight(res.data.data)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载系数分析失败')
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    void load()
  }, [load])

  const apply = async (specId: string, factor: number) => {
    setApplying(specId)
    try {
      await api.post('/ai/coefficients/apply', { specId, factor })
      message.success(`已应用校准系数 ${factor}，后续成本/用料按实测系数计算`)
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '应用失败')
    } finally {
      setApplying(null)
    }
  }

  const d = insight?.data
  const confPct = insight ? Math.round(insight.confidence * 100) : 0

  return (
    <div>
      <Space align="center" style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            <ThunderboltOutlined /> 系数自学习
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            从领用/报工反推各规格实测多耗倍数，建议并应用校准系数，反哺成本与用料核算
          </Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>刷新</Button>
      </Space>

      {!insight || !d ? (
        <Card size="small"><Alert type="info" showIcon message="加载中或无数据" description="需同一规格既有生产领用又有报工（≥3笔）才能学习。" /></Card>
      ) : (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Card size="small">
            <Space wrap>
              <Tag color={insight.source === 'llm' ? 'purple' : 'blue'}>{insight.source === 'llm' ? 'AI 归因' : '规则归因'}</Tag>
              <Tag color={confPct >= 60 ? 'green' : 'orange'}>置信度 {confPct}%</Tag>
              <Text type="secondary">可学习规格 {d.rows.filter((r) => r.sufficient).length} / {d.rows.length}</Text>
            </Space>
            <div style={{ marginTop: 8 }}>
              <Text strong>说明：</Text>
              <Text>{insight.reasoning}</Text>
            </div>
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: 'pointer' }}><Text type="secondary" style={{ fontSize: 12 }}>推导依据（确定性事实）</Text></summary>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {insight.derivation.map((x, i) => <li key={i}><Text type="secondary" style={{ fontSize: 12 }}>{x}</Text></li>)}
              </ul>
            </details>
          </Card>

          <Card size="small" title="各规格实测多耗与建议校准系数">
            <Table<SpecCoefficientRow>
              rowKey="specId" size="small" loading={loading} dataSource={d.rows}
              scroll={LIST_TABLE_SCROLL_Y ? { y: LIST_TABLE_SCROLL_Y } : undefined}
              pagination={{ pageSize: 10, showSizeChanger: false, showTotal: (t) => `共 ${t} 个规格` }}
              columns={[
                { title: '规格', dataIndex: 'specName', width: 150, ellipsis: true },
                { title: '领用(米)', dataIndex: 'inputM', width: 90, align: 'right', render: (v: number) => fmt(String(v), 0) },
                { title: '产出(米)', dataIndex: 'outputM', width: 90, align: 'right', render: (v: number) => fmt(String(v), 0) },
                {
                  title: '实测多耗倍数', dataIndex: 'observedFactor', width: 120, align: 'right',
                  render: (v: number) => <Text style={{ color: v > 1.05 ? '#cf1322' : v < 0.95 ? '#d48806' : undefined }}>{v.toFixed(3)}</Text>,
                },
                { title: '样本', dataIndex: 'sampleSize', width: 60, align: 'right' },
                { title: '当前系数', dataIndex: 'currentFactor', width: 90, render: (v: number | null) => (v == null ? <Tag>未学习</Tag> : v.toFixed(3)) },
                { title: '建议系数', dataIndex: 'suggestedFactor', width: 90, align: 'right', render: (v: number) => v.toFixed(3) },
                {
                  title: '数据', dataIndex: 'sufficient', width: 90,
                  render: (v: boolean, r) => v
                    ? <Tag color="green">可学习</Tag>
                    : <Tooltip title={r.observedFactor > 1.6 ? '多耗倍数异常(>1.6)，疑似数据问题' : '样本不足(<3笔)'}>
                        <Tag color="orange">不建议</Tag>
                      </Tooltip>,
                },
                {
                  title: '操作', width: 150, fixed: 'right',
                  render: (_, r) => canApply ? (
                    <Space size={4}>
                      <InputNumber
                        size="small" style={{ width: 80 }} min={1} max={1.6} step={0.05} precision={3}
                        value={editing[r.specId] ?? r.suggestedFactor}
                        onChange={(v) => setEditing((p) => ({ ...p, [r.specId]: Number(v ?? r.suggestedFactor) }))}
                      />
                      <Popconfirm
                        title={`应用校准系数 ${(editing[r.specId] ?? r.suggestedFactor).toFixed(3)} 到「${r.specName}」？`}
                        description="将影响该规格后续成本/用料/核算"
                        onConfirm={() => void apply(r.specId, editing[r.specId] ?? r.suggestedFactor)}
                      >
                        <Button size="small" type="link" loading={applying === r.specId}>应用</Button>
                      </Popconfirm>
                    </Space>
                  ) : <Text type="secondary">-</Text>,
                },
              ]}
            />
          </Card>
        </Space>
      )}
    </div>
  )
}
