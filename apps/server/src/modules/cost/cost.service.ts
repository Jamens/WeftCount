import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { computeSpecCost, type SpecCalculationSnapshot } from '@weftcount/shared'
import { MaterialService } from '../material/material.service'
import { MaterialEntity } from '../material/entities/material.entity'
import { InventoryBatchEntity } from '../inventory/entities/inventory-batch.entity'
import { InventoryDocumentEntity } from '../inventory/entities/inventory-document.entity'

/** 纱线单价来源：最新采购入库成本 / 物料参考价 / 无 */
export type YarnPriceSource = 'latest_purchase' | 'standard_price' | 'none'

export interface SpecCostRow {
  specId: string
  specCode: string
  specName: string
  warpMaterialName: string | null
  weftMaterialName: string | null
  warpYarnPrice: number
  weftYarnPrice: number
  warpPriceSource: YarnPriceSource
  weftPriceSource: YarnPriceSource
  warpKgPer100m: number
  weftKgPer100m: number
  overheadPerM: number
  warpCostPerM: number
  weftCostPerM: number
  materialCostPerM: number
  totalCostPerM: number
  totalCostPerKg: number
  totalCostPerM2: number
  salesPricePerM: number | null
  grossProfitPerM: number | null
  grossMarginRate: number | null
}

/**
 * 成本报表
 *
 * 制造成本 = 纱线成本 + 加工费，全部由 shared 的确定性引擎算出（用量来自工艺快照）。
 * 本服务只负责「取价」：经/纬纱单价、售价、加工费。
 *
 * 纱价取法（按优先级）：该物料**最近一次采购入库**的 unitCost → 物料参考价 standardPrice → 0。
 * 售价取该规格**最近一次销售出库**单价，用于算毛利；没有则毛利为 null（不臆造）。
 */
@Injectable()
export class CostService {
  constructor(
    private readonly materials: MaterialService,
    @InjectRepository(MaterialEntity)
    private readonly matRepo: Repository<MaterialEntity>,
    @InjectRepository(InventoryBatchEntity)
    private readonly batchRepo: Repository<InventoryBatchEntity>,
    @InjectRepository(InventoryDocumentEntity)
    private readonly docRepo: Repository<InventoryDocumentEntity>,
  ) {}

  /** 批量取物料最新采购单价（batch 化，避免 N+1） */
  private async latestPurchasePrices(companyId: string, materialIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>()
    if (materialIds.length === 0) return map
    const batches = await this.batchRepo
      .createQueryBuilder('b')
      .where('b.company_id = :companyId', { companyId })
      .andWhere('b.material_id IN (:...ids)', { ids: materialIds })
      .andWhere('b.unit_cost IS NOT NULL')
      .orderBy('b.created_at', 'DESC')
      .getMany()
    // 倒序遍历，同一物料只保留第一条（最新）
    for (const b of batches) {
      if (!map.has(b.materialId)) map.set(b.materialId, Number(b.unitCost))
    }
    return map
  }

  /** 批量取物料参考价 */
  private async standardPrices(companyId: string, materialIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>()
    if (materialIds.length === 0) return map
    const mats = await this.matRepo
      .createQueryBuilder('m')
      .where('m.company_id = :companyId', { companyId })
      .andWhere('m.id IN (:...ids)', { ids: materialIds })
      .getMany()
    for (const m of mats) {
      if (m.standardPrice != null) map.set(m.id, Number(m.standardPrice))
    }
    return map
  }

  /** 批量取规格最近销售出库单价 */
  private async latestSalesPrices(companyId: string, specIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>()
    if (specIds.length === 0) return map
    const docs = await this.docRepo
      .createQueryBuilder('d')
      .where('d.company_id = :companyId', { companyId })
      .andWhere('d.spec_id IN (:...ids)', { ids: specIds })
      .andWhere("d.doc_type = 'sales_outbound'")
      .andWhere('d.unit_price IS NOT NULL')
      .orderBy('d.created_at', 'DESC')
      .getMany()
    for (const d of docs) {
      if (!map.has(d.specId)) map.set(d.specId, Number(d.unitPrice))
    }
    return map
  }

  /** 按规格列出成本构成与毛利 */
  async analysis(tenantId: string, companyId: string): Promise<SpecCostRow[]> {
    const specs = await this.materials.findSpecs(tenantId, companyId)
    if (specs.length === 0) return []

    const yarnIds = [...new Set(specs.flatMap((s) => [s.warpMaterialId, s.weftMaterialId].filter((v): v is string => !!v)))]
    const specIds = specs.map((s) => s.id)
    const [purchaseMap, standardMap, salesMap] = await Promise.all([
      this.latestPurchasePrices(companyId, yarnIds),
      this.standardPrices(companyId, yarnIds),
      this.latestSalesPrices(companyId, specIds),
    ])
    const matName = new Map(yarnIds.map((id) => [id, '']))
    const mats = await this.matRepo
      .createQueryBuilder('m')
      .where('m.company_id = :companyId', { companyId })
      .andWhere('m.id IN (:...ids)', { ids: yarnIds.length ? yarnIds : [''] })
      .getMany()
    for (const m of mats) matName.set(m.id, m.name)

    const pickPrice = (id: string | null): { price: number; source: YarnPriceSource } => {
      if (!id) return { price: 0, source: 'none' }
      const p = purchaseMap.get(id)
      if (p != null) return { price: p, source: 'latest_purchase' }
      const s = standardMap.get(id)
      if (s != null) return { price: s, source: 'standard_price' }
      return { price: 0, source: 'none' }
    }

    return specs.map((s) => {
      const snapshot = this.materials.getSnapshot(s) as SpecCalculationSnapshot
      const warp = pickPrice(s.warpMaterialId)
      const weft = pickPrice(s.weftMaterialId)
      const overhead = Number(s.overheadCostPerMeter ?? 0)
      const cost = computeSpecCost({
        snapshot,
        warpYarnPrice: warp.price,
        weftYarnPrice: weft.price,
        overheadPerMeter: overhead,
        salesPricePerMeter: salesMap.get(s.id) ?? null,
      })
      return {
        specId: s.id,
        specCode: s.code,
        specName: s.name,
        warpMaterialName: s.warpMaterialId ? (matName.get(s.warpMaterialId) ?? null) : null,
        weftMaterialName: s.weftMaterialId ? (matName.get(s.weftMaterialId) ?? null) : null,
        warpYarnPrice: warp.price,
        weftYarnPrice: weft.price,
        warpPriceSource: warp.source,
        weftPriceSource: weft.source,
        warpKgPer100m: snapshot.warpKgPer100m,
        weftKgPer100m: snapshot.weftKgPer100m,
        // cost 里已含 overheadPerM(=overhead) 及其余成本字段，避免重复键
        ...cost,
      }
    })
  }

