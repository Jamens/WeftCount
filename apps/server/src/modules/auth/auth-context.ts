import { createParamDecorator, ExecutionContext, Injectable } from '@nestjs/common'
import type { Request } from 'express'
import { ErrorCode } from '@weftcount/shared'

export const TENANT_HEADER = 'x-tenant-id'
export const COMPANY_HEADER = 'x-company-id'

/**
 * 当前请求的租户上下文
 *
 * 隔离策略：所有业务查询必须带上 companyId，从源头防止越权读数。
 * 上下文从 JWT 载荷 + 请求头共同确定：
 *   - JWT 提供可信的 userId / tenantId / roleCodes
 *   - 请求头提供本次操作的目标 companyId（用户可跨公司）
 * 两者必须自洽：companyId 必须属于该用户，否则拒绝。
 */
export interface RequestContext {
  userId: string
  tenantId: string
  companyId: string
  username: string
  realName: string
  /** 展开后的权限码集合 */
  permissions: string[]
  roleCodes: string[]
}

declare module 'express' {
  interface Request {
    ctx?: RequestContext
  }
}

/** 读取请求头（兼容大小写） */
function header(req: Request, name: string): string | undefined {
  const v = req.headers[name]
  if (Array.isArray(v)) return v[0]
  return v?.trim() || undefined
}

export function extractContext(req: Request): Omit<RequestContext, 'permissions'> {
  const tenantId = header(req, TENANT_HEADER)
  const companyId = header(req, COMPANY_HEADER)

  if (!tenantId) {
    throw new Error(`${ErrorCode.TENANT_NOT_FOUND}:缺少租户标识`)
  }
  if (!companyId) {
    throw new Error(`${ErrorCode.COMPANY_NOT_FOUND}:缺少公司标识`)
  }
  return {
    userId: (req as Request & { user?: { sub: string; username: string; realName: string; roleCodes: string[] } }).user!.sub,
    tenantId,
    companyId,
    username: (req as Request & { user?: { username: string } }).user!.username,
    realName: (req as Request & { user?: { realName: string } }).user!.realName,
    roleCodes: (req as Request & { user?: { roleCodes: string[] } }).user!.roleCodes ?? [],
  }
}

export const CurrentUser = createParamDecorator((_data: unknown, host: ExecutionContext) => {
  const req = host.switchToHttp().getRequest<Request & { ctx?: RequestContext }>()
  return req.ctx
})
