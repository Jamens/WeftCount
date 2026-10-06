import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm'
import { DataSource, EntityManager, In, Like, Repository } from 'typeorm'
import {
  contextFromSnapshot,
  convertQuantity,
  DEFAULT_TOLERANCE_RATE,
  ErrorCode,
  type ContextParams,
  type ConversionError,
  type SpecCalculationSnapshot,
} from '@weftcount/shared'
import { withUniqueNo } from '../../common/util/unique-no'
import { MaterialService } from '../material/material.service'
import { PartnerService } from '../partner/partner.service'
import { OrderService } from '../order/order.service'
import { WarehouseService } from '../warehouse/warehouse.service'
import { InventoryBatchEntity } from './entities/inventory-batch.entity'
import { RollEntity } from './entities/roll.entity'
import { ProductionReportEntity } from '../production/entities/production-report.entity'
import { ProductionOrderEntity } from '../production/entities/production-order.entity'
import { MachineEntity } from '../production/entities/machine.entity'
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
  /** 关联订单 id（采购/销售可挂已确认订单，满额自动完成；领用不传） */
  orderId?: string | null
  /** 履约的订单明细行 id（多明细订单按行算进度；不传则按规格自动归到首个未满行） */
  orderItemId?: string | null
  /** 入库仓库 id（不传则落第一个启用仓） */
  warehouseId?: string | null
  /**
   * 扫码拣货（仅出库）：指定要发货的批次与数量（米）。传了则按这些批次消耗（发什么扫什么），
   * 不传则走 FIFO 自动拣货。生产领用/入库不适用。
   */
  pickedItems?: { batchId: string; quantityM: number }[] | null
  /**
   * 逐匹出库（销售/领用）：扫件卡发货，发什么扫什么。件卡整匹出库，
   * 出库量 = 各件卡米数之和（不依赖 enteredValue）。件卡状态置 sold/consumed。
   */
  pickedRolls?: { rollNo: string }[] | null
  /**
   * 逐匹入库（仅采购入库）：扫件卡逐匹登记，rollNo 公司内唯一防重扫。
   * 传了则按各匹米数校验总量并生成件卡记录（批次米数应 = 各匹之和）。
   */
  rolls?: { rollNo: string; meters: number }[] | null
  remark?: string | null
}

