import { useCallback, useEffect, useMemo, useState } from 'react'
import { App as AntdApp, Card, Col, Row, Segmented, Space, Statistic, Typography } from 'antd'
import { AreaChartOutlined, ReloadOutlined } from '@ant-design/icons'
import { api } from '../lib/api'
import { BarChart, HBarChart, Legend, LineChart, type SeriesPoint } from '../components/Charts'
import { fmt, type TrendData } from '../lib/erp'

const { Title, Text } = Typography

/** 趋势分析：日产量 / 采购销售金额 / 规格产量占比（确定性聚合，无预测） */
export default function TrendPage() {
  const { message } = AntdApp.useApp()
  const [days, setDays] = useState<number>(30)
  const [data, setData] = useState<TrendData | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<TrendData>('/analytics/trends', { params: { days } })
      setData(res.data.data)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载趋势失败')
    } finally {
      setLoading(false)
    }
  }, [days, message])

  useEffect(() => { void load() }, [load])

  // 组装图表数据
  const amtSeries = useMemo<SeriesPoint[]>(
    () => (data?.daily ?? []).map((p) => ({ label: p.date.slice(5), values: [p.purchaseAmount, p.salesAmount] })),
    [data]
  )
  const specSeries = useMemo<SeriesPoint[]>(
    () => (data?.specShare ?? []).slice(0, 8).map((s) => ({ label: s.specName, values: [s.meters] })),
    [data]
  )
  const prodMetersOnly = useMemo<SeriesPoint[]>(
    () => (data?.daily ?? []).map((p) => ({ label: p.date.slice(5), values: [p.meters] })),
    [data]
  )
  // 损耗：累计损耗(米)单线 + 投料/产出双线
  const cumLossSeries = useMemo<SeriesPoint[]>(
    () => (data?.loss.daily ?? []).map((p) => ({ label: p.date.slice(5), values: [p.cumulativeExcessM] })),
    [data]
  )
  const ioSeries = useMemo<SeriesPoint[]>(
    () => (data?.loss.daily ?? []).map((p) => ({ label: p.date.slice(5), values: [p.inputM, p.outputM] })),
    [data]
  )
  // 匹数：产出/发货
  const rollSeries = useMemo<SeriesPoint[]>(
    () => (data?.rolls.daily ?? []).map((p) => ({ label: p.date.slice(5), values: [p.produced, p.shipped] })),
    [data]
  )
  // 机台产出 Top
  const machineSeries = useMemo<SeriesPoint[]>(
    () => (data?.rolls.machineTop ?? []).map((m) => ({ label: m.machineName, values: [m.rolls] })),
    [data]
  )

  return (
    <div>
      <Space align="center" style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <div>
          <Title level={4} style={{ margin: 0 }}><AreaChartOutlined /> 趋势分析</Title>
          <Text type="secondary" style={{ fontSize: 12 }}>日产量 / 采购销售 / 规格占比——数据库确定性聚合，不做预测</Text>
        </div>
        <Space>
          <Segmented value={days} onChange={(v) => setDays(Number(v))} options={[{ label: '近7天', value: 7 }, { label: '近30天', value: 30 }, { label: '近90天', value: 90 }]} />
          <span><ReloadOutlined onClick={() => void load()} style={{ cursor: 'pointer' }} /></span>
        </Space>
      </Space>

      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col span={6}><Card size="small" loading={loading}><Statistic title="总产量" value={data?.totals.meters ?? 0} precision={0} suffix="m" /></Card></Col>
        <Col span={6}><Card size="small" loading={loading}><Statistic title="总采购额" value={data?.totals.purchaseAmount ?? 0} precision={0} prefix="¥" valueStyle={{ color: '#BA7517' }} /></Card></Col>
        <Col span={6}><Card size="small" loading={loading}><Statistic title="总销售额" value={data?.totals.salesAmount ?? 0} precision={0} prefix="¥" valueStyle={{ color: '#185FA5' }} /></Card></Col>
        <Col span={6}><Card size="small" loading={loading}><Statistic title="在库匹数" value={data?.rolls.inStock ?? 0} precision={0} suffix="匹" valueStyle={{ color: '#0F6E56' }} /></Card></Col>
      </Row>

      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col span={12}>
          <Card size="small" loading={loading}>
            <Statistic
              title={`窗口累计损耗（投料 ${fmt(String(data?.loss.windowInputM ?? 0), 0)}m − 产出 ${fmt(String(data?.loss.windowOutputM ?? 0), 0)}m）`}
              value={data?.loss.totalExcessM ?? 0} precision={0} suffix="m"
              valueStyle={{ color: (data?.loss.totalExcessM ?? 0) > 0 ? '#cf1322' : '#3f8600' }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>正=净损（领用多于产出）。领用按批、织造跨天，以累计差看趋势。</Text>
          </Card>
        </Col>
        <Col span={12}>
          <Card size="small" loading={loading}>
            <Statistic title="窗口损耗率" value={data?.loss.windowInputM ? (data.loss.totalExcessM / data.loss.windowInputM) * 100 : 0} precision={2} suffix="%" valueStyle={{ color: '#993C1D' }} />
            <Text type="secondary" style={{ fontSize: 12 }}>累计损耗 ÷ 投料当量。注意领用与产出按日不严格配对，此为窗口口径。</Text>
          </Card>
        </Col>
      </Row>

      <Row gutter={[12, 12]}>
        <Col span={24}>
          <Card size="small" title="累计损耗趋势（米，正=净损）" loading={loading}>
            <LineChart data={cumLossSeries} seriesNames={['累计损耗(米)']} height={220} area />
          </Card>
        </Col>
        <Col span={24}>
          <Card size="small" title="投料 vs 产出（米）" loading={loading}>
            <LineChart data={ioSeries} seriesNames={['投料(领用)', '产出(报工)']} height={220} area={false} />
            <Legend names={['投料(领用)', '产出(报工)']} />
          </Card>
        </Col>
        <Col span={24}>
          <Card size="small" title="匹数趋势（匹/日）" loading={loading}>
            <LineChart data={rollSeries} seriesNames={['产出匹', '发货匹']} height={200} area={false} />
            <Legend names={['产出匹', '发货匹']} />
          </Card>
        </Col>
        <Col span={24}>
          <Card size="small" title="机台产出 Top（匹）" loading={loading}>
            <HBarChart data={machineSeries} />
          </Card>
        </Col>
        <Col span={24}>
          <Card size="small" title="日产量趋势（米）" loading={loading}>
            <LineChart data={prodMetersOnly} seriesNames={['产量(米)']} height={220} />
          </Card>
        </Col>
        <Col span={24}>
          <Card size="small" title="采购 vs 销售 金额趋势（元）" loading={loading}>
            <LineChart data={amtSeries} seriesNames={['采购额', '销售额']} height={220} area={false} />
            <Legend names={['采购额', '销售额']} />
          </Card>
        </Col>
        <Col span={24}>
          <Card size="small" title="规格产量占比（Top 8）" loading={loading}>
            <HBarChart data={specSeries} />
          </Card>
        </Col>
        <Col span={24}>
          <Card size="small" title="日产量（米）柱状" loading={loading}>
            <BarChart data={prodMetersOnly} height={200} color="#534AB7" />
          </Card>
        </Col>
      </Row>
    </div>
  )
}
