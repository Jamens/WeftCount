import { SetMetadata } from '@nestjs/common'

export const PERMISSION_KEY = 'weftcount:permission'

export type PermissionRequirement = string | string[]

/**
 * 声明接口所需权限
 *
 * 用法：
 *   @RequirePermission(Permission.PURCHASE_MANAGE)          单个权限
 *   @RequirePermission([Permission.SALES_VIEW, Permission.COST_VIEW])  任一即可
 *
 * 语义是「满足其一」（any），因为业务上很少出现必须同时具备两个权限才能操作的情况；
 * 若确实需要「同时具备」，在 service 内用 hasAllPermissions 显式校验。
 */
export const RequirePermission = (...permissions: string[]) =>
  SetMetadata(PERMISSION_KEY, permissions.length === 1 ? permissions[0] : permissions)
