import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, FindOptionsWhere, Between, Like, type FindOptionsOrder } from 'typeorm'
import type { AuditActionType } from '@weftcount/shared'
import { AuditLogEntity } from './entities/audit-log.entity'
import { buildSnapshot, computeDiff, maskSensitive } from './audit-sanitizer'

export interface AuditInput {
  tenantId: string
  companyId: string
  userId: string
  username: string
  realName: string
  action: AuditActionType
  module: string
  summary?: string
  targetType?: string
  targetId?: string
  httpMethod: string
  path: string
  ip?: string
  userAgent?: string
  /** 更新前快照，由 service 层在修改前抓取 */
  before?: Record<string, unknown> | null
  /** 更新后快照，通常是请求体 */
  after?: Record<string, unknown> | null
  durationMs?: number
}

export interface AuditQuery {
  tenantId: string
  companyId: string
  page?: number
  pageSize?: number
  userId?: string
  module?: string
  action?: string
  targetType?: string
  targetId?: string
  keyword?: string
  from?: Date
  to?: Date
}

export interface AuditQueryResult {
  records: AuditLogEntity[]
  total: number
  page: number
  pageSize: number
}

const MAX_SUMMARY = 128
const MAX_USER_AGENT = 255
const MAX_PATH = 255

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name)

  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly repo: Repository<AuditLogEntity>,
  ) {}

  /**
   * 写入一条审计记录
   *
   * 关键设计：**审计失败绝不能影响主业务**。
   * 切面里任何异常都会被吞掉并只记 warn 日志——宁可丢一条审计，
   * 也不能因为审计表写不进去而让用户的采购单下不了。
   */
  async record(input: AuditInput): Promise<void> {
    try {
      const after = input.after ?? null
      const diff = input.after
        ? computeDiff(input.before ?? null, after)
        : input.before
          ? { 快照: { before: null, after: maskSensitive(input.before) } }
          : null

      await this.repo.insert({
        tenantId: input.tenantId,
        companyId: input.companyId,
        userId: input.userId,
        username: input.username,
        realName: input.realName,
        action: input.action,
        module: input.module.slice(0, 64),
        summary: input.summary ? input.summary.slice(0, MAX_SUMMARY) : null,
        targetType: input.targetType?.slice(0, 64) ?? null,
        targetId: input.targetId?.slice(0, 64) ?? null,
        httpMethod: input.httpMethod.slice(0, 8),
        path: input.path.slice(0, MAX_PATH),
        ip: input.ip?.slice(0, 64) ?? null,
        userAgent: input.userAgent?.slice(0, MAX_USER_AGENT) ?? null,
        // json 列需显式转型：QueryDeepPartial 对 Record 类型过于严格
        diff: diff as never,
        durationMs: input.durationMs ?? null,
      })
    } catch (e) {
      this.logger.warn(
        `审计写入失败（已忽略，不影响主业务）: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }

  /**
   * 记录更新操作的变更前后快照
   * service 层在修改前调用 before() 抓取原值
   */
  async recordUpdate(
    base: Omit<AuditInput, 'before' | 'after'>,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
  ): Promise<void> {
    await this.record({ ...base, before, after })
  }

  /** 分页查询审计日志 */
  async query(q: AuditQuery): Promise<AuditQueryResult> {
    const page = Math.max(1, q.page ?? 1)
    const pageSize = Math.min(200, Math.max(1, q.pageSize ?? 20))

    const where: FindOptionsWhere<AuditLogEntity> = {
      tenantId: q.tenantId,
      companyId: q.companyId,
    }
    if (q.userId) where.userId = q.userId
    if (q.module) where.module = Like(`${q.module}%`)
    if (q.action) where.action = q.action as AuditActionType
    if (q.targetType) where.targetType = q.targetType
    if (q.targetId) where.targetId = q.targetId
    if (q.from || q.to) {
      // Between 接受两端，其中一端可为 undefined
      where.createdAt = Between(q.from ?? new Date(0), q.to ?? new Date('2999-12-31'))
    }

    // 关键字模糊匹配用户名与操作摘要
    if (q.keyword) {
      const kw = `%${q.keyword}%`
      const candidates = await this.repo.find({
        where: [
          { ...where, username: Like(kw) },
          { ...where, realName: Like(kw) },
          { ...where, summary: Like(kw) },
        ],
        order: { createdAt: 'DESC' } as FindOptionsOrder<AuditLogEntity>,
        take: pageSize,
        skip: (page - 1) * pageSize,
      })
      const total = await this.repo.count({ where })
      return { records: candidates, total, page, pageSize }
    }

    const [records, total] = await this.repo.findAndCount({
      where,
      order: { createdAt: 'DESC' } as FindOptionsOrder<AuditLogEntity>,
      take: pageSize,
      skip: (page - 1) * pageSize,
    })
    return { records, total, page, pageSize }
  }

  /** 查询某对象的完整变更史 */
  async queryByTarget(
    tenantId: string,
    targetType: string,
    targetId: string,
  ): Promise<AuditLogEntity[]> {
    return this.repo.find({
      where: { tenantId, targetType, targetId } satisfies FindOptionsWhere<AuditLogEntity>,
      order: { createdAt: 'DESC' } as FindOptionsOrder<AuditLogEntity>,
      take: 200,
    })
  }

  /** 抓取更新前的快照，供 service 层在修改前调用 */
  snapshot(entity: unknown): Record<string, unknown> | null {
    if (!entity || typeof entity !== 'object') return null
    return buildSnapshot(entity)
  }
}
