import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm'
import { DataSource, In, Repository } from 'typeorm'
import dayjs from 'dayjs'
import { ErrorCode } from '@weftcount/shared'
import { MaterialService } from '../material/material.service'
import { MachineEntity } from '../production/entities/machine.entity'
import { ProductionOrderEntity } from '../production/entities/production-order.entity'
import { LlmClient } from './llm.client'
import type { AiInsight } from './ai.types'

export interface ScheduleRow {
  orderId: string
  orderNo: string
  specName: string
  plannedMeters: number
  /** 建议机台 */
  machineId: string | null
  machineName: string | null
  /** 占用天数（按该规格日产能） */
  days: number
  /** 相对今天的起止天（第0天=今天） */
  startDay: number
  endDay: number
  /** 交期距今天数；null=无交期 */
  dueInDays: number | null
  /** 是否能按期完成 */
  meetsDue: boolean | null
  dailyOutputM: number
}

export interface ScheduleData {
  rows: ScheduleRow[]
  orderCount: number
  atRiskCount: number
  machineCount: number
}

/** 甘特条：一条 = 一个工单在某机台上的时间占用 */
export interface GanttBar {
  orderId: string
  orderNo: string
  specName: string
  machineId: string | null
  startDay: number
  endDay: number
  days: number
  plannedMeters: number
  /**
   * in_progress=在产（已真实占用机台）、scheduled=已排产（已确认占用）、
   * draft=排产建议（尚未落库，可批量确认）
   */
  status: 'in_progress' | 'scheduled' | 'draft'
  dueInDays: number | null
  meetsDue: boolean | null
}

/** 甘特行：一台机台及其占用情况 */
export interface GanttMachine {
  id: string
  name: string
  code: string
  /** 该机台累计占用天数（甘特图右边界） */
  loadDays: number
  /** 建议分配到该机台的待排工单数 */
  suggestedCount: number
}

/** 甘特图数据（横向时间轴 × 纵向机台） */
export interface GanttData {
  machines: GanttMachine[]
  bars: GanttBar[]
  /** 时间轴总跨度（天） */
  horizonDays: number
  /** 已确认（在产+已排）的条数 */
  committedCount: number
  /** 待确认（建议）的条数 */
  suggestedCount: number
  atRiskCount: number
}

/**
 * 排产建议
 *
 * 确定性贪心(EDD 最早交期优先)，对象是**生产工单**(单机台单规格任务)：
 *   - 工单占用天数 = 计划米数 ÷ 该规格日产能(快照 dailyOutputM，含机台效率/实测系数)
 *   - 机台初始负载 = 在产工单剩余天数 + 已排(scheduled)未开工工单天数
 *   - 未排(draft)工单按交期升序逐个放到「最早完工」的机台，得出起止天与是否按期
 * 大模型：解读排产结果、点出逾期风险与调整建议(加急/加班/改期)——不碰排产数字。
 */
@Injectable()
export class SchedulingService {
  private readonly log = new Logger(SchedulingService.name)

