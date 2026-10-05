import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository } from 'typeorm'
import * as bcrypt from 'bcryptjs'
import { ErrorCode, PLAN_LIMITS } from '@weftcount/shared'
import { UserEntity } from './entities/user.entity'
import { RoleEntity } from './entities/role.entity'
import { CompanyEntity } from '../tenant/entities/company.entity'
import { TenantEntity } from '../tenant/entities/tenant.entity'
import type { AuthUserPayload, LoginResult } from './types'
import { expandPermissions } from './permissions'

const MAX_FAILED_ATTEMPTS = 5

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(RoleEntity)
    private readonly roles: Repository<RoleEntity>,
    @InjectRepository(CompanyEntity)
    private readonly companies: Repository<CompanyEntity>,
    @InjectRepository(TenantEntity)
    private readonly tenants: Repository<TenantEntity>,
    private readonly jwt: JwtService,
  ) {}

  /**
   * 账号密码登录
   *
   * 安全约定：
   * - 用户名不存在与密码错误返回同一错误码，避免账号枚举
   * - 连续失败达阈值锁定账号，防暴力破解
   * - 租户停用/过期时直接拒绝，不签发令牌
   */
  async login(username: string, password: string): Promise<LoginResult> {
    const user = await this.users.findOne({ where: { username } })

    if (!user) {
      throw new UnauthorizedException({
        code: ErrorCode.LOGIN_FAILED,
        message: '账号或密码错误',
      })
    }

    if (user.status === 'disabled') {
      throw new UnauthorizedException({
        code: ErrorCode.ACCOUNT_DISABLED,
        message: '账号已停用，请联系管理员',
      })
    }

    if (user.status === 'locked' || user.failedAttempts >= MAX_FAILED_ATTEMPTS) {
      throw new UnauthorizedException({
        code: ErrorCode.ACCOUNT_DISABLED,
        message: '账号已锁定，请联系管理员解锁',
      })
    }

    const ok = await bcrypt.compare(password, user.passwordHash)
    if (!ok) {
      user.failedAttempts += 1
      if (user.failedAttempts >= MAX_FAILED_ATTEMPTS) {
        user.status = 'locked'
      }
      await this.users.save(user)
      throw new UnauthorizedException({
        code: ErrorCode.PASSWORD_WRONG,
        message: '账号或密码错误',
      })
    }

    // 密码正确：检查租户状态
    const tenant = await this.tenants.findOne({ where: { id: user.tenantId } })
    if (!tenant) {
      throw new UnauthorizedException({
        code: ErrorCode.TENANT_NOT_FOUND,
        message: '所属租户不存在',
      })
    }
    if (tenant.status !== 'active') {
      throw new UnauthorizedException({
        code: ErrorCode.TENANT_SUSPENDED,
        message: tenant.status === 'expired' ? '订阅已到期，请续费后使用' : '服务已暂停，请联系客服',
      })
    }

    // 重置失败计数
    user.failedAttempts = 0
    user.lastLoginAt = new Date()
    await this.users.save(user)

    return this.issueToken(user, tenant)
  }

  /** 签发令牌并返回登录上下文 */
  private async issueToken(user: UserEntity, tenant: TenantEntity): Promise<LoginResult> {
    const roleEntities = user.roleCodes.length
      ? await this.roles.find({
          where: user.roleCodes.map((code) => ({ tenantId: user.tenantId, code })),
        })
      : []
    const permissions = expandPermissions(roleEntities.map((r) => r.permissions))

    // 用户可访问的公司（剔除已关闭的）
    const companyEntities = user.companyIds.length
      ? await this.companies.find({ where: { id: In(user.companyIds) } })
      : []
    const activeCompanies = companyEntities.filter((c) => c.status === 'active')

    if (activeCompanies.length === 0) {
      throw new BadRequestException({
        code: ErrorCode.COMPANY_NOT_FOUND,
        message: '账号未关联有效公司，请联系管理员',
      })
    }

    const planLimits = PLAN_LIMITS[tenant.plan]
    const payload: AuthUserPayload = {
      sub: user.id,
      tenantId: user.tenantId,
      username: user.username,
      realName: user.realName,
      roleCodes: user.roleCodes,
    }
    const accessToken = await this.jwt.signAsync(payload)

    return {
      accessToken,
      tokenType: 'Bearer',
      user: {
        id: user.id,
        username: user.username,
        realName: user.realName,
        phone: user.phone,
        email: user.email,
      },
      tenant: {
        id: tenant.id,
        code: tenant.code,
        name: tenant.name,
        plan: tenant.plan,
        planLabel: planLimits.label,
        aiEnabled: planLimits.aiEnabled,
      },
      companies: activeCompanies.map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
      })),
      currentCompanyId: activeCompanies[0].id,
      permissions,
    }
  }

  /** 切换当前操作公司 */
  async switchCompany(userId: string, companyId: string): Promise<{ companyId: string }> {
    const user = await this.users.findOne({ where: { id: userId } })
    if (!user) {
      throw new UnauthorizedException({ code: ErrorCode.LOGIN_FAILED, message: '用户不存在' })
    }
    if (!user.companyIds.includes(companyId)) {
      throw new UnauthorizedException({
        code: ErrorCode.FORBIDDEN,
        message: '无权访问该公司',
      })
    }
    const company = await this.companies.findOne({ where: { id: companyId } })
    if (!company || company.status !== 'active') {
      throw new BadRequestException({
        code: ErrorCode.COMPANY_NOT_FOUND,
        message: '公司不存在或已关闭',
      })
    }
    return { companyId }
  }

  /** 修改密码 */
  async changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void> {
    const user = await this.users.findOne({ where: { id: userId } })
    if (!user) {
      throw new UnauthorizedException({ code: ErrorCode.LOGIN_FAILED, message: '用户不存在' })
    }
    const ok = await bcrypt.compare(oldPassword, user.passwordHash)
    if (!ok) {
      throw new BadRequestException({ code: ErrorCode.PASSWORD_WRONG, message: '原密码错误' })
    }
    this.validatePasswordStrength(newPassword)
    if (await bcrypt.compare(newPassword, user.passwordHash)) {
      throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: '新密码不能与原密码相同' })
    }
    user.passwordHash = await bcrypt.hash(newPassword, 10)
    user.passwordChangedAt = new Date()
    await this.users.save(user)
  }

  private validatePasswordStrength(password: string): void {
    if (password.length < 8) {
      throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: '密码至少 8 位' })
    }
    if (password.length > 64) {
      throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: '密码不能超过 64 位' })
    }
    if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: '密码必须同时包含字母和数字',
      })
    }
  }

  /** 根据 id 取用户（供守卫用） */
  findById(id: string): Promise<UserEntity | null> {
    return this.users.findOne({ where: { id } })
  }
}
