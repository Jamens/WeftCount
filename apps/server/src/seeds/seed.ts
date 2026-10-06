import { DataSource } from 'typeorm'
import * as bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { BUILTIN_ROLES } from '@weftcount/shared'
import { TenantEntity } from '../modules/tenant/entities/tenant.entity'
import { CompanyEntity } from '../modules/tenant/entities/company.entity'
import { RoleEntity } from '../modules/auth/entities/role.entity'
import { UserEntity } from '../modules/auth/entities/user.entity'
import { PartnerEntity } from '../modules/partner/entities/partner.entity'
import { MaterialEntity } from '../modules/material/entities/material.entity'
import { GreigeSpecEntity } from '../modules/material/entities/greige-spec.entity'
import { WarehouseEntity } from '../modules/warehouse/entities/warehouse.entity'
import { MachineEntity } from '../modules/production/entities/machine.entity'
import { InventoryDocumentEntity } from '../modules/inventory/entities/inventory-document.entity'
import { InventoryBatchEntity } from '../modules/inventory/entities/inventory-batch.entity'
import { RollEntity } from '../modules/inventory/entities/roll.entity'
import { MaterialService } from '../modules/material/material.service'
import { InventoryService } from '../modules/inventory/inventory.service'

/**
 * 种子数据：创建一个演示租户 + 一个工厂 + 九个内置角色 + 三类演示账号
 *
 * 幂等：按 code 判断是否已存在，重复执行不会重复插入
 * 运行：pnpm --filter @weftcount/server seed
 */
export async function seed(ds: DataSource, materialService: MaterialService, inventoryService: InventoryService, seedUserId: string): Promise<void> {
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

  await seedMasterData(tenant.id, company.id, ds, materialService, inventoryService, seedUserId)
}

/**
 * 演示主数据：物料 / 坯布规格 / 仓库 / 机台
 *
 * 为什么必须 seed：这些是系统可用的**最小完整基线**。缺了它们，界面全是空的、
 * 冒烟测试全部因「无可用规格/机台」而挂。原本这些数据只存在于开发库（手工造的），
 * 重置库后会消失——故固化成种子，保证任何库 reset 后都立刻可用、测试可复现。
 *
 * 规格用**领域校验过的基准**：全棉府绸 120×72 根/英寸 40S 幅宽150cm
 * → 克重 111.6 g/m²、百米经纱 10.46kg / 纬纱 6.28kg（与 shared 单测同源）。
 * 规格经 MaterialService.createSpec 创建以**正确计算工艺快照**（kg/100m 等），
 * 否则成本/单耗/对账全算不出数。
 */
async function seedMasterData(
  tenantId: string, companyId: string, ds: DataSource,
  materialService: MaterialService, inventoryService: InventoryService, seedUserId: string,
): Promise<void> {
  const warehouseRepo = ds.getRepository(WarehouseEntity)
  const machineRepo = ds.getRepository(MachineEntity)
  const specRepo = ds.getRepository(GreigeSpecEntity)

  // —— 物料：40S 棉纱 + 全棉坯布 ——
  const cotton40s = await ensureMaterial(ds, tenantId, companyId, {
    code: 'Y-COTTON-40S', name: '棉纱 40S', category: 'yarn', specification: '40S（NeS）',
  })
  await ensureMaterial(ds, tenantId, companyId, {
    code: 'G-COTTON-PLAIN', name: '全棉坯布', category: 'greige', specification: '本色',
    // **必须设安全库存与采购提前期**：否则 `safetyStock == null` 会被直接跳过，
    // 补货预警/补货建议在演示数据上永远触发不出来（功能做了但看不到）。
    // 300m 演示库存 + 日均消耗 → 补货点= 20×(7+7) + 200 = 480 > 300，会触发建议。
    safetyStock: 200, leadTimeDays: 7,
  })
  console.log('[seed] 演示物料就绪（棉纱40S / 全棉坯布，含安全库存与采购提前期）')

  // —— 仓库 ——
  const warehouses = [
    { code: 'WH-GREIGE', name: '坯布仓', type: 'greige' as const },
    { code: 'WH-FINISHED', name: '成品仓', type: 'finished' as const },
  ]
  for (const w of warehouses) {
    const exists = await warehouseRepo.findOne({ where: { companyId, code: w.code } })
    if (exists) continue
    await warehouseRepo.save(
      warehouseRepo.create({ id: randomUUID(), tenantId, companyId, ...w, address: null, status: 'active' }),
    )
  }
  console.log(`[seed] 演示仓库就绪（${warehouses.length} 个）`)

  // —— 机台（车间大屏/报工需要） ——
  const machines = [
    { code: 'LOOM-01', name: '1 号织机', model: '剑杆织机' },
    { code: 'LOOM-02', name: '2 号织机', model: '剑杆织机' },
    { code: 'LOOM-03', name: '3 号织机', model: '喷气织机' },
  ]
  for (const m of machines) {
    const exists = await machineRepo.findOne({ where: { companyId, code: m.code } })
    if (exists) continue
    await machineRepo.save(
      machineRepo.create({ id: randomUUID(), tenantId, companyId, ...m, status: 'idle', remark: null }),
    )
  }
  console.log(`[seed] 演示机台就绪（${machines.length} 台）`)

  // —— 坯布规格：经纬密单位为「根/英寸」——
  // 全棉府绸 120×72 根/英寸 40S 幅宽150cm → 克重 111.6 g/m²（shared 单测基准）
  const specs = [
    { code: 'FUC-120-72', name: '全棉府绸 120×72', finishedWidth: 150, warpDensity: 120, weftDensity: 72, weaveType: 'plain' as const, warpCount: { value: 40, system: 'NeS' as const }, weftCount: { value: 40, system: 'NeS' as const }, warpMaterialId: cotton40s.id, weftMaterialId: cotton40s.id },
  ]
  let created = 0
  for (const s of specs) {
    const exists = await specRepo.findOne({ where: { companyId, code: s.code } })
    if (exists) continue
    await materialService.createSpec(tenantId, companyId, s)
    created++
  }
  console.log(`[seed] 演示坯布规格就绪（新增 ${created} 个）`)

  await seedDemoRolls(tenantId, companyId, ds, inventoryService, seedUserId, cotton40s.id, specs[0].code)
}

