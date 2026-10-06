import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Not, Repository } from 'typeorm'
import { MaterialService } from '../material/material.service'
import { GreigeSpecEntity } from '../material/entities/greige-spec.entity'
import { InventoryDocumentEntity } from '../inventory/entities/inventory-document.entity'
import { InventoryBatchEntity } from '../inventory/entities/inventory-batch.entity'
import { LlmClient } from './llm.client'
import type { AiInsight } from './ai.types'

export interface SpecCoefficientRow {
  specId: string
  specName: string
  /** 领用当量米数合计 */
  inputM: number
  /** 报工产出米数合计 */
  outputM: number
  /** 报工样本笔数 */
  sampleSize: number
  /** 实测多耗倍数 = inputM / outputM（>1 表示比设计多耗） */
  observedFactor: number
  /** 建议校准系数（已截断到合理区间） */
  suggestedFactor: number
  /** 当前已应用的校准系数（null=未学习） */
  currentFactor: number | null
  /** 数据是否充分（样本足够） */
  sufficient: boolean
  /** 置信度 0~1（样本多、偏差稳定→高） */
  confidence: number
}

export interface CoefficientData {
  rows: SpecCoefficientRow[]
}

/** 校准系数上限：超过 1.6 基本是数据问题而非工艺差异，宁可不学 */
const MAX_FACTOR = 1.6
/** 最少报工样本笔数才建议学习 */
const MIN_SAMPLES = 3

/**
 * 系数自学习
 *
 * 确定性部分：从历史「生产领用(投料当量米)」与「报工(产出米)」反推该规格**实测多耗倍数**
 *   F = 领用米 / 报工米   (>1 说明实际比设计多耗，如断经/落纱/浆耗高于经验值)
 * 建议校准系数 = clamp(F, 1, 1.6)，并按样本量给置信度；样本 <3 或 F>1.6 判为数据不足/异常不建议。
 *
 * 应用后写入规格的 learned_loss_factor，算快照时按 (1+设计损耗)×F−1 折算有效损耗率，
 * **反哺成本/用料/三算的确定性引擎**。大模型只解释偏差成因，不参与数值。
 */
@Injectable()
export class CoefficientService {
  private readonly log = new Logger(CoefficientService.name)

  constructor(
    private readonly materials: MaterialService,
    private readonly llm: LlmClient,
    @InjectRepository(GreigeSpecEntity)
    private readonly specRepo: Repository<GreigeSpecEntity>,
    @InjectRepository(InventoryDocumentEntity)
    private readonly docRepo: Repository<InventoryDocumentEntity>,
    @InjectRepository(InventoryBatchEntity)
    private readonly batchRepo: Repository<InventoryBatchEntity>,
  ) {}

  /** 确定性分析：逐规格算实测多耗倍数与建议校准系数 */
  async analyze(tenantId: string, companyId: string): Promise<CoefficientData> {
    // 投料：生产领用按 specId 归集米数
    const issues = await this.docRepo
      .createQueryBuilder('d')
      .select('d.spec_id', 'specId')
      .addSelect('SUM(d.quantity_m)', 'inputM')
      .where('d.company_id = :companyId', { companyId })
      .andWhere("d.doc_type = 'production_issue'")
      .groupBy('d.spec_id')
      .getRawMany<{ specId: string; inputM: string }>()
    // 产出：报工批次按 specId 归集米数 + 笔数
    const outputs = await this.batchRepo
      .createQueryBuilder('b')
      .select('b.spec_id', 'specId')
      .addSelect('SUM(b.quantity)', 'outputM')
      .addSelect('COUNT(*)', 'cnt')
      .where('b.company_id = :companyId', { companyId })
      .andWhere("b.source_type = 'production_in'")
      .groupBy('b.spec_id')
      .getRawMany<{ specId: string; outputM: string; cnt: string }>()

    const inMap = new Map(issues.map((r) => [r.specId, Number(r.inputM)]))
    const outMap = new Map(outputs.map((r) => [r.specId, { m: Number(r.outputM), cnt: Number(r.cnt) }]))
    const specIds = [...new Set([...inMap.keys(), ...outMap.keys()])]

    const rows: SpecCoefficientRow[] = []
    for (const specId of specIds) {
      const inputM = inMap.get(specId) ?? 0
      const out = outMap.get(specId) ?? { m: 0, cnt: 0 }
      if (inputM <= 0 || out.m <= 0) continue // 需同时有投料与产出
      const spec = await this.specRepo.findOne({ where: { id: specId, tenantId, companyId } })
      if (!spec) continue
      const observedFactor = inputM / out.m
      const suggestedFactor = Math.min(Math.max(observedFactor, 1), MAX_FACTOR)
      const sufficient = out.cnt >= MIN_SAMPLES && observedFactor <= MAX_FACTOR
      // 置信度：样本量(封顶10) × 偏差可信度(1~1.3)；不充分压低
      const confidence = sufficient
        ? Math.min(0.5 + out.cnt * 0.05, 0.95)
        : Math.min(0.3 + out.cnt * 0.02, 0.5)
      rows.push({
        specId, specName: spec.name,
        inputM, outputM: out.m, sampleSize: out.cnt,
        observedFactor, suggestedFactor,
        currentFactor: spec.learnedLossFactor == null ? null : Number(spec.learnedLossFactor),
        sufficient, confidence,
      })
    }
    // 多耗最严重的排前面
    rows.sort((a, b) => b.observedFactor - a.observedFactor)
    return { rows }
  }

