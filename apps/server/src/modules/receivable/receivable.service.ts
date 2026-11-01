import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm'
import { DataSource, type EntityManager, In, Like, Repository } from 'typeorm'
import { ErrorCode, dateToISO, isoToDate } from '@weftcount/shared'
import { PartnerEntity } from '../partner/entities/partner.entity'
import { InventoryDocumentEntity } from '../inventory/entities/inventory-document.entity'
import { ReceiptEntity, type ReceiptMethod } from './entities/receipt.entity'
import { ReceiptApplicationEntity } from './entities/receipt-application.entity'
import type { RequestContext } from '../auth/auth-context'
import { withUniqueNo } from '../../common/util/unique-no'

/** 金额四舍五入为 decimal 字符串 */
function num(n: number, scale: number): string {
  const f = 10 ** scale
  return String(Math.round((n + Number.EPSILON) * f) / f)
}
/** decimal 字符串 → number（空/异常记 0） */
function toNum(s: string | null | undefined): number {
  const v = Number(s ?? '0')
  return Number.isFinite(v) ? v : 0
}
/** 当天 0 点的日期差（天）：a - b */
function dayDiff(a: Date, b: Date): number {
  const ms = 24 * 60 * 60 * 1000
  return Math.floor((a.setHours(0, 0, 0, 0) - b.setHours(0, 0, 0, 0)) / ms)
}

export interface ReceiptApplicationView {
  id: string
  docId: string
  docNo: string
  appliedAmount: number
  docTotal: number
  docSettled: number
}

export interface ReceiptView {
  id: string
  receiptNo: string
  partnerId: string
  partnerName: string
  receiptDate: string
  amount: number
  method: ReceiptMethod
  remark: string | null
  createdAt: Date
  applications: ReceiptApplicationView[]
}

export interface LedgerRow {
  docId: string
  docNo: string
  partnerId: string
  partnerName: string
  totalAmount: number
  settledAmount: number
  uncollected: number
  dueDate: string | null
  agingDays: number | null
  overdue: boolean
}

export interface AgingSegment {
  current: number // 未到期
  d1_30: number
  d31_60: number
  d61_90: number
  d90plus: number
}

export interface AgingRow {
  partnerId: string
  partnerName: string
  total: number
  segments: AgingSegment
}

export interface StatementLine {
  date: string
  docNo: string
  kind: 'invoice' | 'receipt'
  debit: number
  credit: number
  balance: number
}

export interface ReceivableOverview {
  totalReceivable: number
  totalCollected: number
  overdueAmount: number
  receiptTotal: number
}

