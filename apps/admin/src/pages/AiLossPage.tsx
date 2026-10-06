import { useCallback, useEffect, useState } from 'react'
import { App as AntdApp, Alert, Button, Card, Col, Row, Space, Statistic, Table, Tag, Typography } from 'antd'
import { ExperimentOutlined, ReloadOutlined } from '@ant-design/icons'
import { api } from '../lib/api'
import { fmt, fmtMoney, LIST_TABLE_SCROLL_Y, type AiInsight, type LossData, type LossHotspotWire, type SpecLossRow } from '../lib/erp'

const { Title, Text } = Typography

/**
 * 损耗归因（AI 引擎能力）
 *
 * 确定性核算：投料当量(生产领用) vs 实际产出(报工)，标准得布率来自工艺系数；
 * 超额损耗 = 投料当量 − 产出。大模型只做归因解释与建议。结论带来源/置信度/依据。
 */
export default function AiLossPage() {
  const { message } = AntdApp.useApp()
  const [insight, setInsight] = useState<AiInsight<LossData> | null>(null)
  const [hotspots, setHotspots] = useState<LossHotspotWire[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<AiInsight<LossData>>('/ai/loss')
      setInsight(res.data.data)
      // 损耗热点到匹（规格级损耗 + 该规格产出的件卡）
      try {
        const hs = await api.get<LossHotspotWire[]>('/ai/loss/hotspots')
        setHotspots(hs.data.data)
      } catch {
        setHotspots([])
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载损耗分析失败')
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    void load()
  }, [load])

  const d = insight?.data
  const confPct = insight ? Math.round(insight.confidence * 100) : 0

  return (
    <div>
      <Space align="center" style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            <ExperimentOutlined /> 损耗归因
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            投料当量(生产领用) vs 产出(报工)，标准得布率来自工艺系数；AI 解释成因与建议
          </Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>刷新</Button>
      </Space>

      {!insight || !d ? (
        <Card size="small"><Alert type="info" showIcon message="加载中或无数据" description="需先有生产领用与报工数据才能分析损耗。" /></Card>
      ) : (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Row gutter={12}>
            <Col span={8}><Card size="small"><Statistic title="超额损耗合计" value={d.totalExcessKg} precision={1} suffix="kg" valueStyle={{ color: '#cf1322' }} /></Card></Col>
            <Col span={8}><Card size="small"><Statistic title="折合金额" value={d.totalLossAmount} precision={0} prefix="¥" valueStyle={{ color: '#cf1322' }} /></Card></Col>
            <Col span={8}><Card size="small"><Statistic title="分析规格数" value={d.specCount} suffix="个" /></Card></Col>
          </Row>

          <Card size="small">
            <Space wrap>
              <Tag color={insight.source === 'llm' ? 'purple' : 'blue'}>{insight.source === 'llm' ? 'AI 归因' : '规则归因'}</Tag>
              <Tag color={confPct >= 60 ? 'green' : 'orange'}>置信度 {confPct}%</Tag>
            </Space>
            <div style={{ marginTop: 8 }}>
              <Text strong>归因：</Text>
              <Text>{insight.reasoning}</Text>
            </div>
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: 'pointer' }}><Text type="secondary" style={{ fontSize: 12 }}>推导依据（确定性事实）</Text></summary>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {insight.derivation.map((x, i) => <li key={i}><Text type="secondary" style={{ fontSize: 12 }}>{x}</Text></li>)}
              </ul>
            </details>
          </Card>

          <Card size="small" title="各规格损耗明细（按折合金额排序）">
            <Table<SpecLossRow>
              rowKey="specId" size="small" loading={loading} dataSource={d.rows}
              scroll={LIST_TABLE_SCROLL_Y ? { y: LIST_TABLE_SCROLL_Y } : undefined}
              pagination={{ pageSize: 10, showSizeChanger: false, showTotal: (t) => `共 ${t} 个规格` }}
              columns={[
                { title: '规格', dataIndex: 'specName', width: 150, ellipsis: true },
                { title: '投料(米)', dataIndex: 'inputM', width: 90, align: 'right', render: (v: number) => fmt(String(v), 0) },
                { title: '产出(米)', dataIndex: 'outputM', width: 90, align: 'right', render: (v: number) => fmt(String(v), 0) },
                { title: '标准得布率', dataIndex: 'standardYield', width: 100, align: 'right', render: (v: number) => `${(v * 100).toFixed(1)}%` },
                { title: '实际得布率', dataIndex: 'actualYield', width: 100, align: 'right', render: (v: number) => <Text style={{ color: v < 0.9 ? '#cf1322' : undefined }}>{(v * 100).toFixed(1)}%</Text> },
                { title: '超额损耗(米)', dataIndex: 'excessLossM', width: 110, align: 'right', render: (v: number) => <Text style={{ color: v > 0 ? '#cf1322' : '#3f8600' }}>{fmt(String(v), 0)}</Text> },
                { title: '损耗率', dataIndex: 'excessLossRate', width: 90, align: 'right', render: (v: number) => `${(v * 100).toFixed(1)}%` },
                { title: '折合金额', dataIndex: 'lossAmount', width: 110, align: 'right', render: (v: number) => (v > 0 ? fmtMoney(String(v)) : '-') },
              ]}
            />
          </Card>

          <Card size="small" title="损耗热点到匹（展开看该规格织出的每一匹）">
            <Table<LossHotspotWire>
              rowKey="specId" size="small" loading={loading} dataSource={hotspots}
              pagination={false}
              expandable={{
                expandedRowRender: (r) => (
                  <Space wrap size={4}>
                    {r.rolls.length === 0 ? (
                      <Text type="secondary" style={{ fontSize: 12 }}>该规格暂无件卡记录</Text>
                    ) : (
                      r.rolls.map((roll) => (
                        <Tag key={roll.rollNo} color={roll.status === 'in_stock' ? 'blue' : 'default'}>
                          {roll.rollNo} · {fmt(String(roll.meters), 0)}m · {roll.orderNo}/{roll.machineName}
                        </Tag>
                      ))
                    )}
                  </Space>
                ),
              }}
              columns={[
                { title: '规格', dataIndex: 'specName', width: 150, ellipsis: true },
                { title: '产出匹数', dataIndex: 'rolls', width: 90, align: 'right', render: (v: LossHotspotWire['rolls']) => v.length },
                { title: '投料(米)', dataIndex: 'inputM', width: 90, align: 'right', render: (v: number) => fmt(String(v), 0) },
                { title: '产出(米)', dataIndex: 'outputM', width: 90, align: 'right', render: (v: number) => fmt(String(v), 0) },
                { title: '超额损耗(米)', dataIndex: 'excessLossM', width: 110, align: 'right', render: (v: number) => <Text style={{ color: v > 0 ? '#cf1322' : '#3f8600' }}>{fmt(String(v), 0)}</Text> },
                { title: '损耗率', dataIndex: 'excessLossRate', width: 90, align: 'right', render: (v: number) => `${(v * 100).toFixed(1)}%` },
                { title: '折合金额', dataIndex: 'lossAmount', width: 110, align: 'right', render: (v: number) => (v > 0 ? fmtMoney(String(v)) : '-') },
              ]}
            />
          </Card>
        </Space>
      )}
    </div>
  )
}
