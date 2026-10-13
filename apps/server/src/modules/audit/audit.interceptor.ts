import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'
import { Observable, from, of, switchMap, tap } from 'rxjs'
import type { Request, Response } from 'express'
import type { AuditActionType, AuditTargetType } from '@weftcount/shared'
import { AuditService, type AuditInput } from './audit.service'
import { buildEntitySnapshot, buildSnapshot } from './audit-sanitizer'
import { AUDIT_TARGET_ENTITIES, SNAPSHOT_ACTIONS } from './audit-targets'
import { RequestContext } from '../auth/auth-context'

export const AUDIT_KEY = 'weftcount:audit'
export const NO_AUDIT_KEY = 'weftcount:noAudit'

export interface AuditMeta {
  action: AuditActionType
  module: string
  /** 从请求参数或响应中取目标 ID 的字段名 */
  targetIdParam?: string
  /** 从请求体中取目标类型的字段名 */
  targetTypeField?: string
  /**
   * 目标对象类型
   *
   * 限定为 `AuditTargetType`（shared 单一事实源），编译期就能挡住拼错的字面量。
   * 类型只约束书写、运行期靠 `AUDIT_TARGET_TYPES` 全集；
   * 两者不一致时模块加载会直接抛错（见 `audit-targets.ts`）。
   */
  targetType?: AuditTargetType
}

/** 声明接口的审计属性 */
export const Audit = (meta: AuditMeta) => SetMetadata(AUDIT_KEY, meta)

/** 标记接口不记审计（如登录本身由专用逻辑记录） */
export const NoAudit = () => SetMetadata(NO_AUDIT_KEY, true)

/** 写操作的方法 */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * 明确的只读 POST（查询类接口用了 POST 时排除）
 *
 * 注意：登录不在此列——「谁登录了系统」是最该被审计的一条，
 * 只是它的身份要从事务成功后的响应体里取（此时还没有令牌）。
 */
const READ_ONLY_PATHS = [/\/auth\/switch-company$/]