  /**
   * 单规格成本明细（供智能核价复用）。
   * 与 analysis 同一套确定性算法，只是只算一个规格。
   */
  /**
   * 某规格单位成本（**元/米**，规格级而非匹级）
   *
   * 拆匹发货下的成本口径：本方法产出的是**每米成本**，出库单金额 = 米数 × 单价。
   * 故一匹分多次发货时，每次确认 `本次发货米数 × costPerM`；全部发完累计
   * = `原匹米数 × costPerM` = 整匹成本。**天然按米数分期确认，不重复不遗漏**——
   * 无需为拆匹做任何特殊处理（切勿改成按「匹」一次性确认成本，会导致残匹在库时
   * 成本已全额结转、利润虚高）。
   */
  async specCost(tenantId: string, companyId: string, specId: string): Promise<SpecCostRow | null> {
    const spec = await this.materials.findSpec(tenantId, companyId, specId)
    const yarnIds = [spec.warpMaterialId, spec.weftMaterialId].filter((v): v is string => !!v)
    const [purchaseMap, standardMap, salesMap] = await Promise.all([
      this.latestPurchasePrices(companyId, yarnIds),
      this.standardPrices(companyId, yarnIds),
      this.latestSalesPrices(companyId, [specId]),
    ])
    const matName = new Map<string, string>()
    if (yarnIds.length) {
      const mats = await this.matRepo
        .createQueryBuilder('m')
        .where('m.company_id = :companyId', { companyId })
        .andWhere('m.id IN (:...ids)', { ids: yarnIds })
        .getMany()
      for (const m of mats) matName.set(m.id, m.name)
    }
    const pickPrice = (id: string | null): { price: number; source: YarnPriceSource } => {
      if (!id) return { price: 0, source: 'none' }
      const p = purchaseMap.get(id)
      if (p != null) return { price: p, source: 'latest_purchase' }
      const s = standardMap.get(id)
      if (s != null) return { price: s, source: 'standard_price' }
      return { price: 0, source: 'none' }
    }
    const snapshot = this.materials.getSnapshot(spec) as SpecCalculationSnapshot
    const warp = pickPrice(spec.warpMaterialId)
    const weft = pickPrice(spec.weftMaterialId)
    const cost = computeSpecCost({
      snapshot,
      warpYarnPrice: warp.price,
      weftYarnPrice: weft.price,
      overheadPerMeter: Number(spec.overheadCostPerMeter ?? 0),
      salesPricePerMeter: salesMap.get(spec.id) ?? null,
    })
    return {
      specId: spec.id, specCode: spec.code, specName: spec.name,
      warpMaterialName: spec.warpMaterialId ? (matName.get(spec.warpMaterialId) ?? null) : null,
      weftMaterialName: spec.weftMaterialId ? (matName.get(spec.weftMaterialId) ?? null) : null,
      warpYarnPrice: warp.price, weftYarnPrice: weft.price,
      warpPriceSource: warp.source, weftPriceSource: weft.source,
      warpKgPer100m: snapshot.warpKgPer100m, weftKgPer100m: snapshot.weftKgPer100m,
      ...cost,
    }
  }

  /**
   * 某规格近期成交价带（最近 limit 笔销售出库单价）。
   * 供智能核价参考市场价——没有历史成交就没有价带，不臆造。
   */
  async salesPriceBand(companyId: string, specId: string, limit = 12): Promise<{ min: number; max: number; avg: number; count: number } | null> {
    const docs = await this.docRepo
      .createQueryBuilder('d')
      .select('d.unit_price', 'unitPrice')
      .where('d.company_id = :companyId', { companyId })
      .andWhere('d.spec_id = :specId', { specId })
      .andWhere("d.doc_type = 'sales_outbound'")
      .andWhere('d.unit_price IS NOT NULL')
      .orderBy('d.created_at', 'DESC')
      .limit(limit)
      .getRawMany<{ unitPrice: string }>()
    const prices = docs.map((d) => Number(d.unitPrice)).filter((n) => Number.isFinite(n) && n > 0)
    if (prices.length === 0) return null
    const min = Math.min(...prices)
    const max = Math.max(...prices)
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length
    return { min, max, avg, count: prices.length }
  }
}
