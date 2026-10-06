/**
 * 多公司多租户数据隔离基元
 *
 * 隔离策略：所有业务表强制携带 companyId，查询由 TenantGuard 自动注入过滤条件。
 * 三层结构：
 *   Tenant（租户/集团）→ Company（公司/工厂）→ User（用户）
 * 一个租户可开多个公司（多工厂集团），公司之间库存独立核算。
 */

/** 租户（订阅主体，通常对应一个集团） */
export interface Tenant {
  id: string
  /** 租户编码，公开标识 */
  code: string
  name: string
  /** 订阅套餐 */
  plan: SubscriptionPlan
  status: TenantStatus
  /** 配额：可开公司数 */
  maxCompanies: number
  /** 配额：可注册用户数 */
  maxUsers: number
  /** 租户级工艺系数（可被公司级覆盖） */
  defaultCoefficients?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

/** 公司（工厂/实际经营主体） */
export interface Company {
  id: string
  tenantId: string
  code: string
  name: string
  /** 纳税人识别号 */
  taxNo?: string
  address?: string
  phone?: string
  status: CompanyStatus
  /** 公司级工艺系数，优先级高于租户默认 */
  coefficients?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

export type TenantStatus = 'active' | 'suspended' | 'expired'
export type CompanyStatus = 'active' | 'closed'

/**
 * 订阅套餐
 * 调研结论：国内中小织造厂年费 5000-20000 元，AI 能力应放最高档做溢价
 */
export type SubscriptionPlan = 'basic' | 'professional' | 'flagship'

export const PLAN_LIMITS: Record<SubscriptionPlan, { maxCompanies: number; maxUsers: number; aiEnabled: boolean; label: string }> = {
  basic: { maxCompanies: 1, maxUsers: 5, aiEnabled: false, label: '基础版 · 进销存' },
  professional: { maxCompanies: 3, maxUsers: 30, aiEnabled: false, label: '专业版 · 含工艺算法' },
  flagship: { maxCompanies: 999, maxUsers: 999, aiEnabled: true, label: '旗舰版 · 含 AI 引擎' },
}

/** 系统用户 */
export interface User {
  id: string
  tenantId: string
  /** 登录账号，全局唯一 */
  username: string
  passwordHash: string
  realName: string
  phone?: string
  email?: string
  status: UserStatus
  /** 所属公司，单用户可属于多个公司 */
  companyIds: string[]
  lastLoginAt?: Date
  createdAt: Date
  updatedAt: Date
}

export type UserStatus = 'active' | 'disabled' | 'locked'

/** 角色 */
export interface Role {
  id: string
  tenantId?: string
  code: string
  name: string
  description?: string
  /** 权限码列表，如 'purchase.order.create' */
  permissions: string[]
  /** 是否内置角色（内置角色不可删除） */
  builtin: boolean
  createdAt: Date
  updatedAt: Date
}

/**
 * 系统内置角色
 * 刻意贴合织造厂真实岗位，而不是通用 admin/user
 */
export const BUILTIN_ROLES = [
  {
    code: 'tenant_owner',
    name: '租户管理员',
    description: '集团层面，管理公司、用户、套餐与计费',
    permissions: ['*'],
  },
  {
    code: 'company_admin',
    name: '厂长 / 公司管理员',
    description: '单公司全部经营操作，含工艺系数配置与授权',
    permissions: [
      'material.*', 'partner.*', 'warehouse.*', 'inventory.*',
      'purchase.*', 'sales.*', 'production.*', 'cost.*', 'contract.*',
      'report.*', 'coefficient.*', 'user.view', 'user.manage', 'role.view', 'role.manage', 'audit.view',
    ],
  },
  {
    code: 'craft_engineer',
    name: '工艺员',
    description: '负责规格设定、系数调参与用料核算，不碰资金单据',
    permissions: [
      'material.view', 'material.edit', 'coefficient.*',
      'production.view', 'production.order.edit', 'tech.calc',
    ],
  },
  {
    code: 'purchaser',
    name: '采购员',
    description: '供应商、比价、采购订单与到货跟踪',
    permissions: ['material.view', 'partner.view', 'partner.edit', 'purchase.*', 'contract.*', 'inventory.view'],
  },
  {
    code: 'warehouse_keeper',
    name: '仓管员',
    description: '出入库、盘点、移库、库存预警处理',
    permissions: ['material.view', 'warehouse.*', 'inventory.*', 'purchase.view', 'production.view', 'report.view'],
  },
  {
    code: 'sales_clerk',
    name: '业务员',
    description: '报价、客户订单、出库送货与对账收款',
    permissions: ['material.view', 'partner.view', 'partner.edit', 'sales.*', 'contract.*', 'inventory.view', 'report.sales'],
  },
  {
    code: 'loom_operator',
    name: '挡车工 / 织布工',
    description: '仅终端报工与本机台产量查看',
    permissions: ['production.report', 'production.self.view'],
  },
  {
    code: 'accountant',
    name: '会计',
    description: '成本核算、对账、报表与账务导出',
    permissions: ['cost.*', 'report.*', 'contract.view', 'sales.view', 'purchase.view', 'inventory.view', 'partner.view'],
  },
  {
    code: 'viewer',
    name: '只读访客',
    description: '仅查看看板与报表，不可写入',
    permissions: ['*.view', 'report.view'],
  },
] as const

export type BuiltinRoleCode = (typeof BUILTIN_ROLES)[number]['code']
