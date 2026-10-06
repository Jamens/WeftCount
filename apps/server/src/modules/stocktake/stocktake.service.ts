import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm'
import { DataSource, In, Like, Repository, type EntityManager } from 'typeorm'
import { contextFromSnapshot, convertQuantity, ErrorCode, type SpecCalculationSnapshot } from '@weftcount/shared'
import { StocktakeEntity, type StocktakeStatus } from './entities/stocktake.entity'
import { StocktakeItemEntity } from './entities/stocktake-item.entity'
import { RollEntity } from '../inventory/entities/roll.entity'
import { InventoryBatchEntity } from '../inventory/entities/inventory-batch.entity'
import { InventoryTransactionEntity } from '../inventory/entities/inventory-transaction.entity'
import { WarehouseService } from '../warehouse/warehouse.service'

const NO_PREFIX = 'PD'
/** 差异容差（米）：小于此值视为无差异，不过账 */
const DIFF_EPS = 0.005

function num(n: number, scale: number): string {
  const f = 10 ** scale
  return String(Math.round((n + Number.EPSILON) * f) / f)
}

export interface StocktakeItemView {
  id: string
  batchId: string
  batchNo: string
  /** 件卡（件卡级盘点时有值，批次级为 null） */
  rollId: string | null
  rollNo: string | null
  bookQuantityM: number
  countedQuantityM: number | null
  /** 差异 = 实盘 - 账面（未录实盘为 null） */
  diffQuantityM: number | null
}

