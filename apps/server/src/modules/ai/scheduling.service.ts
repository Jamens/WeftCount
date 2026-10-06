import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository } from 'typeorm'
import dayjs from 'dayjs'
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
    for (const o of pending) {
      if (!o.machineId) continue
      const { days, daily } = await this.orderDays(tenantId, companyId, o)
      if (o.status === 'in_progress') {
        const remain = Math.max(Number(o.plannedQuantityM) - Number(o.producedQuantityM), 0)
        load.set(o.machineId, (load.get(o.machineId) ?? 0) + (daily > 0 ? remain / daily : 0))
      } else if (o.status === 'scheduled') {
        load.set(o.machineId, (load.get(o.machineId) ?? 0) + days)
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
      const dueInDays = o.dueDate ? Math.round(dayjs(o.dueDate).startOf('day').diff(today, 'day')) : null
      rows.push({
        orderId: o.id, orderNo: o.orderNo, specName,
        plannedMeters: Number(o.plannedQuantityM),
        machineId,
        machineName: machineId ? (machines.find((m) => m.id === machineId)?.name ?? null) : null,
        days: Math.round(days * 10) / 10,
        startDay: Math.round(start * 10) / 10,
        endDay: Math.round(end * 10) / 10,
        dueInDays,
        meetsDue: dueInDays == null ? null : end <= dueInDays,
        dailyOutputM: daily,
      })
    }

    const atRiskCount = rows.filter((r) => r.meetsDue === false).length
    return { rows, orderCount: rows.length, atRiskCount, machineCount: machines.length }
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
