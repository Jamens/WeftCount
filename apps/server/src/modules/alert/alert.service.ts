import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, IsNull, Not, Repository } from 'typeorm'
import dayjs from 'dayjs'
import { ErrorCode } from '@weftcount/shared'
import {
  computeReorderSuggestion,
  DEFAULT_LEAD_TIME_DAYS,
  DEFAULT_USAGE_WINDOW_DAYS,
} from '@weftcount/shared'
import { AlertEntity, type AlertSeverity, type AlertType } from './entities/alert.entity'
import { MaterialEntity } from '../material/entities/material.entity'
import { ProductionOrderEntity } from '../production/entities/production-order.entity'
import { InventoryBatchEntity } from '../inventory/entities/inventory-batch.entity'
import { InventoryTransactionEntity } from '../inventory/entities/inventory-transaction.entity'
import { TradeOrderEntity } from '../order/entities/trade-order.entity'
import { CompanyEntity } from '../tenant/entities/company.entity'

/** 呆滞批次阈值：入库超此天数且仍有剩余未动 */
const STALE_DAYS = 60
/** 低库存判定：库存 < 安全库存（仅对设了安全库存的物料生效） */
const LOW_STOCK_RATIO = 1
/** 确认后的静默天数：期内同一问题不再重复报，避免「点了确认像没反应」 */
/** 确认后静默天数的缺省值（公司可在预警中心改） */
const DEFAULT_ACK_SILENCE_DAYS = 7

/** 数量展示统一 1 位小数 */
function fmtQty(v: number): string {
  return (Math.round(v * 10) / 10).toFixed(1)
}

export interface AlertScanResult {
  created: number
  /** 扫描时的统计，便于前端展示「扫出了什么」 */
  stats: { orderOverdue: number; lowStock: number; staleBatch: number }
}

/**
 * 预警中心（确定性规则引擎）
 *
 * 扫描三类问题，全部由数据库事实推导，不涉及 AI：
 *   1. 交期逾期：生产工单 dueDate 已过但未完成/未取消
 *   2. 库存低位：物料当前库存(主单位) < 安全库存 × LOW_STOCK_RATIO
 *   3. 呆滞批次：批次入库超 STALE_DAYS 天且仍有剩余
 * 按 (类型, 关联对象, 未确认) 去重：同一问题确认后才会在下次扫描重新报。
 */
@Injectable()
export class AlertService {
  private readonly log = new Logger(AlertService.name)

  constructor(
    @InjectRepository(AlertEntity)
    private readonly alerts: Repository<AlertEntity>,
    @InjectRepository(MaterialEntity)
    private readonly materials: Repository<MaterialEntity>,
    @InjectRepository(ProductionOrderEntity)
    private readonly prodOrders: Repository<ProductionOrderEntity>,
    @InjectRepository(InventoryBatchEntity)
    private readonly batches: Repository<InventoryBatchEntity>,
    @InjectRepository(InventoryTransactionEntity)
    private readonly txns: Repository<InventoryTransactionEntity>,
    /** 只读汇总用：判断「是否已由预警生成采购单」，不注入 OrderService（避免模块循环） */
    @InjectRepository(TradeOrderEntity)
    private readonly orders: Repository<TradeOrderEntity>,
    @InjectRepository(CompanyEntity)
    private readonly companies: Repository<CompanyEntity>,
  ) {}

  /** 读取该公司的预警确认静默天数（缺省 7；0=不静默） */
  private async ackSilenceDays(companyId: string): Promise<number> {
    const c = await this.companies.findOne({ where: { id: companyId } })
    const n = Number(c?.alertAckSilenceDays ?? DEFAULT_ACK_SILENCE_DAYS)
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_ACK_SILENCE_DAYS
  }

  /** 当前公司的预警设置（供界面展示/修改） */
  async getSettings(companyId: string) {
    return { ackSilenceDays: await this.ackSilenceDays(companyId) }
  }

