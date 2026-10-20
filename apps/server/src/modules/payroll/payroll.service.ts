import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm'
import { Between, DataSource, Like, Repository, type EntityManager } from 'typeorm'
import { ErrorCode } from '@weftcount/shared'
import { withUniqueNo } from '../../common/util/unique-no'
import { UserEntity } from '../auth/entities/user.entity'
import { MachineEntity } from '../production/entities/machine.entity'
import { ProductionOrderEntity } from '../production/entities/production-order.entity'
import { ProductionReportEntity } from '../production/entities/production-report.entity'
import { WageProfileEntity } from './entities/wage-profile.entity'
import { WageSlipEntity, type WageSlipStatus } from './entities/wage-slip.entity'
import { WageSlipItemEntity } from './entities/wage-slip-item.entity'
import type { RequestContext } from '../auth/auth-context'

/** 金额/数量四舍五入为 decimal 字符串（先乘后除，避开二进制浮点误差） */
function num(n: number, scale: number): string {
  const f = 10 ** scale
  return String(Math.round((n + Number.EPSILON) * f) / f)
}
/** decimal 字符串 → number（空/异常记 0） */
function toNum(s: string | null | undefined): number {
  const v = Number(s ?? '0')
  return Number.isFinite(v) ? v : 0
}
/**
 * date 列转 YYYY-MM-DD
 *
 * 实体列标注 string，但 mysql 驱动运行时回的可能是 Date 对象——
 * `instanceof` 在 string 类型上 TS 直接报错，先 as unknown 再判。
 */
function dateToISO(v: string | null): string {
  if (!v) return ''
  return (v as unknown) instanceof Date ? (v as unknown as Date).toISOString().slice(0, 10) : String(v)
}
/** 当日 0 点的日期差（天）：a - b */
function dayDiff(a: Date, b: Date): number {
  const ms = 24 * 60 * 60 * 1000
  return Math.floor((a.setHours(0, 0, 0, 0) - b.setHours(0, 0, 0, 0)) / ms)
}

/** 生成工资单时被跳过的人及原因（不猜单价、不重复建单，逐个说明） */
export interface SkippedUser {
  userId: string
  realName: string
  reason: 'no_profile' | 'exists'
  outputM: number
  slipNo?: string
}

export interface WageProfileView {
  id: string
  userId: string
  username: string
  realName: string
  jobType: string
  baseWage: number
  unitPrice: number
  remark: string | null
}

export interface SlipItemView {
  id: string
  orderId: string
  orderNo: string
  machineId: string
  machineName: string
  outputM: number
  reportCount: number
  amount: number
}

export interface PayrollSlipView {
  id: string
  slipNo: string
  userId: string
  realName: string
  periodStart: string
  periodEnd: string
  totalOutputM: number
  reportCount: number
  stoppageMin: number
  baseAmount: number
  pieceAmount: number
  bonus: number
  deduction: number
  netAmount: number
  status: WageSlipStatus
  paidAt: Date | null
  remark: string | null
  createdAt: Date
  items: SlipItemView[]
}

/** 生成前预览：周期内每个有报工的人的聚合与预估价 */
export interface PeriodRow {
  userId: string
  username: string
  realName: string
  reportCount: number
  totalOutputM: number
  stoppageMin: number
  hasProfile: boolean
  unitPrice: number
  estimatedAmount: number
  slipNo: string | null
}

export interface PayrollOverview {
  profileCount: number
  draftCount: number
  confirmedCount: number
  pendingAmount: number
  paidAmount: number
}

