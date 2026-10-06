import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository } from 'typeorm'
import dayjs from 'dayjs'
import { InventoryBatchEntity } from '../inventory/entities/inventory-batch.entity'
import { InventoryDocumentEntity } from '../inventory/entities/inventory-document.entity'
import { RollEntity } from '../inventory/entities/roll.entity'
import { GreigeSpecEntity } from '../material/entities/greige-spec.entity'
import { ProductionReportEntity } from '../production/entities/production-report.entity'
import { ProductionOrderEntity } from '../production/entities/production-order.entity'
import { MachineEntity } from '../production/entities/machine.entity'

export interface DailyPoint {
  date: string
  meters: number
  weightKg: number
  purchaseAmount: number
  salesAmount: number
}

export interface SpecShare {
  specId: string
  specName: string
  meters: number
}

/** 日损耗点：投料(领用) vs 产出，报工产出与领用的差=当日损耗(米)，含累计 */
export interface LossPoint {
  date: string
  inputM: number
  outputM: number
  /** 当日损耗 = 投料 - 产出（正=损） */
  excessM: number
  /** 累计损耗（窗口内滚存，正=净损） */
  cumulativeExcessM: number
}

/** 日匹数点：报工产出匹 / 发货匹 */
export interface RollPoint {
  date: string
  produced: number
  shipped: number
}

export interface MachineOutput {
  machineId: string
  machineName: string
  rolls: number
  meters: number
}

export interface TrendData {
  days: number
  daily: DailyPoint[]
  specShare: SpecShare[]
  totals: { meters: number; purchaseAmount: number; salesAmount: number }
  /** 损耗趋势：领用(投料) vs 产出 vs 损耗 */
  loss: { daily: LossPoint[]; totalExcessM: number; windowInputM: number; windowOutputM: number }
  /** 匹维度：日产出/发货匹数、当前在库匹数、机台产出 Top */
  rolls: { daily: RollPoint[]; inStock: number; machineTop: MachineOutput[] }
}

/**
 * 趋势聚合（确定性）
 *
 * 全部由数据库事实 SUM/COUNT 得出，**不含任何预测或 AI**：
 *  - 日产量：报工产出批次(production_in)按 inbound_at 日聚合
 *  - 日采购/销售金额：单据按 created_at 日聚合
 *  - 规格产量占比：报工产出按规格 SUM
 * 缺失日期补 0，保证图表 X 轴连续。
 */
