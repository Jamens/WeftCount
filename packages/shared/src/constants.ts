/** 全局业务常量 */

/** 单据号前缀 */
export const DocNoPrefix = {
  PO: 'PO', // 采购订单
  GRN: 'GRN', // 到货单
  QC: 'QC', // 检验单
  SO: 'SO', // 销售订单
  DN: 'DN', // 出库单
  MO: 'MO', // 生产工单
  MI: 'MI', // 领料单
  PR: 'PR', // 报工单
  LO: 'LO', // 损耗单
  ADJ: 'ADJ', // 调整单
  STK: 'STK', // 盘点单
  TRF: 'TRF', // 移库单
  RTN: 'RTN', // 退货单
  RCV: 'RCV', // 收款单
} as const

export type DocNoPrefixValue = (typeof DocNoPrefix)[keyof typeof DocNoPrefix]

/** 单据状态机 */
export type DocStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'in_progress' | 'completed' | 'cancelled'

export const DOC_STATUS_FLOW: Record<DocStatus, DocStatus[]> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['approved', 'rejected', 'draft', 'cancelled'],
  approved: ['in_progress', 'completed', 'cancelled'],
  rejected: ['draft', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
}

/** 物料大类 */
export const MaterialCategory = {
  YARN: 'yarn', // 纱线
  GREIGE: 'greige', // 坯布
  FINISHED: 'finished', // 成品布
  AUXILIARY: 'auxiliary', // 辅料
  SPARE: 'spare', // 备品备件
} as const

export type MaterialCategoryValue = (typeof MaterialCategory)[keyof typeof MaterialCategory]

export const MATERIAL_CATEGORY_LABEL: Record<MaterialCategoryValue, string> = {
  yarn: '纱线',
  greige: '坯布',
  finished: '成品布',
  auxiliary: '辅料',
  spare: '备品备件',
}

/** 库存事务类型 */
export const StockTxnType = {
  PURCHASE_IN: 'purchase_in',
  PURCHASE_RETURN: 'purchase_return',
  PRODUCTION_IN: 'production_in',
  PRODUCTION_OUT: 'production_out',
  MATERIAL_ISSUE: 'material_issue',
  SALES_OUT: 'sales_out',
  SALES_RETURN: 'sales_return',
  STOCK_ADJUST: 'stock_adjust',
  STOCK_TRANSFER: 'stock_transfer',
  STOCK_COUNT_GAIN: 'count_gain',
  STOCK_COUNT_LOSS: 'count_loss',
  SCRAP: 'scrap',
} as const

export type StockTxnTypeValue = (typeof StockTxnType)[keyof typeof StockTxnType]

/** 事务方向 */
export const TxnDirection = { IN: 'in', OUT: 'out' } as const
export type TxnDirectionValue = (typeof TxnDirection)[keyof typeof TxnDirection]

export const STOCK_TXN_LABEL: Record<StockTxnTypeValue, string> = {
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

export const STOCK_TXN_DIRECTION: Record<StockTxnTypeValue, TxnDirectionValue> = {
  purchase_in: 'in',
  purchase_return: 'out',
  production_in: 'in',
  production_out: 'out',
  material_issue: 'out',
  sales_out: 'out',
  sales_return: 'in',
  stock_adjust: 'in',
  stock_transfer: 'in',
  count_gain: 'in',
  count_loss: 'out',
  scrap: 'out',
}

/** AI 引擎能力开关，对应订阅套餐 */
export const AiCapability = {
  SMART_PRICING: 'smart_pricing', // 智能核价
  FACTOR_LEARNING: 'factor_learning', // 系数自学习
  USAGE_FORECAST: 'usage_forecast', // 用料预测
  LOSS_ATTRIBUTION: 'loss_attribution', // 损耗归因
  SCHEDULING_ADVICE: 'scheduling_advice', // 排产建议
  NL_QUERY: 'nl_query', // 自然语言问数
  DOC_RECOGNITION: 'doc_recognition', // 单据识别
} as const

export type AiCapabilityValue = (typeof AiCapability)[keyof typeof AiCapability]

/** 数字精度约定 */
export const PRECISION = {
  /** 金额保留 2 位 */
  MONEY: 2,
  /** 重量 kg 保留 3 位 */
  WEIGHT: 3,
  /** 长度米保留 3 位 */
  LENGTH: 3,
  /** 面积平方米保留 4 位 */
  AREA: 4,
  /** 克重 g/m² 保留 2 位 */
  GSM: 2,
  /** 密度保留 2 位 */
  DENSITY: 2,
  /** 支数保留 2 位 */
  COUNT: 2,
  /** 比例 0-1 保留 4 位 */
  RATIO: 4,
  /** 百分比保留 2 位 */
  PERCENT: 2,
} as const