  /** 修改当前公司的预警设置 */
  async updateSettings(companyId: string, ackSilenceDays: number) {
    const c = await this.companies.findOne({ where: { id: companyId } })
    if (!c) throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: '公司不存在' })
    c.alertAckSilenceDays = Math.max(0, Math.floor(Number(ackSilenceDays) || 0))
    await this.companies.save(c)
    return { ackSilenceDays: c.alertAckSilenceDays }
  }

  async list(companyId: string, onlyOpen = true): Promise<AlertEntity[]> {
    return this.alerts.find({
      where: onlyOpen ? { companyId, acknowledged: false } : { companyId },
      order: { createdAt: 'DESC' },
      take: 200,
    })
  }

  async openCount(companyId: string): Promise<number> {
    return this.alerts.count({ where: { companyId, acknowledged: false } })
  }

  async acknowledge(companyId: string, id: string, userId: string): Promise<AlertEntity | null> {
    const a = await this.alerts.findOne({ where: { id, companyId } })
    if (!a) return null
    a.acknowledged = true
    a.acknowledgedBy = userId
    a.acknowledgedAt = new Date()
    return this.alerts.save(a)
  }

  /**
   * 物料在观察窗口内的**出库总量**（主单位）
   *
   * 数据来源：出库流水（sales_out 销售出库 + material_issue 生产领用）的 change_quantity
   * 绝对值之和——这才是真实消耗。不用常数、不用拍脑袋。
   * 注意只统计 `after` 之后仍有效的批次不限——流水是既成事实，即使批次已耗尽也计。
   */
  private async consumedInWindow(companyId: string, materialId: string, days: number): Promise<number> {
    const since = new Date(Date.now() - days * 86400000)
    const row = await this.txns
      .createQueryBuilder('t')
      .select('COALESCE(SUM(ABS(t.change_quantity)), 0)', 'qty')
      .where('t.company_id = :companyId', { companyId })
      .andWhere('t.material_id = :materialId', { materialId })
      .andWhere("t.direction = 'out'")
      .andWhere("t.txn_type IN ('sales_out','material_issue')")
      .andWhere('t.created_at >= :since', { since })
      .getRawOne<{ qty: string }>()
    return Number(row?.qty ?? 0)
  }

  /** 扫描并生成预警（去重三条规则见下方 toCreate 处注释） */
  async scan(tenantId: string, companyId: string): Promise<AlertScanResult> {
    const candidates: {
      type: AlertType
      severity: AlertSeverity
      title: string
      message: string
      refType: string
      refId: string
      /** 结构化附加数据（低库存预警带补货建议） */
      data?: Record<string, string> | null
    }[] = []

    // 1) 交期逾期生产工单
    const today = dayjs().startOf('day')
    const overdue = await this.prodOrders
      .createQueryBuilder('o')
      .where('o.company_id = :companyId', { companyId })
      .andWhere('o.due_date IS NOT NULL')
      .andWhere('o.due_date < :today', { today: today.format('YYYY-MM-DD') })
      .andWhere("o.status NOT IN ('completed','cancelled')")
      .getMany()
    for (const o of overdue) {
      const days = Math.abs(today.diff(dayjs(o.dueDate!), 'day'))
      candidates.push({
        type: 'order_overdue',
        severity: days > 7 ? 'critical' : 'warning',
        title: `工单逾期 ${o.orderNo}`,
        message: `计划 ${Number(o.plannedQuantityM)}m，已产 ${Number(o.producedQuantityM)}m，交期已过 ${days} 天未完成`,
        refType: 'production_order',
        refId: o.id,
      })
    }

    // 2) 库存低于安全库存
    const matsWithSafety = await this.materials.find({ where: { companyId, status: 'active' } })
    for (const m of matsWithSafety) {
      if (m.safetyStock == null) continue
      const safety = Number(m.safetyStock)
      if (!Number.isFinite(safety) || safety <= 0) continue
      const stock = await this.batches
        .createQueryBuilder('b')
        .select('COALESCE(SUM(b.remaining_quantity), 0)', 'qty')
        .where('b.company_id = :companyId', { companyId })
        .andWhere('b.material_id = :materialId', { materialId: m.id })
        .andWhere("b.status = 'normal'")
        .getRawOne<{ qty: string }>()
      const have = Number(stock?.qty ?? 0)
      // **补货建议**：日均用量取自真实出库流水，不拍脑袋。
      // 只看安全库存只能报「低了」，采购员真正要的是「补多少、什么时候补」。
      const consumed = await this.consumedInWindow(companyId, m.id, DEFAULT_USAGE_WINDOW_DAYS)
      const suggestion = computeReorderSuggestion({
        currentStock: have,
        safetyStock: safety,
        consumedQty: consumed,
        windowDays: DEFAULT_USAGE_WINDOW_DAYS,
        leadTimeDays: m.leadTimeDays == null ? DEFAULT_LEAD_TIME_DAYS : Number(m.leadTimeDays),
        orderCycleDays: m.leadTimeDays == null ? DEFAULT_LEAD_TIME_DAYS : Number(m.leadTimeDays),
      })
      // 触发条件用**补货点**（含提前期消耗）而非仅安全库存——
      // 采购在途/提前期内的缺口同样要提前发现，等跌到安全库存已经晚了。
      if (suggestion.shouldReorder || have < safety * LOW_STOCK_RATIO) {
        candidates.push({
          type: 'low_stock',
          severity: have <= 0 ? 'critical' : 'warning',
          title: suggestion.shouldReorder ? `建议补货 ${m.name}` : `库存低位 ${m.name}`,
          message: suggestion.shouldReorder
            ? `建议补 ${fmtQty(suggestion.suggestQty)} ${m.primaryUnit}｜当前 ${fmtQty(have)}，` +
              `补货点 ${fmtQty(suggestion.reorderPoint)}（覆盖 ${suggestion.coverDays} 天用量）｜${suggestion.basis}`
            : `当前 ${fmtQty(have)} ${m.primaryUnit}，安全库存 ${safety} ${m.primaryUnit}，缺口 ${fmtQty(Math.max(0, safety - have))}`,
          refType: 'material',
          refId: m.id,
          // 附带结构化建议，便于前端单独展示与后续接采购单
          data: {
            suggestQty: String(suggestion.suggestQty),
            reorderPoint: String(suggestion.reorderPoint),
            dailyUsage: String(suggestion.dailyUsage),
            coverDays: String(suggestion.coverDays),
            currentStock: String(have),
            safetyStock: String(safety),
            unit: m.primaryUnit,
            basis: suggestion.basis,
          },
        })
      }
    }

    // 3) 呆滞批次（入库超 STALE_DAYS 天且仍有剩余）
    const staleBefore = today.subtract(STALE_DAYS, 'day').format('YYYY-MM-DD')
    const stale = await this.batches
      .createQueryBuilder('b')
      .where('b.company_id = :companyId', { companyId })
      .andWhere("b.status = 'normal'")
      .andWhere('b.remaining_quantity > 0')
      .andWhere('b.inbound_at < :staleBefore', { staleBefore })
      .getMany()
    for (const b of stale) {
      const days = today.diff(dayjs(b.inboundAt), 'day')
      candidates.push({
        type: 'stale_batch',
        severity: 'info',
        title: `呆滞批次 ${b.batchNo}`,
        message: `入库 ${days} 天仍有 ${Number(b.remainingQuantity).toFixed(0)}m 未动，建议调拨或促销`,
        refType: 'batch',
        refId: b.id,
      })
    }

    /**
     * 去重：同一(type, 对象)不重复报
     *
     * 三条规则（缺一条就会让「确认」显得没生效）：
     * 1. 已有**未确认**的同类同对象预警 → 跳过（原本就有，等处理）
     * 2. 最近**确认过**且在静默期内 → 跳过。用户点「确认」是表示「我知道了/在处理」，
     *    若条件没变就立刻再报一条，等于让确认按钮失效、用户被同一件事反复打扰。
     * 3. 已由该对象的预警**生成过采购单**且订单未取消 → 跳过（问题已在处理中）。
     *    库存确实还低是事实，但重复提醒无意义——采购单已经在了。
     */
    const existing = await this.alerts.find({ where: { companyId, acknowledged: false } })
    const seen = new Set(existing.map((a) => `${a.type}:${a.refId}`))

    // 静默期内的已确认预警（静默天数按公司配置；0 表示不静默）
    const silenceDays = await this.ackSilenceDays(companyId)
    const silenceBefore = new Date(Date.now() - silenceDays * 86400000)
    const recentAcked = await this.alerts
      .createQueryBuilder('a')
      .where('a.company_id = :companyId', { companyId })
      .andWhere('a.acknowledged = :ack', { ack: true })
      .andWhere('a.acknowledged_at >= :since', { since: silenceBefore })
      .getMany()
    const silenced = new Set(recentAcked.map((a) => `${a.type}:${a.refId}`))

    // 已转采购单的对象（订单未取消）
    const orderedRefIds = new Set<string>()
    const liveOrders = await this.orders.find({
      where: { companyId, sourceAlertId: Not(IsNull()) },
      relations: { sourceAlert: true },
    })
    for (const o of liveOrders) {
      if (o.status === 'cancelled') continue
      const refId = (o as unknown as { sourceAlert?: { refId?: string } }).sourceAlert?.refId
      if (refId) orderedRefIds.add(`${o.orderType === 'purchase' ? 'low_stock' : o.orderType}:${refId}`)
    }

    const toCreate = candidates.filter(
      (c) => !seen.has(`${c.type}:${c.refId}`) && !silenced.has(`${c.type}:${c.refId}`) && !orderedRefIds.has(`${c.type}:${c.refId}`),
    )
    if (toCreate.length) {
      await this.alerts.save(
        toCreate.map((c) => this.alerts.create({ tenantId, companyId, ...c, acknowledged: false })),
      )
      this.log.log(`预警扫描：新增 ${toCreate.length} 条（逾期${overdue.length} 低库存${candidates.length - overdue.length - stale.length} 呆滞${stale.length}）`)
    }

    return {
      created: toCreate.length,
      stats: {
        orderOverdue: overdue.length,
        lowStock: matsWithSafety.length > 0 ? candidates.filter((c) => c.type === 'low_stock').length : 0,
        staleBatch: stale.length,
      },
    }
  }
}
