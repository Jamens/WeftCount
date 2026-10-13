import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import dayjs from 'dayjs'
import { InventoryBatchEntity } from '../inventory/entities/inventory-batch.entity'
import { InventoryDocumentEntity } from '../inventory/entities/inventory-document.entity'
import { RollEntity } from '../inventory/entities/roll.entity'
import { TradeOrderEntity } from '../order/entities/trade-order.entity'
import { ProductionOrderEntity } from '../production/entities/production-order.entity'
import { ProductionReportEntity } from '../production/entities/production-report.entity'
import { MachineEntity } from '../production/entities/machine.entity'
import { AlertService } from '../alert/alert.service'

/**
 * 首页概览（确定性聚合）
 *
 * 背景：此前首页是**纯静态页**——唯一请求是 `/health`，其余全是硬编码的
 * 演示数据（固定的全棉府绸工艺基准值）。业务方打开系统看不到任何与自己工厂
 * 有关的东西，"首页"名不副实。
 *
 * 设计原则：
 *  - **全部数据库聚合，零预测、零 AI**。首页数字要与各业务页对得上，
 *    看到一个数点进去发现不一样，比没有这个数更糟。
 *  - **只读直查仓库，不注入其它 Service**：避免跨模块依赖与循环引用，
 *    也避免某个模块改动牵连首页。口径若需与业务页一致，
 *    优先复用对方的聚合方法（见 below 的取舍说明）。
 *  - **一个请求返回全部概览**：首页若发七八个请求，任何一个慢都会让整页转圈。
 */
export interface DashboardData {
  /** 统计口径窗口（本月首日 → 今天） */
  period: { from: string; to: string; label: string }
  /** 库存（在库当前状态，非期间） */
  inventory: {
    /** 在库批次剩余米数合计 */
    greigeMeters: number
    /** 在库剩余重量合计 kg */
    remainingKg: number
    /** 在库货值（剩余量 × 单位成本） */
    stockValue: number
    /** 在库件卡匹数 */
    rollsInStock: number
    /** 低位/耗尽批次数（需关注的库存异常） */
    depletedBatches: number
  }
  /** 本月采购 */
  purchase: { amount: number; orders: number }
  /** 本月销售 */
  sales: { amount: number; orders: number }
  /** 生产 */
  production: {
    /** 本月产出米数（报工口径） */
    outputMeters: number
    /** 在产工单数 */
    inProgressOrders: number
    /** 待排产（草稿）工单数 */
    draftOrders: number
    /** 本月报工次数 */
    reportCount: number
    /** 机台总数 / 在产机台数 */
    machineTotal: number
    machineRunning: number
  }
  /** 待办与预警 */
  todo: {
    /** 未确认预警数 */
    openAlerts: number
    /** 临近/逾期交期的在途订单数 */
    dueSoonOrders: number
    /** 逾期订单数 */
    overdueOrders: number
  }
  /** 近 7 日日产量（趋势图数据，缺失补 0 保证 X 轴连续） */
  recentOutput: { date: string; meters: number }[]
}

@Injectable()
export class DashboardService {
  private readonly log = new Logger(DashboardService.name)

  constructor(
    @InjectRepository(InventoryBatchEntity) private readonly batches: Repository<InventoryBatchEntity>,
    @InjectRepository(InventoryDocumentEntity) private readonly docs: Repository<InventoryDocumentEntity>,
    @InjectRepository(RollEntity) private readonly rolls: Repository<RollEntity>,
    @InjectRepository(TradeOrderEntity) private readonly orders: Repository<TradeOrderEntity>,
    @InjectRepository(ProductionOrderEntity) private readonly prodOrders: Repository<ProductionOrderEntity>,
    @InjectRepository(ProductionReportEntity) private readonly reports: Repository<ProductionReportEntity>,
    @InjectRepository(MachineEntity) private readonly machines: Repository<MachineEntity>,
    private readonly alerts: AlertService,
  ) {}

