import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm'
import { DataSource, EntityManager, Like, Repository } from 'typeorm'
import {
  contextFromSnapshot,
  convertQuantity,
  DEFAULT_TOLERANCE_RATE,
  ErrorCode,
  type ContextParams,
  type ConversionError,
  type SpecCalculationSnapshot,
} from '@weftcount/shared'
import { MaterialService } from '../material/material.service'
import { PartnerService } from '../partner/partner.service'
import { InventoryBatchEntity } from './entities/inventory-batch.entity'
import { InventoryTransactionEntity } from './entities/inventory-transaction.entity'
import { InventoryDocumentEntity, type InventoryDocType } from './entities/inventory-document.entity'

/** 单据号前缀 */
const DOC_PREFIX: Record<InventoryDocType, string> = {
  purchase_inbound: 'RK', // 入库
  production_issue: 'LL', // 领料
  sales_outbound: 'CK', // 出库
}
const BATCH_PREFIX = 'PC' // 批次

/** 列精度的四舍五入工具（decimal 用 string 存，写入前统一规整） */
function num(n: number, scale: number): string {
  const f = 10 ** scale
  return String(Math.round((n + Number.EPSILON) * f) / f)
}

export interface CreateDocInput {
  materialId: string
  specId: string
  /** 录入单位：采购=kg 类、领用=m 类、销售=m2 类 */
  enteredUnit: string
  enteredValue: number
  unitPrice?: number | null
  /** 往来单位 id（采购=供应商，销售=客户，领用不传） */
  partnerId?: string | null
  remark?: string | null
}

