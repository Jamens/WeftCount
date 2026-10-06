import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { CostService } from '../cost/cost.service'
import { MaterialService } from '../material/material.service'
import { InventoryDocumentEntity } from '../inventory/entities/inventory-document.entity'
import { InventoryBatchEntity } from '../inventory/entities/inventory-batch.entity'
import { LlmClient } from './llm.client'
import type { AiInsight } from './ai.types'

export interface SpecLossRow {
  specId: string
  specName: string
  /** 投料当量(米)：生产领用折算米数合计（这批纱应产出多少米布） */
  inputM: number
  /** 实际产出(米)：报工产出批次米数合计 */
  outputM: number
  /** 实际投纱重(kg)：由工艺系数从投料米数推算 */
  inputYarnKg: number
  /** 实际产出布重(kg) */
  outputKg: number
  /** 标准得布率（成品重/投纱重，来自工艺系数） */
  standardYield: number
  /** 实际得布率 = 产出布重/投纱重 */
  actualYield: number
  /** 超额损耗(成品当量米) = 投料当量 − 实际产出（正=比标准差） */
  excessLossM: number
  /** 超额损耗(kg，成品当量) */
  excessLossKg: number
  /** 超额损耗率 = 超额损耗米/投料当量米 */
  excessLossRate: number
  /** 折合金额(元)：超额损耗米 × 成品材料成本/米 */
  lossAmount: number
  /** 报工产出笔数 */
  outputCount: number
}

export interface LossData {
  rows: SpecLossRow[]
  /** 超额损耗合计(kg)与金额 */
  totalExcessKg: number
  totalLossAmount: number
  /** 参与分析的规格数（有投料且有产出的） */
  specCount: number
}

/**
 * 损耗归因
 *
 * 口径（全部确定性计算）：
 *   投料 = 生产领用(kg，按坯布规格归集)   产出 = 报工 production_in 批次(kg)
 *   标准得布率 = 成品重/100m ÷ 投料重/100m（来自工艺快照：gsm×幅宽/1000 ÷ 经纬纱 kg/100m）
 *   超额损耗 = 投料×标准得布率 − 实际产出（正=实际比标准差）
 *   折合金额 = 超额损耗 × 纱线均价（经纬纱按成本价加权）
 *
 * 大模型只做「解释与建议」：给定这些确定性数字，输出可能成因与改进动作，
 * 不可用/不合法则规则兜底。结论带置信度与依据。
 */
@Injectable()
export class LossService {
  private readonly log = new Logger(LossService.name)

  constructor(
    private readonly materials: MaterialService,
    private readonly cost: CostService,
    private readonly llm: LlmClient,
    @InjectRepository(InventoryDocumentEntity)
    private readonly docRepo: Repository<InventoryDocumentEntity>,
    @InjectRepository(InventoryBatchEntity)
    private readonly batchRepo: Repository<InventoryBatchEntity>,
  ) {}

  /** 确定性核算：按规格算超额损耗并排序 */
  async analyze(tenantId: string, companyId: string): Promise<LossData> {
    // 投料：生产领用单（按 specId 归集，重量取 weightKg）
    const issues = await this.docRepo
      .createQueryBuilder('d')
      .where('d.company_id = :companyId', { companyId })
      .andWhere("d.doc_type = 'production_issue'")
      .getMany()
    // 产出：报工产生的批次 production_in（按 specId 归集）
    const outputs = await this.batchRepo
      .createQueryBuilder('b')
      .where('b.company_id = :companyId', { companyId })
      .andWhere("b.source_type = 'production_in'")
      .getMany()

    const inBySpec = new Map<string, { kg: number; m: number }>()
    for (const d of issues) {
      const cur = inBySpec.get(d.specId) ?? { kg: 0, m: 0 }
      cur.kg += Number(d.weightKg)
      cur.m += Number(d.quantityM)
      inBySpec.set(d.specId, cur)
    }
    const outBySpec = new Map<string, { kg: number; m: number; count: number }>()
    for (const b of outputs) {
      const cur = outBySpec.get(b.specId) ?? { kg: 0, m: 0, count: 0 }
      cur.kg += Number(b.weightKg)
      cur.m += Number(b.quantity)
      cur.count += 1
      outBySpec.set(b.specId, cur)
    }

    const specIds = [...new Set([...inBySpec.keys(), ...outBySpec.keys()])]
    const rows: SpecLossRow[] = []
    for (const specId of specIds) {
      const input = inBySpec.get(specId) ?? { kg: 0, m: 0 }
      const output = outBySpec.get(specId) ?? { kg: 0, m: 0, count: 0 }
      if (input.m <= 0) continue // 无投料不评估（避免分母 0）
      // 工艺系数（快照）：投纱 kg/米、成品布 kg/米、标准得布率
      const spec = await this.materials.findSpec(tenantId, companyId, specId)
      const snap = this.materials.getSnapshot(spec)
      const widthM = Number(spec.finishedWidth) / 100
      const yarnKgPerM = (Number(snap.warpKgPer100m) + Number(snap.weftKgPer100m)) / 100
      const finishedKgPerM = (Number(snap.totalGsm) * widthM) / 1000 // g/m ÷1000 = kg/m
      if (yarnKgPerM <= 0) continue
      const standardYield = finishedKgPerM / yarnKgPerM
      // 投料当量米 = 领用折算米数；实际投纱重由工艺系数推（领用单存的是成品当量，非投纱重）
      const inputM = input.m
      const inputYarnKg = inputM * yarnKgPerM
      const outputM = output.m
      const outputKg = outputM * finishedKgPerM
      const actualYield = inputYarnKg > 0 ? outputKg / inputYarnKg : 0
      // 超额损耗(成品当量米)：投料当量 − 实际产出（正=比标准差）
      const excessLossM = inputM - outputM
      const excessLossKg = excessLossM * finishedKgPerM
      const excessLossRate = excessLossM / inputM
      // 折合金额：按成品材料成本/米计价（loss 当量的价值）
      let lossAmount = 0
      try {
        const costRow = await this.cost.specCost(tenantId, companyId, specId)
        if (costRow) lossAmount = excessLossM * costRow.materialCostPerM
      } catch {
        /* 取不到价就不折金额，不臆造 */
      }
      rows.push({
        specId, specName: spec.name,
        inputM, outputM,
        inputYarnKg, outputKg,
        standardYield, actualYield,
        excessLossM, excessLossKg, excessLossRate, lossAmount,
        outputCount: output.count,
      })
    }
    // 按折合金额降序（无金额按超额损耗米降序）
    rows.sort((a, b) => b.lossAmount - a.lossAmount || b.excessLossM - a.excessLossM)
    const totalExcessKg = rows.reduce((s, r) => s + Math.max(r.excessLossKg, 0), 0)
    const totalLossAmount = rows.reduce((s, r) => s + Math.max(r.lossAmount, 0), 0)
    return { rows, totalExcessKg, totalLossAmount, specCount: rows.length }
  }