  async overview(companyId: string): Promise<DashboardData> {
    const today = dayjs().startOf('day')
    const monthStart = today.startOf('month').format('YYYY-MM-DD')
    const todayStr = today.format('YYYY-MM-DD')
    const weekAgo = today.subtract(6, 'day').format('YYYY-MM-DD')

    // 一次并发拉齐所有聚合所需数据，避免串行等待
    const [
      batchAgg, rollAgg, depleted, purchaseAgg, salesAgg,
      outputAgg, inProgress, draftOrders, reportCount,
      machines, activeMats, openAlerts, dueSoon, overdue,
      weekOutput,
    ] = await Promise.all([
      // 在库：按剩余量聚合，并算货值（剩余米 × 单位成本）
      this.batches
        .createQueryBuilder('b')
        .select('SUM(b.remaining_quantity)', 'meters')
        .addSelect('SUM(b.remaining_weight_kg)', 'kg')
        .addSelect('SUM(b.remaining_quantity * b.unit_cost)', 'value')
        .where('b.company_id = :companyId', { companyId })
        .andWhere('b.status <> :depleted', { depleted: 'depleted' })
        .getRawOne<{ meters: string | null; kg: string | null; value: string | null }>(),

      this.rolls
        .createQueryBuilder('r')
        .select('COUNT(1)', 'n')
        .where('r.company_id = :companyId', { companyId })
        .andWhere("r.status = 'in_stock'")
        .getRawOne<{ n: string }>(),

      this.batches
        .createQueryBuilder('b')
        .select('COUNT(1)', 'n')
        .where('b.company_id = :companyId', { companyId })
        .andWhere("b.status = 'depleted'")
        .getRawOne<{ n: string }>(),

      // 本月采购金额与单数
      this.docs
        .createQueryBuilder('d')
        .select('COALESCE(SUM(d.total_amount),0)', 'amount')
        .addSelect('COUNT(1)', 'n')
        .where('d.company_id = :companyId', { companyId })
        .andWhere("d.doc_type = 'purchase_inbound'")
        .andWhere('DATE(d.created_at) >= :from', { from: monthStart })
        .getRawOne<{ amount: string; n: string }>(),

      // 本月销售金额与单数
      this.docs
        .createQueryBuilder('d')
        .select('COALESCE(SUM(d.total_amount),0)', 'amount')
        .addSelect('COUNT(1)', 'n')
        .where('d.company_id = :companyId', { companyId })
        .andWhere("d.doc_type = 'sales_outbound'")
        .andWhere('DATE(d.created_at) >= :from', { from: monthStart })
        .getRawOne<{ amount: string; n: string }>(),

      // 本月产出：以报工表为准（产出事实的源头），与报工页一致
      this.reports
        .createQueryBuilder('r')
        .select('COALESCE(SUM(r.output_m),0)', 'meters')
        .where('r.company_id = :companyId', { companyId })
        .andWhere('r.report_date >= :from', { from: monthStart })
        .getRawOne<{ meters: string }>(),

      this.prodOrders
        .createQueryBuilder('p')
        .select('COUNT(1)', 'n')
        .where('p.company_id = :companyId', { companyId })
        .andWhere("p.status = 'in_progress'")
        .getRawOne<{ n: string }>(),

      this.prodOrders
        .createQueryBuilder('p')
        .select('COUNT(1)', 'n')
        .where('p.company_id = :companyId', { companyId })
        .andWhere("p.status = 'draft'")
        .getRawOne<{ n: string }>(),

      this.reports
        .createQueryBuilder('r')
        .select('COUNT(1)', 'n')
        .where('r.company_id = :companyId', { companyId })
        .andWhere('r.report_date >= :from', { from: monthStart })
        .getRawOne<{ n: string }>(),

      this.machines
        .createQueryBuilder('m')
        .select('COUNT(1)', 'n')
        .where('m.company_id = :companyId', { companyId })
        .andWhere("m.status <> 'retired'")
        .getRawOne<{ n: string }>(),

      this.machines
        .createQueryBuilder('m')
        .select('COUNT(1)', 'n')
        .where('m.company_id = :companyId', { companyId })
        .andWhere("m.status = 'running'")
        .getRawOne<{ n: string }>(),

      // 未确认预警：AlertService 已有 openCount，直接复用避免口径分叉
      this.alerts.openCount(companyId),

      // 7 天内交期的在途订单（未完成未取消）
      this.orders
        .createQueryBuilder('o')
        .select('COUNT(1)', 'n')
        .where('o.company_id = :companyId', { companyId })
        .andWhere("o.status IN ('draft','confirmed')")
        .andWhere('o.expected_date IS NOT NULL')
        .andWhere('o.expected_date >= :today', { today: todayStr })
        .andWhere('o.expected_date <= :soon', { soon: today.add(7, 'day').format('YYYY-MM-DD') })
        .getRawOne<{ n: string }>(),

      // 已过交期仍未完成
      this.orders
        .createQueryBuilder('o')
        .select('COUNT(1)', 'n')
        .where('o.company_id = :companyId', { companyId })
        .andWhere("o.status IN ('draft','confirmed')")
        .andWhere('o.expected_date IS NOT NULL')
        .andWhere('o.expected_date < :today', { today: todayStr })
        .getRawOne<{ n: string }>(),

      // 近 7 日日产量
      this.batches
        .createQueryBuilder('b')
        .select('DATE(b.inbound_at)', 'date')
        .addSelect('COALESCE(SUM(b.quantity),0)', 'meters')
        .where('b.company_id = :companyId', { companyId })
        .andWhere("b.source_type = 'production_in'")
        .andWhere('b.inbound_at >= :from', { from: weekAgo })
        .groupBy('DATE(b.inbound_at)')
        .getRawMany<{ date: string; meters: string }>(),
    ])

    // 近 7 日补齐缺失日期：图表 X 轴必须连续，否则折线会跳日期误导读数
    const outMap = new Map(weekOutput.map((r) => [r.date, Number(r.meters)]))
    const recentOutput: DashboardData['recentOutput'] = []
    for (let i = 6; i >= 0; i--) {
      const d = today.subtract(i, 'day').format('YYYY-MM-DD')
      recentOutput.push({ date: d, meters: outMap.get(d) ?? 0 })
    }

    const data: DashboardData = {
      period: { from: monthStart, to: todayStr, label: today.format('YYYY年M月') },
      inventory: {
        greigeMeters: num(batchAgg?.meters),
        remainingKg: num(batchAgg?.kg),
        stockValue: num(batchAgg?.value),
        rollsInStock: num(rollAgg?.n),
        depletedBatches: num(depleted?.n),
      },
      purchase: { amount: num(purchaseAgg?.amount), orders: num(purchaseAgg?.n) },
      sales: { amount: num(salesAgg?.amount), orders: num(salesAgg?.n) },
      production: {
        outputMeters: num(outputAgg?.meters),
        inProgressOrders: num(inProgress?.n),
        draftOrders: num(draftOrders?.n),
        reportCount: num(reportCount?.n),
        machineTotal: num(machines?.n),
        machineRunning: num(activeMats?.n),
      },
      todo: {
        openAlerts: num(openAlerts),
        dueSoonOrders: num(dueSoon?.n),
        overdueOrders: num(overdue?.n),
      },
      recentOutput,
    }
    this.log.log(`概览：产出 ${data.production.outputMeters}m，预警 ${data.todo.openAlerts}，逾期订单 ${data.todo.overdueOrders}`)
    return data
  }
}

function num(v: string | number | null | undefined): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}