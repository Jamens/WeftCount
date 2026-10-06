import { DataSource } from 'typeorm'
import * as bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { BUILTIN_ROLES } from '@weftcount/shared'
import { TenantEntity } from '../modules/tenant/entities/tenant.entity'
import { CompanyEntity } from '../modules/tenant/entities/company.entity'
import { RoleEntity } from '../modules/auth/entities/role.entity'
import { UserEntity } from '../modules/auth/entities/user.entity'
import { PartnerEntity } from '../modules/partner/entities/partner.entity'

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
  const partners = ds.getRepository(PartnerEntity)

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

  // 九个内置角色按租户复制。内置角色的定义（名称/描述/权限）归系统所有，
  // 每次 seed 同步为最新源码定义，便于权限模型演进；租户如需自定义应创建自定义角色。
  for (const role of BUILTIN_ROLES) {
    const exists = await roles.findOne({ where: { tenantId: tenant.id, code: role.code } })
    if (exists) {
      exists.name = role.name
      exists.description = role.description
      exists.permissions = [...role.permissions]
      await roles.save(exists)
      continue
    }
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
  console.log(`[seed] 内置角色就绪（共 ${BUILTIN_ROLES.length} 个，已同步最新权限定义）`)

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

  // 演示往来单位：1 供应商 + 1 客户 + 1 供应商兼客户
  const demoPartners = [
    {
      code: 'P0001',
      name: '绍兴金辉棉纺有限公司',
      type: 'supplier' as const,
      contact: '陈经理',
      phone: '0575-66001122',
      taxNo: '91330621MA2BXXXX2B',
      address: '浙江省绍兴市柯桥区轻纺城',
      bankName: '工行绍兴柯桥支行',
      bankAccount: '6212261210001234567',
      remark: '主营全棉/涤棉纱线',
    },
    {
      code: 'P0002',
      name: '杭州天成服装贸易有限公司',
      type: 'customer' as const,
      contact: '周总',
      phone: '0571-88007766',
      taxNo: '91330106MA2CXXXX3C',
      address: '浙江省杭州市西湖区',
      bankName: '建行杭州西湖支行',
      bankAccount: '6227001210007654321',
      remark: '坯布长期采购方',
    },
    {
      code: 'P0003',
      name: '宁波华联纺织供应链',
      type: 'both' as const,
      contact: '吴经理',
      phone: '0574-55001234',
      taxNo: '91330212MA2DXXXX4D',
      address: '浙江省宁波市鄞州区',
      bankName: '中行宁波鄞州支行',
      bankAccount: '6216601210003456789',
      remark: '既供纱线也收坯布',
    },
  ]

  for (const p of demoPartners) {
    const exists = await partners.findOne({ where: { companyId: company.id, code: p.code } })
    if (exists) continue
    await partners.save(
      partners.create({
        id: randomUUID(),
        tenantId: tenant.id,
        companyId: company.id,
        ...p,
        status: 'active',
      }),
    )
  }
  console.log(`[seed] 演示往来单位就绪（${demoPartners.length} 个）`)
}
