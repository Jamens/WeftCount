import type {
  CountSystem,
  MaterialCategoryValue,
  MeasureMode,
  SpecCalculationSnapshot,
  StockTxnTypeValue,
  WeaveType,
} from '@weftcount/shared'

/**
 * 后端数据线类型（Wire shapes）
 *
 * 重要：MySQL 的 `decimal` 列经 JSON 序列化后到达前端是**字符串**（为保精度），
 * 不是 number。shared 里的 Material / GreigeSpec 接口把部分 decimal 写成 number，
 * 与实际线格式不符，前端若按 number 用会出错。这里按真实 JSON 形状重新声明，
 * 展示/计算前用 dec() 显式转 number。
 */

export interface MaterialWire {
  id: string
  code: string
  name: string
  category: MaterialCategoryValue
  specification: string
  measureMode: MeasureMode
  primaryUnit: string
  allowedUnits: string[]
  batchManaged: boolean
  safetyStock: string | null
  standardPrice: string | null
  status: 'active' | 'discontinued'
  remark: string | null
  createdAt: string
  updatedAt: string
}

export interface GreigeSpecWire {
  id: string
  code: string
  name: string
  finishedWidth: string
  warpDensity: string
  weftDensity: string
  weaveType: WeaveType
  warpCountValue: string
  warpCountSystem: CountSystem
  weftCountValue: string
  weftCountSystem: CountSystem
  warpMaterialId: string | null
  weftMaterialId: string | null
  loomWidth: string | null
  widthAllowance: string
  warpLossRate: string
  weftLossRate: string
  picksPerMinute: number | null
  machineRunRate: string
  calculatedGsm: string
  measuredGsm: string | null
  specVersion: number
  status: 'active' | 'discontinued'
  remark: string | null
  createdAt: string
  updatedAt: string
}

export interface BatchWire {
  id: string
  batchNo: string
  materialId: string
  specId: string
  widthCm: string
  specSnapshot: SpecCalculationSnapshot
  quantity: string
  weightKg: string
  areaM2: string
  remainingQuantity: string
  remainingWeightKg: string
  remainingAreaM2: string
  unitCost: string | null
  sourceType: 'purchase_inbound' | 'production_in' | 'stock_transfer' | 'stock_adjust' | 'count_gain'
  sourceDocId: string
  status: 'normal' | 'frozen' | 'depleted'
  inboundAt: string
  createdAt: string
  updatedAt: string
}

export type InventoryDocType = 'purchase_inbound' | 'production_issue' | 'sales_outbound'

export interface DocWire {
  id: string
  docNo: string
  docType: InventoryDocType
  materialId: string
  specId: string
  widthCm: string
  specSnapshot: SpecCalculationSnapshot
  enteredUnit: string
  enteredValue: string
  quantityM: string
  weightKg: string
  areaM2: string
  unitPrice: string | null
  totalAmount: string | null
  counterparty: string | null
  operatorId: string
  remark: string | null
  createdAt: string
  updatedAt: string
}

export interface TxnWire {
  id: string
  batchId: string
  materialId: string
  specId: string
  direction: 'in' | 'out'
  txnType: StockTxnTypeValue
  changeQuantity: string
  changeWeightKg: string
  changeAreaM2: string
  afterQuantity: string
  afterWeightKg: string
  afterAreaM2: string
  unitPrice: string | null
  docId: string
  operatorId: string
  remark: string | null
  createdAt: string
}

export interface ReconcileWire {
  ledger: {
    purchaseKg: string
    productionOutKg: string
    salesOutKg: string
    remainingKg: string
    unexplainedKg: string
    unexplainedRate: string
  }
  check: { withinTolerance: boolean; warnings: string[] }
  bySpec: Array<{
    specId: string
    purchaseKg: string
    productionOutKg: string
    salesOutKg: string
    remainingKg: string
    unexplainedKg: string
    unexplainedRate: string
    withinTolerance: boolean
  }>
}

/** 往来单位（供应商 / 客户）线类型 */
export type PartnerTypeValue = 'supplier' | 'customer' | 'both'
export type PartnerStatusValue = 'active' | 'disabled'

export interface PartnerWire {
  id: string
  code: string
  name: string
  type: PartnerTypeValue
  contact: string | null
  phone: string | null
  taxNo: string | null
  address: string | null
  bankName: string | null
  bankAccount: string | null
  status: PartnerStatusValue
  remark: string | null
  createdAt: string
  updatedAt: string
}