@Injectable()
export class ReceivableService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(ReceiptEntity) private readonly receipts: Repository<ReceiptEntity>,
    @InjectRepository(ReceiptApplicationEntity)
    private readonly apps: Repository<ReceiptApplicationEntity>,
    @InjectRepository(PartnerEntity) private readonly partners: Repository<PartnerEntity>,
    @InjectRepository(InventoryDocumentEntity)
    private readonly docs: Repository<InventoryDocumentEntity>,
  ) {}

  // ---------- 写：录收款（核销） ----------

  async createReceipt(
    ctx: RequestContext,
    dto: {
      partnerId: string
      receiptDate: string
      amount: number
      method?: ReceiptMethod
      remark?: string | null
      applications: { docId: string; appliedAmount: number }[]
    },
  ): Promise<ReceiptView> {
    const partner = await this.partners.findOne({
      where: { id: dto.partnerId, tenantId: ctx.tenantId, companyId: ctx.companyId },
    })
    if (!partner) {
      throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: '客户不存在' })
    }
    if (partner.status !== 'active') {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: `客户「${partner.name}」已停用`,
      })
    }
    const isCustomer: boolean = partner.type === 'customer' || partner.type === 'both'
    if (!isCustomer) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: `「${partner.name}」不是客户，不能录收款`,
      })
    }
    if (!dto.applications || dto.applications.length === 0) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: '收款必须分配至少一张出库单',
      })
    }

    // 按单据聚合分配额，避免同一张单出现多行
    const byDoc = new Map<string, number>()
    for (const a of dto.applications) {
      if (!a.docId)
        throw new BadRequestException({
          code: ErrorCode.VALIDATION_FAILED,
          message: '核销明细缺少 docId',
        })
      byDoc.set(a.docId, (byDoc.get(a.docId) ?? 0) + a.appliedAmount)
    }
    const sumApplied = [...byDoc.values()].reduce((s, v) => s + v, 0)
    if (Math.abs(sumApplied - dto.amount) > 0.01) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: `核销分配合计 ${num(sumApplied, 2)} 与收款额 ${num(dto.amount, 2)} 不一致`,
      })
    }

    return withUniqueNo(async () => {
      return this.dataSource.transaction(async (manager) => {
        const receiptNo = await this.nextReceiptNo(ctx.companyId)
        const receipt = manager.create(ReceiptEntity, {
          tenantId: ctx.tenantId,
          companyId: ctx.companyId,
          receiptNo,
          partnerId: partner.id,
          partnerName: partner.name,
          receiptDate: isoToDate(dto.receiptDate),
          amount: num(dto.amount, 2),
          method: dto.method ?? 'bank',
          remark: dto.remark ?? null,
          operatorId: ctx.userId,
        })
        const saved = await manager.save(receipt)

        // 涉及的出库单一次性取回（原先逐条 findOne，N 张单 = N 次查询）。
        // byDoc 以 docId 为键，同一张单只出现一次，故批量预取与逐条查询等价；
        // docType 校验保留在循环内，报错文案与原先完全一致。
        const docIds = [...byDoc.keys()]
        const docs = docIds.length
          ? await manager.find(InventoryDocumentEntity, {
              where: { id: In(docIds), tenantId: ctx.tenantId, companyId: ctx.companyId },
            })
          : []
        const docMap = new Map(docs.map((d) => [d.id, d]))
        const applications: ReceiptApplicationEntity[] = []
        for (const [docId, applied] of byDoc) {
          const doc = docMap.get(docId)
          if (!doc || doc.docType !== 'sales_outbound') {
            throw new BadRequestException({
              code: ErrorCode.VALIDATION_FAILED,
              message: `出库单 ${docId} 不是本公司的销售出库单`,
            })
          }
          const total = toNum(doc.totalAmount)
          const newSettled = toNum(doc.settledAmount) + applied
          if (newSettled > total + 0.01) {
            throw new BadRequestException({
              code: ErrorCode.VALIDATION_FAILED,
              message: `出库单 ${doc.docNo} 核销超额：已收 ${num(toNum(doc.settledAmount), 2)} + 本次 ${num(applied, 2)} > 应收 ${num(total, 2)}`,
            })
          }
          applications.push(
            manager.create(ReceiptApplicationEntity, {
              tenantId: ctx.tenantId,
              companyId: ctx.companyId,
              receiptId: saved.id,
              docId,
              appliedAmount: num(applied, 2),
            }),
          )
          doc.settledAmount = num(newSettled, 2)
          await manager.save(doc)
        }
        if (applications.length) await manager.save(applications)
        return this.toReceiptView(saved, await this.loadApps(manager, saved.id, ctx))
      })
    })
  }

  // ---------- 写：作废收款（回退核销） ----------

  async voidReceipt(ctx: RequestContext, receiptId: string): Promise<void> {
    const receipt = await this.receipts.findOne({
      where: { id: receiptId, tenantId: ctx.tenantId, companyId: ctx.companyId },
    })
    if (!receipt)
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: '收款单不存在' })

    await this.dataSource.transaction(async (manager) => {
      const list = await manager.find(ReceiptApplicationEntity, {
        where: { receiptId: receipt.id, tenantId: ctx.tenantId, companyId: ctx.companyId },
      })
      // 涉及的出库单一次性取回（原先逐条 findOne，N 条核销 = N 次查询）。
      // 核销明细按 docId 唯一（核销时已按 docId 归并），故每张单只回退一次，
      // 批量预取与逐条查询等价。
      const docIds = [...new Set(list.map((a) => a.docId))]
      const docs = docIds.length
        ? await manager.find(InventoryDocumentEntity, {
            where: { id: In(docIds), tenantId: ctx.tenantId, companyId: ctx.companyId },
          })
        : []
      const docMap = new Map(docs.map((d) => [d.id, d]))
      for (const app of list) {
        const doc = docMap.get(app.docId)
        if (doc) {
          const back = Math.max(0, toNum(doc.settledAmount) - toNum(app.appliedAmount))
          doc.settledAmount = num(back, 2)
          // update 而非 save：save 每行多打一条存在性 SELECT；该实体的
          // updatedAt 是 @UpdateDateColumn，update 同样会自动维护。
          await manager.update(
            InventoryDocumentEntity,
            { id: doc.id },
            {
              settledAmount: doc.settledAmount,
            },
          )
        }
      }
      await manager.delete(ReceiptApplicationEntity, { receiptId: receipt.id })
      await manager.delete(ReceiptEntity, { id: receipt.id })
    })
  }

  // ---------- 读：收款列表 / 详情 ----------

  async listReceipts(
    ctx: RequestContext,
    filter: {
      partnerId?: string
      from?: string
      to?: string
      page?: number
      pageSize?: number
    },
  ): Promise<{ records: ReceiptView[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(1, filter.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 20))
    const where: Record<string, unknown> = { tenantId: ctx.tenantId, companyId: ctx.companyId }
    if (filter.partnerId) where.partnerId = filter.partnerId
    if (filter.from || filter.to) {
      where.receiptDate = {}
      if (filter.from) (where.receiptDate as Record<string, unknown>).gte = filter.from
      if (filter.to) (where.receiptDate as Record<string, unknown>).lte = filter.to
    }
    const [rows, total] = await this.receipts.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    })
    const appsByReceipt = await this.loadAppsBatch(
      this.receipts.manager,
      rows.map((r) => r.id),
      ctx,
    )
    const views = rows.map((r) => this.toReceiptView(r, appsByReceipt.get(r.id) ?? []))
    return { records: views, total, page, pageSize }
  }

  async getReceipt(ctx: RequestContext, id: string): Promise<ReceiptView> {
    const r = await this.receipts.findOne({
      where: { id, tenantId: ctx.tenantId, companyId: ctx.companyId },
    })
    if (!r) throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: '收款单不存在' })
    return this.toReceiptView(r, await this.loadApps(this.receipts.manager, r.id, ctx))
  }

  // ---------- 读：应收台账 ----------

  async getLedger(ctx: RequestContext, filter: { partnerId?: string }): Promise<LedgerRow[]> {
    const where: Record<string, unknown> = {
      tenantId: ctx.tenantId,
      companyId: ctx.companyId,
      docType: 'sales_outbound',
    }
    if (filter.partnerId) where.partnerId = filter.partnerId
    const all = await this.docs.find({ where })
    const today = new Date()
    return all
      .map((d) => {
        const total = toNum(d.totalAmount)
        const settled = toNum(d.settledAmount)
        const uncollected = Math.max(0, total - settled)
        return { d, total, settled, uncollected }
      })
      .filter((x) => x.uncollected > 0.005)
      .map(({ d, total, settled, uncollected }) => {
        const due = d.dueDate ? isoToDate(dateToISO(d.dueDate)) : null
        const agingDays = due ? dayDiff(today, due) : null
        return {
          docId: d.id,
          docNo: d.docNo,
          partnerId: d.partnerId ?? '',
          partnerName: d.partnerName ?? '',
          totalAmount: total,
          settledAmount: settled,
          uncollected,
          dueDate: due ? dateToISO(due) : null,
          agingDays,
          overdue: due ? dayDiff(today, due) > 0 : false,
        } as LedgerRow
      })
      .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))
  }

  // ---------- 读：账龄分析 ----------

  async getAging(ctx: RequestContext, filter: { partnerId?: string }): Promise<AgingRow[]> {
    const ledger = await this.getLedger(ctx, filter)
    const map = new Map<string, AgingRow>()
    for (const row of ledger) {
      let agg = map.get(row.partnerId)
      if (!agg) {
        agg = {
          partnerId: row.partnerId,
          partnerName: row.partnerName,
          total: 0,
          segments: { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 },
        }
        map.set(row.partnerId, agg)
      }
      agg.total += row.uncollected
      const age = row.agingDays ?? 0
      if (age <= 0) agg.segments.current += row.uncollected
      else if (age <= 30) agg.segments.d1_30 += row.uncollected
      else if (age <= 60) agg.segments.d31_60 += row.uncollected
      else if (age <= 90) agg.segments.d61_90 += row.uncollected
      else agg.segments.d90plus += row.uncollected
    }
    return [...map.values()].sort((a, b) => b.total - a.total)
  }

  // ---------- 读：对账单 ----------

  async getStatement(
    ctx: RequestContext,
    filter: { partnerId: string; from?: string; to?: string },
  ): Promise<{
    partnerId: string
    partnerName: string
    lines: StatementLine[]
    totalDebit: number
    totalCredit: number
    closingBalance: number
  }> {
    const partner = await this.partners.findOne({
      where: { id: filter.partnerId, tenantId: ctx.tenantId, companyId: ctx.companyId },
    })
    if (!partner) throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: '客户不存在' })

    const docWhere: Record<string, unknown> = {
      tenantId: ctx.tenantId,
      companyId: ctx.companyId,
      docType: 'sales_outbound',
      partnerId: filter.partnerId,
    }
    if (filter.from || filter.to) {
      docWhere.createdAt = {}
      if (filter.from) (docWhere.createdAt as Record<string, unknown>).gte = new Date(filter.from)
      if (filter.to)
        (docWhere.createdAt as Record<string, unknown>).lte = new Date(filter.to + 'T23:59:59')
    }
    const docs = await this.docs.find({ where: docWhere, order: { createdAt: 'ASC' } })

    const rcptWhere: Record<string, unknown> = {
      tenantId: ctx.tenantId,
      companyId: ctx.companyId,
      partnerId: filter.partnerId,
    }
    if (filter.from || filter.to) {
      rcptWhere.receiptDate = {}
      if (filter.from) (rcptWhere.receiptDate as Record<string, unknown>).gte = filter.from
      if (filter.to) (rcptWhere.receiptDate as Record<string, unknown>).lte = filter.to
    }
    const receipts = await this.receipts.find({ where: rcptWhere, order: { receiptDate: 'ASC' } })

    type Raw = { date: string; docNo: string; kind: 'invoice' | 'receipt'; amount: number }
    const raw: Raw[] = [
      ...docs.map((d) => ({
        date: dateToISO(d.createdAt),
        docNo: d.docNo,
        kind: 'invoice' as const,
        amount: toNum(d.totalAmount),
      })),
      ...receipts.map((r) => ({
        date: dateToISO(r.receiptDate),
        docNo: r.receiptNo,
        kind: 'receipt' as const,
        amount: toNum(r.amount),
      })),
    ]
    // 按日历日排序；同日则收款排在发货之后（同日同刻时以 kind 稳定排序）
    raw.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'receipt' ? 1 : -1))

    let balance = 0
    const lines: StatementLine[] = raw.map((r) => {
      const debit = r.kind === 'invoice' ? r.amount : 0
      const credit = r.kind === 'receipt' ? r.amount : 0
      balance += debit - credit
      return {
        date: r.date,
        docNo: r.docNo,
        kind: r.kind,
        debit,
        credit,
        balance: Math.round(balance * 100) / 100,
      }
    })
    return {
      partnerId: partner.id,
      partnerName: partner.name,
      lines,
      totalDebit:
        Math.round(
          raw.filter((r) => r.kind === 'invoice').reduce((s, r) => s + r.amount, 0) * 100,
        ) / 100,
      totalCredit:
        Math.round(
          raw.filter((r) => r.kind === 'receipt').reduce((s, r) => s + r.amount, 0) * 100,
        ) / 100,
      closingBalance: Math.round(balance * 100) / 100,
    }
  }

  // ---------- 读：总览 ----------

  async getOverview(ctx: RequestContext): Promise<ReceivableOverview> {
    const all = await this.docs.find({
      where: { tenantId: ctx.tenantId, companyId: ctx.companyId, docType: 'sales_outbound' },
    })
    const today = new Date()
    let totalReceivable = 0
    let totalCollected = 0
    let overdueAmount = 0
    for (const d of all) {
      const total = toNum(d.totalAmount)
      const settled = toNum(d.settledAmount)
      totalCollected += settled
      const uncollected = Math.max(0, total - settled)
      totalReceivable += uncollected
      if (d.dueDate && uncollected > 0.005 && dayDiff(today, isoToDate(dateToISO(d.dueDate))) > 0) {
        overdueAmount += uncollected
      }
    }
    const receipts = await this.receipts.find({
      where: { tenantId: ctx.tenantId, companyId: ctx.companyId },
    })
    const receiptTotal = receipts.reduce((s, r) => s + toNum(r.amount), 0)
    return {
      totalReceivable: Math.round(totalReceivable * 100) / 100,
      totalCollected: Math.round(totalCollected * 100) / 100,
      overdueAmount: Math.round(overdueAmount * 100) / 100,
      receiptTotal: Math.round(receiptTotal * 100) / 100,
    }
  }

  // ---------- 内部工具 ----------

  private async loadApps(
    manager: EntityManager | Repository<ReceiptApplicationEntity>,
    receiptId: string,
    ctx: RequestContext,
  ): Promise<ReceiptApplicationView[]> {
    const repo =
      manager instanceof Repository ? manager : manager.getRepository(ReceiptApplicationEntity)
    const list = await repo.find({
      where: { receiptId, tenantId: ctx.tenantId, companyId: ctx.companyId },
    })
    const docIds = [...new Set(list.map((a) => a.docId))]
    const docs = docIds.length
      ? await this.docs.find({
          where: docIds.map((id) => ({ id, tenantId: ctx.tenantId, companyId: ctx.companyId })),
        })
      : []
    const docMap = new Map(docs.map((d) => [d.id, d]))
    return list.map((a) => {
      const d = docMap.get(a.docId)
      return {
        id: a.id,
        docId: a.docId,
        docNo: d?.docNo ?? '',
        appliedAmount: toNum(a.appliedAmount),
        docTotal: d ? toNum(d.totalAmount) : 0,
        docSettled: d ? toNum(d.settledAmount) : 0,
      }
    })
  }

  /**
   * 批量加载多张收款的核销明细（列表页用）
   *
   * 逐张调用 loadApps 会发出 2N+1 条 SQL（N 张收款 → N 次核销行 + N 次出库单），
   * 这里改为两次查询取回全部核销行与出库单，再按 receiptId / docId 建 Map 分组。
   *
   * @returns receiptId → 核销明细视图列表
   */
  private async loadAppsBatch(
    manager: EntityManager | Repository<ReceiptApplicationEntity>,
    receiptIds: string[],
    ctx: RequestContext,
  ): Promise<Map<string, ReceiptApplicationView[]>> {
    const result = new Map<string, ReceiptApplicationView[]>()
    if (receiptIds.length === 0) return result
    const repo =
      manager instanceof Repository ? manager : manager.getRepository(ReceiptApplicationEntity)
    const list = await repo.find({
      where: {
        receiptId: In(receiptIds),
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
      },
    })
    const docIds = [...new Set(list.map((a) => a.docId))]
    const docs = docIds.length
      ? await this.docs.find({
          where: docIds.map((id) => ({ id, tenantId: ctx.tenantId, companyId: ctx.companyId })),
        })
      : []
    const docMap = new Map(docs.map((d) => [d.id, d]))
    const byReceipt = new Map<string, ReceiptApplicationView[]>()
    for (const a of list) {
      const d = docMap.get(a.docId)
      const view: ReceiptApplicationView = {
        id: a.id,
        docId: a.docId,
        docNo: d?.docNo ?? '',
        appliedAmount: toNum(a.appliedAmount),
        docTotal: d ? toNum(d.totalAmount) : 0,
        docSettled: d ? toNum(d.settledAmount) : 0,
      }
      const arr = byReceipt.get(a.receiptId)
      if (arr) arr.push(view)
      else byReceipt.set(a.receiptId, [view])
    }
    for (const id of receiptIds) result.set(id, byReceipt.get(id) ?? [])
    return result
  }

  private toReceiptView(r: ReceiptEntity, applications: ReceiptApplicationView[]): ReceiptView {
    return {
      id: r.id,
      receiptNo: r.receiptNo,
      partnerId: r.partnerId,
      partnerName: r.partnerName,
      receiptDate: dateToISO(r.receiptDate),
      amount: toNum(r.amount),
      method: r.method,
      remark: r.remark,
      createdAt: r.createdAt,
      applications,
    }
  }

  private async nextReceiptNo(companyId: string): Promise<string> {
    const prefix = 'SK'
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const last = await this.receipts.findOne({
      where: { companyId, receiptNo: Like(`${prefix}${date}%`) },
      order: { receiptNo: 'DESC' },
    })
    let next = 1
    if (last) {
      const seq = Number(last.receiptNo.slice(prefix.length + 8))
      if (Number.isFinite(seq)) next = seq + 1
    }
    return `${prefix}${date}${String(next).padStart(4, '0')}`
  }
}