/** FIFO 消耗规划结果 */
interface ConsumptionPlan {
  need: number
  portions: Array<{ batchId: string; take: number; kg: number; m2: number }>
  totalM: number
  totalKg: number
  totalM2: number
}

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(InventoryBatchEntity)
    private readonly batches: Repository<InventoryBatchEntity>,
    @InjectRepository(InventoryTransactionEntity)
    private readonly txns: Repository<InventoryTransactionEntity>,
    @InjectRepository(InventoryDocumentEntity)
    private readonly docs: Repository<InventoryDocumentEntity>,
    private readonly materials: MaterialService,
    private readonly partners: PartnerService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  // ---------------------------------------------------------------------------
  // 换算辅助
  // ---------------------------------------------------------------------------

  private ctxOf(snapshot: SpecCalculationSnapshot, widthCm: number): ContextParams {
    return contextFromSnapshot(snapshot, widthCm)
  }

  private toMeters(value: number, unit: string, ctx: ContextParams): number {
    return convertQuantity(value, unit, 'm', ctx).value
  }

  private metersToWeight(meters: number, ctx: ContextParams): number {
    return convertQuantity(meters, 'm', 'kg', ctx).value
  }

  private metersToArea(meters: number, ctx: ContextParams): number {
    return convertQuantity(meters, 'm', 'm2', ctx).value
  }

  private translateConversionError(e: unknown): never {
    if (e instanceof Error && e.name === 'ConversionError') {
      const ce = e as ConversionError
      throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: `换算失败：${ce.message}` })
    }
    throw e
  }

  // ---------------------------------------------------------------------------
  // 单据号 / 批次号
  // ---------------------------------------------------------------------------

  private async nextDocNo(companyId: string, docType: InventoryDocType): Promise<string> {
    const prefix = DOC_PREFIX[docType]
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    // 必须按「前缀 + 日期」过滤，否则会跨类型误判序号（RK 字符串序大于 LL，导致撞号）
    const last = await this.docs.findOne({
      where: { companyId, docNo: Like(`${prefix}${date}%`) },
      order: { docNo: 'DESC' },
    })
    let next = 1
    if (last) {
      const seq = Number(last.docNo.slice(prefix.length + 8))
      if (Number.isFinite(seq)) next = seq + 1
    }
    return `${prefix}${date}${String(next).padStart(4, '0')}`
  }

  private async nextBatchNo(companyId: string): Promise<string> {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const last = await this.batches.findOne({
      where: { companyId, batchNo: Like(`${BATCH_PREFIX}${date}%`) },
      order: { batchNo: 'DESC' },
    })
    let next = 1
    if (last) {
      const seq = Number(last.batchNo.slice(BATCH_PREFIX.length + 8))
      if (Number.isFinite(seq)) next = seq + 1
    }
    return `${BATCH_PREFIX}${date}${String(next).padStart(4, '0')}`
  }

  // ---------------------------------------------------------------------------
  // 往来单位校验
  // ---------------------------------------------------------------------------

  /**
   * 校验并解析往来单位，返回落库用的 id + 名称快照。
   *
   * 规则（按单据类型约束交易对手）：
   *   - purchase_inbound 采购入库 → 必须是供应商（supplier / both）
   *   - sales_outbound  销售出库 → 必须是客户（customer / both）
   *   - production_issue 生产领用 → 内部转移，不适用（强制 null）
   *
   * 采购/销售强制要求选择往来单位：一张没有供应商的入库单无法参与按供应商的
   * 三算对账，是数据质量漏洞。领用则不接受 partnerId（多传直接报错，避免误填）。
   * 名称取快照，防止 partner 改名后历史单据「变脸」。
   */
  private async resolvePartner(
    ctx: { tenantId: string; companyId: string },
    partnerId: string | null | undefined,
    docType: InventoryDocType,
  ): Promise<{ partnerId: string | null; partnerName: string | null }> {
    if (docType === 'production_issue') {
      if (partnerId) {
        throw new BadRequestException({
          code: ErrorCode.VALIDATION_FAILED,
          message: '生产领用为内部转移，不设往来单位',
        })
      }
      return { partnerId: null, partnerName: null }
    }

    if (!partnerId) {
      const who = docType === 'purchase_inbound' ? '供应商' : '客户'
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: `${docType === 'purchase_inbound' ? '采购入库' : '销售出库'}必须选择${who}`,
      })
    }

    // findOne 内部已按 tenantId + companyId 隔离，越权取不到
    const p = await this.partners.findOne(ctx.tenantId, ctx.companyId, partnerId)
    if (p.status !== 'active') {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: `往来单位「${p.name}」已停用，无法开单`,
      })
    }
    const wantSupplier = docType === 'purchase_inbound'
    const ok = wantSupplier
      ? p.type === 'supplier' || p.type === 'both'
      : p.type === 'customer' || p.type === 'both'
    if (!ok) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: wantSupplier
          ? `「${p.name}」不是供应商，不能用于采购入库`
          : `「${p.name}」不是客户，不能用于销售出库`,
      })
    }
    return { partnerId: p.id, partnerName: p.name }
  }

  // ---------------------------------------------------------------------------
  // 采购入库（按重量）
  // ---------------------------------------------------------------------------

  async createPurchaseInbound(
    ctx: { tenantId: string; companyId: string; userId: string },
    input: CreateDocInput,
  ): Promise<InventoryDocumentEntity> {
    const spec = await this.materials.findSpec(ctx.tenantId, ctx.companyId, input.specId)
    const snapshot = this.materials.getSnapshot(spec)
    const widthCm = Number(spec.finishedWidth)
    const c = this.ctxOf(snapshot, widthCm)

    let meters: number
    try {
      meters = this.toMeters(input.enteredValue, input.enteredUnit, c)
    } catch (e) {
      return this.translateConversionError(e)
    }
    if (meters <= 0) {
      throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: '折算后长度必须为正' })
    }

    const weightKg = this.metersToWeight(meters, c)
    const areaM2 = this.metersToArea(meters, c)
    const unitCost = input.unitPrice != null ? input.unitPrice / meters : null
    const docNo = await this.nextDocNo(ctx.companyId, 'purchase_inbound')
    const batchNo = await this.nextBatchNo(ctx.companyId)
    const partner = await this.resolvePartner(ctx, input.partnerId, 'purchase_inbound')

    return this.dataSource.transaction(async (manager) => {
      const batch = manager.create(InventoryBatchEntity, {
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        batchNo,
        materialId: input.materialId,
        specId: input.specId,
        widthCm: num(widthCm, 2),
        specSnapshot: snapshot,
        quantity: num(meters, 3),
        weightKg: num(weightKg, 3),
        areaM2: num(areaM2, 4),
        remainingQuantity: num(meters, 3),
        remainingWeightKg: num(weightKg, 3),
        remainingAreaM2: num(areaM2, 4),
        unitCost: unitCost != null ? num(unitCost, 4) : null,
        sourceType: 'purchase_inbound',
        sourceDocId: 'pending',
        status: 'normal',
      })
      const savedBatch = await manager.save(batch)

      const doc = manager.create(InventoryDocumentEntity, {
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        docNo,
        docType: 'purchase_inbound',
        materialId: input.materialId,
        specId: input.specId,
        widthCm: num(widthCm, 2),
        specSnapshot: snapshot,
        enteredUnit: input.enteredUnit,
        enteredValue: num(input.enteredValue, 4),
        quantityM: num(meters, 3),
        weightKg: num(weightKg, 3),
        areaM2: num(areaM2, 4),
        unitPrice: input.unitPrice != null ? num(input.unitPrice, 4) : null,
        totalAmount: input.unitPrice != null ? num(input.unitPrice * meters, 2) : null,
        partnerId: partner.partnerId,
        partnerName: partner.partnerName,
        operatorId: ctx.userId,
        remark: input.remark ?? null,
      })
      const savedDoc = await manager.save(doc)

      savedBatch.sourceDocId = savedDoc.id
      await manager.save(savedBatch)

      await manager.save(
        manager.create(InventoryTransactionEntity, {
          tenantId: ctx.tenantId,
          companyId: ctx.companyId,
          batchId: savedBatch.id,
          materialId: input.materialId,
          specId: input.specId,
          direction: 'in',
          txnType: 'purchase_in',
          changeQuantity: num(meters, 3),
          changeWeightKg: num(weightKg, 3),
          changeAreaM2: num(areaM2, 4),
          afterQuantity: num(meters, 3),
          afterWeightKg: num(weightKg, 3),
          afterAreaM2: num(areaM2, 4),
          unitPrice: unitCost != null ? num(unitCost, 4) : null,
          docId: savedDoc.id,
          operatorId: ctx.userId,
          remark: input.remark ?? null,
        }),
      )

      return savedDoc
    })
  }

  // ---------------------------------------------------------------------------
  // FIFO 消耗规划 + 出库（生产领用按长度 / 销售出库按面积）
  // ---------------------------------------------------------------------------

  /**
   * 规划先进先出消耗：给定需要消耗的米数，按入库先后拆成若干批次份额。
   * 不落库，仅计算并返回份额；落库由调用方在事务内执行，避免并发错账。
   */
  private async planConsumption(
    manager: EntityManager,
    ctx: { tenantId: string; companyId: string; userId: string },
    input: CreateDocInput,
    snapshot: SpecCalculationSnapshot,
    widthCm: number,
  ): Promise<ConsumptionPlan> {
    const c = this.ctxOf(snapshot, widthCm)
    let need: number
    try {
      need = this.toMeters(input.enteredValue, input.enteredUnit, c)
    } catch (e) {
      return this.translateConversionError(e)
    }
    if (need <= 0) {
      throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: '折算后长度必须为正' })
    }

    const available = await manager.find(InventoryBatchEntity, {
      where: { companyId: ctx.companyId, specId: input.specId, status: 'normal' },
      order: { inboundAt: 'ASC', createdAt: 'ASC' },
    })
    const totalAvail = available.reduce((s, b) => s + Number(b.remainingQuantity), 0)
    if (totalAvail < need - 1e-6) {
      throw new BadRequestException({
        code: ErrorCode.STOCK_NOT_ENOUGH,
        message: `库存不足：需 ${need.toFixed(2)} 米，可用 ${totalAvail.toFixed(2)} 米`,
      })
    }

    const portions: ConsumptionPlan['portions'] = []
    let remainingNeed = need
    let totalM = 0
    let totalKg = 0
    let totalM2 = 0
    for (const batch of available) {
      if (remainingNeed <= 1e-9) break
      const rem = Number(batch.remainingQuantity)
      if (rem <= 1e-9) continue
      const take = Math.min(rem, remainingNeed)
      const kg = this.metersToWeight(take, c)
      const m2 = this.metersToArea(take, c)
      portions.push({ batchId: batch.id, take, kg, m2 })
      totalM += take
      totalKg += kg
      totalM2 += m2
      remainingNeed -= take
    }
    return { need, portions, totalM, totalKg, totalM2 }
  }

  private async executeConsumption(
    manager: EntityManager,
    ctx: { tenantId: string; companyId: string; userId: string },
    docId: string,
    txnType: 'material_issue' | 'sales_out',
    input: CreateDocInput,
    plan: ConsumptionPlan,
  ): Promise<void> {
    for (const p of plan.portions) {
      const batch = await manager.findOne(InventoryBatchEntity, { where: { id: p.batchId } })
      if (!batch) continue
      const newRem = Number(batch.remainingQuantity) - p.take
      batch.remainingQuantity = num(newRem, 3)
      batch.remainingWeightKg = num(this.metersToWeight(newRem, this.ctxOf(batch.specSnapshot, Number(batch.widthCm))), 3)
      batch.remainingAreaM2 = num(this.metersToArea(newRem, this.ctxOf(batch.specSnapshot, Number(batch.widthCm))), 4)
      batch.status = newRem <= 1e-9 ? 'depleted' : 'normal'
      await manager.save(batch)

      await manager.save(
        manager.create(InventoryTransactionEntity, {
          tenantId: ctx.tenantId,
          companyId: ctx.companyId,
          batchId: batch.id,
          materialId: input.materialId,
          specId: input.specId,
          direction: 'out',
          txnType,
          changeQuantity: num(-p.take, 3),
          changeWeightKg: num(-p.kg, 3),
          changeAreaM2: num(-p.m2, 4),
          afterQuantity: num(newRem, 3),
          afterWeightKg: batch.remainingWeightKg,
          afterAreaM2: batch.remainingAreaM2,
          unitPrice: input.unitPrice != null ? num(input.unitPrice, 4) : null,
          docId,
          operatorId: ctx.userId,
          remark: input.remark ?? null,
        }),
      )
    }
  }

  private async createOutbound(
    ctx: { tenantId: string; companyId: string; userId: string },
    docType: 'production_issue' | 'sales_outbound',
    txnType: 'material_issue' | 'sales_out',
    input: CreateDocInput,
  ): Promise<InventoryDocumentEntity> {
    const spec = await this.materials.findSpec(ctx.tenantId, ctx.companyId, input.specId)
    const snapshot = this.materials.getSnapshot(spec)
    const widthCm = Number(spec.finishedWidth)
    const partner = await this.resolvePartner(ctx, input.partnerId, docType)

    return this.dataSource.transaction(async (manager) => {
      const plan = await this.planConsumption(manager, ctx, input, snapshot, widthCm)
      const docNo = await this.nextDocNo(ctx.companyId, docType)
      const doc = manager.create(InventoryDocumentEntity, {
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        docNo,
        docType,
        materialId: input.materialId,
        specId: input.specId,
        widthCm: num(widthCm, 2),
        specSnapshot: snapshot,
        enteredUnit: input.enteredUnit,
        enteredValue: num(input.enteredValue, 4),
        quantityM: num(plan.totalM, 3),
        weightKg: num(plan.totalKg, 3),
        areaM2: num(plan.totalM2, 4),
        unitPrice: input.unitPrice != null ? num(input.unitPrice, 4) : null,
        totalAmount: input.unitPrice != null ? num(input.unitPrice * plan.totalM, 2) : null,
        partnerId: partner.partnerId,
        partnerName: partner.partnerName,
        operatorId: ctx.userId,
        remark: input.remark ?? null,
      })
      const saved = await manager.save(doc)
      await this.executeConsumption(manager, ctx, saved.id, txnType, input, plan)
      return saved
    })
  }

  /** 生产领用（按长度录入） */
  createProductionIssue(
    ctx: { tenantId: string; companyId: string; userId: string },
    input: CreateDocInput,
  ): Promise<InventoryDocumentEntity> {
    return this.createOutbound(ctx, 'production_issue', 'material_issue', input)
  }

  /** 销售出库（按面积录入） */
  createSalesOutbound(
    ctx: { tenantId: string; companyId: string; userId: string },
    input: CreateDocInput,
  ): Promise<InventoryDocumentEntity> {
    return this.createOutbound(ctx, 'sales_outbound', 'sales_out', input)
  }

  // ---------------------------------------------------------------------------
  // 查询
  // ---------------------------------------------------------------------------

  async listBatches(
    tenantId: string,
    companyId: string,
    filter?: { specId?: string; status?: string },
  ): Promise<InventoryBatchEntity[]> {
    const qb = this.batches
      .createQueryBuilder('b')
      .where('b.tenant_id = :tenantId', { tenantId })
      .andWhere('b.company_id = :companyId', { companyId })
    if (filter?.specId) qb.andWhere('b.spec_id = :specId', { specId: filter.specId })
    if (filter?.status) qb.andWhere('b.status = :status', { status: filter.status })
    return qb.orderBy('b.inbound_at', 'DESC').getMany()
  }

  async listDocuments(
    tenantId: string,
    companyId: string,
    filter?: { docType?: InventoryDocType; specId?: string },
  ): Promise<InventoryDocumentEntity[]> {
    const qb = this.docs
      .createQueryBuilder('d')
      .where('d.tenant_id = :tenantId', { tenantId })
      .andWhere('d.company_id = :companyId', { companyId })
    if (filter?.docType) qb.andWhere('d.doc_type = :docType', { docType: filter.docType })
    if (filter?.specId) qb.andWhere('d.spec_id = :specId', { specId: filter.specId })
    return qb.orderBy('d.created_at', 'DESC').getMany()
  }

  async listTransactions(
    tenantId: string,
    companyId: string,
    filter?: { batchId?: string; docId?: string },
  ): Promise<InventoryTransactionEntity[]> {
    const qb = this.txns
      .createQueryBuilder('t')
      .where('t.tenant_id = :tenantId', { tenantId })
      .andWhere('t.company_id = :companyId', { companyId })
    if (filter?.batchId) qb.andWhere('t.batch_id = :batchId', { batchId: filter.batchId })
    if (filter?.docId) qb.andWhere('t.doc_id = :docId', { docId: filter.docId })
    return qb.orderBy('t.created_at', 'ASC').getMany()
  }

  // ---------------------------------------------------------------------------
  // 三算对账
  // ---------------------------------------------------------------------------

  /**
   * 一件事三算对账（闭环恒等式）
   *
   * 同一批布的三种记账口径——采购按重量、生产按长度、销售按面积——
   * 在物理上指向同一重量。对账的恒等式：
   *
   *   采购入库重量 = 生产领用折算重量 + 销售出库折算重量 + 期末结存重量
   *
   * 三者折算到重量后若对不上，差值就是「说不清的去向」：
   * 报废 / 盘亏 / 录入单位错 / 规格版本漂移（绕过快照强行改克重）。
   * 这正是三算要替老板暴露的隐形损耗。
   *
   * 折算一律用「每张单据自己的规格快照」，不同规格/版本各自精确，
   * 不会因混用克重而失真。
   */
  async reconcile(
    tenantId: string,
    companyId: string,
    filter?: { specId?: string; toleranceRate?: number },
  ): Promise<{
    ledger: {
      purchaseKg: string
      productionOutKg: string
      salesOutKg: string
      remainingKg: string
      unexplainedKg: string
      unexplainedRate: string
    }
    check: { withinTolerance: boolean; warnings: string[] }
    bySpec: Array<{
      specId: string
      purchaseKg: string
      productionOutKg: string
      salesOutKg: string
      remainingKg: string
      unexplainedKg: string
      unexplainedRate: string
      withinTolerance: boolean
    }>
  }> {
    const toleranceRate = filter?.toleranceRate ?? DEFAULT_TOLERANCE_RATE

    const docQb = this.docs
      .createQueryBuilder('d')
      .where('d.tenant_id = :tenantId', { tenantId })
      .andWhere('d.company_id = :companyId', { companyId })
    if (filter?.specId) docQb.andWhere('d.spec_id = :specId', { specId: filter.specId })
    const docs = await docQb.getMany()

    const batchQb = this.batches
      .createQueryBuilder('b')
      .where('b.tenant_id = :tenantId', { tenantId })
      .andWhere('b.company_id = :companyId', { companyId })
    if (filter?.specId) batchQb.andWhere('b.spec_id = :specId', { specId: filter.specId })
    const batches = await batchQb.getMany()

    // 按规格聚合
    const groups = new Map<
      string,
      { purchaseKg: number; productionOutKg: number; salesOutKg: number; remainingKg: number }
    >()
    const ensure = (specId: string) => {
      let g = groups.get(specId)
      if (!g) {
        g = { purchaseKg: 0, productionOutKg: 0, salesOutKg: 0, remainingKg: 0 }
        groups.set(specId, g)
      }
      return g
    }

    for (const d of docs) {
      const snap = d.specSnapshot
      const g = ensure(d.specId)
      if (d.docType === 'purchase_inbound') {
        g.purchaseKg += Number(d.weightKg)
      } else if (d.docType === 'production_issue') {
        // 长度 → 重量：用该单据自己的 kgPerMeter
        g.productionOutKg += Number(d.quantityM) * (snap.kgPerMeter ?? 0)
      } else if (d.docType === 'sales_outbound') {
        // 面积 → 重量：用该单据自己的 kgPerM2
        g.salesOutKg += Number(d.areaM2) * (snap.kgPerM2 ?? 0)
      }
    }
    for (const b of batches) {
      ensure(b.specId).remainingKg += Number(b.remainingWeightKg)
    }

    const bySpec: Array<{
      specId: string
      purchaseKg: string
      productionOutKg: string
      salesOutKg: string
      remainingKg: string
      unexplainedKg: string
      unexplainedRate: string
      withinTolerance: boolean
    }> = []

    let tPurchase = 0
    let tProd = 0
    let tSales = 0
    let tRemain = 0
    for (const [specId, g] of groups) {
      const unexplained = g.purchaseKg - g.productionOutKg - g.salesOutKg - g.remainingKg
      const rate = g.purchaseKg > 0 ? Math.abs(unexplained) / g.purchaseKg : 0
      const within = rate <= toleranceRate
      bySpec.push({
        specId,
        purchaseKg: num(g.purchaseKg, 3),
        productionOutKg: num(g.productionOutKg, 3),
        salesOutKg: num(g.salesOutKg, 3),
        remainingKg: num(g.remainingKg, 3),
        unexplainedKg: num(unexplained, 3),
        unexplainedRate: num(rate, 4),
        withinTolerance: within,
      })
      tPurchase += g.purchaseKg
      tProd += g.productionOutKg
      tSales += g.salesOutKg
      tRemain += g.remainingKg
    }

    const tUnexplained = tPurchase - tProd - tSales - tRemain
    const tRate = tPurchase > 0 ? Math.abs(tUnexplained) / tPurchase : 0
    const warnings: string[] = []
    if (tRate > toleranceRate) {
      warnings.push(
        `采购 ${num(tPurchase, 2)}kg，生产+销售折算 ${num(tProd + tSales, 2)}kg，结存 ${num(
          tRemain,
          2,
        )}kg，差异 ${num(tUnexplained, 2)}kg（占比 ${(tRate * 100).toFixed(
          2,
        )}%），超出容差 ${(toleranceRate * 100).toFixed(0)}%。请核查报废/盘亏单据，或录入单位、规格版本是否一致。`,
      )
    }

    const ledger = {
      purchaseKg: num(tPurchase, 3),
      productionOutKg: num(tProd, 3),
      salesOutKg: num(tSales, 3),
      remainingKg: num(tRemain, 3),
      unexplainedKg: num(tUnexplained, 3),
      unexplainedRate: num(tRate, 4),
    }
    return { ledger, check: { withinTolerance: tRate <= toleranceRate, warnings }, bySpec }
  }
}
