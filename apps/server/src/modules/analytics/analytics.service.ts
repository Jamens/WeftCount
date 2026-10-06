import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import dayjs from 'dayjs'
import { InventoryBatchEntity } from '../inventory/entities/inventory-batch.entity'
import { InventoryDocumentEntity } from '../inventory/entities/inventory-document.entity'
import { GreigeSpecEntity } from '../material/entities/greige-spec.entity'

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

export interface TrendData {
  days: number
  daily: DailyPoint[]
  specShare: SpecShare[]
  totals: { meters: number; purchaseAmount: number; salesAmount: number }
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
    }
  }
}
