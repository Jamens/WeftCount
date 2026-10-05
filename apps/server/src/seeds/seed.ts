import { DataSource } from 'typeorm'
import * as bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { BUILTIN_ROLES } from '@weftcount/shared'
import { TenantEntity } from '../modules/tenant/entities/tenant.entity'
import { CompanyEntity } from '../modules/tenant/entities/company.entity'
import { RoleEntity } from '../modules/auth/entities/role.entity'
import { UserEntity } from '../modules/auth/entities/user.entity'

/**
 * 种子数据：创建一个演示租户 + 一个工厂 + 九个内置角色 + 三类演示账号
 *
 * 幂等：按 code 判断是否已存在，重复执行不会重复插入
 * 运行：pnpm --filter @weftcount/server seed
 */
export async function seed(ds: DataSource): Promise<void> {
  const tenants = ds.getRepository(TenantEntity)
  const companies = ds.getRepository(CompanyEntity)
  const roles = ds.getRepository(RoleEntity)
  const users = ds.getRepository(UserEntity)

  const TENANT_CODE = 'demo'
  let tenant = await tenants.findOne({ where: { code: TENANT_CODE } })
  if (!tenant) {
    tenant = await tenants.save(
      tenants.create({
        id: randomUUID(),
        code: TENANT_CODE,
        name: '示范织造集团',
        plan: 'flagship',
        status: 'active',
        maxCompanies: 3,
        maxUsers: 30,
        defaultCoefficients: {
          warpLossRate: 0.055,
          weftLossRate: 0.05,
          widthAllowance: 10,
          warpShrinkage: 0.05,
          weftShrinkage: 0.04,
          machineRunRate: 0.85,
        },
      }),
    )
    console.log(`[seed] 创建租户 ${tenant.name}`)
  } else {
    console.log(`[seed] 租户已存在: ${tenant.name}`)
  }

  let company = await companies.findOne({ where: { tenantId: tenant.id, code: 'F01' } })
  if (!company) {
    company = await companies.save(
      companies.create({
        id: randomUUID(),
        tenantId: tenant.id,
        code: 'F01',
        name: '示范织造厂',
        taxNo: '91330621MA2XXXXX1A',
        address: '浙江省绍兴市柯桥区',
        phone: '0575-88888888',
        status: 'active',
        coefficients: null,
      }),
    )
    console.log(`[seed] 创建公司 ${company.name}`)
  } else {
    console.log(`[seed] 公司已存在: ${company.name}`)
  }

  // 九个内置角色按租户复制，租户可改权限但不可删除
  for (const role of BUILTIN_ROLES) {
    const exists = await roles.findOne({ where: { tenantId: tenant.id, code: role.code } })
    if (exists) continue
    await roles.save(
      roles.create({
        id: randomUUID(),
        tenantId: tenant.id,
        code: role.code,
        name: role.name,
        description: role.description,
        permissions: [...role.permissions],
        builtin: true,
      }),
    )
  }
  console.log(`[seed] 内置角色就绪（共 ${BUILTIN_ROLES.length} 个）`)

  // 演示账号：密码统一 weft2026，提示部署后立即修改
  const demoPassword = 'weft2026'
  const hash = await bcrypt.hash(demoPassword, 10)
  const demoUsers = [
    { username: 'owner', realName: '集团管理员', roleCodes: ['tenant_owner'] },
    { username: 'factory', realName: '王厂长', roleCodes: ['company_admin'] },
    { username: 'craft', realName: '李工艺', roleCodes: ['craft_engineer'] },
    { username: 'warehouse', realName: '张仓管', roleCodes: ['warehouse_keeper'] },
    { username: 'loom', realName: '刘挡车', roleCodes: ['loom_operator'] },
  ]

  for (const u of demoUsers) {
    const exists = await users.findOne({ where: { username: u.username } })
    if (exists) continue
    await users.save(
      users.create({
        id: randomUUID(),
        tenantId: tenant.id,
        username: u.username,
        passwordHash: hash,
        realName: u.realName,
        phone: null,
        email: null,
        status: 'active',
        companyIds: [company.id],
        roleCodes: u.roleCodes,
        lastLoginAt: null,
        passwordChangedAt: new Date(),
        failedAttempts: 0,
      }),
    )
  }
  console.log(`[seed] 演示账号就绪（${demoUsers.length} 个，密码 ${demoPassword}）`)
}
