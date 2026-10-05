import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import type { Request } from 'express'
import { ErrorCode } from '@weftcount/shared'
import { UserEntity } from '../entities/user.entity'
import { RoleEntity } from '../entities/role.entity'
import { CompanyEntity } from '../../tenant/entities/company.entity'
import { TenantEntity } from '../../tenant/entities/tenant.entity'
import { extractContext, type RequestContext } from '../auth-context'
import { expandPermissions, hasPermission } from '../permissions'
import { PERMISSION_KEY, type PermissionRequirement } from '../decorators/require-permission.decorator'
import type { AuthUserPayload } from '../types'

/**
 * 认证 + 租户上下文守卫
 *
 * 职责：
 * 1. 校验 JWT，把载荷挂到 req.user
 * 2. 校验用户状态（停用/锁定后令牌立即失效）
 * 3. 校验租户状态（停用/过期后令牌立即失效）
 * 4. 校验公司归属（防止通过改请求头越权访问他公司数据）
 * 5. 校验 @RequirePermission 声明的权限码
 *
 * 设计取舍：把租户/公司/状态校验放在守卫而非仅靠拦截器，
 * 是因为「拿到令牌」不等于「有权访问这份数据」，多租户系统必须每次请求都复核。
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(RoleEntity)
    private readonly roles: Repository<RoleEntity>,
    @InjectRepository(CompanyEntity)
    private readonly companies: Repository<CompanyEntity>,
    @InjectRepository(TenantEntity)
    private readonly tenants: Repository<TenantEntity>,
  ) {}

  async canActivate(host: ExecutionContext): Promise<boolean> {
    const req = host.switchToHttp().getRequest<Request & { user?: AuthUserPayload; ctx?: RequestContext }>()
    const token = this.extractToken(req)
    if (!token) {
      throw new UnauthorizedException({ code: ErrorCode.LOGIN_FAILED, message: '未提供访问令牌' })
    }

    let payload: AuthUserPayload
    try {
      payload = await this.jwt.verifyAsync<AuthUserPayload>(token)
    } catch (e) {
      const expired = e instanceof Error && e.name === 'TokenExpiredError'
      throw new UnauthorizedException({
        code: expired ? ErrorCode.TOKEN_EXPIRED : ErrorCode.LOGIN_FAILED,
        message: expired ? '登录已过期，请重新登录' : '访问令牌无效',
      })
    }
    req.user = payload

    const user = await this.users.findOne({ where: { id: payload.sub } })
    if (!user) {
      throw new UnauthorizedException({ code: ErrorCode.LOGIN_FAILED, message: '用户不存在' })
    }
    if (user.status !== 'active') {
      throw new UnauthorizedException({
        code: ErrorCode.ACCOUNT_DISABLED,
        message: user.status === 'locked' ? '账号已锁定' : '账号已停用',
      })
    }

    const tenant = await this.tenants.findOne({ where: { id: user.tenantId } })
    if (!tenant) {
      throw new UnauthorizedException({ code: ErrorCode.TENANT_NOT_FOUND, message: '所属租户不存在' })
    }
    if (tenant.status !== 'active') {
      throw new UnauthorizedException({
        code: ErrorCode.TENANT_SUSPENDED,
        message: tenant.status === 'expired' ? '订阅已到期' : '服务已暂停',
      })
    }

    // 从请求头取租户/公司，并校验与令牌自洽
    const base = extractContext(req)

    // 请求头的 tenantId 必须与令牌一致，防止跨租户访问
    if (base.tenantId !== user.tenantId) {
      throw new UnauthorizedException({
        code: ErrorCode.FORBIDDEN,
        message: '租户标识与登录身份不符',
      })
    }
    if (!user.companyIds.includes(base.companyId)) {
      throw new UnauthorizedException({
        code: ErrorCode.FORBIDDEN,
        message: '无权访问该公司',
      })
    }

    const company = await this.companies.findOne({ where: { id: base.companyId } })
    if (!company || company.status !== 'active') {
      throw new UnauthorizedException({
        code: ErrorCode.COMPANY_NOT_FOUND,
        message: '公司不存在或已关闭',
      })
    }

    // 展开权限
    const permissions = await this.resolvePermissions(user)

    req.ctx = { ...base, permissions, roleCodes: user.roleCodes }

    // 校验声明式权限（任一满足即可）
    const required = this.reflector.getAllAndOverride<PermissionRequirement>(PERMISSION_KEY, [
      host.getHandler(),
      host.getClass(),
    ])
    if (required) {
      const needed: string[] = Array.isArray(required) ? required : [required]
      const missing = needed.filter((p) => !hasPermission(permissions, p))
      if (missing.length === 0) {
        return true
      }
      // 全部不满足时，若只声明了一个权限就报缺哪个；声明多个时报缺少清单
      throw new UnauthorizedException({
        code: ErrorCode.FORBIDDEN,
        message:
          needed.length === 1
            ? '无权访问，缺少权限：' + needed[0]
            : `无权访问，缺少权限：${missing.join('、')}`,
      })
    }

    return true
  }

  /**
   * 展开用户实际拥有的权限码
   * 角色是租户级的，取当前租户下该用户所有角色的权限并集
   */
  private async resolvePermissions(user: UserEntity): Promise<string[]> {
    if (!user.roleCodes.length) return []
    const roleEntities = await this.roles.find({
      where: user.roleCodes.map((code) => ({ tenantId: user.tenantId, code })),
    })
    return expandPermissions(roleEntities.map((r) => r.permissions))
  }

  private extractToken(req: Request): string | undefined {
    const auth = req.headers.authorization
    if (!auth) return undefined
    const [scheme, value] = auth.split(' ')
    if (!value || scheme.toLowerCase() !== 'bearer') return undefined
    return value.trim()
  }
}
