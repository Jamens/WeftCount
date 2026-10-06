import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { CostService } from '../cost/cost.service'
import { LlmClient } from './llm.client'
import type { AiInsight } from './ai.types'

export interface QuoteData {
  specId: string
  specName: string
  quantityM: number
  /** 确定性单米成本（材料+加工费） */
  costPerM: number
  materialCostPerM: number
  overheadPerM: number
  /** 建议报价（元/米） */
  suggestedPrice: number
  /** 建议毛利率 0~1 */
  marginRate: number
  grossProfitPerM: number
  /** 该规格近期成交价带（无历史则 null，不臆造） */
  priceBand: { min: number; max: number; avg: number; count: number } | null
  targetMarginRate: number
}

const DEFAULT_TARGET_MARGIN = 0.15
const MIN_MARGIN = 0.05

/**
 * 智能核价
 *
 * 事实包（100% 确定性，来自成本/历史引擎）：
 *   - 单米成本 = 纱线材料成本 + 加工费（shared computeSpecCost）
 *   - 该规格近期成交价带（最近 N 笔销售出库单价）
 * 大模型职责：基于这些事实给出**建议报价**与理由。
 * AI 不可用/输出不合法时，走**规则兜底**（成本×(1+目标毛利)，并向历史价带靠拢），
 * 保证任何时候都能给出一个有依据的报价。结论一律带 source/confidence/derivation。
 */
@Injectable()
export class PricingService {
  private readonly log = new Logger(PricingService.name)

  constructor(
    private readonly cost: CostService,
    private readonly llm: LlmClient,
  ) {}

