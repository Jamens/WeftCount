import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm'
import { DataSource, type EntityManager, Like, Repository } from 'typeorm'
import { ErrorCode } from '@weftcount/shared'
import { MachineEntity } from '../production/entities/machine.entity'
import { MaintenancePlanEntity, type MaintenanceCycleType, type MaintenancePlanType } from './entities/maintenance-plan.entity'
import { MaintenanceRecordEntity, type MaintenanceRecordType, type MaintenanceResult } from './entities/maintenance-record.entity'
import { SparePartEntity } from './entities/spare-part.entity'
import { MaintenanceSparePartEntity } from './entities/maintenance-spare-part.entity'
import type { RequestContext } from '../auth/auth-context'
import { withUniqueNo } from '../../common/util/unique-no'

/** decimal 字符串四舍五入 */
function num(n: number, scale: number): string {
  const f = 10 ** scale
  return String(Math.round((n + Number.EPSILON) * f) / f)
}
/** decimal 字符串 → number（空/异常记 0） */
function toNum(s: string | number | null | undefined): number {
  const v = Number(s ?? '0')
  return Number.isFinite(v) ? v : 0
}
/** 'YYYY-MM-DD' 的本地 0 点 */
function atMidnight(d: string | Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
/** 当天 0 点的日期差（天）：a - b */
function dayDiff(a: Date, b: Date): number {
  return Math.floor((atMidnight(a).getTime() - atMidnight(b).getTime()) / 86400000)
}

export interface SpareUsageView {
  id: string
  partId: string
  partName: string
  qty: number
  cost: number
}

export interface PlanView {
  id: string
  planNo: string
  machineId: string
  machineName: string
  machineCode: string
  planName: string
  type: MaintenancePlanType
  cycleType: MaintenanceCycleType
  cycleValue: number
  lastDoneDate: string | null
  nextDueDate: string | null
  responsible: string | null
  status: 'active' | 'paused'
  remark: string | null
  createdAt: Date
}

export interface RecordView {
  id: string
  recordNo: string
  machineId: string
  machineName: string
  planId: string | null
  planName: string | null
  type: MaintenanceRecordType
  category: string
  date: string
  operatorId: string | null
  operatorName: string | null
  durationMin: number | null
  downtimeMin: number | null
  cost: number
  result: MaintenanceResult
  remark: string | null
  spareParts: SpareUsageView[]
  createdAt: Date
}

export interface SparePartView {
  id: string
  partCode: string
  name: string
  spec: string | null
  unit: string
  stock: number
  minStock: number
  location: string | null
  remark: string | null
  lowStock: boolean
}

export interface MaintenanceOverview {
  totalMachines: number
  activePlans: number
  dueSoonPlans: number
  overduePlans: number
  breakdownThisMonth: number
  lowStockParts: number
}

export interface MtbfRow {
  machineId: string
  machineName: string
  breakdownCount: number
  totalDowntimeMin: number
  mtbfDays: number | null
  lastBreakdownDate: string | null
}

@Injectable()
export class MaintenanceService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(MaintenancePlanEntity) private readonly plans: Repository<MaintenancePlanEntity>,
    @InjectRepository(MaintenanceRecordEntity) private readonly records: Repository<MaintenanceRecordEntity>,
    @InjectRepository(SparePartEntity) private readonly parts: Repository<SparePartEntity>,
    @InjectRepository(MaintenanceSparePartEntity) private readonly usages: Repository<MaintenanceSparePartEntity>,
    @InjectRepository(MachineEntity) private readonly machines: Repository<MachineEntity>,
  ) {}

  // ---------- 写：保养计划 ----------

  async createPlan(ctx: RequestContext, dto: {
    machineId: string
    planName: string
    type?: MaintenancePlanType
    cycleType?: MaintenanceCycleType
    cycleValue?: number
    lastDoneDate?: string | null
    responsible?: string | null
    remark?: string | null
  }): Promise<PlanView> {
    const machine = await this.machines.findOne({
      where: { id: dto.machineId, tenantId: ctx.tenantId, companyId: ctx.companyId },
    })
    if (!machine) throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: '机台不存在' })

    return withUniqueNo(async () => {
      return this.dataSource.transaction(async (manager) => {
        const planNo = await this.nextPlanNo(ctx.companyId)
        const cycleType = dto.cycleType ?? 'day'
        const cycleValue = dto.cycleValue ?? 1
        const lastDone = dto.lastDoneDate ?? null
        const plan = manager.create(MaintenancePlanEntity, {
          tenantId: ctx.tenantId,
          companyId: ctx.companyId,
          planNo,
          machineId: machine.id,
          planName: dto.planName,
          type: dto.type ?? 'inspect',
          cycleType,
          cycleValue,
          lastDoneDate: lastDone,
          nextDueDate: this.computeNextDueDate(lastDone, cycleType, cycleValue),
          responsible: dto.responsible ?? null,
          status: 'active',
          remark: dto.remark ?? null,
        })
        const saved = await manager.save(plan)
        return this.toPlanView(saved, machine.name, machine.code)
      })
    })
  }

  async updatePlan(ctx: RequestContext, id: string, dto: {
    planName?: string
    type?: MaintenancePlanType
    cycleType?: MaintenanceCycleType
    cycleValue?: number
    lastDoneDate?: string | null
    nextDueDate?: string | null
    responsible?: string | null
    status?: 'active' | 'paused'
    remark?: string | null
  }): Promise<PlanView> {
    const plan = await this.plans.findOne({ where: { id, tenantId: ctx.tenantId, companyId: ctx.companyId } })
    if (!plan) throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: '保养计划不存在' })

    if (dto.planName !== undefined) plan.planName = dto.planName
    if (dto.type !== undefined) plan.type = dto.type
    if (dto.cycleType !== undefined) plan.cycleType = dto.cycleType
    if (dto.cycleValue !== undefined) plan.cycleValue = dto.cycleValue
    if (dto.lastDoneDate !== undefined) plan.lastDoneDate = dto.lastDoneDate
    if (dto.responsible !== undefined) plan.responsible = dto.responsible
    if (dto.status !== undefined) plan.status = dto.status
    if (dto.remark !== undefined) plan.remark = dto.remark

    // 到期日：显式传则用之；否则改了基准/周期就重算（按天循环）
    if (dto.nextDueDate !== undefined) {
      plan.nextDueDate = dto.nextDueDate
    } else if (dto.lastDoneDate !== undefined || dto.cycleType !== undefined || dto.cycleValue !== undefined) {
      const base = plan.lastDoneDate
      plan.nextDueDate = this.computeNextDueDate(base, plan.cycleType, plan.cycleValue)
    }

    const saved = await this.plans.save(plan)
    const machine = await this.machines.findOne({ where: { id: plan.machineId, tenantId: ctx.tenantId, companyId: ctx.companyId } })
    return this.toPlanView(saved, machine?.name ?? '', machine?.code ?? '')
  }

  async listPlans(ctx: RequestContext, filter: {
    machineId?: string
    status?: 'active' | 'paused'
    dueSoon?: number
    page?: number
    pageSize?: number
  }): Promise<{ records: PlanView[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(1, filter.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 20))
    const where: Record<string, unknown> = { tenantId: ctx.tenantId, companyId: ctx.companyId }
    if (filter.machineId) where.machineId = filter.machineId
    if (filter.status) where.status = filter.status

    const [rows, total] = await this.plans.findAndCount({
      where,
      order: { nextDueDate: 'ASC', createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    })
    const names = await this.loadMachineNames(ctx, rows.map((r) => r.machineId))
    let views = rows.map((p) => this.toPlanView(p, names.get(p.machineId)?.name ?? '', names.get(p.machineId)?.code ?? ''))

    if (filter.dueSoon !== undefined) {
      const horizon = atMidnight(new Date())
      horizon.setDate(horizon.getDate() + Math.max(0, filter.dueSoon))
      views = views.filter((v) => {
        if (v.status !== 'active' || !v.nextDueDate) return false
        const d = atMidnight(v.nextDueDate)
        return d.getTime() <= horizon.getTime()
      })
    }
    return { records: views, total, page, pageSize }
  }

  async getPlan(ctx: RequestContext, id: string): Promise<PlanView> {
    const p = await this.plans.findOne({ where: { id, tenantId: ctx.tenantId, companyId: ctx.companyId } })
    if (!p) throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: '保养计划不存在' })
    const m = await this.machines.findOne({ where: { id: p.machineId, tenantId: ctx.tenantId, companyId: ctx.companyId } })
    return this.toPlanView(p, m?.name ?? '', m?.code ?? '')
  }

  // ---------- 写：维保执行 / 故障停机 ----------

  async createRecord(ctx: RequestContext, dto: {
    machineId: string
    planId?: string | null
    type?: MaintenanceRecordType
    category: string
    date: string
    durationMin?: number | null
    downtimeMin?: number | null
    cost?: number
    result?: MaintenanceResult
    remark?: string | null
    spareParts?: { partId: string; qty: number; cost: number }[]
  }): Promise<RecordView> {
    const machine = await this.machines.findOne({
      where: { id: dto.machineId, tenantId: ctx.tenantId, companyId: ctx.companyId },
    })
    if (!machine) throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: '机台不存在' })

    let plan: MaintenancePlanEntity | null = null
    if (dto.planId) {
      plan = await this.plans.findOne({ where: { id: dto.planId, tenantId: ctx.tenantId, companyId: ctx.companyId } })
      if (!plan) throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: '关联的保养计划不存在' })
    }

    return withUniqueNo(async () => {
      return this.dataSource.transaction(async (manager) => {
        const recordNo = await this.nextRecordNo(ctx.companyId)
        const type = dto.type ?? (plan ? 'planned' : 'breakdown')
        const record = manager.create(MaintenanceRecordEntity, {
          tenantId: ctx.tenantId,
          companyId: ctx.companyId,
          recordNo,
          machineId: machine.id,
          planId: plan ? plan.id : null,
          type,
          category: dto.category,
          date: dto.date,
          operatorId: ctx.userId,
          operatorName: ctx.realName ?? ctx.username,
          durationMin: dto.durationMin ?? null,
          downtimeMin: dto.downtimeMin ?? null,
          cost: num(dto.cost ?? 0, 2),
          result: dto.result ?? 'ok',
          remark: dto.remark ?? null,
        })
        const saved = await manager.save(record)

        // 备件耗用：扣减库存
        const usageViews: SpareUsageView[] = []
        if (dto.spareParts && dto.spareParts.length) {
          for (const u of dto.spareParts) {
            const part = await manager.findOne(SparePartEntity, {
              where: { id: u.partId, tenantId: ctx.tenantId, companyId: ctx.companyId },
            })
            if (!part) throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: '备件不存在' })
            const newStock = toNum(part.stock) - u.qty
            if (newStock < -0.001) {
              throw new BadRequestException({
                code: ErrorCode.VALIDATION_FAILED,
                message: `备件「${part.name}」库存不足：当前 ${num(toNum(part.stock), 2)}，需 ${num(u.qty, 2)}`,
              })
            }
            part.stock = num(newStock, 2)
            await manager.save(part)
            const urow = await manager.save(manager.create(MaintenanceSparePartEntity, {
              tenantId: ctx.tenantId,
              companyId: ctx.companyId,
              recordId: saved.id,
              partId: part.id,
              qty: num(u.qty, 2),
              cost: num(u.cost, 2),
            }))
            usageViews.push({ id: urow.id, partId: part.id, partName: part.name, qty: u.qty, cost: u.cost })
          }
        }

        // 回写计划：本次日期作为上次执行，顺延下次到期
        if (plan) {
          plan.lastDoneDate = dto.date
          plan.nextDueDate = this.computeNextDueDate(dto.date, plan.cycleType, plan.cycleValue)
          await manager.save(plan)
        }
        // 回写机台最近维保日期
        machine.lastMaintenanceDate = dto.date
        await manager.save(machine)

        return { saved, usageViews }
      })
    }).then(async ({ saved, usageViews }) => {
      const m = await this.machines.findOne({ where: { id: saved.machineId, tenantId: ctx.tenantId, companyId: ctx.companyId } })
      const pName = dto.planId ? (await this.plans.findOne({ where: { id: dto.planId, tenantId: ctx.tenantId, companyId: ctx.companyId } }))?.planName ?? null : null
      return this.toRecordView(saved, usageViews, m?.name ?? '', pName)
    })
  }

  async listRecords(ctx: RequestContext, filter: {
    machineId?: string
    type?: MaintenanceRecordType
    from?: string
    to?: string
    page?: number
    pageSize?: number
  }): Promise<{ records: RecordView[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(1, filter.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 20))
    const where: Record<string, unknown> = { tenantId: ctx.tenantId, companyId: ctx.companyId }
    if (filter.machineId) where.machineId = filter.machineId
    if (filter.type) where.type = filter.type
    if (filter.from || filter.to) {
      where.date = {}
      if (filter.from) (where.date as Record<string, unknown>).gte = filter.from
      if (filter.to) (where.date as Record<string, unknown>).lte = filter.to
    }
    const [rows, total] = await this.records.findAndCount({
      where,
      order: { date: 'DESC', createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    })
    const names = await this.loadMachineNames(ctx, rows.map((r) => r.machineId))
    const planNames = await this.loadPlanNames(ctx, rows.map((r) => r.planId).filter((x): x is string => !!x))
    const usages = await this.loadUsages(ctx, rows.map((r) => r.id))
    return {
      records: rows.map((r) => this.toRecordView(
        r,
        usages.get(r.id) ?? [],
        names.get(r.machineId)?.name ?? '',
        r.planId ? (planNames.get(r.planId) ?? null) : null,
      )),
      total,
      page,
      pageSize,
    }
  }

  async getRecord(ctx: RequestContext, id: string): Promise<RecordView> {
    const r = await this.records.findOne({ where: { id, tenantId: ctx.tenantId, companyId: ctx.companyId } })
    if (!r) throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: '维保记录不存在' })
    const m = await this.machines.findOne({ where: { id: r.machineId, tenantId: ctx.tenantId, companyId: ctx.companyId } })
    const pName = r.planId
      ? (await this.plans.findOne({ where: { id: r.planId, tenantId: ctx.tenantId, companyId: ctx.companyId } }))?.planName ?? null
      : null
    const us = await this.loadUsages(ctx, [r.id])
    return this.toRecordView(r, us.get(r.id) ?? [], m?.name ?? '', pName)
  }

  // ---------- 写：备件 ----------

  async createSparePart(ctx: RequestContext, dto: {
    partCode: string
    name: string
    spec?: string | null
    unit?: string
    stock?: number
    minStock?: number
    location?: string | null
    remark?: string | null
  }): Promise<SparePartView> {
    const dup = await this.parts.findOne({
      where: { partCode: dto.partCode, tenantId: ctx.tenantId, companyId: ctx.companyId },
    })
    if (dup) throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: `备件编码「${dto.partCode}」已存在` })
    const part = this.parts.create({
      tenantId: ctx.tenantId,
      companyId: ctx.companyId,
      partCode: dto.partCode,
      name: dto.name,
      spec: dto.spec ?? null,
      unit: dto.unit ?? '个',
      stock: num(dto.stock ?? 0, 2),
      minStock: num(dto.minStock ?? 0, 2),
      location: dto.location ?? null,
      remark: dto.remark ?? null,
    })
    const saved = await this.parts.save(part)
    return this.toPartView(saved)
  }

  async updateSparePart(ctx: RequestContext, id: string, dto: {
    name?: string
    spec?: string | null
    unit?: string
    stock?: number
    minStock?: number
    location?: string | null
    remark?: string | null
  }): Promise<SparePartView> {
    const part = await this.parts.findOne({ where: { id, tenantId: ctx.tenantId, companyId: ctx.companyId } })
    if (!part) throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: '备件不存在' })
    if (dto.name !== undefined) part.name = dto.name
    if (dto.spec !== undefined) part.spec = dto.spec
    if (dto.unit !== undefined) part.unit = dto.unit
    if (dto.stock !== undefined) part.stock = num(dto.stock, 2)
    if (dto.minStock !== undefined) part.minStock = num(dto.minStock, 2)
    if (dto.location !== undefined) part.location = dto.location
    if (dto.remark !== undefined) part.remark = dto.remark
    const saved = await this.parts.save(part)
    return this.toPartView(saved)
  }

  async listSpareParts(ctx: RequestContext, filter: {
    lowStock?: number
    page?: number
    pageSize?: number
  }): Promise<{ records: SparePartView[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(1, filter.page ?? 1)
    const pageSize = Math.min(200, Math.max(1, filter.pageSize ?? 50))
    const where: Record<string, unknown> = { tenantId: ctx.tenantId, companyId: ctx.companyId }
    const [rows, total] = await this.parts.findAndCount({
      where,
      order: { partCode: 'ASC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    })
    let views = rows.map((p) => this.toPartView(p))
    if (filter.lowStock !== undefined) {
      views = views.filter((v) => v.stock < v.minStock + Number.EPSILON)
    }
    return { records: views, total, page, pageSize }
  }

  async getSparePart(ctx: RequestContext, id: string): Promise<SparePartView> {
    const p = await this.parts.findOne({ where: { id, tenantId: ctx.tenantId, companyId: ctx.companyId } })
    if (!p) throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: '备件不存在' })
    return this.toPartView(p)
  }

  // ---------- 读：总览 / MTBF ----------

  async getOverview(ctx: RequestContext): Promise<MaintenanceOverview> {
    const machines = await this.machines.find({
      where: { tenantId: ctx.tenantId, companyId: ctx.companyId },
    })
    const totalMachines = machines.filter((m) => m.status !== 'retired').length

    const plans = await this.plans.find({ where: { tenantId: ctx.tenantId, companyId: ctx.companyId } })
    const activePlans = plans.filter((p) => p.status === 'active').length
    const today = atMidnight(new Date())
    const dueSoonHorizon = atMidnight(new Date())
    dueSoonHorizon.setDate(dueSoonHorizon.getDate() + 7)
    let dueSoonPlans = 0
    let overduePlans = 0
    for (const p of plans) {
      if (p.status !== 'active' || !p.nextDueDate) continue
      const d = atMidnight(p.nextDueDate)
      if (d.getTime() < today.getTime()) overduePlans++
      else if (d.getTime() <= dueSoonHorizon.getTime()) dueSoonPlans++
    }

    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10)
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10)
    const breakdowns = await this.records.find({
      where: { tenantId: ctx.tenantId, companyId: ctx.companyId, type: 'breakdown' },
    })
    const breakdownThisMonth = breakdowns.filter((r) => r.date >= startOfMonth && r.date <= endOfMonth).length

    const parts = await this.parts.find({ where: { tenantId: ctx.tenantId, companyId: ctx.companyId } })
    const lowStockParts = parts.filter((p) => toNum(p.stock) < toNum(p.minStock) - 0.001).length

    return { totalMachines, activePlans, dueSoonPlans, overduePlans, breakdownThisMonth, lowStockParts }
  }

  async getMtbf(ctx: RequestContext): Promise<MtbfRow[]> {
    const breakdowns = await this.records.find({
      where: { tenantId: ctx.tenantId, companyId: ctx.companyId, type: 'breakdown' },
      order: { date: 'ASC' },
    })
    const names = await this.loadMachineNames(ctx, [...new Set(breakdowns.map((r) => r.machineId))])
    const byMachine = new Map<string, MaintenanceRecordEntity[]>()
    for (const r of breakdowns) {
      const arr = byMachine.get(r.machineId) ?? []
      arr.push(r)
      byMachine.set(r.machineId, arr)
    }
    const rows: MtbfRow[] = []
    for (const [machineId, list] of byMachine) {
      const totalDowntimeMin = list.reduce((s, r) => s + (r.downtimeMin ?? 0), 0)
      let mtbfDays: number | null = null
      if (list.length >= 2) {
        let sum = 0
        for (let i = 1; i < list.length; i++) {
          sum += Math.abs(dayDiff(new Date(list[i].date), new Date(list[i - 1].date)))
        }
        mtbfDays = Math.round((sum / (list.length - 1)) * 100) / 100
      }
      rows.push({
        machineId,
        machineName: names.get(machineId)?.name ?? '',
        breakdownCount: list.length,
        totalDowntimeMin,
        mtbfDays,
        lastBreakdownDate: list[list.length - 1].date,
      })
    }
    return rows.sort((a, b) => (b.mtbfDays ?? -1) - (a.mtbfDays ?? -1))
  }

  // ---------- 内部工具 ----------

  /**
   * 推算下次到期日
   * - 按天循环：lastDone + cycleValue 天；无基准则以今天为基准（首次到期）
   * - 按运转小时循环：需累计运行小时，本系统未采集，返回 null 由人工维护
   */
  private computeNextDueDate(lastDone: string | null, cycleType: MaintenanceCycleType, cycleValue: number): string | null {
    if (cycleType === 'run_hour') return null
    const base = lastDone ? atMidnight(lastDone) : atMidnight(new Date())
    base.setDate(base.getDate() + cycleValue)
    return base.toISOString().slice(0, 10)
  }

  private async loadMachineNames(ctx: RequestContext, ids: string[]): Promise<Map<string, { name: string; code: string }>> {
    const map = new Map<string, { name: string; code: string }>()
    const uniq = [...new Set(ids.filter(Boolean))]
    if (!uniq.length) return map
    const rows = await this.machines.find({ where: uniq.map((id) => ({ id, tenantId: ctx.tenantId, companyId: ctx.companyId })) })
    for (const m of rows) map.set(m.id, { name: m.name, code: m.code })
    return map
  }

  private async loadPlanNames(ctx: RequestContext, ids: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>()
    const uniq = [...new Set(ids.filter(Boolean))]
    if (!uniq.length) return map
    const rows = await this.plans.find({ where: uniq.map((id) => ({ id, tenantId: ctx.tenantId, companyId: ctx.companyId })) })
    for (const p of rows) map.set(p.id, p.planName)
    return map
  }

  private async loadUsages(ctx: RequestContext, recordIds: string[]): Promise<Map<string, SpareUsageView[]>> {
    const map = new Map<string, SpareUsageView[]>()
    const uniq = [...new Set(recordIds.filter(Boolean))]
    if (!uniq.length) return map
    const rows = await this.usages.find({ where: uniq.map((id) => ({ recordId: id, tenantId: ctx.tenantId, companyId: ctx.companyId })) })
    const partIds = [...new Set(rows.map((u) => u.partId))]
    const parts = partIds.length
      ? await this.parts.find({ where: partIds.map((id) => ({ id, tenantId: ctx.tenantId, companyId: ctx.companyId })) })
      : []
    const partMap = new Map(parts.map((p) => [p.id, p.name]))
    for (const u of rows) {
      const arr = map.get(u.recordId) ?? []
      arr.push({ id: u.id, partId: u.partId, partName: partMap.get(u.partId) ?? '', qty: toNum(u.qty), cost: toNum(u.cost) })
      map.set(u.recordId, arr)
    }
    return map
  }

  private toPlanView(p: MaintenancePlanEntity, machineName: string, machineCode: string): PlanView {
    return {
      id: p.id,
      planNo: p.planNo,
      machineId: p.machineId,
      machineName,
      machineCode,
      planName: p.planName,
      type: p.type,
      cycleType: p.cycleType,
      cycleValue: p.cycleValue,
      lastDoneDate: p.lastDoneDate,
      nextDueDate: p.nextDueDate,
      responsible: p.responsible,
      status: p.status,
      remark: p.remark,
      createdAt: p.createdAt,
    }
  }

  private toRecordView(
    r: MaintenanceRecordEntity,
    spareParts: SpareUsageView[],
    machineName: string,
    planName: string | null,
  ): RecordView {
    return {
      id: r.id,
      recordNo: r.recordNo,
      machineId: r.machineId,
      machineName,
      planId: r.planId,
      planName,
      type: r.type,
      category: r.category,
      date: (r.date as unknown) instanceof Date ? (r.date as unknown as Date).toISOString().slice(0, 10) : String(r.date),
      operatorId: r.operatorId,
      operatorName: r.operatorName,
      durationMin: r.durationMin,
      downtimeMin: r.downtimeMin,
      cost: toNum(r.cost),
      result: r.result,
      remark: r.remark,
      spareParts,
      createdAt: r.createdAt,
    }
  }

  private toPartView(p: SparePartEntity): SparePartView {
    const stock = toNum(p.stock)
    const min = toNum(p.minStock)
    return {
      id: p.id,
      partCode: p.partCode,
      name: p.name,
      spec: p.spec,
      unit: p.unit,
      stock,
      minStock: min,
      location: p.location,
      remark: p.remark,
      lowStock: stock < min - 0.001,
    }
  }

  private async nextPlanNo(companyId: string): Promise<string> {
    const prefix = 'WB'
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const last = await this.plans.findOne({
      where: { companyId, planNo: Like(`${prefix}${date}%`) },
      order: { planNo: 'DESC' },
    })
    let next = 1
    if (last) {
      const seq = Number(last.planNo.slice(prefix.length + 8))
      if (Number.isFinite(seq)) next = seq + 1
    }
    return `${prefix}${date}${String(next).padStart(4, '0')}`
  }

  private async nextRecordNo(companyId: string): Promise<string> {
    const prefix = 'WX'
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const last = await this.records.findOne({
      where: { companyId, recordNo: Like(`${prefix}${date}%`) },
      order: { recordNo: 'DESC' },
    })
    let next = 1
    if (last) {
      const seq = Number(last.recordNo.slice(prefix.length + 8))
      if (Number.isFinite(seq)) next = seq + 1
    }
    return `${prefix}${date}${String(next).padStart(4, '0')}`
  }
}