@Injectable()
export class PayrollService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(WageProfileEntity) private readonly profiles: Repository<WageProfileEntity>,
    @InjectRepository(WageSlipEntity) private readonly slips: Repository<WageSlipEntity>,
    @InjectRepository(WageSlipItemEntity) private readonly items: Repository<WageSlipItemEntity>,
    @InjectRepository(ProductionReportEntity) private readonly reports: Repository<ProductionReportEntity>,
    @InjectRepository(ProductionOrderEntity) private readonly orders: Repository<ProductionOrderEntity>,
    @InjectRepository(MachineEntity) private readonly machines: Repository<MachineEntity>,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
  ) {}

  // ---------- 工资档案 ----------

  async createProfile(ctx: RequestContext, dto: { userId: string; jobType?: string; baseWage?: number; unitPrice: number; remark?: string | null }): Promise<WageProfileView> {
    const user = await this.users.findOne({ where: { id: dto.userId, tenantId: ctx.tenantId } })
    if (!user || !user.companyIds.includes(ctx.companyId)) {
      throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: '用户不存在或不属于本公司' })
    }
    const dup = await this.profiles.findOne({ where: { userId: dto.userId, companyId: ctx.companyId } })
    if (dup) {
      throw new BadRequestException({ code: ErrorCode.DUPLICATE_CODE, message: `「${user.realName}」已有工资档案` })
    }
    const saved = await this.profiles.save(this.profiles.create({
      tenantId: ctx.tenantId,
      companyId: ctx.companyId,
      userId: user.id,
      realName: user.realName,
      jobType: dto.jobType ?? '挡车工',
      baseWage: num(dto.baseWage ?? 0, 2),
      unitPrice: num(dto.unitPrice, 4),
      remark: dto.remark ?? null,
    }))
    return this.toProfileView(saved, user.username)
  }

  async updateProfile(ctx: RequestContext, id: string, dto: { jobType?: string; baseWage?: number; unitPrice?: number; remark?: string | null }): Promise<WageProfileView> {
    const p = await this.profiles.findOne({ where: { id, tenantId: ctx.tenantId, companyId: ctx.companyId } })
    if (!p) throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: '工资档案不存在' })
    if (dto.jobType !== undefined) p.jobType = dto.jobType
    if (dto.baseWage !== undefined) p.baseWage = num(dto.baseWage, 2)
    if (dto.unitPrice !== undefined) p.unitPrice = num(dto.unitPrice, 4)
    if (dto.remark !== undefined) p.remark = dto.remark ?? null
    const saved = await this.profiles.save(p)
    const user = await this.users.findOne({ where: { id: saved.userId } })
    return this.toProfileView(saved, user?.username ?? '')
  }

  async listProfiles(ctx: RequestContext, filter: { jobType?: string }): Promise<WageProfileView[]> {
    const where: Record<string, unknown> = { tenantId: ctx.tenantId, companyId: ctx.companyId }
    if (filter.jobType) where.jobType = filter.jobType
    const rows = await this.profiles.find({ where, order: { createdAt: 'ASC' } })
    const userIds = [...new Set(rows.map((r) => r.userId))]
    const users = userIds.length ? await this.users.find({ where: userIds.map((id) => ({ id })) }) : []
    const nameMap = new Map(users.map((u) => [u.id, u.username]))
    return rows.map((r) => this.toProfileView(r, nameMap.get(r.userId) ?? ''))
  }

  // ---------- 生成前预览 ----------

  /**
   * 周期报工聚合预览：生成工资单前先让人看清「这周期每人多少米、预估多少钱」
   *
   * 与 generateSlips 用同一套聚合口径，保证预览与实生成一致——
   * 不一致的预览比没有预览更坏（按预览发下来的钱对不上）。
   */
  async previewPeriod(ctx: RequestContext, periodStart: string, periodEnd: string): Promise<PeriodRow[]> {
    const { spans, profileByUser, existingByUser } = await this.loadPeriodData(ctx, periodStart, periodEnd)
    const rows: PeriodRow[] = []
    for (const span of spans.values()) {
      const profile = profileByUser.get(span.userId)
      const existing = existingByUser.get(span.userId)
      rows.push({
        userId: span.userId,
        username: span.username,
        realName: span.realName,
        reportCount: span.reportCount,
        totalOutputM: Math.round(span.outputM * 1000) / 1000,
        stoppageMin: span.stoppageMin,
        hasProfile: Boolean(profile),
        unitPrice: profile ? toNum(profile.unitPrice) : 0,
        estimatedAmount: profile ? Math.round(span.outputM * toNum(profile.unitPrice) * 100) / 100 : 0,
        slipNo: existing?.slipNo ?? null,
      })
    }
    return rows.sort((a, b) => b.totalOutputM - a.totalOutputM)
  }

  // ---------- 生成工资单 ----------

  /**
   * 按周期批量生成工资单
   *
   * 事务保证：工资单 + 计件明细同生同滚，没有「单头建了明细没建」的中间态。
   * 三条硬规则：
   * 1. 无档案的人有报工 → 跳过并说明，不猜单价（猜出来的工资对不上账）
   * 2. 周期内已有单的用户 → 跳过（幂等），唯一键兜底防并发重复
   * 3. 金额全部服务端算：明细按「每行米数 × 单价」逐行舍入再累加，表头 piece = Σ明细，
   *    前端提交不了任何金额
   */
  async generateSlips(ctx: RequestContext, dto: { periodStart: string; periodEnd: string; remark?: string | null }): Promise<{ created: PayrollSlipView[]; skipped: SkippedUser[] }> {
    const { periodStart, periodEnd } = dto
    if (periodStart > periodEnd) {
      throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: '结算周期起不得晚于止' })
    }
    const spanDays = dayDiff(new Date(periodEnd), new Date(periodStart))
    if (spanDays > 62) {
      throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: '结算周期跨度不能超过 62 天（防误选长周期）' })
    }

    return withUniqueNo(async () => {
      return this.dataSource.transaction(async (manager) => {
        const { spans, profileByUser, existingByUser } = await this.loadPeriodData(ctx, periodStart, periodEnd, manager)
        const created: PayrollSlipView[] = []
        const skipped: SkippedUser[] = []

        for (const span of spans.values()) {
          const profile = profileByUser.get(span.userId)
          if (!profile) {
            skipped.push({ userId: span.userId, realName: span.realName, reason: 'no_profile', outputM: round3(span.outputM) })
            continue
          }
          const existing = existingByUser.get(span.userId)
          if (existing) {
            skipped.push({ userId: span.userId, realName: span.realName, reason: 'exists', outputM: round3(span.outputM), slipNo: existing.slipNo })
            continue
          }
          const slip = await this.createOneSlip(manager, ctx, { profile, span, periodStart, periodEnd, remark: dto.remark ?? null })
          created.push(slip)
        }
        return { created, skipped }
      })
    })
  }

  // ---------- 工资单读 ----------

  async listSlips(ctx: RequestContext, filter: { status?: WageSlipStatus; userId?: string; periodStart?: string; periodEnd?: string }): Promise<PayrollSlipView[]> {
    const where: Record<string, unknown> = { tenantId: ctx.tenantId, companyId: ctx.companyId }
    if (filter.status) where.status = filter.status
    if (filter.userId) where.userId = filter.userId
    if (filter.periodStart) where.periodStart = Between(filter.periodStart, filter.periodEnd ?? '9999-12-31')
    else if (filter.periodEnd) where.periodStart = Between('0000-01-01', filter.periodEnd)
    const rows = await this.slips.find({ where, order: { periodStart: 'DESC', createdAt: 'DESC' } })
    const views = await Promise.all(rows.map(async (r) => this.toSlipView(r, await this.loadItems(this.slips.manager, r.id, ctx))))
    return views
  }

  async getSlip(ctx: RequestContext, id: string): Promise<PayrollSlipView> {
    const s = await this.slips.findOne({ where: { id, tenantId: ctx.tenantId, companyId: ctx.companyId } })
    if (!s) throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: '工资单不存在' })
    return this.toSlipView(s, await this.loadItems(this.slips.manager, s.id, ctx))
  }

  // ---------- 工资单状态推进 ----------

  /** 改奖金/扣款/备注（仅 draft；confirmed/paid 已锁定——改了就是对凭证造假） */
  async updateSlip(ctx: RequestContext, id: string, dto: { bonus?: number; deduction?: number; remark?: string | null }): Promise<PayrollSlipView> {
    const s = await this.slips.findOne({ where: { id, tenantId: ctx.tenantId, companyId: ctx.companyId } })
    if (!s) throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: '工资单不存在' })
    if (s.status !== 'draft') {
      throw new BadRequestException({ code: ErrorCode.ORDER_STATUS_INVALID, message: '只有草稿状态的工资单可修改' })
    }
    if (dto.bonus !== undefined) s.bonus = num(dto.bonus, 2)
    if (dto.deduction !== undefined) s.deduction = num(dto.deduction, 2)
    if (dto.remark !== undefined) s.remark = dto.remark ?? null
    s.netAmount = num(toNum(s.baseAmount) + toNum(s.pieceAmount) + toNum(s.bonus) - toNum(s.deduction), 2)
    const saved = await this.slips.save(s)
    return this.toSlipView(saved, await this.loadItems(this.slips.manager, saved.id, ctx))
  }

  /** 核算确认：draft → confirmed，锁定明细与金额 */
  async confirmSlip(ctx: RequestContext, id: string): Promise<PayrollSlipView> {
    const s = await this.slips.findOne({ where: { id, tenantId: ctx.tenantId, companyId: ctx.companyId } })
    if (!s) throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: '工资单不存在' })
    if (s.status !== 'draft') {
      throw new BadRequestException({ code: ErrorCode.ORDER_STATUS_INVALID, message: '只有草稿状态的工资单可确认' })
    }
    s.status = 'confirmed'
    const saved = await this.slips.save(s)
    return this.toSlipView(saved, await this.loadItems(this.slips.manager, saved.id, ctx))
  }

  /** 发放：confirmed → paid，记发放时间（资金动作，不可回退） */
  async paySlip(ctx: RequestContext, id: string): Promise<PayrollSlipView> {
    const s = await this.slips.findOne({ where: { id, tenantId: ctx.tenantId, companyId: ctx.companyId } })
    if (!s) throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: '工资单不存在' })
    if (s.status !== 'confirmed') {
      throw new BadRequestException({ code: ErrorCode.ORDER_STATUS_INVALID, message: '只有已确认的工资单可发放' })
    }
    s.status = 'paid'
    s.paidAt = new Date()
    const saved = await this.slips.save(s)
    return this.toSlipView(saved, await this.loadItems(this.slips.manager, saved.id, ctx))
  }

  /** 删除草稿单（连同明细）。confirmed/paid 是资金凭据，不留「删了又生成」的洞账 */
  async deleteSlip(ctx: RequestContext, id: string): Promise<void> {
    const s = await this.slips.findOne({ where: { id, tenantId: ctx.tenantId, companyId: ctx.companyId } })
    if (!s) throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: '工资单不存在' })
    if (s.status !== 'draft') {
      throw new BadRequestException({ code: ErrorCode.ORDER_STATUS_INVALID, message: '只有草稿状态的工资单可删除' })
    }
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(WageSlipItemEntity, { slipId: s.id, tenantId: ctx.tenantId, companyId: ctx.companyId })
      await manager.delete(WageSlipEntity, { id: s.id })
    })
  }

  // ---------- 总览 ----------

  async getOverview(ctx: RequestContext): Promise<PayrollOverview> {
    const profileCount = await this.profiles.count({ where: { tenantId: ctx.tenantId, companyId: ctx.companyId } })
    const all = await this.slips.find({ where: { tenantId: ctx.tenantId, companyId: ctx.companyId } })
    let draftCount = 0
    let confirmedCount = 0
    let pendingAmount = 0
    let paidAmount = 0
    for (const s of all) {
      if (s.status === 'draft') { draftCount++; pendingAmount += toNum(s.netAmount) }
      else if (s.status === 'confirmed') { confirmedCount++; pendingAmount += toNum(s.netAmount) }
      else paidAmount += toNum(s.netAmount)
    }
    return {
      profileCount,
      draftCount,
      confirmedCount,
      pendingAmount: round2(pendingAmount),
      paidAmount: round2(paidAmount),
    }
  }

  // ---------- 内部：周期数据加载（预览与生成共用同一口径） ----------

  private async loadPeriodData(ctx: RequestContext, periodStart: string, periodEnd: string, manager?: EntityManager): Promise<{
    spans: Map<string, UserSpan>
    profileByUser: Map<string, WageProfileEntity>
    existingByUser: Map<string, WageSlipEntity>
  }> {
    const profiles = await this.profiles.find({ where: { tenantId: ctx.tenantId, companyId: ctx.companyId } })
    const profileByUser = new Map(profiles.map((p) => [p.userId, p]))

    const reports = await this.reports.find({
      where: { tenantId: ctx.tenantId, companyId: ctx.companyId, reportDate: Between(periodStart, periodEnd) },
    })

    // 工单号与机台名：从报工反查一次，明细里冗余快照，工资单不依赖生产库
    const orderIds = [...new Set(reports.map((r) => r.orderId))]
    const orders = orderIds.length
      ? await this.orders.find({ where: orderIds.map((id) => ({ id, tenantId: ctx.tenantId, companyId: ctx.companyId })) })
      : []
    const orderMap = new Map(orders.map((o) => [o.id, o]))
    const machineIds = [...new Set(orders.map((o) => o.machineId as string).filter(Boolean))]
    const machines = machineIds.length
      ? await this.machines.find({ where: machineIds.map((id) => ({ id, tenantId: ctx.tenantId, companyId: ctx.companyId })) })
      : []
    const machineMap = new Map(machines.map((m) => [m.id, m]))

    // 报工人信息：operatorId 是登录账号，期末可能改名/停用——用账号 id 兜底取名
    const operatorIds = [...new Set(reports.map((r) => r.operatorId))]
    const users = operatorIds.length
      ? await this.users.find({ where: operatorIds.map((id) => ({ id, tenantId: ctx.tenantId })) })
      : []
    const userMap = new Map(users.map((u) => [u.id, u]))

    const spans = new Map<string, UserSpan>()
    for (const r of reports) {
      let span = spans.get(r.operatorId)
      if (!span) {
        const u = userMap.get(r.operatorId)
        span = {
          userId: r.operatorId,
          username: u?.username ?? r.operatorId,
          realName: u?.realName ?? '未知用户',
          reportCount: 0,
          outputM: 0,
          stoppageMin: 0,
          byOrder: new Map(),
        }
        spans.set(r.operatorId, span)
      }
      span.reportCount += 1
      span.outputM += toNum(r.outputM)
      span.stoppageMin += r.stoppageMinutes ?? 0
      const o = orderMap.get(r.orderId)
      const machine = o?.machineId ? machineMap.get(o.machineId as string) : undefined
      const key = r.orderId
      let line = span.byOrder.get(key)
      if (!line) {
        line = {
          orderId: r.orderId,
          orderNo: o?.orderNo ?? '',
          machineId: o?.machineId ?? '',
          machineName: machine?.name ?? '',
          outputM: 0,
          reportCount: 0,
        }
        span.byOrder.set(key, line)
      }
      line.outputM += toNum(r.outputM)
      line.reportCount += 1
    }

    const existing = await (manager ?? this.slips.manager).find(WageSlipEntity, {
      where: {
        tenantId: ctx.tenantId, companyId: ctx.companyId,
        periodStart, periodEnd,
      },
    })
    const existingByUser = new Map(existing.map((s) => [s.userId, s]))
    return { spans, profileByUser, existingByUser }
  }

  /** 事务内为一个人建一张工资单：单号撞了整体重试，明细金额逐行舍入后累加 */
  private async createOneSlip(
    manager: EntityManager,
    ctx: RequestContext,
    input: { profile: WageProfileEntity; span: UserSpan; periodStart: string; periodEnd: string; remark: string | null },
  ): Promise<PayrollSlipView> {
    const { profile, span } = input
    const unitPrice = toNum(profile.unitPrice)
    const itemRows = [...span.byOrder.values()]
      .map((line) => {
        const outputMRound = round3(line.outputM)
        return {
          orderId: line.orderId,
          orderNo: line.orderNo,
          machineId: line.machineId,
          machineName: line.machineName,
          outputM: outputMRound,
          reportCount: line.reportCount,
          amount: round2(outputMRound * unitPrice),
        }
      })
      .sort((a, b) => b.amount - a.amount)
    const pieceAmount = round2(itemRows.reduce((s, i) => s + i.amount, 0))
    const slipNo = await this.nextSlipNo(manager, ctx.companyId)

    const saved = await manager.save(manager.create(WageSlipEntity, {
      tenantId: ctx.tenantId,
      companyId: ctx.companyId,
      slipNo,
      userId: span.userId,
      realName: span.realName,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      totalOutputM: num(span.outputM, 3),
      reportCount: span.reportCount,
      stoppageMin: span.stoppageMin,
      baseAmount: profile.baseWage,
      pieceAmount: num(pieceAmount, 2),
      bonus: '0.00',
      deduction: '0.00',
      netAmount: num(toNum(profile.baseWage) + pieceAmount, 2),
      status: 'draft',
      remark: input.remark,
    }))

    for (const row of itemRows) {
      await manager.save(manager.create(WageSlipItemEntity, {
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        slipId: saved.id,
        orderId: row.orderId,
        orderNo: row.orderNo,
        machineId: row.machineId,
        machineName: row.machineName,
        outputM: num(row.outputM, 3),
        reportCount: row.reportCount,
        amount: num(row.amount, 2),
      }))
    }
    const items = await this.loadItems(manager, saved.id, ctx)
    return this.toSlipView(saved, items)
  }

  private async loadItems(manager: EntityManager | Repository<WageSlipItemEntity>, slipId: string, ctx: RequestContext): Promise<SlipItemView[]> {
    const repo = manager instanceof Repository ? manager : manager.getRepository(WageSlipItemEntity)
    const list = await repo.find({ where: { slipId, tenantId: ctx.tenantId, companyId: ctx.companyId }, order: { createdAt: 'ASC' } })
    return list.map((i) => ({
      id: i.id,
      orderId: i.orderId,
      orderNo: i.orderNo,
      machineId: i.machineId,
      machineName: i.machineName,
      outputM: toNum(i.outputM),
      reportCount: i.reportCount,
      amount: toNum(i.amount),
    }))
  }

  private toProfileView(p: WageProfileEntity, username: string): WageProfileView {
    return {
      id: p.id,
      userId: p.userId,
      username,
      realName: p.realName,
      jobType: p.jobType,
      baseWage: toNum(p.baseWage),
      unitPrice: toNum(p.unitPrice),
      remark: p.remark,
    }
  }

  private toSlipView(s: WageSlipEntity, items: SlipItemView[]): PayrollSlipView {
    return {
      id: s.id,
      slipNo: s.slipNo,
      userId: s.userId,
      realName: s.realName,
      periodStart: dateToISO(s.periodStart),
      periodEnd: dateToISO(s.periodEnd),
      totalOutputM: toNum(s.totalOutputM),
      reportCount: s.reportCount,
      stoppageMin: s.stoppageMin,
      baseAmount: toNum(s.baseAmount),
      pieceAmount: toNum(s.pieceAmount),
      bonus: toNum(s.bonus),
      deduction: toNum(s.deduction),
      netAmount: toNum(s.netAmount),
      status: s.status,
      paidAt: s.paidAt,
      remark: s.remark,
      createdAt: s.createdAt,
      items,
    }
  }

  private async nextSlipNo(manager: EntityManager, companyId: string): Promise<string> {
    const prefix = 'GZ'
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const last = await manager.findOne(WageSlipEntity, {
      where: { companyId, slipNo: Like(`${prefix}${date}%`) },
      order: { slipNo: 'DESC' },
    })
    let next = 1
    if (last) {
      const seq = Number(last.slipNo.slice(prefix.length + 8))
      if (Number.isFinite(seq)) next = seq + 1
    }
    return `${prefix}${date}${String(next).padStart(4, '0')}`
  }
}

interface UserSpan {
  userId: string
  username: string
  realName: string
  reportCount: number
  outputM: number
  stoppageMin: number
  byOrder: Map<string, {
    orderId: string
    orderNo: string
    machineId: string
    machineName: string
    outputM: number
    reportCount: number
  }>
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000
}