  async quote(
    tenantId: string,
    companyId: string,
    input: { specId: string; quantityM: number; targetMarginRate?: number },
  ): Promise<AiInsight<QuoteData>> {
    const quantityM = Number(input.quantityM)
    if (!Number.isFinite(quantityM) || quantityM <= 0) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: '报价数量必须大于 0' })
    }
    const targetMargin = Number.isFinite(Number(input.targetMarginRate)) ? Number(input.targetMarginRate) : DEFAULT_TARGET_MARGIN

    const costRow = await this.cost.specCost(tenantId, companyId, input.specId)
    if (!costRow) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: '规格不存在' })
    }
    const band = await this.cost.salesPriceBand(companyId, input.specId)

    const costPerM = costRow.totalCostPerM
    const costKnown = costPerM > 0.0001
    // 成本与价带都缺失 → 无法给出有依据的报价，明确报错而非臆造
    if (!costKnown && !band) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: '该规格缺少纱线价格(成本数据)与历史成交价，无法给出可靠报价，请先补纱线采购价或成交记录',
      })
    }
    // 确定性事实
    const derivation = [
      costKnown
        ? `单米成本 ${costPerM.toFixed(4)} 元（材料 ${costRow.materialCostPerM.toFixed(4)} + 加工费 ${costRow.overheadPerM.toFixed(4)}）`
        : '单米成本未知（经/纬纱无价格数据，成本=0）',
      `经纱价 ${costRow.warpYarnPrice.toFixed(2)} 元/kg（来源：${costRow.warpPriceSource}），纬纱价 ${costRow.weftYarnPrice.toFixed(2)} 元/kg（来源：${costRow.weftPriceSource}）`,
      band
        ? `该规格近 ${band.count} 笔成交价带 ${band.min.toFixed(2)}~${band.max.toFixed(2)}，均价 ${band.avg.toFixed(2)} 元/米`
        : '该规格暂无历史成交价带（按成本加成报价）',
      `目标毛利率 ${(targetMargin * 100).toFixed(1)}%`,
    ]

    // 规则兜底建议价
    const rulePrice = this.rulePrice(costPerM, costKnown, targetMargin, band)
    const fallback: AiInsight<QuoteData> = {
      source: 'rule',
      confidence: costKnown ? (band ? 0.6 : 0.4) : 0.35,
      derivation,
      reasoning: !costKnown
        ? `成本数据缺失，按历史成交均价 ${band!.avg.toFixed(2)} 元/米 建议（置信度低，建议先补纱线价）。`
        : band
          ? `以成本加成价 ${(costPerM * (1 + targetMargin)).toFixed(2)} 为锚，向历史成交均价 ${band.avg.toFixed(2)} 靠拢后取 ${rulePrice.toFixed(2)} 元/米。`
          : `无历史成交参考，按成本加成 ${(targetMargin * 100).toFixed(1)}% 报价 ${rulePrice.toFixed(2)} 元/米。`,
      data: this.buildData(costRow, quantityM, rulePrice, targetMargin, band),
    }

    // 成本未知时不让 LLM 拍价（无成本底线可校验），直接用兜底
    if (!this.llm.enabled || !costKnown) return fallback

    // 让大模型基于事实给建议价
    const system = `你是纺织厂报价助手。只依据给定事实给出建议报价（元/米），不得臆造数据。必须只输出 JSON：{"suggestedPrice":数字,"marginRate":0~1小数,"confidence":0~1,"reasoning":"简短中文理由"}`
    const user =
      `规格：${costRow.specName}（${costRow.specCode}）\n` +
      `数量：${quantityM} 米\n` +
      `单米成本：${costPerM.toFixed(4)} 元（材料 ${costRow.materialCostPerM.toFixed(4)} + 加工费 ${costRow.overheadPerM.toFixed(4)}）\n` +
      (band ? `该规格近 ${band.count} 笔成交价：${band.min.toFixed(2)}~${band.max.toFixed(2)}，均价 ${band.avg.toFixed(2)} 元/米\n` : '该规格无历史成交\n') +
      `目标毛利率：${(targetMargin * 100).toFixed(1)}%\n` +
      `请给出建议报价。`
    const res = await this.llm.chat([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ])
    if (!res.ok) return fallback

    try {
      const parsed = JSON.parse(extractJson(res.content)) as {
        suggestedPrice?: number
        marginRate?: number
        confidence?: number
        reasoning?: string
      }
      const price = Number(parsed.suggestedPrice)
      // 校验：价格为正且不低于成本×(1+最低毛利)，否则丢弃用兜底
      if (!Number.isFinite(price) || price <= costPerM * (1 + MIN_MARGIN) || price <= 0) {
        return fallback
      }
      const margin = (price - costPerM) / price
      return {
        source: 'llm',
        confidence: Math.min(Math.max(Number(parsed.confidence ?? 0.7), 0), 1),
        derivation,
        reasoning: parsed.reasoning ?? '大模型基于成本与历史价带给出的建议价',
        data: this.buildData(costRow, quantityM, price, targetMargin, band, margin),
      }
    } catch (e) {
      this.log.warn(`LLM 报价输出解析失败，回退规则：${e instanceof Error ? e.message : e}`)
      return fallback
    }
  }

  /** 规则建议价：成本已知则成本加成并向历史成交均价靠拢；成本未知则退化为历史均价 */
  private rulePrice(costPerM: number, costKnown: boolean, targetMargin: number, band: { min: number; max: number; avg: number } | null): number {
    if (!costKnown) {
      // 成本缺失：只能参考历史成交价带（此时必有 band，否则上面已报错）
      return band ? round2(band.avg) : 0
    }
    const base = costPerM * (1 + targetMargin)
    const floor = costPerM * (1 + MIN_MARGIN)
    if (!band) return round2(base)
    // 向均价靠拢：取 base 与均价的加权（成本权重更高），并夹在 [floor, max*1.05]
    const anchored = base * 0.6 + band.avg * 0.4
    return round2(Math.min(Math.max(anchored, floor), band.max * 1.05))
  }

  private buildData(
    costRow: { specId: string; specName: string; totalCostPerM: number; materialCostPerM: number; overheadPerM: number },
    quantityM: number,
    price: number,
    targetMargin: number,
    band: { min: number; max: number; avg: number; count: number } | null,
    margin?: number,
  ): QuoteData {
    const costPerM = costRow.totalCostPerM
    return {
      specId: costRow.specId,
      specName: costRow.specName,
      quantityM,
      costPerM,
      materialCostPerM: costRow.materialCostPerM,
      overheadPerM: costRow.overheadPerM,
      suggestedPrice: price,
      marginRate: margin ?? (price - costPerM) / price,
      grossProfitPerM: price - costPerM,
      priceBand: band,
      targetMarginRate: targetMargin,
    }
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** 从可能带 markdown 包裹的模型输出里抠出 JSON */
function extractJson(s: string): string {
  const t = s.trim()
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start >= 0 && end > start) return t.slice(start, end + 1)
  return t
}
