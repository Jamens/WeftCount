import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository } from 'typeorm'
import dayjs from 'dayjs'
import { AlertEntity, type AlertSeverity, type AlertType } from './entities/alert.entity'
import { MaterialEntity } from '../material/entities/material.entity'
import { ProductionOrderEntity } from '../production/entities/production-order.entity'
import { InventoryBatchEntity } from '../inventory/entities/inventory-batch.entity'

/** 呆滞批次阈值：入库超此天数且仍有剩余未动 */
const STALE_DAYS = 60
/** 低库存判定：库存 < 安全库存（仅对设了安全库存的物料生效） */
const LOW_STOCK_RATIO = 1

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
  ) {}

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

  /** 扫描并生成预警（去重：已有未确认的同类同对象预警则跳过） */
  async scan(tenantId: string, companyId: string): Promise<AlertScanResult> {
    const candidates: { type: AlertType; severity: AlertSeverity; title: string; message: string; refType: string; refId: string }[] = []

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
      if (have < safety * LOW_STOCK_RATIO) {
        candidates.push({
          type: 'low_stock',
          severity: have <= 0 ? 'critical' : 'warning',
          title: `库存低位 ${m.name}`,
          message: `当前 ${have.toFixed(1)} ${m.primaryUnit}，安全库存 ${safety} ${m.primaryUnit}，缺口 ${(safety - have).toFixed(1)}`,
          refType: 'material',
          refId: m.id,
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

    // 去重：已有未确认的同类同对象预警则跳过
    const existing = await this.alerts.find({ where: { companyId, acknowledged: false } })
    const seen = new Set(existing.map((a) => `${a.type}:${a.refId}`))
    const toCreate = candidates.filter((c) => !seen.has(`${c.type}:${c.refId}`))
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