/** 权限码（与后端 Permission 保持一致，前端仅做菜单/按钮门控） */
export const PERM = {
  MATERIAL_VIEW: 'material.view',
  MATERIAL_EDIT: 'material.edit',
  PARTNER_VIEW: 'partner.view',
  PARTNER_EDIT: 'partner.edit',
  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_MANAGE: 'inventory.manage',
  AUDIT_VIEW: 'audit.view',
} as const

/** decimal 字符串 → number，null/空按 0 处理 */
export function dec(v: string | number | null | undefined): number {
  if (v == null || v === '') return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

/** 数字格式化：固定小数位，千分位逗号 */
export function fmt(v: string | number | null | undefined, scale = 2): string {
  return dec(v).toLocaleString('zh-CN', { minimumFractionDigits: scale, maximumFractionDigits: scale })
}

/** 金额格式化（人民币） */
export function fmtMoney(v: string | number | null | undefined): string {
  const n = dec(v)
  return `¥${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** 占百分比格式化 */
export function fmtPct(v: string | number | null | undefined, scale = 2): string {
  return `${(dec(v) * 100).toFixed(scale)}%`
}

// ---------------------------------------------------------------------------
// 标签映射（shared 未覆盖的部分）
// ---------------------------------------------------------------------------

export const DOC_TYPE_LABEL: Record<InventoryDocType, { text: string; color: string; unitHint: string }> = {
  purchase_inbound: { text: '采购入库', color: 'green', unitHint: '按重量录入（kg / g / t）' },
  production_issue: { text: '生产领用', color: 'blue', unitHint: '按长度录入（m / yd）' },
  sales_outbound: { text: '销售出库', color: 'purple', unitHint: '按面积录入（m² / ft²）' },
}

export const DOC_TYPE_OPTIONS = (Object.keys(DOC_TYPE_LABEL) as InventoryDocType[]).map((k) => ({
  value: k,
  label: DOC_TYPE_LABEL[k].text,
}))

export const SOURCE_TYPE_LABEL: Record<BatchWire['sourceType'], string> = {
  purchase_inbound: '采购入库',
  production_in: '生产入库',
  stock_transfer: '移库',
  stock_adjust: '库存调整',
  count_gain: '盘盈',
}

export const BATCH_STATUS_LABEL: Record<BatchWire['status'], { text: string; color: string }> = {
  normal: { text: '正常', color: 'green' },
  frozen: { text: '冻结', color: 'orange' },
  depleted: { text: '已耗尽', color: 'default' },
}

export const COUNT_SYSTEM_LABEL: Record<CountSystem, string> = {
  NeS: '英支 NeS',
  Nm: '公支 Nm',
  Tex: '特数 Tex',
  D: '旦数 D',
}

export const COUNT_SYSTEM_OPTIONS = (Object.keys(COUNT_SYSTEM_LABEL) as CountSystem[]).map((k) => ({
  value: k,
  label: COUNT_SYSTEM_LABEL[k],
}))

export const WEAVE_TYPE_LABEL: Record<WeaveType, string> = {
  plain: '平纹',
  twill: '斜纹',
  satin: '缎纹',
  jacquard: '提花',
  leno: '纱罗',
  pile: '绒类',
}

/** 单据类型建议录入单位（与后端 convertQuantity 接受的维度一致） */
export const SUGGESTED_UNITS: Record<InventoryDocType, string[]> = {
  purchase_inbound: ['kg', 'g', 't'],
  production_issue: ['m', 'yd'],
  sales_outbound: ['m2', 'ft2'],
}

export const PARTNER_TYPE_LABEL: Record<PartnerTypeValue, string> = {
  supplier: '供应商',
  customer: '客户',
  both: '供应商兼客户',
}

export const PARTNER_TYPE_OPTIONS = (Object.keys(PARTNER_TYPE_LABEL) as PartnerTypeValue[]).map((k) => ({
  value: k,
  label: PARTNER_TYPE_LABEL[k],
}))

export const PARTNER_STATUS_LABEL: Record<PartnerStatusValue, { text: string; color: string }> = {
  active: { text: '启用', color: 'green' },
  disabled: { text: '停用', color: 'default' },
}