/**
 * 演示件卡（逐匹入库）：让桌面端**扫码流程开箱可用**
 *
 * 件卡只能由「逐匹入库」产生，seed 此前不建 → 新库/重置后开发库 0 件卡，
 * 桌面端扫码出库/件卡打印/标签打印/扫码查询全部无从测试（用户扫件卡号报「不存在」）。
 * 故固化 3 匹 100m 的全棉府绸坯布。
 */
async function seedDemoRolls(
  tenantId: string, companyId: string, ds: DataSource,
  inventoryService: InventoryService, userId: string,
  yarnMaterialId: string, _specCode: string,
): Promise<void> {
  const docRepo = ds.getRepository(InventoryDocumentEntity)
  const has = await docRepo
    .createQueryBuilder('d')
    .where('d.company_id = :companyId', { companyId })
    .andWhere('d.remark LIKE :r', { r: '%演示件卡%' })
    .getCount()
  if (has > 0) {
    console.log('[seed] 演示件卡已存在，跳过')
    return
  }
  const specRepo = ds.getRepository(GreigeSpecEntity)
  const spec = await specRepo.findOne({ where: { companyId, code: 'FUC-120-72' } })
  const greige = await ds.getRepository(MaterialEntity).findOne({ where: { companyId, code: 'G-COTTON-PLAIN' } })
  const supplier = await ds.getRepository(PartnerEntity).findOne({ where: { companyId, type: 'supplier' } })
  if (!spec || !greige || !supplier) {
    console.log('[seed] 跳过演示件卡（规格/物料/供应商缺失）')
    return
  }
  // 件卡号**跟随实际生成的批次号**（`<批次号>-01/02/03`），与系统自身编号体系一致——
  // 不用另起一套「PC-DEMO-xxx」，否则演示数据看起来像外来的、与真实流程对不上。
  // 批次号入库后才确定，故先用临时名建匹，再统一改名为「批次号-序号」。
  const rollsMeta = [1, 2, 3].map((i) => ({ meters: 100, rollNo: `__SEED_ROLL_${i}__` }))
  const doc = await inventoryService.createPurchaseInbound(
    { tenantId, companyId, userId },
    {
      materialId: greige.id,
      specId: spec.id,
      enteredUnit: 'm',
      enteredValue: 300,
      unitPrice: 8.5,
      partnerId: supplier.id,
      remark: '演示件卡（逐匹入库）',
      rolls: rollsMeta,
    } as never,
  )
  // 由入库单反查批次号，再把件卡改成「批次号-序号」
  const batch = await ds.getRepository(InventoryBatchEntity).findOne({ where: { sourceDocId: doc.id } })
  const rollRepo = ds.getRepository(RollEntity)
  const created: string[] = []
  for (let i = 0; i < rollsMeta.length; i++) {
    const r = await rollRepo.findOne({ where: { rollNo: rollsMeta[i].rollNo, companyId } })
    if (!r || !batch) continue
    r.rollNo = `${batch.batchNo}-${String(i + 1).padStart(2, '0')}`
    await rollRepo.save(r)
    created.push(r.rollNo)
  }
  void yarnMaterialId
  console.log(`[seed] 演示件卡就绪（批次 ${batch?.batchNo ?? '-'}：${created.join('、')}）`)
}

/** 幂等建物料 */
async function ensureMaterial(
  ds: DataSource, tenantId: string, companyId: string,
  m: {
    code: string
    name: string
    category: 'yarn' | 'greige'
    specification: string
    /** 安全库存：补货预警的前提，缺了永不触发 */
    safetyStock?: number
    /** 采购提前期/周期（天）：补货点计算用 */
    leadTimeDays?: number
  },
) {
  const repo = ds.getRepository(MaterialEntity)
  const exists = await repo.findOne({ where: { companyId, code: m.code } })
  if (exists) {
    // 幂等但**允许补齐**：已存在时只填「为空」的字段。
    // seed 增删了演示字段（如安全库存）后，重跑应能修复旧演示数据；
    // 但用户自己改过的值不能被冲掉——所以只在 null 时填。
    let dirty = false
    if (m.safetyStock != null && exists.safetyStock == null) {
      exists.safetyStock = String(m.safetyStock)
      dirty = true
    }
    if (m.leadTimeDays != null && exists.leadTimeDays == null) {
      exists.leadTimeDays = String(m.leadTimeDays)
      dirty = true
    }
    return dirty ? repo.save(exists) : exists
  }
  return repo.save(
    repo.create({
      id: randomUUID(), tenantId, companyId,
      code: m.code, name: m.name, category: m.category, specification: m.specification,
      safetyStock: m.safetyStock != null ? String(m.safetyStock) : null,
      leadTimeDays: m.leadTimeDays != null ? String(m.leadTimeDays) : null,
      measureMode: m.category === 'yarn' ? 'weight' : 'length',
      primaryUnit: m.category === 'yarn' ? 'kg' : 'm',
      allowedUnits: m.category === 'yarn' ? ['kg', 't'] : ['m', 'kg'],
      status: 'active',
    }),
  )
}