  /** 系数自学习分析 + AI 解释 */
  async learn(tenantId: string, companyId: string): Promise<AiInsight<CoefficientData>> {
    const data = await this.analyze(tenantId, companyId)
    const actionable = data.rows.filter((r) => r.sufficient)
    const derivation = [
      `分析 ${data.rows.length} 个规格，其中 ${actionable.length} 个样本充分、建议学习`,
      '口径：实测多耗倍数 F = 生产领用当量米 / 报工产出米（>1 表示实际比设计多耗）',
      `校准系数截断区间 [1, ${MAX_FACTOR}]，最少样本 ${MIN_SAMPLES} 笔`,
    ]
    for (const r of actionable.slice(0, 5)) {
      derivation.push(
        `${r.specName}：领用 ${r.inputM.toFixed(0)}m / 产出 ${r.outputM.toFixed(0)}m = 多耗 ${r.observedFactor.toFixed(3)} 倍（${r.sampleSize} 笔样本），建议校准系数 ${r.suggestedFactor.toFixed(3)}`,
      )
    }
    const fallback: AiInsight<CoefficientData> = {
      source: 'rule',
      confidence: actionable.length ? 0.5 : 0.3,
      derivation,
      reasoning: actionable.length
        ? `${actionable[0].specName} 实测多耗 ${(actionable[0].observedFactor * 100 - 100).toFixed(1)}%（高于设计），建议优先复核其断经/落纱与上浆后固系数；确认后可应用校准系数反哺核算。`
        : '暂无样本充分的规格可学习（需同一规格既有领用又有报工、且报工≥3笔）。',
      data,
    }
    if (!this.llm.enabled || actionable.length === 0) return fallback

    const system = `你是纺织厂工艺工程师。只依据给定数据解释各规格实测多耗的原因并给建议，中文作答，输出 JSON：{"reasoning":"归因说明","confidence":0~1}`
    const user = actionable
      .slice(0, 8)
      .map((r) => `- ${r.specName}：领用${r.inputM.toFixed(0)}m/产出${r.outputM.toFixed(0)}m=多耗${((r.observedFactor - 1) * 100).toFixed(1)}%，样本${r.sampleSize}笔`)
      .join('\n')
    const res = await this.llm.chat([
      { role: 'system', content: system },
      { role: 'user', content: user + '\n请解释这些规格多耗的可能原因与改进建议。' },
    ])
    if (!res.ok) return fallback
    try {
      const parsed = JSON.parse(extractJson(res.content)) as { reasoning?: string; confidence?: number }
      return {
        source: 'llm',
        confidence: Math.min(Math.max(Number(parsed.confidence ?? 0.7), 0), 1),
        derivation,
        reasoning: parsed.reasoning ?? fallback.reasoning,
        data,
      }
    } catch (e) {
      this.log.warn(`LLM 系数归因解析失败，回退规则：${e instanceof Error ? e.message : e}`)
      return fallback
    }
  }

  /** 应用校准系数到规格（反哺确定性引擎） */
  async apply(
    tenantId: string,
    companyId: string,
    input: { specId: string; factor: number },
  ): Promise<GreigeSpecEntity> {
    const f = Number(input.factor)
    if (!Number.isFinite(f) || f < 1 || f > MAX_FACTOR) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: `校准系数须在 [1, ${MAX_FACTOR}] 之间` })
    }
    const spec = await this.specRepo.findOne({ where: { id: input.specId, tenantId, companyId } })
    if (!spec) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: '规格不存在' })
    // 取当前报工样本量作为学习依据记录
    const out = await this.batchRepo
      .createQueryBuilder('b')
      .select('COUNT(*)', 'cnt')
      .where('b.company_id = :companyId', { companyId })
      .andWhere('b.spec_id = :specId', { specId: input.specId })
      .andWhere("b.source_type = 'production_in'")
      .getRawOne<{ cnt: string }>()
    spec.learnedLossFactor = String(Math.round(f * 10000) / 10000)
    spec.learnedAt = new Date()
    spec.learnedSampleSize = Number(out?.cnt ?? 0)
    return this.specRepo.save(spec)
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