@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(InventoryBatchEntity)
    private readonly batches: Repository<InventoryBatchEntity>,
    @InjectRepository(InventoryDocumentEntity)
    private readonly docs: Repository<InventoryDocumentEntity>,
    @InjectRepository(GreigeSpecEntity)
    private readonly specs: Repository<GreigeSpecEntity>,
    @InjectRepository(RollEntity)
    private readonly rolls: Repository<RollEntity>,
    @InjectRepository(MachineEntity)
    private readonly machineRepo: Repository<MachineEntity>,
  ) {}

  async trends(companyId: string, days = 30): Promise<TrendData> {
    const d = Math.min(Math.max(Number(days) || 30, 7), 180)
    const since = dayjs().subtract(d - 1, 'day').startOf('day')
    const sinceStr = since.format('YYYY-MM-DD')

    // 日产量（报工产出）
    const prodRows = await this.batches
      .createQueryBuilder('b')
      .select('DATE(b.inbound_at)', 'date')
      .addSelect('SUM(b.quantity)', 'meters')
      .addSelect('SUM(b.weight_kg)', 'kg')
      .where('b.company_id = :companyId', { companyId })
      .andWhere("b.source_type = 'production_in'")
      .andWhere('b.inbound_at >= :since', { since: sinceStr })
      .groupBy('DATE(b.inbound_at)')
      .getRawMany<{ date: string; meters: string; kg: string }>()

    // 日采购/销售金额
    const docRows = await this.docs
      .createQueryBuilder('d')
      .select('DATE(d.created_at)', 'date')
      .addSelect('d.doc_type', 'docType')
      .addSelect('SUM(d.total_amount)', 'amount')
      .where('d.company_id = :companyId', { companyId })
      .andWhere('d.created_at >= :since', { since: sinceStr })
      .andWhere("d.doc_type IN ('purchase_inbound','sales_outbound')")
      .groupBy('DATE(d.created_at)')
      .addGroupBy('d.doc_type')
      .getRawMany<{ date: string; docType: string; amount: string }>()

    // 组装连续日期序列
    const byDate = new Map<string, DailyPoint>()
    for (let i = 0; i < d; i++) {
      const date = since.add(i, 'day').format('YYYY-MM-DD')
      byDate.set(date, { date, meters: 0, weightKg: 0, purchaseAmount: 0, salesAmount: 0 })
    }
    const key = (v: string | Date) => dayjs(v).format('YYYY-MM-DD')
    for (const r of prodRows) {
      const p = byDate.get(key(r.date))
      if (p) {
        p.meters = Number(r.meters ?? 0)
        p.weightKg = Number(r.kg ?? 0)
      }
    }
    for (const r of docRows) {
      const p = byDate.get(key(r.date))
      if (p) {
        if (r.docType === 'purchase_inbound') p.purchaseAmount = Number(r.amount ?? 0)
        else if (r.docType === 'sales_outbound') p.salesAmount = Number(r.amount ?? 0)
      }
    }
    const daily = [...byDate.values()]

    // 规格产量占比
    const specRows = await this.batches
      .createQueryBuilder('b')
      .select('b.spec_id', 'specId')
      .addSelect('SUM(b.quantity)', 'meters')
      .where('b.company_id = :companyId', { companyId })
      .andWhere("b.source_type = 'production_in'")
      .groupBy('b.spec_id')
      .orderBy('SUM(b.quantity)', 'DESC')
      .getRawMany<{ specId: string; meters: string }>()
    const specMap = new Map((await this.specs.find({ where: { companyId } })).map((s) => [s.id, s.name]))
    const specShare: SpecShare[] = specRows.map((r) => ({
      specId: r.specId,
      specName: specMap.get(r.specId) ?? '未知规格',
      meters: Number(r.meters ?? 0),
    }))

    return {
      days: d,
      daily,
      specShare,
      totals: {
        meters: daily.reduce((s, p) => s + p.meters, 0),
        purchaseAmount: daily.reduce((s, p) => s + p.purchaseAmount, 0),
        salesAmount: daily.reduce((s, p) => s + p.salesAmount, 0),
      },
      loss: await this.lossTrend(companyId, d, since, daily),
      rolls: await this.rollStats(companyId, d, byDate),
    }
  }

  /**
   * 损耗趋势：按日 投料(生产领用米) vs 产出(报工米)，差=当日损耗，累计滚存。
   * 全部确定性 SUM——**不做预测**。注意：领用与产出按日不严格配对(纱按批领、织造跨天)，
   * 故以「累计差」看趋势最有意义。
   */
  private async lossTrend(companyId: string, days: number, since: dayjs.Dayjs, daily: DailyPoint[]) {
    // 投料：生产领用单按 created_at 日聚合 quantityM
    const issueRows = await this.docs
      .createQueryBuilder('d')
      .select('DATE(d.created_at)', 'date')
      .addSelect('SUM(d.quantity_m)', 'm')
      .where('d.company_id = :companyId', { companyId })
      .andWhere("d.doc_type = 'production_issue'")
      .andWhere('d.created_at >= :since', { since: since.format('YYYY-MM-DD') })
      .groupBy('DATE(d.created_at)')
      .getRawMany<{ date: string; m: string }>()
    const inputByDate = new Map(issueRows.map((r) => [dayjs(r.date).format('YYYY-MM-DD'), Number(r.m ?? 0)]))
    // 产出：报工产出 daily.meters 已有
    const outByDate = new Map(daily.map((p) => [p.date, p.meters]))

    const pts: LossPoint[] = []
    let cum = 0
    for (const p of daily) {
      const inputM = inputByDate.get(p.date) ?? 0
      const outputM = outByDate.get(p.date) ?? 0
      const excessM = inputM - outputM
      cum += excessM
      pts.push({ date: p.date, inputM, outputM, excessM, cumulativeExcessM: cum })
    }
    return {
      daily: pts,
      totalExcessM: cum,
      windowInputM: pts.reduce((s, p) => s + p.inputM, 0),
      windowOutputM: pts.reduce((s, p) => s + p.outputM, 0),
    }
  }

  /** 匹维度：日产出/发货匹数、当前在库匹数、机台产出 Top(匹数+米数) */
  private async rollStats(companyId: string, days: number, byDate: Map<string, DailyPoint>) {
    // 产出匹：所有件卡按创建日(created_at)——入库(采购/报工)都在此登记
    const producedRows = await this.rolls
      .createQueryBuilder('r')
      .select('DATE(r.created_at)', 'date')
      .addSelect('COUNT(r.id)', 'n')
      .where('r.company_id = :companyId', { companyId })
      .groupBy('DATE(r.created_at)')
      .getRawMany<{ date: string; n: string }>()
    const producedByDate = new Map(producedRows.map((r) => [dayjs(r.date).format('YYYY-MM-DD'), Number(r.n ?? 0)]))

    // 发货匹：件卡 outbound_doc_id → 出库单 created_at
    const shippedRows = await this.rolls
      .createQueryBuilder('r')
      .innerJoin(InventoryDocumentEntity, 'doc', 'doc.id = r.outbound_doc_id')
      .select('DATE(doc.created_at)', 'date')
      .addSelect('COUNT(r.id)', 'n')
      .where('r.company_id = :companyId', { companyId })
      .andWhere('r.outbound_doc_id IS NOT NULL')
      .groupBy('DATE(doc.created_at)')
      .getRawMany<{ date: string; n: string }>()
    const shippedByDate = new Map(shippedRows.map((r) => [dayjs(r.date).format('YYYY-MM-DD'), Number(r.n ?? 0)]))

    const dailyRoll: RollPoint[] = []
    for (const date of byDate.keys()) {
      dailyRoll.push({ date, produced: producedByDate.get(date) ?? 0, shipped: shippedByDate.get(date) ?? 0 })
    }

    const inStock = await this.rolls
      .createQueryBuilder('r')
      .where('r.company_id = :companyId', { companyId })
      .andWhere("r.status = 'in_stock'")
      .getCount()

    // 机台产出 Top：报工产出批次 → sourceDocId=报工 → orderId → machineId，按匹数
    const machineRows = await this.batches
      .createQueryBuilder('b')
      .innerJoin(ProductionReportEntity, 'rep', 'rep.id = b.source_doc_id')
      .innerJoin(ProductionOrderEntity, 'o', 'o.id = rep.order_id')
      .select('o.machine_id', 'machineId')
      .addSelect('COUNT(DISTINCT b.id)', 'batches')
      .addSelect('SUM(b.quantity)', 'meters')
      .where('b.company_id = :companyId', { companyId })
      .andWhere("b.source_type = 'production_in'")
      .andWhere('o.machine_id IS NOT NULL')
      .groupBy('o.machine_id')
      .getRawMany<{ machineId: string; batches: string; meters: string }>()
    // 每批的匹数
    const rollCountByBatch = await this.rolls
      .createQueryBuilder('r')
      .select('r.batch_id', 'batchId')
      .addSelect('COUNT(r.id)', 'n')
      .groupBy('r.batch_id')
      .getRawMany<{ batchId: string; n: string }>()
    const rollMap = new Map(rollCountByBatch.map((r) => [r.batchId, Number(r.n ?? 0)]))
    const batchIdsByMachine = machineRows.length
      ? await this.batches
          .createQueryBuilder('b')
          .innerJoin(ProductionReportEntity, 'rep', 'rep.id = b.source_doc_id')
          .innerJoin(ProductionOrderEntity, 'o', 'o.id = rep.order_id')
          .select('b.id', 'batchId')
          .addSelect('o.machine_id', 'machineId')
          .where('b.company_id = :companyId', { companyId })
          .andWhere("b.source_type = 'production_in'")
          .andWhere('o.machine_id IS NOT NULL')
          .getRawMany<{ batchId: string; machineId: string }>()
      : []
    const rollsByMachine = new Map<string, number>()
    for (const bm of batchIdsByMachine) {
      rollsByMachine.set(bm.machineId, (rollsByMachine.get(bm.machineId) ?? 0) + (rollMap.get(bm.batchId) ?? 0))
    }
    const machineIds = machineRows.map((m) => m.machineId)
    const machines = machineIds.length ? await this.machineRepo.find({ where: { id: In(machineIds) } }) : []
    const machineNameMap = new Map(machines.map((m) => [m.id, m.name]))
    const machineTop: MachineOutput[] = machineRows
      .map((m) => ({
        machineId: m.machineId,
        machineName: machineNameMap.get(m.machineId) ?? m.machineId,
        rolls: rollsByMachine.get(m.machineId) ?? 0,
        meters: Number(m.meters ?? 0),
      }))
      .sort((a, b) => b.rolls - a.rolls || b.meters - a.meters)
      .slice(0, 10)

    return { daily: dailyRoll, inStock, machineTop }
  }
}
