/**
 * 权限内核（前端/后端共享，纯函数、浏览器安全）
 *
 * 单一事实源：权限码常量 + 通配匹配 + 车间视图→权限映射。
 * admin / desktop / server 三端都从这里取，避免各写各的导致「一边改一边漏」
 * （历史上 desktop 菜单未按权限门控，就是两端不同步的漏洞）。
 *
 * 角色解析（角色→权限展开 expandPermissions）留在 server 端——那是授权模板解析，
 * 前端不需要也不该碰。前端只做「拿 /auth/me 的权限码 → hasPermission 判定」。
 */

/** 权限码分段（`a.b.c` → [a,b,c]） */
function segments(code: string): string[] {
  return code.split('.')
}

/** 判断单条权限码是否覆盖所需权限（分段通配） */
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

/** 权限集合是否覆盖所需权限 */
export function hasPermission(grants: string[], required: string): boolean {
  return grants.some((g) => matches(g, required))
}

/** 是否具备所需权限之一 */
export function hasAnyPermission(grants: string[], required: string[]): boolean {
  return required.some((r) => hasPermission(grants, r))
}

/** 是否同时具备全部所需权限 */
export function hasAllPermissions(grants: string[], required: string[]): boolean {
  return required.every((r) => hasPermission(grants, r))
}

/** 系统权限码，业务模块统一从此处取，避免各处硬编码字符串 */
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
  // 合同 / 价格
  CONTRACT_VIEW: 'contract.view',
  CONTRACT_MANAGE: 'contract.manage',
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

/**
 * 车间工作台（desktop）视图 → 所需权限码
 *
 * 与后端各端点 `@RequirePermission` 一一对应，保证菜单门控与实际可访问一致，
 * 避免「点了才报无权限」。新增车间页时同步加这里 + 后端端点。
 */
export const WORKSHOP_VIEW_PERM = {
  report: Permission.PRODUCTION_REPORT,   // 织机报工
  board: Permission.PRODUCTION_VIEW,      // 车间大屏（工单/机台）
  pick: Permission.INVENTORY_MANAGE,     // 扫码出库
  pickin: Permission.INVENTORY_MANAGE,   // 扫码入库
  label: Permission.INVENTORY_VIEW,      // 布匹标签打印
  rollcard: Permission.INVENTORY_VIEW,   // 件卡打印
  scan: Permission.REPORT_VIEW,          // 扫码查询（件卡/批次追溯）
} as const

export type WorkshopView = keyof typeof WORKSHOP_VIEW_PERM
