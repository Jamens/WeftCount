import { Permission } from '@weftcount/shared'

/**
 * 路由 → 所需权限码（**单一事实源**）
 *
 * ## 为什么必须有这张表
 *
 * 之前菜单里19 处 `hasPermission(...)` 是内联散写的，路由定义区则一个都没有——
 * 于是「菜单里看不到的页面，手输 URL 就能直达」。
 * 页面能打开、然后所有请求 403，用户看到的是一堆报错而不是「你没有权限」。
 *
 * 有了这张表，菜单显隐与路由门控读同一份数据：
 * 改权限只需改一处，不会出现「菜单藏了但路由还能进」的漏防。
 *
 * ## 语义
 *
 * 数组是**「任一满足即可」**（与后端 `@RequirePermission(A, B)` 一致）。
 * 缺项 = 不做权限门控，只校验登录。
 */
export const ROUTE_PERMS: Record<string, string[]> = {
  // 工作台：任一业务查看权限即可进入。
  // 后端 /dashboard/overview 用的就是同一套判定（会计、挡车工都必须能进首页），
  // 前端若写死某一个权限码会让这些角色登录即撞 403。
  '/': [
    Permission.PRODUCTION_VIEW,
    Permission.PRODUCTION_REPORT,
    Permission.INVENTORY_VIEW,
    Permission.COST_VIEW,
    Permission.REPORT_VIEW,
    Permission.PURCHASE_VIEW,
    Permission.SALES_VIEW,
  ],
  '/materials': [Permission.MATERIAL_VIEW],
  '/greige-specs': [Permission.MATERIAL_VIEW],
  '/partners': [Permission.PARTNER_VIEW],
  '/supplier-codes': [Permission.PARTNER_VIEW],
  '/warehouses': [Permission.WAREHOUSE_VIEW],
  '/import-export': [Permission.MATERIAL_VIEW],
  '/report-export': [Permission.MATERIAL_VIEW],
  '/orders': [Permission.PURCHASE_VIEW, Permission.SALES_VIEW],
  '/contracts': [Permission.PURCHASE_VIEW, Permission.SALES_VIEW],
  '/inventory/batches': [Permission.INVENTORY_VIEW],
  '/inventory/documents': [Permission.INVENTORY_VIEW],
  '/inventory/transactions': [Permission.INVENTORY_VIEW],
  '/inventory/reconcile': [Permission.INVENTORY_VIEW],
  '/stocktakes': [Permission.INVENTORY_VIEW],
  '/cost': [Permission.COST_VIEW],
  '/trends': [Permission.COST_VIEW],
  '/traceability': [Permission.REPORT_VIEW],
  '/production': [Permission.PRODUCTION_VIEW],
  '/alerts': [Permission.INVENTORY_VIEW],
  '/ai-quote': [Permission.SALES_VIEW],
  '/ai-loss': [Permission.COST_VIEW],
  '/ai-coefficient': [Permission.PRODUCTION_VIEW],
  '/ai-production': [Permission.PRODUCTION_VIEW],
  '/users': [Permission.USER_VIEW],
  '/roles': [Permission.ROLE_VIEW],
  '/audit-logs': [Permission.AUDIT_VIEW],
  '/quality/inspections': [Permission.QUALITY_VIEW],
  '/quality/inspections/:id': [Permission.QUALITY_VIEW],
  '/quality/defect-types': [Permission.QUALITY_VIEW],
  '/quality/grade-prices': [Permission.QUALITY_VIEW],
}

/** 某路径是否被权限门控保护 */
export function routePerms(path: string): string[] | undefined {
  return ROUTE_PERMS[path]
}