@Injectable()
export class StocktakeService {
  constructor(
    @InjectRepository(StocktakeEntity)
    private readonly stocktakes: Repository<StocktakeEntity>,
    @InjectRepository(StocktakeItemEntity)
    private readonly items: Repository<StocktakeItemEntity>,
    @InjectRepository(InventoryBatchEntity)
    private readonly batches: Repository<InventoryBatchEntity>,
    @InjectRepository(InventoryTransactionEntity)
    private readonly txns: Repository<InventoryTransactionEntity>,
    private readonly warehouses: WarehouseService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  private async nextNo(companyId: string): Promise<string> {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const last = await this.stocktakes.findOne({
      where: { companyId, stocktakeNo: Like(`${NO_PREFIX}${date}%`) },
      order: { stocktakeNo: 'DESC' },
    })
    let next = 1
    if (last) {
      const seq = Number(last.stocktakeNo.slice(NO_PREFIX.length + 8))
      if (Number.isFinite(seq)) next = seq + 1
    }
    return `${NO_PREFIX}${date}${String(next).padStart(4, '0')}`
  }

  /**
   * 建单：冻结账面量
   *
   * - `mode:'roll'`（**件卡级**）：把仓内批次的**在库件卡逐匹**快照为明细。
   *   拆匹发货后同批次混着「已发过的匹」与「在库残匹」，只按米数核销无法指认缺哪一匹；
   *   件卡级则能定位到匹。未盘到的件卡=缺失→ 过账时按 remaining_m 写损并置 0。
   * - `mode:'batch'`（默认，批次级）：原有行为，每批次一条明细按米数核销。
   */
  async create(
    ctx: { tenantId: string; companyId: string; userId: string },
    input: { warehouseId: string; stocktakeDate?: string | null; remark?: string | null; mode?: 'batch' | 'roll' | null },
  ): Promise<StocktakeEntity> {
    const warehouse = await this.warehouses.requireActive(ctx.tenantId, ctx.companyId, input.warehouseId)
    const stocktakeNo = await this.nextNo(ctx.companyId)
    const stocktakeDate = input.stocktakeDate ?? new Date().toISOString().slice(0, 10)

    return this.dataSource.transaction(async (manager) => {
      const st = await manager.save(
        manager.create(StocktakeEntity, {
          tenantId: ctx.tenantId,
          companyId: ctx.companyId,
          stocktakeNo,
          warehouseId: warehouse.id,
          stocktakeDate,
          status: 'draft',
          operatorId: ctx.userId,
          remark: input.remark ?? null,
        }),
      )
      // 快照仓内所有有剩余的批次（normal/frozen 均纳入盘点）
      const batches = await manager.find(InventoryBatchEntity, {
        where: { tenantId: ctx.tenantId, companyId: ctx.companyId, warehouseId: warehouse.id },
      })
      const countable = batches.filter((b) => Number(b.remainingQuantity) > 1e-6)
      if (input.mode === 'roll') {
        // 件卡级：逐匹快照「在库」件卡（remaining_m > 0），账面量=该匹剩余米数
        const batchIds = countable.map((b) => b.id)
        const rolls = batchIds.length
          ? await manager.find(RollEntity, { where: { companyId: ctx.companyId, batchId: In(batchIds), status: 'in_stock' } })
          : []
        const items = rolls
          .filter((r) => (r.remainingM == null ? Number(r.meters) : Number(r.remainingM)) > 1e-6)
          .map((r) => {
            const b = countable.find((x) => x.id === r.batchId)!
            const remain = r.remainingM == null ? Number(r.meters) : Number(r.remainingM)
            return manager.create(StocktakeItemEntity, {
              tenantId: ctx.tenantId,
              companyId: ctx.companyId,
              stocktakeId: st.id,
              batchId: b.id,
              batchNo: b.batchNo,
              rollId: r.id,
              rollNo: r.rollNo,
              bookQuantityM: num(remain, 3),
              countedQuantityM: null,
            })
          })
        if (items.length > 0) await manager.save(items)
      } else if (countable.length > 0) {
        await manager.save(
          countable.map((b) =>
            manager.create(StocktakeItemEntity, {
              tenantId: ctx.tenantId,
              companyId: ctx.companyId,
              stocktakeId: st.id,
              batchId: b.id,
              batchNo: b.batchNo,
              rollId: null,
              rollNo: null,
              bookQuantityM: b.remainingQuantity,
              countedQuantityM: null,
            }),
          ),
        )
      }
      return st
    })
  }

  async findAll(tenantId: string, companyId: string, status?: StocktakeStatus): Promise<StocktakeEntity[]> {
    const qb = this.stocktakes
      .createQueryBuilder('s')
      .where('s.tenant_id = :tenantId', { tenantId })
      .andWhere('s.company_id = :companyId', { companyId })
      .orderBy('s.stocktake_no', 'DESC')
    if (status) qb.andWhere('s.status = :status', { status })
    return qb.getMany()
  }

  async findOne(tenantId: string, companyId: string, id: string): Promise<StocktakeEntity> {
    const st = await this.stocktakes.findOne({ where: { id, tenantId, companyId } })
    if (!st) throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: '盘点单不存在' })
    return st
  }

  /** 详情：单 + 明细（含差异），明细带批次当前规格名由前端映射 */
  async getDetail(tenantId: string, companyId: string, id: string) {
    const stocktake = await this.findOne(tenantId, companyId, id)
    const items = await this.items.find({ where: { stocktakeId: id }, order: { batchNo: 'ASC' } })
    const itemViews: StocktakeItemView[] = items.map((it) => {
      const book = Number(it.bookQuantityM)
      const counted = it.countedQuantityM == null ? null : Number(it.countedQuantityM)
      return {
        id: it.id,
        batchId: it.batchId,
        batchNo: it.batchNo,
        rollId: it.rollId,
        rollNo: it.rollNo,
        bookQuantityM: book,
        countedQuantityM: counted,
        diffQuantityM: counted == null ? null : counted - book,
      }
    })
    return { stocktake, items: itemViews }
  }

  private async requireDraft(tenantId: string, companyId: string, id: string): Promise<StocktakeEntity> {
    const st = await this.findOne(tenantId, companyId, id)
    if (st.status !== 'draft') {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: `盘点单当前为「${st.status}」，仅草稿可录入/过账`,
      })
    }
    return st
  }

  /** 批量录入实盘数 */
  async recordCounts(
    tenantId: string,
    companyId: string,
    id: string,
    records: { itemId: string; countedQuantityM: number }[],
  ): Promise<StocktakeItemEntity[]> {
    await this.requireDraft(tenantId, companyId, id)
    const items = await this.items.find({ where: { stocktakeId: id, tenantId, companyId } })
    const byId = new Map(items.map((i) => [i.id, i]))
    const updated: StocktakeItemEntity[] = []
    for (const r of records) {
      const it = byId.get(r.itemId)
      if (!it) continue
      if (r.countedQuantityM < 0) {
        throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: '实盘量不能为负' })
      }
      it.countedQuantityM = num(r.countedQuantityM, 3)
      updated.push(it)
    }
    return this.items.save(updated)
  }

  /**
   * 完成盘点并过账：逐条按差异把批次剩余调平，记 count_gain(盘盈)/count_loss(盘亏) 流水。
   *
   * 差异 = 实盘 - 账面；按批次**自己的规格快照**折重量/面积，保证三视图自洽。
   * 盘亏不会把批次扣成负数（实盘为 0 即扣完并标记 depleted）。全程单事务。
   * 未录实盘数的明细按「账实相符」处理（不调整）。
   */
  async complete(tenantId: string, companyId: string, userId: string, id: string): Promise<StocktakeEntity> {
    const st = await this.requireDraft(tenantId, companyId, id)
    return this.dataSource.transaction(async (manager) => {
      const items = await manager.find(StocktakeItemEntity, { where: { stocktakeId: id, tenantId, companyId } })
      for (const it of items) {
        // 件卡级明细：countedQuantityM 为 null 表示**没盘到这一匹**（缺失），
        // 需按该匹 remaining_m 写损并把件卡归零——这是件卡级的核心价值：
        // 账上能明确指认「缺哪一匹」，而非只记一笔总盘亏。
        if (it.rollId && it.countedQuantityM == null) {
          await this.writeOffRoll(manager, st, it, userId)
          continue
        }
        if (it.countedQuantityM == null) continue
        const book = Number(it.bookQuantityM)
        const counted = Number(it.countedQuantityM)
        const diff = counted - book
        if (Math.abs(diff) < DIFF_EPS) continue // 无差异

        const batch = await manager.findOne(InventoryBatchEntity, { where: { id: it.batchId } })
        if (!batch) continue

        // 件卡级且实盘有差异：按差异调整该匹 remaining_m（盘盈/盘亏都落到匹上）
        if (it.rollId) {
          await this.adjustRollByDiff(manager, st, it, batch, diff, userId)
          continue
        }

        const snap = batch.specSnapshot as SpecCalculationSnapshot
        const c = contextFromSnapshot(snap, Number(batch.widthCm))
        const deltaM = diff // 正=盘盈, 负=盘亏
        const deltaKg = convertQuantity(Math.abs(deltaM), 'm', 'kg', c).value
        const deltaM2 = convertQuantity(Math.abs(deltaM), 'm', 'm2', c).value

        let afterM: number
        if (diff > 0) {
          batch.remainingQuantity = num(Number(batch.remainingQuantity) + deltaM, 3)
          batch.remainingWeightKg = num(Number(batch.remainingWeightKg) + deltaKg, 3)
          batch.remainingAreaM2 = num(Number(batch.remainingAreaM2) + deltaM2, 4)
          afterM = Number(batch.remainingQuantity)
          await manager.save(batch)
          await manager.save(
            manager.create(InventoryTransactionEntity, {
              tenantId, companyId, batchId: batch.id, materialId: batch.materialId, specId: batch.specId,
              direction: 'in', txnType: 'count_gain',
              changeQuantity: num(deltaM, 3), changeWeightKg: num(deltaKg, 3), changeAreaM2: num(deltaM2, 4),
              afterQuantity: num(afterM, 3), afterWeightKg: batch.remainingWeightKg, afterAreaM2: batch.remainingAreaM2,
              unitPrice: null, docId: st.id, operatorId: userId,
              remark: `盘盈 ${num(deltaM, 2)}m（盘点 ${st.stocktakeNo}）`,
            }),
          )
        } else {
          // 盘亏：扣减但不超扣到负
          const loss = Math.min(-diff, Number(batch.remainingQuantity))
          batch.remainingQuantity = num(Number(batch.remainingQuantity) - loss, 3)
          batch.remainingWeightKg = num(Math.max(Number(batch.remainingWeightKg) - deltaKg, 0), 3)
          batch.remainingAreaM2 = num(Math.max(Number(batch.remainingAreaM2) - deltaM2, 0), 4)
          afterM = Number(batch.remainingQuantity)
          if (afterM <= 1e-6) batch.status = 'depleted'
          await manager.save(batch)
          await manager.save(
            manager.create(InventoryTransactionEntity, {
              tenantId, companyId, batchId: batch.id, materialId: batch.materialId, specId: batch.specId,
              direction: 'out', txnType: 'count_loss',
              changeQuantity: num(-loss, 3), changeWeightKg: num(-deltaKg, 3), changeAreaM2: num(-deltaM2, 4),
              afterQuantity: num(afterM, 3), afterWeightKg: batch.remainingWeightKg, afterAreaM2: batch.remainingAreaM2,
              unitPrice: null, docId: st.id, operatorId: userId,
              remark: `盘亏 ${num(loss, 2)}m（盘点 ${st.stocktakeNo}）`,
            }),
          )
        }
      }
      st.status = 'completed'
      return manager.save(st)
    })
  }

  /**
   * 件卡缺失：按该匹 remaining_m 全额写损，件卡 remaining 归零 + 置 consumed
   *
   * 盘亏金额按**该匹剩余米数**折算（不超扣），批次侧同步扣减，保证
   * `Σ roll.remaining_m == batch.remaining_quantity` 不变式不被破坏。
   */
  private async writeOffRoll(
    manager: EntityManager,
    st: StocktakeEntity,
    it: StocktakeItemEntity,
    userId: string,
  ): Promise<void> {
    const roll = await manager.findOne(RollEntity, { where: { id: it.rollId!, companyId: it.companyId } })
    if (!roll) return
    const remain = roll.remainingM == null ? Number(roll.meters) : Number(roll.remainingM)
    if (remain <= 1e-6) return // 已无剩余，无需再写损
    const batch = await manager.findOne(InventoryBatchEntity, { where: { id: it.batchId } })
    if (!batch) return

    const loss = Math.min(remain, Number(batch.remainingQuantity))
    if (loss <= 1e-6) return

    roll.remainingM = num(0, 3)
    roll.remainingKg = num(0, 3)
    roll.status = 'consumed'
    await manager.save(roll)

    await this.postCountLoss(manager, st, batch, it, loss, userId, `件卡 ${roll.rollNo} 缺失`)
  }

  /** 件卡级实盘有差异：把差异落到该匹 remaining_m 上（盘盈也落到匹，保持粒度一致） */
  private async adjustRollByDiff(
    manager: EntityManager,
    st: StocktakeEntity,
    it: StocktakeItemEntity,
    batch: InventoryBatchEntity,
    diff: number,
    userId: string,
  ): Promise<void> {
    const roll = await manager.findOne(RollEntity, { where: { id: it.rollId!, companyId: it.companyId } })
    if (!roll) return
    const book = Number(it.bookQuantityM)
    const counted = Number(it.countedQuantityM)
    const remain = roll.remainingM == null ? Number(roll.meters) : Number(roll.remainingM)
    // 目标剩余 = 该匹账面(建单时) + 实测差异
    const target = Math.max(book + diff, 0)
    const deltaRoll = target - remain
    if (Math.abs(deltaRoll) < 1e-6) return

    const snap = batch.specSnapshot as SpecCalculationSnapshot
    const c = contextFromSnapshot(snap, Number(batch.widthCm))
    const kgDelta = convertQuantity(Math.abs(deltaRoll), 'm', 'kg', c).value
    const m2Delta = convertQuantity(Math.abs(deltaRoll), 'm', 'm2', c).value

    if (deltaRoll > 0) {
      // 盘盈：匹与批次同步增
      roll.remainingM = num(remain + deltaRoll, 3)
      await manager.save(roll)
      await this.postCountLoss(manager, st, batch, it, -deltaRoll, userId, `件卡 ${roll.rollNo} 盘盈`, kgDelta, m2Delta, true)
    } else {
      // 盘亏：匹剩余不得为负；不超扣
      const loss = Math.min(-deltaRoll, remain, Number(batch.remainingQuantity))
      if (loss <= 1e-6) return
      roll.remainingM = num(remain - loss, 3)
      roll.remainingKg = num(Math.max(Number(roll.remainingKg ?? 0) - (roll.remainingKg == null ? 0 : kgDelta), 0), 3)
      if (Number(roll.remainingM) <= 1e-6) {
        roll.remainingM = num(0, 3)
        roll.remainingKg = num(0, 3)
        roll.status = 'consumed'
      }
      await manager.save(roll)
      await this.postCountLoss(manager, st, batch, it, loss, userId, `件卡 ${roll.rollNo} 盘亏`, kgDelta, m2Delta)
    }
  }

  /** 记count_gain/count_loss 流水并同步批次剩余（countLossM>0 为盘亏，<0 为盘盈） */
  private async postCountLoss(
    manager: EntityManager,
    st: StocktakeEntity,
    batch: InventoryBatchEntity,
    it: StocktakeItemEntity,
    countLossM: number,
    userId: string,
    label: string,
    kgOverride?: number,
    m2Override?: number,
    isGain = false,
  ): Promise<void> {
    const snap = batch.specSnapshot as SpecCalculationSnapshot
    const c = contextFromSnapshot(snap, Number(batch.widthCm))
    const abs = Math.abs(countLossM)
    const kg = kgOverride ?? convertQuantity(abs, 'm', 'kg', c).value
    const m2 = m2Override ?? convertQuantity(abs, 'm', 'm2', c).value

    if (isGain) {
      batch.remainingQuantity = num(Number(batch.remainingQuantity) + abs, 3)
      batch.remainingWeightKg = num(Number(batch.remainingWeightKg) + kg, 3)
      batch.remainingAreaM2 = num(Number(batch.remainingAreaM2) + m2, 4)
      await manager.save(batch)
      await manager.save(
        manager.create(InventoryTransactionEntity, {
          tenantId: it.tenantId, companyId: it.companyId, batchId: batch.id, materialId: batch.materialId, specId: batch.specId,
          direction: 'in', txnType: 'count_gain',
          changeQuantity: num(abs, 3), changeWeightKg: num(kg, 3), changeAreaM2: num(m2, 4),
          afterQuantity: num(Number(batch.remainingQuantity), 3), afterWeightKg: batch.remainingWeightKg, afterAreaM2: batch.remainingAreaM2,
          unitPrice: null, docId: st.id, operatorId: userId,
          remark: `${label} ${num(abs, 2)}m（盘点 ${st.stocktakeNo}）`,
        }),
      )
      return
    }

    // 盘亏：批次不扣成负数
    const loss = Math.min(abs, Number(batch.remainingQuantity))
    if (loss <= 1e-6) return
    batch.remainingQuantity = num(Number(batch.remainingQuantity) - loss, 3)
    batch.remainingWeightKg = num(Math.max(Number(batch.remainingWeightKg) - kg, 0), 3)
    batch.remainingAreaM2 = num(Math.max(Number(batch.remainingAreaM2) - m2, 0), 4)
    if (Number(batch.remainingQuantity) <= 1e-6) batch.status = 'depleted'
    await manager.save(batch)
    await manager.save(
      manager.create(InventoryTransactionEntity, {
        tenantId: it.tenantId, companyId: it.companyId, batchId: batch.id, materialId: batch.materialId, specId: batch.specId,
        direction: 'out', txnType: 'count_loss',
        changeQuantity: num(-loss, 3), changeWeightKg: num(-kg, 3), changeAreaM2: num(-m2, 4),
        afterQuantity: num(Number(batch.remainingQuantity), 3), afterWeightKg: batch.remainingWeightKg, afterAreaM2: batch.remainingAreaM2,
        unitPrice: null, docId: st.id, operatorId: userId,
        remark: `${label} ${num(loss, 2)}m（盘点 ${st.stocktakeNo}）`,
      }),
    )
  }

  async cancel(tenantId: string, companyId: string, id: string): Promise<StocktakeEntity> {
    const st = await this.requireDraft(tenantId, companyId, id)
    st.status = 'cancelled'
    return this.stocktakes.save(st)
  }
}
