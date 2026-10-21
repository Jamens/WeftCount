import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Between, Repository } from 'typeorm'
import { ErrorCode } from '@weftcount/shared'
import { EnergyReadingEntity } from './entities/energy-reading.entity'
import { MachineEntity } from '../production/entities/machine.entity'
import { ProductionReportEntity } from '../production/entities/production-report.entity'
import type { RequestContext } from '../auth/auth-context'

/** decimal 字符串 → number（空/异常记 0） */
function toNum(s: string | null | undefined): number {
  const v = Number(s ?? '0')
  return Number.isFinite(v) ? v : 0
}
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000
}
/** date 列转 YYYY-MM-DD（实体列标 string，驱动运行时可能回 Date） */
function dateToISO(v: string | null): string {
  if (!v) return ''
  return (v as unknown) instanceof Date ? (v as unknown as Date).toISOString().slice(0, 10) : String(v)
}

/** 一条抄表记录 + 派生用量 */
export interface ReadingView {
  id: string
  machineId: string
  machineCode: string
  machineName: string
  meterNo: string
  readingDate: string
  reading: number
  tariff: number
  /** 用量 = 本期表底 − 同表上期表底；首条为基线时 null（不是 0） */
  consumedKwh: number | null
  /** 电费 = 用量 × 当期电价；基线时 null */
  cost: number | null
  /** 该表是否首条（只建基线，未出量） */
  isBaseline: boolean
  remark: string | null
}

/** 单机台能耗 */
export interface MachineEnergyRow {
  machineId: string
  machineCode: string
  machineName: string
  /** 期间内该表序列的用量合计；期间无抄表时 null（缺数据 ≠ 零耗电） */
  totalKwh: number | null
  /** 期间产量（米），来自报工聚合 */
  outputM: number
  /** 单位产量电耗 kWh/百米；产量为 0 时 null（除零不给 Infinity） */
  kwhPer100m: number | null
  /** 期间电费（元） */
  totalCost: number | null
  /** 单位成本 元/米；产量为 0 时 null */
  costPerMeter: number | null
  /** 期间内最后抄表日，用于判断统计覆盖到哪天 */
  lastReadingDate: string | null
}

export interface EnergyTotals {
  totalKwh: number
  outputM: number
  kwhPer100m: number | null
  totalCost: number
  costPerMeter: number | null
  readingCount: number
  machineCount: number
}

export interface EnergyStats {
  periodStart: string
  periodEnd: string
  rows: MachineEnergyRow[]
  totals: EnergyTotals
  /** 期间有产量但无抄表的机台（提醒补抄表，别把「没数」当「零耗」） */
  missingMachines: string[]
}

export interface EnergyCompare {
  periodStart: string
  periodEnd: string
  prevStart: string
  prevEnd: string
  current: { totalKwh: number; outputM: number; kwhPer100m: number | null; totalCost: number; costPerMeter: number | null }
  prev: { totalKwh: number; outputM: number; kwhPer100m: number | null; totalCost: number; costPerMeter: number | null }
  /** 单耗环比变化（本期 − 上期），任一侧缺数/为 0 则 null */
  kwhPer100mDelta: number | null
  /** 单耗环比百分比；上期单耗为 0 或缺数则 null（除零） */
  kwhPer100mDeltaPct: number | null
}

@Injectable()
export class EnergyService {
  constructor(
    @InjectRepository(EnergyReadingEntity) private readonly readings: Repository<EnergyReadingEntity>,
    @InjectRepository(MachineEntity) private readonly machines: Repository<MachineEntity>,
    @InjectRepository(ProductionReportEntity) private readonly reports: Repository<ProductionReportEntity>,
  ) {}

  /**
   * 机台选项（精简参照数据）
   *
   * 为什么本模块自带而不是前端复用 `GET /machines`：那个端点要 `production.view`，
   * 而录抄表的是会计（持 cost.*、**无** production.view）。为填一个下拉框给会计
   * 授予生产数据权是错误的扩权——参照数据的读取权应随功能走，不随数据表走。
   * 只回 id/code/name/status，不外泄机台配置细节。
   */
  async listMachineOptions(ctx: RequestContext): Promise<{ id: string; code: string; name: string; status: string }[]> {
    const rows = await this.machines.find({
      where: { tenantId: ctx.tenantId, companyId: ctx.companyId },
      order: { code: 'ASC' },
    })
    return rows.map((m) => ({ id: m.id, code: m.code, name: m.name, status: m.status }))
  }

  // ---------- 写：抄表 ----------

