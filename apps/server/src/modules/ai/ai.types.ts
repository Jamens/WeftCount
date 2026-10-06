/**
 * AI 结论统一形态
 *
 * 项目铁律：**数字来自确定性引擎，AI 只给建议/解释**。每条 AI 结论都必须带
 * - source     : llm(大模型生成) | rule(规则兜底，AI 不可用时)
 * - confidence : 置信度 0~1
 * - derivation : 推导依据（确定性事实列表，可追溯到成本/历史/规则）
 * - reasoning  : 大模型给出的理由（rule 兜底时为规则说明）
 */
export interface AiInsight<T> {
  source: 'llm' | 'rule'
  confidence: number
  derivation: string[]
  reasoning: string
  data: T
}