  constructor(
    private readonly materials: MaterialService,
    private readonly llm: LlmClient,
    @InjectRepository(ProductionOrderEntity)
    private readonly prodOrders: Repository<ProductionOrderEntity>,
    @InjectRepository(MachineEntity)
    private readonly machines: Repository<MachineEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  private async orderDays(tenantId: string, companyId: string, o: ProductionOrderEntity): Promise<{ days: number; daily: number; specName: string }> {
    try {
      const spec = await this.materials.findSpec(tenantId, companyId, o.specId)
      const daily = Number(this.materials.getSnapshot(spec).dailyOutputM) || 0
      return { days: daily > 0 ? Number(o.plannedQuantityM) / daily : 0, daily, specName: spec.name }
    } catch {
      return { days: 0, daily: 0, specName: '-' }
    }
  }

  /** 确定性排产：EDD 贪心分配 */
  async schedule(tenantId: string, companyId: string): Promise<ScheduleData> {
    const today = dayjs().startOf('day')
    const machines = await this.machines.find({ where: { companyId, status: In(['idle', 'running']) } })
    const pending = await this.prodOrders.find({ where: { companyId, status: In(['draft', 'scheduled', 'in_progress']) } })

    // 机台初始负载：在产工单剩余天数 + 已排(scheduled)工单天数
    const load = new Map<string, number>()
    for (const m of machines) load.set(m.id, 0)

    // 甘特条：已确认占用（在产/已排）先入，start/end 即该工单在本机台的起止天
    const bars: GanttBar[] = []
    for (const o of pending) {
      if (!o.machineId) continue
      const { days, daily, specName } = await this.orderDays(tenantId, companyId, o)
      if (o.status === 'in_progress') {
        const remain = Math.max(Number(o.plannedQuantityM) - Number(o.producedQuantityM), 0)
        const span = daily > 0 ? remain / daily : 0
        const start = load.get(o.machineId) ?? 0
        load.set(o.machineId, start + span)
        bars.push({
          orderId: o.id, orderNo: o.orderNo, specName, machineId: o.machineId,
          startDay: r1(start), endDay: r1(start + span), days: r1(span),
          plannedMeters: Number(o.plannedQuantityM), status: 'in_progress',
          dueInDays: dueIn(o.dueDate, today), meetsDue: null,
        })
      } else if (o.status === 'scheduled') {
        const start = load.get(o.machineId) ?? 0
        load.set(o.machineId, start + days)
        bars.push({
          orderId: o.id, orderNo: o.orderNo, specName, machineId: o.machineId,
          startDay: r1(start), endDay: r1(start + days), days: r1(days),
          plannedMeters: Number(o.plannedQuantityM), status: 'scheduled',
          dueInDays: dueIn(o.dueDate, today),
          meetsDue: o.dueDate ? start + days <= dueIn(o.dueDate, today)! : null,
        })
      }
    }

    // 未排(draft)工单按交期升序（无交期最后）
    const toSchedule = pending
      .filter((o) => o.status === 'draft')
      .sort((a, b) => {
        const ad = a.dueDate ? dayjs(a.dueDate).valueOf() : Infinity
        const bd = b.dueDate ? dayjs(b.dueDate).valueOf() : Infinity
        return ad - bd
      })

    const rows: ScheduleRow[] = []
    const assignedCount = new Map<string, number>() // 每台机台已排工单数，用于负载打散
    for (const o of toSchedule) {
      const { days, daily, specName } = await this.orderDays(tenantId, companyId, o)
      // 选机台：先比「最早完工(可用天)」，平局比「已排工单数少」——避免全堆到同一台
      let best: { machineId: string; start: number; count: number } | null = null
      for (const m of machines) {
        const start = load.get(m.id) ?? 0
        const count = assignedCount.get(m.id) ?? 0
        if (!best || start < best.start || (start === best.start && count < best.count)) {
          best = { machineId: m.id, start, count }
        }
      }
      const machineId = best?.machineId ?? null
      const start = best?.start ?? 0
      const end = start + days
      if (machineId) {
        load.set(machineId, end)
        assignedCount.set(machineId, (assignedCount.get(machineId) ?? 0) + 1)
      }
      const dueInDays = dueIn(o.dueDate, today)
      rows.push({
        orderId: o.id, orderNo: o.orderNo, specName,
        plannedMeters: Number(o.plannedQuantityM),
        machineId,
        machineName: machineId ? (machines.find((m) => m.id === machineId)?.name ?? null) : null,
        days: r1(days),
        startDay: r1(start),
        endDay: r1(end),
        dueInDays,
        meetsDue: dueInDays == null ? null : end <= dueInDays,
        dailyOutputM: daily,
      })
      // 甘特条：建议（未落库），与 rows 同源
      bars.push({
        orderId: o.id, orderNo: o.orderNo, specName, machineId,
        startDay: r1(start), endDay: r1(end), days: r1(days),
        plannedMeters: Number(o.plannedQuantityM), status: 'draft',
        dueInDays, meetsDue: dueInDays == null ? null : end <= dueInDays,
      })
    }

    const atRiskCount = rows.filter((r) => r.meetsDue === false).length
    return { rows, orderCount: rows.length, atRiskCount, machineCount: machines.length }
  }

  /**
   * 甘特图数据（横向天数 × 纵向机台）
   *
   * 与 schedule() 同源同口径，差别是本方法**同时纳入已确认占用的工单**
   * （in_progress 在产 / scheduled 已排产），这样看到的是「机台真实排布 + 待排建议」
   * 的完整全景，而不只是待排清单。纯确定性聚合，不调大模型。
   */
  async gantt(tenantId: string, companyId: string): Promise<GanttData> {
    const today = dayjs().startOf('day')
    const machines = await this.machines.find({ where: { companyId, status: In(['idle', 'running']) } })
    const pending = await this.prodOrders.find({ where: { companyId, status: In(['draft', 'scheduled', 'in_progress']) } })

    const load = new Map<string, number>()
    for (const m of machines) load.set(m.id, 0)
    const bars: GanttBar[] = []

    // 已确认占用：在产(从今天起) + 已排(接在负载之后)
    for (const o of pending) {
      if (!o.machineId) continue
      const { days, daily, specName } = await this.orderDays(tenantId, companyId, o)
      const start = load.get(o.machineId) ?? 0
      if (o.status === 'in_progress') {
        const remain = Math.max(Number(o.plannedQuantityM) - Number(o.producedQuantityM), 0)
        const span = daily > 0 ? remain / daily : 0
        load.set(o.machineId, start + span)
        bars.push({
          orderId: o.id, orderNo: o.orderNo, specName, machineId: o.machineId,
          startDay: r1(start), endDay: r1(start + span), days: r1(span),
          plannedMeters: Number(o.plannedQuantityM), status: 'in_progress',
          dueInDays: dueIn(o.dueDate, today), meetsDue: null,
        })
      } else if (o.status === 'scheduled') {
        load.set(o.machineId, start + days)
        bars.push({
          orderId: o.id, orderNo: o.orderNo, specName, machineId: o.machineId,
          startDay: r1(start), endDay: r1(start + days), days: r1(days),
          plannedMeters: Number(o.plannedQuantityM), status: 'scheduled',
          dueInDays: dueIn(o.dueDate, today),
          meetsDue: o.dueDate ? start + days <= dueIn(o.dueDate, today)! : null,
        })
      }
    }

    // 待排建议：EDD 贪心，与 schedule() 完全一致的选机台口径
    const toSchedule = pending
      .filter((o) => o.status === 'draft')
      .sort((a, b) => {
        const ad = a.dueDate ? dayjs(a.dueDate).valueOf() : Infinity
        const bd = b.dueDate ? dayjs(b.dueDate).valueOf() : Infinity
        return ad - bd
      })
    const assignedCount = new Map<string, number>()
    for (const o of toSchedule) {
      const { days, daily, specName } = await this.orderDays(tenantId, companyId, o)
      let best: { machineId: string; start: number; count: number } | null = null
      for (const m of machines) {
        const start = load.get(m.id) ?? 0
        const count = assignedCount.get(m.id) ?? 0
        if (!best || start < best.start || (start === best.start && count < best.count)) {
          best = { machineId: m.id, start, count }
        }
      }
      const machineId = best?.machineId ?? null
      const start = best?.start ?? 0
      const end = start + days
      if (machineId) {
        load.set(machineId, end)
        assignedCount.set(machineId, (assignedCount.get(machineId) ?? 0) + 1)
      }
      const dueInDays = dueIn(o.dueDate, today)
      bars.push({
        orderId: o.id, orderNo: o.orderNo, specName, machineId,
        startDay: r1(start), endDay: r1(end), days: r1(days),
        plannedMeters: Number(o.plannedQuantityM), status: 'draft',
        dueInDays, meetsDue: dueInDays == null ? null : end <= dueInDays,
      })
    }

    const suggestedCount = new Map<string, number>()
    for (const b of bars) {
      if (b.status === 'draft' && b.machineId) {
        suggestedCount.set(b.machineId, (suggestedCount.get(b.machineId) ?? 0) + 1)
      }
    }

    // 时间轴跨度：各机台负载的最大值（至少 1 天，避免无机台时除零/空图）
    const horizonDays = r1(Math.max(1, ...[...load.values()]))

    return {
      machines: machines.map((m) => ({
        id: m.id,
        name: m.name,
        code: m.code,
        loadDays: r1(load.get(m.id) ?? 0),
        suggestedCount: suggestedCount.get(m.id) ?? 0,
      })),
      bars,
      horizonDays,
      committedCount: bars.filter((b) => b.status !== 'draft').length,
      suggestedCount: bars.filter((b) => b.status === 'draft').length,
      atRiskCount: bars.filter((b) => b.meetsDue === false).length,
    }
  }

  /**
   * 批量确认排产建议 → 落库
   *
   * 把甘特/建议里的 draft 条真正写进生产工单：指派机台 + 按startDay 推算计划开工日 + 状态转 scheduled。
   *
   * 为什么不在前端逐条 PATCH：排产是**计划动作**，计划员往往一眼认可整张排布，
   * 逐条点 20 次既慢又容易漏。这里支持一次提交整批，并用事务保证
   * 「要么全部落库，要么全部不动」——排产中途失败留半截状态比什么都不做更糟。
   *
   * 会跳过已被别人改走的工单（状态已不是 draft），返回实际生效清单，
   * 不静默覆盖他人操作。
   */
  async applySchedule(
    tenantId: string,
    companyId: string,
    items: { orderId: string; machineId: string; startDay: number }[],
  ): Promise<{ applied: number; skipped: string[]; orders: ProductionOrderEntity[] }> {
    if (items.length === 0) return { applied: 0, skipped: [], orders: [] }
    const today = dayjs().startOf('day')

    return this.dataSource.transaction(async (manager) => {
      const orderRepo = manager.getRepository(ProductionOrderEntity)
      const machineRepo = manager.getRepository(MachineEntity)
      const skipped: string[] = []
      const orders: ProductionOrderEntity[] = []

      for (const it of items) {
        const o = await orderRepo.findOne({ where: { id: it.orderId, tenantId, companyId } })
        if (!o) {
          skipped.push(it.orderId)
          continue
        }
        // 已被其他人推进（如开工/取消）→ 不覆盖，跳过并回报
        if (o.status !== 'draft') {
          skipped.push(o.orderNo)
          continue
        }
        const m = await machineRepo.findOne({ where: { id: it.machineId, companyId } })
        if (!m) {
          throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: `机台不存在：${it.machineId}` })
        }
        o.machineId = it.machineId
        // 相对天 → 绝对日期：plannedStartDate 是 date 列，只取年月日
        o.plannedStartDate = today.add(it.startDay).format('YYYY-MM-DD')
        o.status = 'scheduled'
        orders.push(await orderRepo.save(o))
      }
      return { applied: orders.length, skipped, orders }
    })
  }

  /** 排产建议 + AI 解读 */
  async advise(tenantId: string, companyId: string): Promise<AiInsight<ScheduleData>> {
    const data = await this.schedule(tenantId, companyId)
    const derivation = [
      `待排(draft)工单 ${data.orderCount} 个，可用机台 ${data.machineCount} 台，按交期升序(EDD)贪心排产`,
      '口径：工单占用天数 = 计划米数 ÷ 该规格日产能(快照 dailyOutputM，含机台效率与实测系数)',
    ]
    for (const r of data.rows.slice(0, 8)) {
      derivation.push(
        `${r.orderNo}(${r.specName} ${r.plannedMeters}m)：建议 ${r.machineName ?? '无机台'}，第${r.startDay}~${r.endDay}天，占${r.days}天${r.meetsDue === false ? '，**逾期风险**' : r.meetsDue ? '，可按期' : ''}`,
      )
    }
    const fallback: AiInsight<ScheduleData> = {
      source: 'rule',
      confidence: 0.5,
      derivation,
      reasoning: data.atRiskCount > 0
        ? `有 ${data.atRiskCount} 个工单按当前产能/机台数无法按期完成，建议加急(插单/加班)或与客户改交期。`
        : data.orderCount > 0
          ? `按交期优先排产，${data.orderCount} 个工单均可按期完成。`
          : '暂无待排(draft)工单。',
      data,
    }
    if (!this.llm.enabled || data.orderCount === 0) return fallback

    const system = `你是纺织厂生产计划员。只依据给定排产结果做解读与调整建议，中文作答，输出 JSON：{"reasoning":"排产解读与建议","confidence":0~1}`
    const user =
      `排产建议结果（可用机台 ${data.machineCount} 台）：\n` +
      data.rows
        .slice(0, 10)
        .map((r) => `- ${r.orderNo} ${r.specName} ${r.plannedMeters}m → ${r.machineName ?? '无机台'}，第${r.startDay}~${r.endDay}天(占${r.days}天)，${r.dueInDays != null ? `交期还有${r.dueInDays}天` : '无交期'}，${r.meetsDue === false ? '逾期风险' : r.meetsDue ? '可按期' : ''}`)
        .join('\n') +
      `\n请解读排产合理性、指出逾期风险并给调整建议。`
    const res = await this.llm.chat([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ])
    if (!res.ok) return fallback
    try {
      const parsed = JSON.parse(extractJson(res.content)) as { reasoning?: string; confidence?: number }
      return {
        source: 'llm',
        confidence: Math.min(Math.max(Number(parsed.confidence ?? 0.7), 0), 1),
        derivation,
        reasoning: parsed.reasoning ?? fallback.reasoning,
        data,
      }
    } catch (e) {
      this.log.warn(`LLM 排产解读解析失败，回退规则：${e instanceof Error ? e.message : e}`)
      return fallback
    }
  }
}

function extractJson(s: string): string {
  const t = s.trim()
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start >= 0 && end > start) return t.slice(start, end + 1)
  return t
}

/** 天数保留一位小数（0.1 天 ≈ 2.4 小时，够车间排班用，且避免浮点尾数在图上抖动） */
function r1(n: number): number {
  return Math.round(n * 10) / 10
}

/** 交期距今天数；null = 无交期 */
function dueIn(dueDate: string | null, today: dayjs.Dayjs): number | null {
  return dueDate ? Math.round(dayjs(dueDate).startOf('day').diff(today, 'day')) : null
}