  async createReading(ctx: RequestContext, dto: {
    machineId: string; meterNo: string; readingDate: string; reading: number; tariff: number; remark?: string | null
  }): Promise<ReadingView> {
    const machine = await this.machines.findOne({
      where: { id: dto.machineId, tenantId: ctx.tenantId, companyId: ctx.companyId },
    })
    if (!machine) {
      throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: '机台不存在' })
    }
    const dup = await this.readings.findOne({
      where: { machineId: dto.machineId, meterNo: dto.meterNo, readingDate: dto.readingDate, companyId: ctx.companyId },
    })
    if (dup) {
      throw new BadRequestException({
        code: ErrorCode.DUPLICATE_CODE,
        message: `该电表在 ${dto.readingDate} 已有抄表记录`,
      })
    }

    // 累计表底必须单调不减：回退只可能是抄错或误改表。
    // 换表请开新电表号（新号读数可从 0 起算），不给「回退量」开口子。
    const prev = await this.findPrevReading(ctx, dto.machineId, dto.meterNo, dto.readingDate)
    if (prev && dto.reading < toNum(prev.reading)) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: `读数 ${dto.reading} 小于上期（${dateToISO(prev.readingDate)}）的 ${toNum(prev.reading)}：累计表底不能回退，换表请换电表号`,
      })
    }

    const saved = await this.readings.save(this.readings.create({
      tenantId: ctx.tenantId,
      companyId: ctx.companyId,
      machineId: dto.machineId,
      meterNo: dto.meterNo,
      readingDate: dto.readingDate,
      reading: String(dto.reading),
      tariff: String(dto.tariff),
      remark: dto.remark ?? null,
    }))
    const views = await this.buildViews(ctx, [saved.id])
    return views[0]
  }

  async updateReading(ctx: RequestContext, id: string, dto: { tariff?: number; remark?: string | null }): Promise<ReadingView> {
    const r = await this.readings.findOne({ where: { id, tenantId: ctx.tenantId, companyId: ctx.companyId } })
    if (!r) throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: '抄表记录不存在' })
    if (dto.tariff !== undefined) r.tariff = String(dto.tariff)
    if (dto.remark !== undefined) r.remark = dto.remark ?? null
    const saved = await this.readings.save(r)
    const views = await this.buildViews(ctx, [saved.id])
    return views[0]
  }

  async deleteReading(ctx: RequestContext, id: string): Promise<void> {
    const r = await this.readings.findOne({ where: { id, tenantId: ctx.tenantId, companyId: ctx.companyId } })
    if (!r) throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: '抄表记录不存在' })
    await this.readings.delete({ id })
  }

  // ---------- 读：抄表列表（带派生用量） ----------

  async listReadings(ctx: RequestContext, filter: { machineId?: string; meterNo?: string; from?: string; to?: string }): Promise<ReadingView[]> {
    const where: Record<string, unknown> = { tenantId: ctx.tenantId, companyId: ctx.companyId }
    if (filter.machineId) where.machineId = filter.machineId
    if (filter.meterNo) where.meterNo = filter.meterNo
    if (filter.from) where.readingDate = Between(filter.from, filter.to ?? '9999-12-31')
    else if (filter.to) where.readingDate = Between('0000-01-01', filter.to)
    const rows = await this.readings.find({ where, order: { readingDate: 'DESC', createdAt: 'DESC' } })
    return this.toViews(ctx, rows)
  }

  // ---------- 读：能耗统计 ----------

  /**
   * 期间单位产量电耗（kWh/百米）
   *
   * 口径两条，都写在字段注释里免得后人踩：
   * 1. **用量按抄表日归期**（末次抄表法）：一条读数记的是「距上期抄表」的整段用量，
   *    归到本期这条读表的日期上。跨期补抄不会被劈成两半。
   * 2. **合计用总量算**，不是各机台单耗取平均——平均的平均会把高耗机台的异常摊平。
   */
  async getStats(ctx: RequestContext, periodStart: string, periodEnd: string): Promise<EnergyStats> {
    this.assertPeriod(periodStart, periodEnd)

    // 全量序列算差值后再按期间筛：某表在期间内的第一条可能需要「期间之前」的读数当上期
    const all = await this.sortedReadings(ctx)
    const consumedMap = this.consumeMap(all)
    const inPeriod = all.filter((r) => {
      const d = dateToISO(r.readingDate)
      return d >= periodStart && d <= periodEnd
    })

    const outputByMachine = await this.outputByMachine(ctx, periodStart, periodEnd)
    const machineIds = [...new Set([
      ...inPeriod.map((r) => r.machineId),
      ...[...outputByMachine.keys()],
    ])]
    const machineMap = await this.machineMap(machineIds)

    const rows: MachineEnergyRow[] = machineIds.map((id) => {
      const m = machineMap.get(id)
      const readingsOf = inPeriod.filter((r) => r.machineId === id)
      const hasReading = readingsOf.length > 0
      let kwh = 0
      let cost = 0
      let lastReadingDate: string | null = null
      for (const r of readingsOf) {
        const consumed = consumedMap.get(r.id)
        if (consumed == null) continue // 基线，不出量
        kwh += consumed
        cost += consumed * toNum(r.tariff)
        const d = dateToISO(r.readingDate)
        if (!lastReadingDate || d > lastReadingDate) lastReadingDate = d
      }
      const outputM = round3(outputByMachine.get(id) ?? 0)
      return {
        machineId: id,
        machineCode: m?.code ?? '',
        machineName: m?.name ?? '未知机台',
        totalKwh: hasReading ? round2(kwh) : null,
        outputM,
        kwhPer100m: hasReading && outputM > 0 ? round2(kwh / (outputM / 100)) : null,
        totalCost: hasReading ? round2(cost) : null,
        costPerMeter: hasReading && outputM > 0 ? round3(cost / outputM) : null,
        lastReadingDate,
      }
    }).sort((a, b) => (b.totalKwh ?? -1) - (a.totalKwh ?? -1))

    const totalKwh = rows.reduce((s, r) => s + (r.totalKwh ?? 0), 0)
    const totalOutput = round3(rows.reduce((s, r) => s + r.outputM, 0))
    const totalCost = round2(rows.reduce((s, r) => s + (r.totalCost ?? 0), 0))
    const meterCount = new Set(inPeriod.map((r) => `${r.machineId}|${r.meterNo}`)).size
    const missingMachines = rows
      .filter((r) => r.totalKwh == null && r.outputM > 0)
      .map((r) => r.machineName)

    return {
      periodStart,
      periodEnd,
      rows,
      totals: {
        totalKwh: round2(totalKwh),
        outputM: totalOutput,
        kwhPer100m: totalOutput > 0 ? round2(totalKwh / (totalOutput / 100)) : null,
        totalCost,
        costPerMeter: totalOutput > 0 ? round3(totalCost / totalOutput) : null,
        readingCount: inPeriod.length,
        machineCount: meterCount,
      },
      missingMachines,
    }
  }

  /** 环比：与上一个等长期间比（[start-len, start-1]） */
  async getCompare(ctx: RequestContext, periodStart: string, periodEnd: string): Promise<EnergyCompare> {
    this.assertPeriod(periodStart, periodEnd)
    const len = dayDiff(new Date(periodEnd), new Date(periodStart))
    const prevEnd = dayShift(periodStart, -1)
    const prevStart = dayShift(periodStart, -(len + 1))

    const cur = await this.periodTotals(ctx, periodStart, periodEnd)
    const prev = await this.periodTotals(ctx, prevStart, prevEnd)
    const delta = cur.kwhPer100m != null && prev.kwhPer100m != null ? round2(cur.kwhPer100m - prev.kwhPer100m) : null
    const pct = delta != null && prev.kwhPer100m != null && prev.kwhPer100m !== 0
      ? round2((delta / prev.kwhPer100m) * 100)
      : null
    return {
      periodStart, periodEnd, prevStart, prevEnd,
      current: cur,
      prev,
      kwhPer100mDelta: delta,
      kwhPer100mDeltaPct: pct,
    }
  }

  // ---------- 内部 ----------

  private assertPeriod(start: string, end: string): void {
    if (start > end) {
      throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: '统计期间起不得晚于止' })
    }
  }

  private async periodTotals(ctx: RequestContext, start: string, end: string): Promise<{
    totalKwh: number; outputM: number; kwhPer100m: number | null; totalCost: number; costPerMeter: number | null
  }> {
    const all = await this.sortedReadings(ctx)
    const consumedMap = this.consumeMap(all)
    const inPeriod = all.filter((r) => {
      const d = dateToISO(r.readingDate)
      return d >= start && d <= end
    })
    let kwh = 0
    let cost = 0
    for (const r of inPeriod) {
      const consumed = consumedMap.get(r.id)
      if (consumed == null) continue
      kwh += consumed
      cost += consumed * toNum(r.tariff)
    }
    const outputMap = await this.outputByMachine(ctx, start, end)
    const outputM = round3([...outputMap.values()].reduce((s, v) => s + v, 0))
    return {
      totalKwh: round2(kwh),
      outputM,
      kwhPer100m: outputM > 0 ? round2(kwh / (outputM / 100)) : null,
      totalCost: round2(cost),
      costPerMeter: outputM > 0 ? round3(cost / outputM) : null,
    }
  }

  /** 公司全部读数，按 (机台, 电表, 抄表日) 升序——差值必须在这个顺序上算 */
  private async sortedReadings(ctx: RequestContext): Promise<EnergyReadingEntity[]> {
    return this.readings.find({
      where: { tenantId: ctx.tenantId, companyId: ctx.companyId },
      order: { machineId: 'ASC', meterNo: 'ASC', readingDate: 'ASC', createdAt: 'ASC' },
    })
  }

  /**
   * 用量差值：id → kWh（首条为基线不入表）
   * 已校验单调不减，这里仍用 max(0,·) 兜底——数据被绕过接口改过时宁可显示 0 也不要负耗电。
   */
  private consumeMap(all: EnergyReadingEntity[]): Map<string, number> {
    const out = new Map<string, number>()
    let prevInMeter: EnergyReadingEntity | null = null
    let prevKey = ''
    for (const r of all) {
      const key = `${r.machineId}|${r.meterNo}`
      if (key !== prevKey) {
        prevKey = key
        prevInMeter = null
        continue // 该表首条 = 基线，不出量
      }
      if (prevInMeter) {
        out.set(r.id, Math.max(0, toNum(r.reading) - toNum(prevInMeter.reading)))
      }
      prevInMeter = r
    }
    return out
  }

  private async findPrevReading(ctx: RequestContext, machineId: string, meterNo: string, before: string): Promise<EnergyReadingEntity | null> {
    return this.readings.findOne({
      where: {
        tenantId: ctx.tenantId, companyId: ctx.companyId,
        machineId, meterNo,
        readingDate: Between('0000-01-01', before),
      },
      order: { readingDate: 'DESC', createdAt: 'DESC' },
    })
  }

  /** 期间产量按机台聚合（与工资/成本核算同源，不另设一套产量口径） */
  private async outputByMachine(ctx: RequestContext, start: string, end: string): Promise<Map<string, number>> {
    const reports = await this.reports.find({
      where: { tenantId: ctx.tenantId, companyId: ctx.companyId, reportDate: Between(start, end) },
    })
    const map = new Map<string, number>()
    for (const r of reports) map.set(r.machineId, (map.get(r.machineId) ?? 0) + toNum(r.outputM))
    return map
  }

  private async machineMap(ids: string[]): Promise<Map<string, MachineEntity>> {
    if (!ids.length) return new Map()
    const list = await this.machines.find({ where: ids.map((id) => ({ id })) })
    return new Map(list.map((m) => [m.id, m]))
  }

  private async toViews(ctx: RequestContext, rows: EnergyReadingEntity[]): Promise<ReadingView[]> {
    if (!rows.length) return []
    const all = await this.sortedReadings(ctx)
    const consumedMap = this.consumeMap(all)
    const machineMap = await this.machineMap([...new Set(rows.map((r) => r.machineId))])
    return rows.map((r) => {
      const m = machineMap.get(r.machineId)
      const consumed = consumedMap.get(r.id) ?? null
      return {
        id: r.id,
        machineId: r.machineId,
        machineCode: m?.code ?? '',
        machineName: m?.name ?? '未知机台',
        meterNo: r.meterNo,
        readingDate: dateToISO(r.readingDate),
        reading: round2(toNum(r.reading)),
        tariff: toNum(r.tariff),
        consumedKwh: consumed == null ? null : round2(consumed),
        cost: consumed == null ? null : round2(consumed * toNum(r.tariff)),
        isBaseline: consumed == null,
        remark: r.remark,
      }
    })
  }

  private async buildViews(ctx: RequestContext, ids: string[]): Promise<ReadingView[]> {
    const rows = await this.readings.find({ where: ids.map((id) => ({ id })) })
    return this.toViews(ctx, rows)
  }
}

function dayDiff(a: Date, b: Date): number {
  const ms = 24 * 60 * 60 * 1000
  return Math.floor((a.setHours(0, 0, 0, 0) - b.setHours(0, 0, 0, 0)) / ms)
}

/** 日期平移（天），返回 YYYY-MM-DD */
function dayShift(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}