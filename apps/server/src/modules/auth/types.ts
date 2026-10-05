import type { AuthUserPayload, LoginResult } from '@weftcount/shared'

/**
 * 认证模块的类型契约
 *
 * 这些结构定义在 shared 里（前后端共用），此处只做转发导出，
 * 避免前后端各写一份、日后漂移。
 */
export type { AuthUserPayload, LoginResult }

export interface ChangePasswordDto {
  oldPassword: string
  newPassword: string
}
