import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Observable, tap } from 'rxjs'
import type { Request, Response } from 'express'
import type { AuditActionType } from '@weftcount/shared'
import { AuditService, type AuditInput } from './audit.service'
import { buildSnapshot } from './audit-sanitizer'
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
   * 目标对象类型（**字面量**，推荐直接写）
   *
   * 不填则targetType 恒为 null，`/audit-logs/target`（按对象查变更史）**永远查不到**——
   * 该端点依赖 `targetType + targetId` 组合匹配。只有 targetId 没用，类型缺失就匹配不上。
   */
  targetType?: string
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
    const bodySnapshot = buildSnapshot((req as Request & { body?: unknown }).body)

    return next.handle().pipe(
      tap({
        // 业务成功才记审计：失败的操作由全局异常过滤器记error 日志，
        // 避免「点了没反应」这类无效操作也进审计表
        next: (data: unknown) => {
          const identity = this.resolveIdentity(ctx, data)
          if (!identity) return
          void this.audit.record({
            ...identity,
            action: meta.action,
            module: meta.module,
            summary:
              meta.action === 'login'
                ? `登录账号 ${identity.username}`
                : this.buildSummary(meta, req, data),
            targetType: meta.targetType ?? this.pick(req, meta.targetTypeField),
            targetId: this.pick(req, meta.targetIdParam) ?? this.pickFromResponse(data),
            httpMethod: method,
            path: req.originalUrl ?? req.url,
            ip: this.extractIp(req),
            userAgent: req.headers['user-agent'],
            after: bodySnapshot,
            durationMs: Date.now() - startedAt,
          })
        },
        error: () => {
          // 失败操作记 warn，便于排查「谁在反复提交失败请求」
          if (!ctx) return
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
   * 解析操作人身份
   *
   * 常规接口从 AuthGuard 写入的 req.ctx 取；
   * 登录接口此时还没有令牌，身份要从事务成功后的响应体里取——
   * 否则「谁登录了系统」这条最关键的审计就永远记不上。
   */
  private resolveIdentity(
    ctx: RequestContext | undefined,
    data: unknown,
  ): Omit<AuditInput, 'action' | 'module' | 'httpMethod' | 'path'> | null {
    if (ctx) {
      return {
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        userId: ctx.userId,
        username: ctx.username,
        realName: ctx.realName,
      }
    }

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

  private buildSummary(meta: AuditMeta, req: Request, data: unknown): string {
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
    const id = this.pick(req, meta.targetIdParam) ?? this.pickFromResponse(data)
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
