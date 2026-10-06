import { Injectable, UnauthorizedException, BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository } from 'typeorm'
import { randomUUID } from 'node:crypto'
import * as bcrypt from 'bcryptjs'
import { ErrorCode, PLAN_LIMITS, type UserStatus } from '@weftcount/shared'
import {
  type CompanyOption,
  type CreateRoleDto,
  type CreateUserDto,
  type ResetPasswordDto,
  type SafeUser,
  type UpdateRoleDto,
  type UpdateUserDto,
} from './dtos/admin.dto'
import { UserEntity } from './entities/user.entity'
import { RoleEntity } from './entities/role.entity'
import { CompanyEntity } from '../tenant/entities/company.entity'
import { TenantEntity } from '../tenant/entities/tenant.entity'
import type { AuthUserPayload, LoginResult } from './types'
import { expandPermissions, hasPermission, WORKSHOP_VIEW_PERM } from './permissions'

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

  /**
   * 账号有效权限（账号权限管理的关键一环）
   *
   * 返回：各角色及其权限 + **多角色并集后的有效权限** + 该账号在车间工作台能看到的页面。
   * 角色是授权模板，一个账号可挂多个角色，实际权限是**并集**——不显式算出并集，
   * 管理员无法确认「这个人到底能干什么」。全部为已落库的确定性事实。
   */
  async userEffectivePermissions(tenantId: string, userId: string) {
    const user = await this.users.findOne({ where: { id: userId, tenantId } })
    if (!user) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: '用户不存在' })
    }
    const roleEntities = user.roleCodes.length
      ? await this.roles.find({
          where: user.roleCodes.map((code) => ({ tenantId, code })),
        })
      : []
    const effective = expandPermissions(roleEntities.map((r) => r.permissions))
    // 该账号在车间工作台(desktop)可见的页面（按 shared 的视图→权限映射）
    const workshopViews = Object.entries(WORKSHOP_VIEW_PERM)
      .filter(([, perm]) => hasPermission(effective, perm))
      .map(([view]) => view)
    return {
      user: { id: user.id, username: user.username, realName: user.realName, status: user.status },
      roles: roleEntities.map((r) => ({ code: r.code, name: r.name, permissions: r.permissions })),
      effective,
      workshopViews,
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

  // -------------------------------------------------------------------------
  // 角色管理（内置角色系统所有；租户可查看 / 编辑权限，不可删除内置角色）
  // -------------------------------------------------------------------------

  async listRoles(tenantId: string): Promise<RoleEntity[]> {
    return this.roles.find({ where: { tenantId }, order: { builtin: 'DESC', code: 'ASC' } })
  }

  async createRole(tenantId: string, dto: CreateRoleDto): Promise<RoleEntity> {
    const exists = await this.roles.findOne({ where: { tenantId, code: dto.code } })
    if (exists) {
      throw new ConflictException({ code: ErrorCode.DUPLICATE_CODE, message: `角色编码 ${dto.code} 已存在` })
    }
    return this.roles.save(
      this.roles.create({
        id: randomUUID(),
        tenantId,
        code: dto.code,
        name: dto.name,
        description: dto.description ?? null,
        permissions: dto.permissions,
        builtin: false,
      }),
    )
  }

  async updateRole(tenantId: string, id: string, dto: UpdateRoleDto): Promise<RoleEntity> {
    const role = await this.roles.findOne({ where: { id, tenantId } })
    if (!role) throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: '角色不存在' })
    if (dto.name !== undefined) role.name = dto.name
    if (dto.description !== undefined) role.description = dto.description
    if (dto.permissions !== undefined) role.permissions = dto.permissions
    return this.roles.save(role)
  }

  async deleteRole(tenantId: string, id: string): Promise<void> {
    const role = await this.roles.findOne({ where: { id, tenantId } })
    if (!role) throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: '角色不存在' })
    if (role.builtin) {
      throw new ForbiddenException({ code: ErrorCode.FORBIDDEN, message: '内置角色不可删除' })
    }
    const users = await this.users.find({ where: { tenantId }, select: ['id', 'roleCodes'] })
    if (users.some((u) => u.roleCodes.includes(role.code))) {
      throw new ConflictException({
        code: ErrorCode.CONFLICT,
        message: `角色「${role.name}」仍被用户使用，无法删除`,
      })
    }
    await this.roles.remove(role)
  }

  // -------------------------------------------------------------------------
  // 用户管理
  // -------------------------------------------------------------------------

  private async toSafeUser(
    user: UserEntity,
    companies: CompanyEntity[],
    roles: RoleEntity[],
  ): Promise<SafeUser> {
    const companyNames = user.companyIds
      .map((cid) => companies.find((c) => c.id === cid)?.name)
      .filter((n): n is string => !!n)
    const roleNames = user.roleCodes
      .map((rc) => roles.find((r) => r.code === rc)?.name)
      .filter((n): n is string => !!n)
    return {
      id: user.id,
      username: user.username,
      realName: user.realName,
      phone: user.phone,
      email: user.email,
      status: user.status,
      companyIds: user.companyIds,
      companyNames,
      roleCodes: user.roleCodes,
      roleNames,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    }
  }

  async listUsers(tenantId: string): Promise<{ users: SafeUser[]; companies: CompanyOption[] }> {
    const [users, companies, roles] = await Promise.all([
      this.users.find({ where: { tenantId }, order: { createdAt: 'ASC' } }),
      this.companies.find({ where: { tenantId }, order: { code: 'ASC' } }),
      this.roles.find({ where: { tenantId } }),
    ])
    return {
      users: await Promise.all(users.map((u) => this.toSafeUser(u, companies, roles))),
      companies: companies.map((c) => ({ id: c.id, code: c.code, name: c.name })),
    }
  }

  async createUser(tenantId: string, dto: CreateUserDto): Promise<SafeUser> {
    const existing = await this.users.findOne({ where: { username: dto.username } })
    if (existing) {
      throw new ConflictException({ code: ErrorCode.DUPLICATE_CODE, message: `账号 ${dto.username} 已存在` })
    }
    const companies = await this.companies.find({ where: { id: In(dto.companyIds) } })
    if (companies.length !== dto.companyIds.length || !companies.every((c) => c.tenantId === tenantId)) {
      throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: '关联公司非法' })
    }
    const roles = await this.roles.find({ where: dto.roleCodes.map((code) => ({ tenantId, code })) })
    if (roles.length !== dto.roleCodes.length) {
      throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: '分配了不存在的角色' })
    }
    this.validatePasswordStrength(dto.password)
    const user = await this.users.save(
      this.users.create({
        id: randomUUID(),
        tenantId,
        username: dto.username,
        passwordHash: await bcrypt.hash(dto.password, 10),
        realName: dto.realName,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        status: 'active',
        companyIds: dto.companyIds,
        roleCodes: dto.roleCodes,
        failedAttempts: 0,
        passwordChangedAt: new Date(),
      }),
    )
    return this.toSafeUser(user, companies, roles)
  }

  async updateUser(tenantId: string, id: string, dto: UpdateUserDto): Promise<SafeUser> {
    const user = await this.users.findOne({ where: { id, tenantId } })
    if (!user) throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: '用户不存在' })
    if (dto.realName !== undefined) user.realName = dto.realName
    if (dto.phone !== undefined) user.phone = dto.phone
    if (dto.email !== undefined) user.email = dto.email
    if (dto.status !== undefined) user.status = dto.status
    if (dto.companyIds !== undefined) {
      const companies = await this.companies.find({ where: { id: In(dto.companyIds) } })
      if (companies.length !== dto.companyIds.length || !companies.every((c) => c.tenantId === tenantId)) {
        throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: '关联公司非法' })
      }
      user.companyIds = dto.companyIds
    }
    if (dto.roleCodes !== undefined) {
      const roles = await this.roles.find({ where: dto.roleCodes.map((code) => ({ tenantId, code })) })
      if (roles.length !== dto.roleCodes.length) {
        throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: '分配了不存在的角色' })
      }
      user.roleCodes = dto.roleCodes
    }
    if (dto.password !== undefined) {
      this.validatePasswordStrength(dto.password)
      if (await bcrypt.compare(dto.password, user.passwordHash)) {
        throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: '新密码不能与原密码相同' })
      }
      user.passwordHash = await bcrypt.hash(dto.password, 10)
      user.passwordChangedAt = new Date()
    }
    const [companies, roles] = await Promise.all([
      this.companies.find({ where: { tenantId } }),
      this.roles.find({ where: { tenantId } }),
    ])
    return this.toSafeUser(await this.users.save(user), companies, roles)
  }

  async resetPassword(tenantId: string, id: string, dto: ResetPasswordDto): Promise<void> {
    const user = await this.users.findOne({ where: { id, tenantId } })
    if (!user) throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: '用户不存在' })
    this.validatePasswordStrength(dto.newPassword)
    if (await bcrypt.compare(dto.newPassword, user.passwordHash)) {
      throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: '新密码不能与原密码相同' })
    }
    user.passwordHash = await bcrypt.hash(dto.newPassword, 10)
    user.passwordChangedAt = new Date()
    user.failedAttempts = 0
    if (user.status === 'locked') user.status = 'active'
    await this.users.save(user)
  }

  /** 根据 id 取用户（供守卫用） */
  findById(id: string): Promise<UserEntity | null> {
    return this.users.findOne({ where: { id } })
  }
}
