import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { MaterialService } from '../material/material.service'
import { InventoryBatchEntity } from '../inventory/entities/inventory-batch.entity'
import { MaterialEntity } from '../material/entities/material.entity'
import { LlmClient } from './llm.client'
import type { AiInsight } from './ai.types'

export interface YarnNeed {
  role: 'warp' | 'weft'
  materialId: string | null
  materialName: string
  /** 需求 kg（含实测校准系数，来自工艺快照） */
  needKg: number
  /** 当前库存 kg */
  stockKg: number
  /** 缺口 kg（正=需采购） */
  gapKg: number
  /** 单价 元/kg（无价则 null，不臆造） */
  pricePerKg: number | null
}

export interface PredictionData {
  specId: string
  specName: string
  plannedMeters: number
  warp: YarnNeed
  weft: YarnNeed
  totalNeedKg: number
  totalGapKg: number
  /** 预计采购成本(元)，无价则 null */
  estPurchaseCost: number | null
  /** 工艺快照的经/纬纱单耗 kg/100m（含实测系数） */
  warpKgPer100m: number
  weftKgPer100m: number
}

/**
 * 用料预测
 *
 * 确定性：按规格工艺快照的经/纬纱单耗(含**实测校准系数** learnedLossFactor) × 计划产量
 *   = 需经纱/纬纱 kg；对比当前纱线库存(批次 remainingWeightKg) → 采购缺口 → 采购成本。
 * 大模型：基于「需求/库存/缺口/成本」建议采购量、备料时机、价位提示——只给建议不碰数字。
 */
@Injectable()
export class PredictionService {
  private readonly log = new Logger(PredictionService.name)

  constructor(
    private readonly materials: MaterialService,
    private readonly llm: LlmClient,
    @InjectRepository(InventoryBatchEntity)
    private readonly batchRepo: Repository<InventoryBatchEntity>,
    @InjectRepository(MaterialEntity)
    private readonly matRepo: Repository<MaterialEntity>,
  ) {}

  /** 确定性算料：需求/库存/缺口/成本 */
  async predict(tenantId: string, companyId: string, specId: string, plannedMeters: number): Promise<PredictionData> {
    const spec = await this.materials.findSpec(tenantId, companyId, specId)
    const snap = this.materials.getSnapshot(spec)
    const warpKgPer100m = Number(snap.warpKgPer100m)
    const weftKgPer100m = Number(snap.weftKgPer100m)

    const build = async (role: 'warp' | 'weft', materialId: string | null, kgPer100m: number): Promise<YarnNeed> => {
      const needKg = (kgPer100m / 100) * plannedMeters
      let stockKg = 0
      let pricePerKg: number | null = null
      let materialName = '未指定'
      if (materialId) {
        const mat = await this.matRepo.findOne({ where: { id: materialId, companyId } })
        materialName = mat?.name ?? materialId
        // 库存：该物料所有正常批次的剩余重量
        const batches = await this.batchRepo
          .createQueryBuilder('b')
          .select('SUM(b.remaining_weight_kg)', 'kg')
          .where('b.company_id = :companyId', { companyId })
          .andWhere('b.material_id = :materialId', { materialId })
          .andWhere("b.status = 'normal'")
          .getRawOne<{ kg: string }>()
        stockKg = Number(batches?.kg ?? 0)
        // 单价：优先最新采购入库成本，其次物料参考价
        const lastBatch = await this.batchRepo
          .createQueryBuilder('b')
          .select('b.unit_cost', 'unitCost')
          .where('b.company_id = :companyId', { companyId })
          .andWhere('b.material_id = :materialId', { materialId })
          .andWhere('b.unit_cost IS NOT NULL')
          .orderBy('b.created_at', 'DESC')
          .getRawOne<{ unitCost: string }>()
        if (lastBatch?.unitCost != null) pricePerKg = Number(lastBatch.unitCost)
        else if (mat?.standardPrice != null) pricePerKg = Number(mat.standardPrice)
      }
      const gapKg = Math.max(needKg - stockKg, 0)
      return { role, materialId, materialName, needKg, stockKg, gapKg, pricePerKg }
    }

    const warp = await build('warp', spec.warpMaterialId ?? null, warpKgPer100m)
    const weft = await build('weft', spec.weftMaterialId ?? null, weftKgPer100m)
    const totalNeedKg = warp.needKg + weft.needKg
    const totalGapKg = warp.gapKg + weft.gapKg
    const hasPrice = (warp.pricePerKg != null || weft.pricePerKg != null)
    const estPurchaseCost = hasPrice
      ? (warp.pricePerKg != null ? warp.gapKg * warp.pricePerKg : 0) + (weft.pricePerKg != null ? weft.gapKg * weft.pricePerKg : 0)
      : null

    return {
      specId, specName: spec.name, plannedMeters,
      warp, weft, totalNeedKg, totalGapKg, estPurchaseCost,
      warpKgPer100m, weftKgPer100m,
    }
  }

