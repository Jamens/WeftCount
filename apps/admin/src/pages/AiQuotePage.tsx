import { useState } from 'react'
import {
  App as AntdApp,
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Form,
  InputNumber,
  Row,
  Select,
  Space,
  Statistic,
  Tag,
  Typography,
} from 'antd'
import { RobotOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { api } from '../lib/api'
import { useLookups } from '../lib/lookups'
import { fmt, fmtMoney, type AiInsight, type QuoteData } from '../lib/erp'

const { Title, Text } = Typography

interface QuoteForm {
  specId?: string
  quantityM?: number
  targetMarginRate?: number
}

/**
 * 智能核价（AI 引擎首个能力）
 *
 * 数字全部来自确定性引擎（成本：纱线价+加工费；价带：历史成交），大模型只给建议与理由。
 * 结论带来源(LLM/规则)、置信度与推导依据；未接大模型时走规则兜底，功能不阉割。
 */
export default function AiQuotePage() {
  const { message } = AntdApp.useApp()
  const { specs } = useLookups()
  const [form] = Form.useForm<QuoteForm>()
  const [loading, setLoading] = useState(false)
  const [insight, setInsight] = useState<AiInsight<QuoteData> | null>(null)

  const onQuote = async () => {
    const v = await form.validateFields()
    setLoading(true)
    try {
      const res = await api.post<AiInsight<QuoteData>>('/ai/quote', {
        specId: v.specId,
        quantityM: v.quantityM,
        targetMarginRate: v.targetMarginRate,
      })
      setInsight(res.data.data)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '核价失败')
    } finally {
      setLoading(false)
    }
  }

  const d = insight?.data
  const confPct = insight ? Math.round(insight.confidence * 100) : 0

  return (
    <div>
      <Space align="center" style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            <RobotOutlined /> 智能核价
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            确定性成本 + 历史成交价带 → 建议报价（大模型只给建议与理由，数字均可追溯）
          </Text>
        </div>
      </Space>

      <Row gutter={[12, 12]}>
        <Col span={8}>
          <Card size="small" title="报价条件">
            <Form<QuoteForm> form={form} layout="vertical" initialValues={{ targetMarginRate: 0.15 }}>
              <Form.Item name="specId" label="规格" rules={[{ required: true, message: '请选择规格' }]}>
                <Select showSearch optionFilterProp="label" placeholder="选择坯布规格" options={specs.map((s) => ({ value: s.id, label: `${s.code} ${s.name}` }))} />
              </Form.Item>
              <Form.Item name="quantityM" label="数量（米）" rules={[{ required: true, message: '请输入数量' }]}>
                <InputNumber style={{ width: '100%' }} min={1} precision={0} placeholder="如 5000" />
              </Form.Item>
              <Form.Item name="targetMarginRate" label="目标毛利率">
                <InputNumber style={{ width: '100%' }} min={0} max={0.9} step={0.05} precision={2} addonAfter="(0~1)" />
              </Form.Item>
              <Button type="primary" block icon={<ThunderboltOutlined />} loading={loading} onClick={() => void onQuote()}>
                生成报价建议
              </Button>
            </Form>
          </Card>
        </Col>

        <Col span={16}>
          {!insight || !d ? (
            <Card size="small">
              <Alert type="info" showIcon message="等待报价" description="选择规格与数量后生成建议报价。成本来自纱线价与加工费（确定性计算），价带来自历史成交。" />
            </Card>
          ) : (
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <Card size="small">
                <Row gutter={12}>
                  <Col span={8}><Statistic title="建议报价(元/米)" value={d.suggestedPrice} precision={2} valueStyle={{ color: '#BA7517' }} /></Col>
                  <Col span={8}><Statistic title="单米成本(元/米)" value={d.costPerM} precision={3} /></Col>
                  <Col span={8}><Statistic title="毛利率" value={(d.marginRate * 100).toFixed(1)} suffix="%" /></Col>
                </Row>
                <Divider style={{ margin: '12px 0' }} />
                <Space wrap>
                  <Tag color={insight.source === 'llm' ? 'purple' : 'blue'}>
                    {insight.source === 'llm' ? 'AI 生成' : '规则兜底'}
                  </Tag>
                  <Tag color={confPct >= 60 ? 'green' : 'orange'}>置信度 {confPct}%</Tag>
                  <Text type="secondary">毛利 {fmtMoney(String(d.grossProfitPerM))}/米 · 数量 {fmt(String(d.quantityM), 0)} 米</Text>
                </Space>
              </Card>

              <Card size="small" title="推导依据（确定性事实）">
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {insight.derivation.map((x, i) => (
                    <li key={i}><Text>{x}</Text></li>
                  ))}
                </ul>
                <Divider style={{ margin: '10px 0' }} />
                <Text strong>理由：</Text>
                <Text>{insight.reasoning}</Text>
              </Card>

              <Card size="small" title="成本与价带明细">
                <Descriptions column={2} size="small" bordered>
                  <Descriptions.Item label="材料成本">{fmt(String(d.materialCostPerM), 4)} 元/米</Descriptions.Item>
                  <Descriptions.Item label="加工费">{fmt(String(d.overheadPerM), 4)} 元/米</Descriptions.Item>
                  <Descriptions.Item label="历史成交价带">
                    {d.priceBand ? `${d.priceBand.min.toFixed(2)} ~ ${d.priceBand.max.toFixed(2)}（${d.priceBand.count} 笔，均价 ${d.priceBand.avg.toFixed(2)}）` : '暂无'}
                  </Descriptions.Item>
                  <Descriptions.Item label="目标毛利率">{(d.targetMarginRate * 100).toFixed(0)}%</Descriptions.Item>
                </Descriptions>
              </Card>
            </Space>
          )}
        </Col>
      </Row>
    </div>
  )
}
