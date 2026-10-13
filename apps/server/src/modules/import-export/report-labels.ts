/**
 * 报表导出·枚举中文字典（服务端侧）
 *
 * 为什么不在 shared：admin 侧 `erp.ts` 已有一套标签映射，但那是**前端展示**用的、
 * 带 color/antd 依赖；服务端导出只需要「英文枚举值→中文」这一层。
 * 两边若都硬编码容易漂移，故这里的取值与 `shared/constants.ts` 的
 * `STOCK_TXN_LABEL` 和 admin 的 `DOC_TYPE_LABEL` **保持一致**——
 * 同一份枚举值在页面上和导出文件里必须是同一个中文，否则用户会以为导出错了。
 *
 * 兜底：查不到的值原样输出英文枚举（而不是空串），让问题可见而不是静默。
 */

/** 库存单据类型（inventory_documents.doc_type） */
export const DOC_TYPE_CN: Record<string, string> = {
  purchase_inbound: '采购入库',
  production_issue: '生产领料',
  sales_outbound: '销售出库',
}

/** 批次来源（inventory_batches.source_type） */
export const BATCH_SOURCE_CN: Record<string, string> = {
  purchase_inbound: '采购入库',
  production_in: '报工入库',
  stock_transfer: '移库',
  stock_adjust: '库存调整',
  count_gain: '盘盈',
}

/** 批次状态（inventory_batches.status） */
export const BATCH_STATUS_CN: Record<string, string> = {
  normal: '正常',
  frozen: '冻结',
  depleted: '已耗尽',
}

/** 库存流水类型（inventory_transactions.txn_type），与 shared STOCK_TXN_LABEL 一致 */
export const TXN_TYPE_CN: Record<string, string> = {
  purchase_in: '采购入库',
  purchase_return: '采购退货',
  production_in: '生产入库',
  production_out: '生产出库',
  material_issue: '生产领料',
  sales_out: '销售出库',
  sales_return: '销售退货',
  stock_adjust: '库存调整',
  stock_transfer: '移库',
  count_gain: '盘盈',
  count_loss: '盘亏',
  scrap: '报废',
}

/** 流水方向（inventory_transactions.direction） */
export const TXN_DIRECTION_CN: Record<string, string> = {
  in: '入库',
  out: '出库',
}

/** 件卡状态（rolls.status） */
export const ROLL_STATUS_CN: Record<string, string> = {
  in_stock: '在库',
  sold: '已发货',
  consumed: '已耗用',
}

/** 采购/销售订单类型（trade_orders.order_type） */
export const ORDER_TYPE_CN: Record<string, string> = {
  purchase: '采购',
  sales: '销售',
}

/** 订单状态（trade_orders.status） */
export const ORDER_STATUS_CN: Record<string, string> = {
  draft: '草稿',
  confirmed: '已确认',
  in_progress: '执行中',
  completed: '已完成',
  cancelled: '已取消',
}

/** 生产工单状态（production_orders.status） */
export const PROD_ORDER_STATUS_CN: Record<string, string> = {
  draft: '草稿',
  scheduled: '已排产',
  in_progress: '生产中',
  completed: '已完成',
  cancelled: '已取消',
}

/** 生产报表停机原因（production_reports.stop_reason），可空 */
export const STOP_REASON_CN: Record<string, string> = {
  mechanical: '机械故障',
  material: '缺料',
  process: '工艺问题',
  power: '停电',
  planned: '计划停机',
  other: '其他',
}

/** 盘点单状态（stocktakes.status） */
export const STOCKTAKE_STATUS_CN: Record<string, string> = {
  draft: '草稿',
  counting: '盘点中',
  finished: '已完成',
  cancelled: '已取消',
}

/** 审计动作（audit_logs.action） */
export const AUDIT_ACTION_CN: Record<string, string> = {
  create: '新建',
  update: '更新',
  delete: '删除',
  submit: '提交',
  cancel: '取消',
  ack: '确认',
  scan: '扫描',
  import: '导入',
  export: '导出',
  post: '过账',
}

/** 取中文标签；查不到则原样返回（不返回空串，避免问题被吞掉） */
export function cn(map: Record<string, string>, v: string | null | undefined): string {
  if (v === null || v === undefined || v === '') return ''
  return map[v] ?? v
}