/** FIFO 消耗规划结果 */
interface ConsumptionPlan {
  need: number
  portions: Array<{ batchId: string; take: number; kg: number; m2: number }>
  totalM: number
  totalKg: number
  totalM2: number
  /** 件卡逐匹发货时，待置为已出库的件卡 id */
  rollIds?: string[]
}

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(InventoryBatchEntity)
    private readonly batches: Repository<InventoryBatchEntity>,
    @InjectRepository(RollEntity)
    private readonly rolls: Repository<RollEntity>,
    @InjectRepository(ProductionReportEntity)
    private readonly reports: Repository<ProductionReportEntity>,
    @InjectRepository(ProductionOrderEntity)
    private readonly prodOrders: Repository<ProductionOrderEntity>,
    @InjectRepository(MachineEntity)
    private readonly machines: Repository<MachineEntity>,
    @InjectRepository(InventoryTransactionEntity)
    private readonly txns: Repository<InventoryTransactionEntity>,
    @InjectRepository(InventoryDocumentEntity)
    private readonly docs: Repository<InventoryDocumentEntity>,
    private readonly materials: MaterialService,
    private readonly partners: PartnerService,
    private readonly orders: OrderService,
    private readonly warehouses: WarehouseService,
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

  /**
   * 校验「单据挂订单」：生产领用不挂订单（多传报错）；采购/销售传了就必须是
   * 可履约的已确认订单，且往来单位/物料/规格与订单一致。多明细订单解析本单履约的
   * 明细行（传了 orderItemId 用它、否则按规格自动归到首个未满行）。返回 orderId+orderItemId 供落库。
   */
  private async validateOrderLink(
    ctx: { tenantId: string; companyId: string },
    orderId: string | null | undefined,
    docType: InventoryDocType,
    partnerId: string,
    materialId: string,
    specId: string,
    orderItemId?: string | null,
  ): Promise<{ orderId: string | null; orderItemId: string | null }> {
    if (docType === 'production_issue') {
      if (orderId) {
        throw new BadRequestException({
          code: ErrorCode.VALIDATION_FAILED,
          message: '生产领用为内部转移，不关联订单',
        })
      }
      return { orderId: null, orderItemId: null }
    }
    if (!orderId) return { orderId: null, orderItemId: null }
    const { orderItemId: resolvedItemId } = await this.orders.validateLink(
      ctx.tenantId,
      ctx.companyId,
      orderId,
      docType,
      partnerId,
      materialId,
      specId,
      orderItemId,
    )
    return { orderId, orderItemId: resolvedItemId }
  }

  /** 解析入库仓库：指定则校验可用，否则落第一个启用仓；都没有则 null（未指定仓） */
  private async resolveWarehouse(
    ctx: { tenantId: string; companyId: string },
    warehouseId: string | null | undefined,
  ): Promise<string | null> {
    if (warehouseId) {
      const w = await this.warehouses.requireActive(ctx.tenantId, ctx.companyId, warehouseId)
      return w.id
    }
    const first = await this.warehouses.firstActive(ctx.tenantId, ctx.companyId)
    return first?.id ?? null
  }

  // ---------------------------------------------------------------------------
  // 采购入库（按重量）
  // ---------------------------------------------------------------------------

  /** 采购入库：撞号重试（单号/批号并发碰撞时整体重试，内部每次重取号） */
  async createPurchaseInbound(
    ctx: { tenantId: string; companyId: string; userId: string },
    input: CreateDocInput,
  ): Promise<InventoryDocumentEntity> {
    return withUniqueNo(() => this.doPurchaseInbound(ctx, input))
  }

  private async doPurchaseInbound(
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
    const { orderId, orderItemId } = await this.validateOrderLink(
      ctx, input.orderId, 'purchase_inbound', partner.partnerId as string, input.materialId, input.specId, input.orderItemId,
    )
    const warehouseId = await this.resolveWarehouse(ctx, input.warehouseId)

    const savedDoc = await this.dataSource.transaction(async (manager) => {
      const batch = manager.create(InventoryBatchEntity, {
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        batchNo,
        materialId: input.materialId,
        specId: input.specId,
        warehouseId,
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
        orderId,
        orderItemId,
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

      // 逐匹入库：按各匹米数校验总量并生成件卡记录
      if (input.rolls && input.rolls.length > 0) {
        await this.persistRolls(manager, ctx, input.rolls, savedBatch.id, savedDoc.id, meters, weightKg, '入库总量')
      }

      return savedDoc
    })

    // 事务提交后再回写订单履约进度（挂单才需要；满额订单会自动转已完成）
    if (orderId) {
      await this.orders.recomputeFulfillment(ctx.tenantId, ctx.companyId, orderId)
    }
    return savedDoc
  }

  /**
   * 生产入库：织造产出（报工）自动生成坯布批次。
   *
   * 与采购入库不同：产出按**主单位米**直接进（织机产出就是米），内部转移无往来单位，
   * 不生成三算单据，只落「批次 + 入库流水」。批次 sourceDocId 指向报工记录，
   * 可经 批次→报工→工单 回溯是哪张工单织出来的。
   *
   * 接受外部 EntityManager，由生产模块在**同一事务**内调用，保证「报工 + 入库」原子。
   */
  async createProductionInbound(
    manager: EntityManager,
    ctx: { tenantId: string; companyId: string; userId: string },
    input: { materialId: string; specId: string; quantityM: number; sourceDocId: string; warehouseId?: string | null; remark?: string | null; rolls?: { rollNo: string; meters: number }[] | null },
  ): Promise<InventoryBatchEntity> {
    if (input.quantityM <= 0) {
      throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: '入库产量必须为正' })
    }
    const spec = await this.materials.findSpec(ctx.tenantId, ctx.companyId, input.specId)
    const snapshot = this.materials.getSnapshot(spec)
    const widthCm = Number(spec.finishedWidth)
    const c = this.ctxOf(snapshot, widthCm)

    const meters = input.quantityM
    const weightKg = this.metersToWeight(meters, c)
    const areaM2 = this.metersToArea(meters, c)
    const batchNo = await this.nextBatchNo(ctx.companyId)
    const warehouseId = await this.resolveWarehouse(ctx, input.warehouseId)

    const batch = await manager.save(
      manager.create(InventoryBatchEntity, {
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        batchNo,
        materialId: input.materialId,
        specId: input.specId,
        warehouseId,
        widthCm: num(widthCm, 2),
        specSnapshot: snapshot,
        quantity: num(meters, 3),
        weightKg: num(weightKg, 3),
        areaM2: num(areaM2, 4),
        remainingQuantity: num(meters, 3),
        remainingWeightKg: num(weightKg, 3),
        remainingAreaM2: num(areaM2, 4),
        unitCost: null,
        sourceType: 'production_in',
        sourceDocId: input.sourceDocId,
        status: 'normal',
      }),
    )

    await manager.save(
      manager.create(InventoryTransactionEntity, {
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        batchId: batch.id,
        materialId: input.materialId,
        specId: input.specId,
        direction: 'in',
        txnType: 'production_in',
        changeQuantity: num(meters, 3),
        changeWeightKg: num(weightKg, 3),
        changeAreaM2: num(areaM2, 4),
        afterQuantity: num(meters, 3),
        afterWeightKg: num(weightKg, 3),
        afterAreaM2: num(areaM2, 4),
        unitPrice: null,
        docId: input.sourceDocId,
        operatorId: ctx.userId,
        remark: input.remark ?? null,
      }),
    )

    // 报工按匹：织机产出按件卡登记（每匹一件卡，关联到本次产出批次）
    if (input.rolls && input.rolls.length > 0) {
      await this.persistRolls(manager, ctx, input.rolls, batch.id, input.sourceDocId, meters, weightKg, '报工产量')
    }
    return batch
  }

  /**
   * 逐匹登记件卡（入库/报工共用）——**唯一口径**
   *
   * 校验：
   *  1) 各匹米数之和 ≈ 总量（容差 max(0.5m, 0.1%)）——否则「数了3匹却按100m入账」，
   *     计数与账面脱节，破坏可追溯性。
   *  2) 件卡号非空、单内不重复（防重扫）。
   * 落库：每匹重量按 `批次kg/m × 该匹m` 折算（批次重量本就是各匹加总，自洽）。
   *
   * @param expectedMeters 批次/报工总量(米)；@param label 报错用的口径名(入库总量/报工产量)
   */
  private async persistRolls(
    manager: EntityManager,
    ctx: { tenantId: string; companyId: string; userId: string },
    rolls: { rollNo: string; meters: number }[],
    batchId: string,
    sourceDocId: string,
    expectedMeters: number,
    expectedWeightKg: number,
    label: string,
  ): Promise<void> {
    const rollSum = rolls.reduce((s, r) => s + Number(r.meters || 0), 0)
    if (Math.abs(rollSum - expectedMeters) > Math.max(0.5, expectedMeters * 0.001)) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: `逐匹合计 ${rollSum.toFixed(2)}m 与${label} ${expectedMeters.toFixed(2)}m 不一致，请核对`,
      })
    }
    const seen = new Set<string>()
    const kgPerM = expectedMeters > 0 ? expectedWeightKg / expectedMeters : 0
    const entities = rolls.map((r) => {
      const rollNo = String(r.rollNo).trim()
      if (!rollNo) throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: '件卡号不能为空' })
      if (seen.has(rollNo)) {
        throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: `件卡号 ${rollNo} 重复` })
      }
      seen.add(rollNo)
      const meters = Number(r.meters)
      return manager.create(RollEntity, {
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        batchId,
        rollNo,
        meters: num(meters, 3),
        weightKg: num(kgPerM * meters, 3),
        status: 'in_stock',
        sourceDocId,
      })
    })
    await manager.save(entities)
  }

  /**
   * 仓间调拨：把源批次的一部分数量移动到目标仓。
   *
   * 数量以主单位「米」录入，按源批次自己的规格快照折三视图，保证调拨前后总量守恒。
   * 全部在一个事务内完成：
   *   1) 扣减源批次剩余（扣完则标记 depleted）
   *   2) 在目标仓新建批次（同物料/规格/快照，sourceType=stock_transfer，sourceDocId 指向源批次）
   *   3) 记两条流水：源批次 stock_transfer 出、新批次 stock_transfer 入
   * 净效果：源仓 -q、目标仓 +q，全库总量不变，对账恒等式不受影响。
   */
  /** 仓间调拨：撞号重试（新批次号并发碰撞时整体重试） */
  async transfer(
    ctx: { tenantId: string; companyId: string; userId: string },
    input: { sourceBatchId: string; toWarehouseId: string; quantityM: number; remark?: string | null },
  ): Promise<{ sourceBatch: InventoryBatchEntity; targetBatch: InventoryBatchEntity }> {
    return withUniqueNo(() => this.doTransfer(ctx, input))
  }

  private async doTransfer(
    ctx: { tenantId: string; companyId: string; userId: string },
    input: { sourceBatchId: string; toWarehouseId: string; quantityM: number; remark?: string | null },
  ): Promise<{ sourceBatch: InventoryBatchEntity; targetBatch: InventoryBatchEntity }> {
    const src = await this.batches.findOne({ where: { id: input.sourceBatchId, tenantId: ctx.tenantId, companyId: ctx.companyId } })
    if (!src) throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: '源批次不存在' })
    const target = await this.warehouses.requireActive(ctx.tenantId, ctx.companyId, input.toWarehouseId)
    if (src.warehouseId === target.id) {
      throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: '源批次已在目标仓，无需调拨' })
    }
    const q = input.quantityM
    if (q <= 0) {
      throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: '调拨数量必须大于 0' })
    }
    const remaining = Number(src.remainingQuantity)
    if (q > remaining + 1e-6) {
      throw new BadRequestException({
        code: ErrorCode.INSUFFICIENT_QUANTITY,
        message: `调拨数量 ${num(q, 2)}m 超过批次剩余 ${num(remaining, 2)}m`,
      })
    }

    // 用源批次自己的规格快照折算，保证调拨前后三视图守恒
    const snapshot = src.specSnapshot as SpecCalculationSnapshot
    const c = this.ctxOf(snapshot, Number(src.widthCm))
    const weightKg = this.metersToWeight(q, c)
    const areaM2 = this.metersToArea(q, c)
    const batchNo = await this.nextBatchNo(ctx.companyId)

    return this.dataSource.transaction(async (manager) => {
      // 1) 扣减源批次
      const srcRemainM = remaining - q
      src.remainingQuantity = num(srcRemainM, 3)
      src.remainingWeightKg = num(Number(src.remainingWeightKg) - weightKg, 3)
      src.remainingAreaM2 = num(Number(src.remainingAreaM2) - areaM2, 4)
      if (srcRemainM <= 1e-6) src.status = 'depleted'
      const savedSrc = await manager.save(src)

      // 2) 目标仓新建批次
      const targetBatch = await manager.save(
        manager.create(InventoryBatchEntity, {
          tenantId: ctx.tenantId,
          companyId: ctx.companyId,
          batchNo,
          materialId: src.materialId,
          specId: src.specId,
          warehouseId: target.id,
          widthCm: src.widthCm,
          specSnapshot: src.specSnapshot,
          quantity: num(q, 3),
          weightKg: num(weightKg, 3),
          areaM2: num(areaM2, 4),
          remainingQuantity: num(q, 3),
          remainingWeightKg: num(weightKg, 3),
          remainingAreaM2: num(areaM2, 4),
          unitCost: src.unitCost,
          sourceType: 'stock_transfer',
          sourceDocId: src.id,
          status: 'normal',
        }),
      )

      // 3) 两条流水：源出、新入
      await manager.save(
        manager.create(InventoryTransactionEntity, {
          tenantId: ctx.tenantId,
          companyId: ctx.companyId,
          batchId: savedSrc.id,
          materialId: src.materialId,
          specId: src.specId,
          direction: 'out',
          txnType: 'stock_transfer',
          changeQuantity: num(-q, 3),
          changeWeightKg: num(-weightKg, 3),
          changeAreaM2: num(-areaM2, 4),
          afterQuantity: num(srcRemainM, 3),
          afterWeightKg: src.remainingWeightKg,
          afterAreaM2: src.remainingAreaM2,
          unitPrice: null,
          docId: targetBatch.id,
          operatorId: ctx.userId,
          remark: input.remark ?? `调拨至 ${target.name}`,
        }),
      )
      await manager.save(
        manager.create(InventoryTransactionEntity, {
          tenantId: ctx.tenantId,
          companyId: ctx.companyId,
          batchId: targetBatch.id,
          materialId: src.materialId,
          specId: src.specId,
          direction: 'in',
          txnType: 'stock_transfer',
          changeQuantity: num(q, 3),
          changeWeightKg: num(weightKg, 3),
          changeAreaM2: num(areaM2, 4),
          afterQuantity: num(q, 3),
          afterWeightKg: num(weightKg, 3),
          afterAreaM2: num(areaM2, 4),
          unitPrice: null,
          docId: targetBatch.id,
          operatorId: ctx.userId,
          remark: input.remark ?? `由 ${src.batchNo} 调入`,
        }),
      )
      return { sourceBatch: savedSrc, targetBatch }
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
    // 扫码拣货模式：发什么扫什么，按指定批次消耗，不走 FIFO
    if (input.pickedItems && input.pickedItems.length > 0) {
      return this.planPickedConsumption(manager, ctx, input, snapshot, widthCm)
    }
    // 件卡逐匹发货：扫件卡发整匹
    if (input.pickedRolls && input.pickedRolls.length > 0) {
      return this.planRollConsumption(manager, ctx, input, snapshot, widthCm)
    }
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

  /**
   * 扫码拣货消耗规划：按传入的「批次+数量」逐个校验并消耗（发什么扫什么）。
   *
   * 校验：批次属本公司、状态正常、**规格与单据一致**（防止扫错布种发出去）、剩余足够。
   * 出库量 = 各扫码批次数量之和（不依赖录入的 enteredValue）。
   */
  private async planPickedConsumption(
    manager: EntityManager,
    ctx: { tenantId: string; companyId: string; userId: string },
    input: CreateDocInput,
    snapshot: SpecCalculationSnapshot,
    widthCm: number,
  ): Promise<ConsumptionPlan> {
    const c = this.ctxOf(snapshot, widthCm)
    const portions: ConsumptionPlan['portions'] = []
    let totalM = 0
    let totalKg = 0
    let totalM2 = 0
    for (const pick of input.pickedItems ?? []) {
      const batch = await manager.findOne(InventoryBatchEntity, { where: { id: pick.batchId, companyId: ctx.companyId } })
      if (!batch) throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: '扫码批次不存在' })
      if (batch.status !== 'normal') {
        throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: `批次 ${batch.batchNo} 不可用（已耗尽/冻结）` })
      }
      if (batch.specId !== input.specId) {
        throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: `扫码批次 ${batch.batchNo} 规格与单据规格不一致` })
      }
      const take = pick.quantityM
      if (take <= 0) {
        throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: `批次 ${batch.batchNo} 拣货数量必须大于 0` })
      }
      const rem = Number(batch.remainingQuantity)
      if (take > rem + 1e-6) {
        throw new BadRequestException({
          code: ErrorCode.INSUFFICIENT_QUANTITY,
          message: `批次 ${batch.batchNo} 剩余 ${rem.toFixed(2)}m，拣货 ${take.toFixed(2)}m 超出`,
        })
      }
      const kg = this.metersToWeight(take, c)
      const m2 = this.metersToArea(take, c)
      portions.push({ batchId: batch.id, take, kg, m2 })
      totalM += take
      totalKg += kg
      totalM2 += m2
    }
    if (totalM <= 0) {
      throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: '扫码拣货合计必须大于 0' })
    }
    return { need: totalM, portions, totalM, totalKg, totalM2 }
  }

  /**
   * 件卡逐匹发货规划：按扫到的件卡整匹出库（发什么扫什么）。
   *
   * 校验：件卡存在、属本公司、**状态 in_stock**（防重发）、所属批次规格与单据一致、
   * 批次剩余足够。出库量 = 各件卡米数之和（不依赖 enteredValue）。
   */
  private async planRollConsumption(
    manager: EntityManager,
    ctx: { tenantId: string; companyId: string; userId: string },
    input: CreateDocInput,
    snapshot: SpecCalculationSnapshot,
    widthCm: number,
  ): Promise<ConsumptionPlan> {
    const c = this.ctxOf(snapshot, widthCm)
    const portions: ConsumptionPlan['portions'] = []
    const rollIds: string[] = []
    const seen = new Set<string>()
    let totalM = 0
    let totalKg = 0
    let totalM2 = 0
    for (const pick of input.pickedRolls ?? []) {
      const rollNo = String(pick.rollNo).trim()
      if (!rollNo) throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: '件卡号不能为空' })
      if (seen.has(rollNo)) {
        throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: `件卡 ${rollNo} 重复扫码` })
      }
      seen.add(rollNo)
      const roll = await manager.findOne(RollEntity, { where: { rollNo, companyId: ctx.companyId } })
      if (!roll) throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: `件卡 ${rollNo} 不存在` })
      if (roll.status !== 'in_stock') {
        throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: `件卡 ${rollNo} 不可用（已出库/已耗）` })
      }
      const batch = await manager.findOne(InventoryBatchEntity, { where: { id: roll.batchId } })
      if (!batch) throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: `件卡 ${rollNo} 所属批次不存在` })
      if (batch.specId !== input.specId) {
        throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: `件卡 ${rollNo} 规格与单据规格不一致` })
      }
      const take = Number(roll.meters)
      const rem = Number(batch.remainingQuantity)
      if (take > rem + 1e-6) {
        throw new BadRequestException({
          code: ErrorCode.INSUFFICIENT_QUANTITY,
          message: `件卡 ${rollNo}(${take.toFixed(2)}m) 超出批次 ${batch.batchNo} 剩余 ${rem.toFixed(2)}m`,
        })
      }
      const kg = this.metersToWeight(take, c)
      const m2 = this.metersToArea(take, c)
      portions.push({ batchId: batch.id, take, kg, m2 })
      rollIds.push(roll.id)
      totalM += take
      totalKg += kg
      totalM2 += m2
    }
    if (totalM <= 0) {
      throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: '件卡发货合计必须大于 0' })
    }
    return { need: totalM, portions, totalM, totalKg, totalM2, rollIds }
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
    // 件卡逐匹发货：把扫到的件卡置为已出库（销售=sold，售出；领用=consumed），记录出库单
    if (plan.rollIds && plan.rollIds.length > 0) {
      await manager.update(
        RollEntity,
        { id: In(plan.rollIds) },
        { status: txnType === 'sales_out' ? 'sold' : 'consumed', outboundDocId: docId },
      )
    }
  }

  private async doCreateOutbound(
    ctx: { tenantId: string; companyId: string; userId: string },
    docType: 'production_issue' | 'sales_outbound',
    txnType: 'material_issue' | 'sales_out',
    input: CreateDocInput,
  ): Promise<InventoryDocumentEntity> {
    const spec = await this.materials.findSpec(ctx.tenantId, ctx.companyId, input.specId)
    const snapshot = this.materials.getSnapshot(spec)
    const widthCm = Number(spec.finishedWidth)
    const partner = await this.resolvePartner(ctx, input.partnerId, docType)
    const { orderId, orderItemId } = await this.validateOrderLink(
      ctx, input.orderId, docType, partner.partnerId ?? '', input.materialId, input.specId, input.orderItemId,
    )

    const saved = await this.dataSource.transaction(async (manager) => {
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
        orderId,
        orderItemId,
        operatorId: ctx.userId,
        remark: input.remark ?? null,
      })
      const savedDoc = await manager.save(doc)
      await this.executeConsumption(manager, ctx, savedDoc.id, txnType, input, plan)
      return savedDoc
    })

    if (orderId) {
      await this.orders.recomputeFulfillment(ctx.tenantId, ctx.companyId, orderId)
    }
    return saved
  }

  /** 生产领用（按长度录入） */
  createProductionIssue(
    ctx: { tenantId: string; companyId: string; userId: string },
    input: CreateDocInput,
  ): Promise<InventoryDocumentEntity> {
    return withUniqueNo(() => this.doCreateOutbound(ctx, 'production_issue', 'material_issue', input))
  }

  /** 销售出库（按面积录入） */
  createSalesOutbound(
    ctx: { tenantId: string; companyId: string; userId: string },
    input: CreateDocInput,
  ): Promise<InventoryDocumentEntity> {
    return withUniqueNo(() => this.doCreateOutbound(ctx, 'sales_outbound', 'sales_out', input))
  }

  // ---------------------------------------------------------------------------
  // 查询
  // ---------------------------------------------------------------------------

  /** 列批次的件卡（件卡标签打印用） */
  async listRolls(tenantId: string, companyId: string, filter: { batchId?: string; status?: string }) {
    const qb = this.rolls
      .createQueryBuilder('r')
      .where('r.company_id = :companyId', { companyId })
      .orderBy('r.created_at', 'ASC')
    if (filter.batchId) qb.andWhere('r.batch_id = :batchId', { batchId: filter.batchId })
    if (filter.status) qb.andWhere('r.status = :status', { status: filter.status })
    const rolls = await qb.getMany()
    // 带批次号/规格名，标签直接可用
    const batchIds = [...new Set(rolls.map((r) => r.batchId))]
    const batches = batchIds.length
      ? await this.batches.find({ where: { id: In(batchIds) } })
      : []
    const batchMap = new Map(batches.map((b) => [b.id, b]))
    return Promise.all(
      rolls.map(async (r) => {
        const b = batchMap.get(r.batchId)
        const spec = b ? await this.materials.findSpec(tenantId, companyId, b.specId).catch(() => null) : null
        return {
          id: r.id,
          rollNo: r.rollNo,
          meters: r.meters,
          status: r.status,
          batchId: r.batchId,
          batchNo: b?.batchNo ?? '-',
          specId: b?.specId ?? null,
          specName: spec?.name ?? '-',
          widthCm: b?.widthCm ?? null,
          inboundAt: r.createdAt,
        }
      }),
    )
  }

  /** 件卡轻量查询（扫码发货用）：件卡→米数/规格/批次/状态，不含单据追溯 */
  async lookupRoll(tenantId: string, companyId: string, rollNo: string) {
    const roll = await this.rolls.findOne({ where: { rollNo, companyId } })
    if (!roll) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: `件卡 ${rollNo} 不存在` })
    }
    const batch = await this.batches.findOne({ where: { id: roll.batchId } })
    const spec = batch ? await this.materials.findSpec(tenantId, companyId, batch.specId).catch(() => null) : null
    return {
      rollNo: roll.rollNo,
      meters: roll.meters,
      status: roll.status,
      specId: batch?.specId ?? null,
      specName: spec?.name ?? null,
      materialId: batch?.materialId ?? null,
      batchNo: batch?.batchNo ?? null,
    }
  }

  /**
   * 件卡全链路追溯
   *
   * 一匹布的完整来历与去向：
   *   件卡(rollNo/米数/状态) → 所属批次(规格/克重/幅宽快照) →
   *   入库单(供应商 + 采购订单) → [若已出库] 出库单(客户 + 销售订单)
   * 全部为**已落库的确定性事实**，不含推测。
   */
  async traceRoll(tenantId: string, companyId: string, rollNo: string) {
    const roll = await this.rolls.findOne({ where: { rollNo, companyId } })
    if (!roll) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: `件卡 ${rollNo} 不存在` })
    }
    const batch = await this.batches.findOne({ where: { id: roll.batchId } })
    if (!batch) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: '件卡所属批次不存在' })
    }
    const snap = batch.specSnapshot
    const spec = await this.materials.findSpec(tenantId, companyId, batch.specId).catch(() => null)
    const material = batch.materialId
      ? await this.materials
          .findOne(tenantId, companyId, batch.materialId)
          .catch(() => null)
      : null

    // 来源：分两种——采购件看入库单(供应商+采购订单)；织造件看报工(工单+机台)。
    // 织造批次的 sourceDocId 指向**报工**而非库存单据，需经 report→order 解析织造来源。
    let source: {
      docNo: string
      docType: string
      partnerName: string | null
      orderId: string | null
      date: Date
      machineName?: string
    } | null = null
    if (roll.sourceDocId) {
      const inDoc = await this.docs.findOne({ where: { id: roll.sourceDocId, companyId } })
      if (inDoc) {
        source = { docNo: inDoc.docNo, docType: inDoc.docType, partnerName: inDoc.partnerName, orderId: inDoc.orderId, date: inDoc.createdAt }
      } else {
        // 织造件：sourceDocId = 报工 id
        const report = await this.reports.findOne({ where: { id: roll.sourceDocId } })
        if (report) {
          const order = await this.prodOrders.findOne({ where: { id: report.orderId } })
          let machineName: string | undefined
          if (order?.machineId) {
            const m = await this.machines.findOne({ where: { id: order.machineId } })
            machineName = m?.name
          }
          source = {
            docNo: order?.orderNo ?? '—',
            docType: 'production_report',
            partnerName: null,
            orderId: report.orderId,
            date: report.reportDate ? new Date(report.reportDate) : report.createdAt ?? new Date(),
            machineName,
          }
        }
      }
    }

    // 去向：出库单（客户 + 销售订单）
    const outDoc = roll.outboundDocId
      ? await this.docs.findOne({ where: { id: roll.outboundDocId, companyId } })
      : null

    return {
      roll: {
        id: roll.id,
        rollNo: roll.rollNo,
        meters: roll.meters,
        weightKg: roll.weightKg,
        status: roll.status,
        inboundAt: roll.createdAt,
      },
      spec: {
        specId: batch.specId,
        specName: spec?.name ?? batch.specId,
        finishedWidth: batch.widthCm,
        totalGsm: snap?.totalGsm ?? null,
        totalKgPer100m: snap?.totalKgPer100m ?? null,
      },
      material: material ? { id: material.id, name: material.name, code: material.code } : null,
      batch: { id: batch.id, batchNo: batch.batchNo, remainingM: batch.remainingQuantity },
      source,
      destination: outDoc
        ? {
            docNo: outDoc.docNo,
            docType: outDoc.docType,
            partnerName: outDoc.partnerName,
            orderId: outDoc.orderId,
            date: outDoc.createdAt,
          }
        : null,
    }
  }

  async listBatches(
    tenantId: string,
    companyId: string,
    filter?: { specId?: string; status?: string; warehouseId?: string },
  ): Promise<InventoryBatchEntity[]> {
    const qb = this.batches
      .createQueryBuilder('b')
      .where('b.tenant_id = :tenantId', { tenantId })
      .andWhere('b.company_id = :companyId', { companyId })
    if (filter?.specId) qb.andWhere('b.spec_id = :specId', { specId: filter.specId })
    if (filter?.status) qb.andWhere('b.status = :status', { status: filter.status })
    if (filter?.warehouseId) qb.andWhere('b.warehouse_id = :warehouseId', { warehouseId: filter.warehouseId })
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
      productionInKg: string
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
      productionInKg: string
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

    // 盘点调整：count_gain(盘盈) 计入入库侧，count_loss(盘亏) 计入出库侧。
    // 盘点是「已解释」的差异（做了盘点并已调整批次），不该再被算成 unexplained。
    const adjQb = this.txns
      .createQueryBuilder('t')
      .where('t.tenant_id = :tenantId', { tenantId })
      .andWhere('t.company_id = :companyId', { companyId })
      .andWhere("t.txn_type IN ('count_gain','count_loss')")
    if (filter?.specId) adjQb.andWhere('t.spec_id = :specId', { specId: filter.specId })
    const adjustTxns = await adjQb.getMany()

    // 按规格聚合。入库侧 = 采购入库 + 生产产出 + 盘盈，出库侧 = 生产领用 + 销售出库 + 盘亏，
    // 结存 = 批次剩余。恒等式：
    //   采购入库 + 生产产出 + 盘盈 = 生产领用 + 销售出库 + 盘亏 + 期末结存
    // 每加一类「来源/去向」都要同步进对应侧，否则会被误报「去向不明」。
    const groups = new Map<
      string,
      {
        purchaseKg: number
        productionInKg: number
        countGainKg: number
        productionOutKg: number
        salesOutKg: number
        countLossKg: number
        remainingKg: number
      }
    >()
    const ensure = (specId: string) => {
      let g = groups.get(specId)
      if (!g) {
        g = { purchaseKg: 0, productionInKg: 0, countGainKg: 0, productionOutKg: 0, salesOutKg: 0, countLossKg: 0, remainingKg: 0 }
        groups.set(specId, g)
      }
      return g
    }
    // 盘点调整计入对应侧（按重量）
    for (const t of adjustTxns) {
      const g = ensure(t.specId)
      if (t.txnType === 'count_gain') g.countGainKg += Number(t.changeWeightKg)
      else g.countLossKg += Math.abs(Number(t.changeWeightKg))
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
      const g = ensure(b.specId)
      // 生产产出按原始入库量计（weightKg），不是剩余量
      if (b.sourceType === 'production_in') {
        g.productionInKg += Number(b.weightKg)
      }
      g.remainingKg += Number(b.remainingWeightKg)
    }

    const bySpec: Array<{
      specId: string
      purchaseKg: string
      productionInKg: string
      countGainKg: string
      productionOutKg: string
      salesOutKg: string
      countLossKg: string
      remainingKg: string
      unexplainedKg: string
      unexplainedRate: string
      withinTolerance: boolean
    }> = []

    let tPurchase = 0
    let tProdIn = 0
    let tGain = 0
    let tProd = 0
    let tSales = 0
    let tLoss = 0
    let tRemain = 0
    for (const [specId, g] of groups) {
      const inKg = g.purchaseKg + g.productionInKg + g.countGainKg
      const outKg = g.productionOutKg + g.salesOutKg + g.countLossKg
      const unexplained = inKg - outKg - g.remainingKg
      const rate = inKg > 0 ? Math.abs(unexplained) / inKg : 0
      const within = rate <= toleranceRate
      bySpec.push({
        specId,
        purchaseKg: num(g.purchaseKg, 3),
        productionInKg: num(g.productionInKg, 3),
        countGainKg: num(g.countGainKg, 3),
        productionOutKg: num(g.productionOutKg, 3),
        salesOutKg: num(g.salesOutKg, 3),
        countLossKg: num(g.countLossKg, 3),
        remainingKg: num(g.remainingKg, 3),
        unexplainedKg: num(unexplained, 3),
        unexplainedRate: num(rate, 4),
        withinTolerance: within,
      })
      tPurchase += g.purchaseKg
      tProdIn += g.productionInKg
      tGain += g.countGainKg
      tProd += g.productionOutKg
      tSales += g.salesOutKg
      tLoss += g.countLossKg
      tRemain += g.remainingKg
    }

    const tIn = tPurchase + tProdIn + tGain
    const tOut = tProd + tSales + tLoss
    const tUnexplained = tIn - tOut - tRemain
    const tRate = tIn > 0 ? Math.abs(tUnexplained) / tIn : 0
    const warnings: string[] = []
    if (tRate > toleranceRate) {
      warnings.push(
        `入库合计 ${num(tIn, 2)}kg（采购 ${num(tPurchase, 2)} + 生产产出 ${num(tProdIn, 2)} + 盘盈 ${num(tGain, 2)}），出库合计 ${num(
          tOut,
          2,
        )}kg（领用+销售 ${num(tProd + tSales, 2)} + 盘亏 ${num(tLoss, 2)}），结存 ${num(tRemain, 2)}kg，差异 ${num(
          tUnexplained,
          2,
        )}kg（占比 ${(tRate * 100).toFixed(2)}%），超出容差 ${(toleranceRate * 100).toFixed(0)}%。请核查报废/未记录盘亏，或录入单位、规格版本是否一致。`,
      )
    }

    const ledger = {
      purchaseKg: num(tPurchase, 3),
      productionInKg: num(tProdIn, 3),
      countGainKg: num(tGain, 3),
      productionOutKg: num(tProd, 3),
      salesOutKg: num(tSales, 3),
      countLossKg: num(tLoss, 3),
      remainingKg: num(tRemain, 3),
      unexplainedKg: num(tUnexplained, 3),
      unexplainedRate: num(tRate, 4),
    }
    return { ledger, check: { withinTolerance: tRate <= toleranceRate, warnings }, bySpec }
  }
}