  /** 用料预测 + AI 采购建议 */
  async advise(tenantId: string, companyId: string, specId: string, plannedMeters: number): Promise<AiInsight<PredictionData>> {
    const data = await this.predict(tenantId, companyId, specId, plannedMeters)
    const derivation = [
      `计划产量 ${plannedMeters} 米（${data.specName}），工艺单耗：经纱 ${data.warpKgPer100m.toFixed(2)} + 纬纱 ${data.weftKgPer100m.toFixed(2)} kg/100m（含实测校准系数）`,
      `需经纱 ${data.warp.needKg.toFixed(1)}kg（库存 ${data.warp.stockKg.toFixed(1)}，缺口 ${data.warp.gapKg.toFixed(1)}）、纬纱 ${data.weft.needKg.toFixed(1)}kg（库存 ${data.weft.stockKg.toFixed(1)}，缺口 ${data.weft.gapKg.toFixed(1)}）`,
      data.estPurchaseCost != null ? `预计采购成本 ${data.estPurchaseCost.toFixed(0)} 元` : '纱线无价格数据，不估算成本',
    ]
    const enough = data.totalGapKg <= 0
    const fallback: AiInsight<PredictionData> = {
      source: 'rule',
      confidence: 0.6,
      derivation,
      reasoning: enough
        ? `现有库存可覆盖该计划产量(总需求 ${data.totalNeedKg.toFixed(0)}kg)，无需紧急采购。`
        : `需补经纱 ${data.warp.gapKg.toFixed(0)}kg、纬纱 ${data.weft.gapKg.toFixed(0)}kg（共 ${data.totalGapKg.toFixed(0)}kg），建议开机前完成备料采购。`,
      data,
    }
    if (!this.llm.enabled) return fallback

    const system = `你是纺织厂物控/采购。只依据给定数据给备料采购建议，中文作答，输出 JSON：{"reasoning":"建议说明","confidence":0~1}`
    const user =
      `织造用料预测（规格：${data.specName}，计划产 ${plannedMeters} 米）：\n` +
      `- 经纱 ${data.warp.materialName}：需 ${data.warp.needKg.toFixed(0)}kg，库存 ${data.warp.stockKg.toFixed(0)}kg，缺口 ${data.warp.gapKg.toFixed(0)}kg${data.warp.pricePerKg != null ? `，单价 ${data.warp.pricePerKg}元/kg` : ''}\n` +
      `- 纬纱 ${data.weft.materialName}：需 ${data.weft.needKg.toFixed(0)}kg，库存 ${data.weft.stockKg.toFixed(0)}kg，缺口 ${data.weft.gapKg.toFixed(0)}kg${data.weft.pricePerKg != null ? `，单价 ${data.weft.pricePerKg}元/kg` : ''}\n` +
      `请给备料采购建议（采购量、时机、价位提示、风险）。`
    const res = await this.llm.chat([
      { role: 'system', content: system },
      { role: 'user', content: user },
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
      this.log.warn(`LLM 用料建议解析失败，回退规则：${e instanceof Error ? e.message : e}`)
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
