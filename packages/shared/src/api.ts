/**
 * 全局 API 契约
 * 统一响应格式，区分「成功」与「业务失败」两种 envelope，
 * 前端拦截器据此判断是否弹错误提示。
 */

export interface ApiSuccess<T> {
  code: 0
  message: 'ok'
  data: T
  /** 服务端时间戳，便于客户端校时 */
  ts: number
}

export interface ApiFailure {
  code: number
  message: string
  data: null
  ts: number
  /** 字段级校验错误 */
  errors?: Record<string, string[]>
  /** 追踪 ID，便于查日志 */
  traceId?: string
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure

/** 业务错误码分段 */
export const ErrorCode = {
  // 通用 1xxx
  UNKNOWN: 1000,
  VALIDATION_FAILED: 1001,
  NOT_FOUND: 1004,
  CONFLICT: 1009,
  FORBIDDEN: 1003,
  UNAUTHORIZED: 1001,

  // 认证 2xxx
  LOGIN_FAILED: 2001,
  TOKEN_EXPIRED: 2002,
  PASSWORD_WRONG: 2003,
  ACCOUNT_DISABLED: 2004,

  // 租户 3xxx
  TENANT_NOT_FOUND: 3001,
  TENANT_SUSPENDED: 3002,
  QUOTA_EXCEEDED: 3003,
  COMPANY_NOT_FOUND: 3004,
  PLAN_REQUIRED: 3005,

  // 业务 4xxx
  STOCK_NOT_ENOUGH: 4001,
  ORDER_STATUS_INVALID: 4002,
  DUPLICATE_CODE: 4003,
  INSUFFICIENT_QUANTITY: 4004,

  // 工艺 5xxx
  COEFFICIENT_INVALID: 5001,
  SPEC_INCOMPLETE: 5002,
  FORMULA_INPUT_INVALID: 5003,

  // AI 6xxx
  AI_NOT_ENABLED: 6001,
  AI_UPSTREAM_ERROR: 6002,
  AI_INSUFFICIENT_DATA: 6003,
} as const

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode]

/** 分页请求 */
export interface PageQuery {
  page?: number
  pageSize?: number
  /** 排序字段 */
  orderBy?: string
  orderDir?: 'ASC' | 'DESC'
  /** 关键字模糊搜索 */
  keyword?: string
}

export interface PageResult<T> {
  records: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

/** 审计操作类型 */
export const AuditAction = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  SUBMIT: 'submit',
  APPROVE: 'approve',
  REJECT: 'reject',
  CANCEL: 'cancel',
  LOGIN: 'login',
  LOGOUT: 'logout',
  EXPORT: 'export',
  PRINT: 'print',
  AI_CALL: 'ai_call',
} as const

export type AuditActionType = (typeof AuditAction)[keyof typeof AuditAction]

export interface AuditLogEntry {
  userId: string
  companyId?: string
  action: AuditActionType
  /** 业务模块，如 purchase.order */
  module: string
  /** 操作对象 ID */
  targetId?: string
  /** 变更摘要 */
  summary: string
  /** 变更前后快照（脱敏后） */
  diff?: Record<string, { before: unknown; after: unknown }>
}
