/**
 * 权限（从 @weftcount/shared 单一事实源取，避免三端各写各的）
 *
 * 权限码常量、通配匹配（matches/hasPermission/hasAny/hasAll）全部来自 shared；
 * 本文件只保留**角色解析**（isBuiltinRole / expandPermissions）——把角色的权限展开为
 * 集合，这是授权模板解析，只在服务端做。
 */
export {
  Permission,
  matches,
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  WORKSHOP_VIEW_PERM,
  type PermissionValue,
} from '@weftcount/shared'

import { matches } from '@weftcount/shared'
import type { BuiltinRoleCode } from '@weftcount/shared'


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
