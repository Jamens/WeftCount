import type { BuiltinRoleCode } from '@weftcount/shared'

/**
 * 权限匹配器
 *
 * 权限码格式：`<模块>.<资源>.<动作>`，例：purchase.order.create
 * 支持通配：
 *   - `*`          匹配全部权限（租户管理员）
 *   - `purchase.*` 匹配 purchase 下全部
 *   - `*.view`     匹配任意模块的 view 动作
 *
 * 采用「持有权限」与「所需权限」双向通配的实现方式：
 * 任一侧含 * 即可匹配，避免出现"给了 *.view 却读不到 module.list"的割裂。
 */

function segments(code: string): string[] {
  return code.split('.')
}

/**
 * 判断单条权限码是否覆盖所需权限
 */
export function matches(granted: string, required: string): boolean {
  if (granted === '*') return true
  const g = segments(granted)
  const r = segments(required)

  for (let i = 0; i < r.length; i++) {
    const gSeg = g[i]
    const rSeg = r[i]
    if (gSeg === undefined) return false
    if (gSeg === '*') return true
    if (gSeg !== rSeg) return false
  }
  // 所需权限是所持有权限的前缀（如有 purchase.* 但要 purchase.order）时视为覆盖
  return true
}

/**
 * 判断权限集合是否覆盖所需权限
 */
export function hasPermission(grants: string[], required: string): boolean {
  return grants.some((g) => matches(g, required))
}

/**
 * 判断是否具备所需权限之一（满足其一即可）
 */
export function hasAnyPermission(grants: string[], required: string[]): boolean {
  return required.some((r) => hasPermission(grants, r))
}

/**
 * 判断是否同时具备全部所需权限
 */
export function hasAllPermissions(grants: string[], required: string[]): boolean {
  return required.every((r) => hasPermission(grants, r))
}

/** 系统保留权限码，业务模块统一从此处取，避免各处硬编码字符串 */
export const Permission = {
  // 租户与公司
  TENANT_VIEW: 'tenant.view',
  TENANT_MANAGE: 'tenant.manage',
  COMPANY_VIEW: 'company.view',
  COMPANY_MANAGE: 'company.manage',

  // 用户与角色
  USER_VIEW: 'user.view',
  USER_MANAGE: 'user.manage',
  ROLE_VIEW: 'role.view',
  ROLE_MANAGE: 'role.manage',

  // 基础资料
  MATERIAL_VIEW: 'material.view',
  MATERIAL_EDIT: 'material.edit',
  PARTNER_VIEW: 'partner.view',
  PARTNER_EDIT: 'partner.edit',
  WAREHOUSE_VIEW: 'warehouse.view',
  WAREHOUSE_MANAGE: 'warehouse.manage',

  // 工艺系数
  COEFFICIENT_VIEW: 'coefficient.view',
  COEFFICIENT_EDIT: 'coefficient.edit',
  TECH_CALC: 'tech.calc',

  // 库存
  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_MANAGE: 'inventory.manage',

  // 采购
  PURCHASE_VIEW: 'purchase.view',
  PURCHASE_MANAGE: 'purchase.manage',

  // 销售
  SALES_VIEW: 'sales.view',
  SALES_MANAGE: 'sales.manage',

  // 生产
  PRODUCTION_VIEW: 'production.view',
  PRODUCTION_ORDER_EDIT: 'production.order.edit',
  PRODUCTION_REPORT: 'production.report',
  PRODUCTION_SELF_VIEW: 'production.self.view',

  // 成本与报表
  COST_VIEW: 'cost.view',
  COST_MANAGE: 'cost.manage',
  REPORT_VIEW: 'report.view',
  REPORT_SALES: 'report.sales',

  // 审计
  AUDIT_VIEW: 'audit.view',

  // AI
  AI_USE: 'ai.use',
} as const

export type PermissionValue = (typeof Permission)[keyof typeof Permission]

/** 判断是否为内置角色 */
export function isBuiltinRole(code: string): code is BuiltinRoleCode {
  return [
    'tenant_owner',
    'company_admin',
    'craft_engineer',
    'purchaser',
    'warehouse_keeper',
    'sales_clerk',
    'loom_operator',
    'accountant',
    'viewer',
  ].includes(code)
}

/**
 * 把多个角色的权限展开为去重后的权限码集合
 *
 * 入参是「角色数组」，每个角色一组权限码：
 *   expandPermissions([roleA.permissions, roleB.permissions])
 *
 * 角色是「授权模板」，权限码是「判定依据」，二者分离便于：
 * - 后续加数据级权限（本人/本部门/全部）时不必改角色结构
 * - 审计时能追溯「因哪个角色获得此权限」
 */
export function expandPermissions(roleGrants: string[][]): string[] {
  const set = new Set<string>()
  for (const grants of roleGrants) {
    for (const g of grants) {
      if (g) set.add(g)
    }
  }
  return [...set].sort()
}

/**
 * 展开单个角色的权限（单角色场景的便捷版本）
 */
export function expandSingleRole(permissions: string[]): string[] {
  return expandPermissions([permissions])
}

/**
 * 列出某权限码能匹配到的全部已授予权限
 * 供「我的权限」接口展示，便于排查权限问题
 */
export function explainPermission(grants: string[], target: string): string[] {
  return grants.filter((g) => matches(g, target))
}