  /** 损耗归因 + AI 解释/建议 */
  async attribute(tenantId: string, companyId: string): Promise<AiInsight<LossData>> {
    const data = await this.analyze(tenantId, companyId)
    const worst = data.rows.filter((r) => r.excessLossM > 0).slice(0, 5)
    const derivation = [
      `参与分析规格 ${data.specCount} 个，超额损耗合计 ${data.totalExcessKg.toFixed(1)} kg，折合约 ${data.totalLossAmount.toFixed(0)} 元`,
      '口径：投料当量=生产领用折算米数，产出=报工产出米数；实际得布率=产出布重/投纱重(投纱重由工艺系数推)',
    ]
    for (const r of worst) {
      derivation.push(
        `${r.specName}：投料当量 ${r.inputM.toFixed(0)}m，产出 ${r.outputM.toFixed(0)}m，实际得布率 ${(r.actualYield * 100).toFixed(1)}%（标准 ${(r.standardYield * 100).toFixed(1)}%），超额损耗 ${r.excessLossM.toFixed(0)}m（${(r.excessLossRate * 100).toFixed(1)}%）`,
      )
    }

    // 规则兜底解释
    const fallback: AiInsight<LossData> = {
      source: 'rule',
      confidence: worst.length ? 0.5 : 0.3,
      derivation,
      reasoning: worst.length
        ? `损耗主要集中在 ${worst[0].specName}（超额 ${(worst[0].excessLossRate * 100).toFixed(1)}%），建议优先排查该规格的断经/落纱与上浆稳定性。`
        : '当前各规格实际得布率未低于标准（或无投料数据），暂无明显异常损耗。',
      data,
    }
    if (!this.llm.enabled || worst.length === 0) return fallback

    const system = `你是纺织厂工艺/生产分析师。只依据给定数据给出损耗原因与改进建议，用中文简短作答，输出 JSON：{"reasoning":"归因说明","suggestions":["建议1","建议2"],"confidence":0~1,"topSpec":"损耗最严重的规格名"}`
    const user =
      `织造损耗归因数据（得布率=产出/投料，越低损耗越大）：\n` +
      worst
        .map((r) => `- ${r.specName}：投料当量${r.inputM.toFixed(0)}m，产出${r.outputM.toFixed(0)}m，实际得布率${(r.actualYield * 100).toFixed(1)}%，标准得布率${(r.standardYield * 100).toFixed(1)}%，超额损耗${r.excessLossM.toFixed(0)}m（${(r.excessLossRate * 100).toFixed(1)}%）`)
        .join('\n') +
      `\n请归因并给出改进建议。`
    const res = await this.llm.chat([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ])
    if (!res.ok) return fallback
    try {
      const parsed = JSON.parse(extractJson(res.content)) as {
        reasoning?: string
        suggestions?: string[]
        confidence?: number
      }
      return {
        source: 'llm',
        confidence: Math.min(Math.max(Number(parsed.confidence ?? 0.7), 0), 1),
        derivation,
        reasoning: parsed.reasoning ?? fallback.reasoning,
        data,
      }
    } catch (e) {
      this.log.warn(`LLM 归因输出解析失败，回退规则：${e instanceof Error ? e.message : e}`)
      return fallback
    }
  }
}

function extractJson(s: string): string {
  const t = s.trim()
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start >= 0 && end > start) return t.slice(start, end + 1)
  return t
}