/**
 * 审计切面
 *
 * 记录所有写操作。设计取舍：
 * - 只有 POST/PUT/PATCH/DELETE 才记，GET 一律不记（否则日志表会被查询淹没）
 * - 未声明 @Audit 的接口按路径推断模块名，避免每个接口都忘加注解
 * - 任何异常都不向上抛，审计不该让业务失败
 * - 异步落库，不阻塞响应
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle()

    const req = context.switchToHttp().getRequest<Request & { ctx?: RequestContext }>()
    const res = context.switchToHttp().getResponse<Response>()
    const method = req.method.toUpperCase()

    // 显式跳过
    if (this.reflector.getAllAndOverride<boolean>(NO_AUDIT_KEY, [context.getHandler(), context.getClass()])) {
      return next.handle()
    }

    // 非写操作直接放行
    if (!WRITE_METHODS.has(method)) return next.handle()
    if (READ_ONLY_PATHS.some((p) => p.test(req.path))) return next.handle()

    const explicit = this.reflector.getAllAndOverride<AuditMeta>(AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ])

    const meta = explicit ?? this.inferMeta(req.path, method)
    const startedAt = Date.now()
    const ctx = req.ctx

    // 没有登录上下文就没有操作人身份，记了也无法追责。
    // 登录接口本身就是特例：此时还没有令牌，身份从事务成功后的响应体里取，
    // 由 handle() 内部的 resolveIdentity 兜住。
    if (!ctx) {
      return next.handle().pipe(
        tap({
          next: (data: unknown) => {
            const identity = this.resolveLoginIdentity(data)
            if (!identity) return
            void this.audit.record({
              ...identity,
              action: meta.action,
              module: meta.module,
              summary: `登录账号 ${identity.username}`,
              httpMethod: method,
              path: req.originalUrl ?? req.url,
              ip: this.extractIp(req),
              userAgent: req.headers['user-agent'],
              after: buildSnapshot((req as Request & { body?: unknown }).body),
              durationMs: Date.now() - startedAt,
            })
          },
        }),
      )
    }

    const bodySnapshot = buildSnapshot((req as Request & { body?: unknown }).body)
    const targetType = meta.targetType ?? this.pick(req, meta.targetTypeField)

    // 需要字段级前后快照的动作才做库内快照。
    // 这里是 async（要查库），所以先把 Observable 流铺开再进next.handle()，
    // 不能写成同步的 tap 前置逻辑。
    if (!targetType || !SNAPSHOT_ACTIONS.has(meta.action)) {
      return this.handle(next, {
        meta,
        method,
        req,
        startedAt,
        ctx,
        bodySnapshot,
        targetType,
        targetId: undefined,
        before: null,
      })
    }

    const targetId = this.pick(req, meta.targetIdParam) ?? this.pick(req, 'id')
    if (!targetId) {
      // 拿不到目标 id 就退化为请求体快照：
      // 宁可 before 为 null，也不能让审计整条丢失
      return this.handle(next, {
        meta,
        method,
        req,
        startedAt,
        ctx,
        bodySnapshot,
        targetType,
        targetId: undefined,
        before: null,
      })
    }

    return from(this.loadSnapshot(targetType, targetId, ctx.tenantId)).pipe(
      switchMap((before) =>
        this.handle(next, {
          meta,
          method,
          req,
          startedAt,
          ctx,
          bodySnapshot,
          targetType,
          targetId,
          before,
        }),
      ),
    )
  }

  /**
   * 执行业务并写审计
   *
   * 「后」快照在业务成功后才查库取——这是字段级审计的唯一可靠来源：
   * 请求体只是用户提交了什么，不等于库里最终是什么
   * （服务端会补默认字段、算工艺派生值、跑归一化）。
   */
  private handle(
    next: CallHandler,
    info: {
      meta: AuditMeta
      method: string
      req: Request & { ctx?: RequestContext }
      startedAt: number
      ctx: RequestContext
      bodySnapshot: Record<string, unknown> | null
      targetType?: string
      targetId?: string
      before: Record<string, unknown> | null
    },
  ): Observable<unknown> {
    const { meta, method, req, startedAt, ctx, bodySnapshot, targetType, targetId, before } = info

    return next.handle().pipe(
      switchMap((data: unknown) => {
        // ctx 已在 intercept() 里确保存在，这里直接取操作人身份
        const identity: Omit<AuditInput, 'action' | 'module' | 'httpMethod' | 'path'> = {
          tenantId: ctx.tenantId,
          companyId: ctx.companyId,
          userId: ctx.userId,
          username: ctx.username,
          realName: ctx.realName,
        }
        return from(this.loadSnapshot(targetType, targetId, ctx.tenantId)).pipe(
          switchMap((after) =>
            of(data).pipe(
              tap(() => {
                void this.audit.record({
                  ...identity,
                  action: meta.action,
                  module: meta.module,
                  summary: this.buildSummary(meta, req, data, targetId),
                  targetType,
                  targetId: targetId ?? this.pickFromResponse(data),
                  httpMethod: method,
                  path: req.originalUrl ?? req.url,
                  ip: this.extractIp(req),
                  userAgent: req.headers['user-agent'],
                  before,
                  // 有库内前快照却没有后快照，说明目标已被删除（如 delete 动作），
                  // 此时应展示「原值→空」，退回请求体会显示成「无变化」，是误导
                  after: before ? (after ?? this.deletedMarker(before)) : (after ?? bodySnapshot),
                  durationMs: Date.now() - startedAt,
                })
              }),
            ),
          ),
        )
      }),
      tap({
        error: () => {
          // 失败操作记warn，便于排查「谁在反复提交失败请求」
          void this.audit.record({
            tenantId: ctx.tenantId,
            companyId: ctx.companyId,
            userId: ctx.userId,
            username: ctx.username,
            realName: ctx.realName,
            action: meta.action,
            module: meta.module,
            summary: `操作失败: ${this.extractPath(req)}`,
            httpMethod: method,
            path: req.originalUrl ?? req.url,
            ip: this.extractIp(req),
            userAgent: req.headers['user-agent'],
            after: bodySnapshot,
            durationMs: Date.now() - startedAt,
          })
        },
      }),
    )
  }

  /**
   * 读取目标实体在库内的真实状态
   *
   * 三个「不查」的条件都要静默跳过，不能抛错：
   * 审计出问题绝不能影响主业务（与 `AuditService.record` 同一条铁律）
   */
  private async loadSnapshot(
    targetType: string | undefined,
    targetId: string | undefined,
    tenantId: string,
  ): Promise<Record<string, unknown> | null> {
    if (!targetType || !targetId) return null
    const entity = AUDIT_TARGET_ENTITIES[targetType]
    if (!entity) return null
    try {
      const repo = this.dataSource.getRepository(entity)
      // 必须带 tenantId：审计快照会把整行字段写进审计表，
      // 漏掉租户条件等于允许跨租户读取他人数据
      const row = await repo.findOne({ where: { id: targetId, tenantId } as never })
      return buildEntitySnapshot(row)
    } catch {
      return null
    }
  }

  /**
   * 目标已删除时的「后」快照占位
   *
   * 取前快照的键、值全部置 null，`computeDiff` 就能逐字段展示「原值 → 空」，
   * 而不是整个diff 变成空（用户会误以为没改过）。
   */
  private deletedMarker(before: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(before)) out[k] = null
    return out
  }

  /**
   * 从登录响应里解析操作人身份
   *
   * 只用于**登录接口**：此时还没有令牌，`req.ctx` 不存在，
   * 身份只能从事务成功后的响应体里取——
   * 否则「谁登录了系统」这条最该被审计的记录就永远记不上。
   */
  private resolveLoginIdentity(
    data: unknown,
  ): Omit<AuditInput, 'action' | 'module' | 'httpMethod' | 'path'> | null {
    // 登录响应：{ data: { user, tenant, currentCompanyId } }
    const d = (data as { data?: Record<string, unknown> } | null)?.data
    if (!d) return null
    const user = d.user as { id?: string; username?: string; realName?: string } | undefined
    const tenant = d.tenant as { id?: string } | undefined
    if (!user?.id || !tenant?.id) return null

    return {
      tenantId: tenant.id,
      // 登录时默认选中第一个公司；切换公司另有接口记录
      companyId: (d.currentCompanyId as string) ?? '',
      userId: user.id,
      username: user.username ?? '',
      realName: user.realName ?? '',
    }
  }

  /** 未声明 @Audit 时按路径推断模块 */
  private inferMeta(path: string, method: string): AuditMeta {
    const clean = path.replace(/^\/api\/?/, '')
    const seg = clean.split('/').filter(Boolean)
    const module = seg[0] ?? 'unknown'
    const actionMap: Record<string, AuditActionType> = {
      POST: 'create',
      PUT: 'update',
      PATCH: 'update',
      DELETE: 'delete',
    }
    // login / logout 这类动作名本身就是动作
    if (seg.length > 1 && ['login', 'logout'].includes(seg[1])) {
      return { action: seg[1] as AuditActionType, module }
    }
    return { action: actionMap[method] ?? 'update', module, targetIdParam: 'id' }
  }

  private buildSummary(
    meta: AuditMeta,
    req: Request,
    data: unknown,
    resolvedId?: string,
  ): string {
    const labels: Record<AuditActionType, string> = {
      create: '新建',
      update: '修改',
      delete: '删除',
      submit: '提交',
      approve: '审核通过',
      reject: '审核驳回',
      cancel: '作废',
      login: '登录',
      logout: '登出',
      export: '导出',
      print: '打印',
      ai_call: 'AI 调用',
    }
    const label = labels[meta.action] ?? meta.action
    const id = resolvedId ?? this.pick(req, meta.targetIdParam) ?? this.pickFromResponse(data)
    return id ? `${label} ${meta.module} #${id}` : `${label} ${meta.module}`
  }

  private pick(req: Request, field?: string): string | undefined {
    if (!field) return undefined
    const src = {
      ...((req as Request & { params?: Record<string, string> }).params ?? {}),
      ...((req as Request & { body?: Record<string, unknown> }).body ?? {}),
      ...((req as unknown as { query?: Record<string, string> }).query ?? {}),
    }
    const v = src[field]
    return v === undefined || v === null ? undefined : String(v)
  }

  /** 从响应体里捞 id，兼容 envelope 包装 */
  private pickFromResponse(data: unknown): string | undefined {
    if (!data || typeof data !== 'object') return undefined
    const d = data as { id?: unknown; data?: { id?: unknown } }
    const id = d.data?.id ?? d.id
    return id === undefined || id === null ? undefined : String(id)
  }

  private extractIp(req: Request): string | undefined {
    const fwd = req.headers['x-forwarded-for']
    if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim()
    return req.ip ?? req.socket?.remoteAddress ?? undefined
  }

  private extractPath(req: Request): string {
    return req.originalUrl ?? req.url
  }
}
