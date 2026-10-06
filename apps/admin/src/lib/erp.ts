import { Permission } from '@weftcount/shared'
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
  /** 采购提前期/采购周期（天），补货点计算用 */
  leadTimeDays: string | null
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
  warehouseId: string | null
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
  partnerId: string | null
  partnerName: string | null
  orderId: string | null
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
    productionInKg: string
    countGainKg: string
    productionOutKg: string
    salesOutKg: string
    countLossKg: string
    remainingKg: string
    unexplainedKg: string
    unexplainedRate: string
  }
  check: { withinTolerance: boolean; warnings: string[] }
  bySpec: Array<{
    specId: string
    purchaseKg: string
    productionInKg: string
    countGainKg: string
    productionOutKg: string
    salesOutKg: string
    countLossKg: string
    remainingKg: string
    unexplainedKg: string
    unexplainedRate: string
    withinTolerance: boolean
  }>
}

// ---------------------------------------------------------------------------
// 采购 / 销售订单
// ---------------------------------------------------------------------------

export type TradeOrderTypeValue = 'purchase' | 'sales'
export type TradeOrderStatusValue = 'draft' | 'confirmed' | 'completed' | 'cancelled'

export interface OrderWire {
  id: string
  orderNo: string
  orderType: TradeOrderTypeValue
  partnerId: string
  partnerName: string
  /** 汇总数量（米）= 明细 quantityM 合计 */
  totalQuantityM: string
  /** 汇总金额 = 明细 lineAmount 合计 */
  totalAmount: string | null
  /** 来源合同（可选） */
  contractId: string | null
  status: TradeOrderStatusValue
  /** 交期 YYYY-MM-DD */
  expectedDate: string | null
  remark: string | null
  version: number
  createdAt: string
  updatedAt: string
}

export interface OrderItemWire {
  id: string
  orderId: string
  materialId: string
  specId: string
  orderedUnit: string
  orderedValue: string
  quantityM: string
  weightKg: string
  areaM2: string
  unitPrice: string | null
  lineAmount: string | null
  contractItemId: string | null
}

/** 订单详情（含已关联的履约单据与进度） */
export interface OrderDetail {
  order: OrderWire
  /** 已履约折米 */
  fulfilledM: number
  /** 订单折米 */
  orderedM: number
  /** 履约进度百分比 0~100 */
  progressPct: number
  /** 已关联的入库/出库单 */
  documents: DocWire[]
}

export const ORDER_TYPE_LABEL: Record<TradeOrderTypeValue, string> = {
  purchase: '采购订单',
  sales: '销售订单',
}

export const ORDER_TYPE_OPTIONS = (Object.keys(ORDER_TYPE_LABEL) as TradeOrderTypeValue[]).map((k) => ({
  value: k,
  label: ORDER_TYPE_LABEL[k],
}))

export const ORDER_STATUS_LABEL: Record<TradeOrderStatusValue, { text: string; color: string }> = {
  draft: { text: '草稿', color: 'default' },
  confirmed: { text: '已确认', color: 'blue' },
  completed: { text: '已完成', color: 'green' },
  cancelled: { text: '已取消', color: 'red' },
}

/** 订单建议录入单位：采购多按重量，销售多按面积（与三算单据一致） */
export const ORDER_SUGGESTED_UNITS: Record<TradeOrderTypeValue, string[]> = {
  purchase: ['kg', 'g', 't'],
  sales: ['m2', 'ft2'],
}

// ---------------------------------------------------------------------------
// 合同 / 价格
// ---------------------------------------------------------------------------

export type ContractStatusValue = 'draft' | 'active' | 'completed' | 'cancelled'

export interface ContractWire {
  id: string
  contractNo: string
  contractType: 'purchase' | 'sales'
  partnerId: string
  partnerName: string
  status: ContractStatusValue
  totalQuantityM: string
  totalAmount: string
  startDate: string | null
  endDate: string | null
  remark: string | null
  createdAt: string
  updatedAt: string
}

export interface ContractItemWire {
  id: string
  contractId: string
  materialId: string
  specId: string
  agreedPrice: string
  agreedQuantityM: string
  amount: string
  remark: string | null
}

export const CONTRACT_STATUS_LABEL: Record<ContractStatusValue, { text: string; color: string }> = {
  draft: { text: '草稿', color: 'default' },
  active: { text: '生效', color: 'green' },
  completed: { text: '已完成', color: 'blue' },
  cancelled: { text: '已取消', color: 'red' },
}

// ---------------------------------------------------------------------------
// AI 智能（阶段五）：确定性事实 + AI 建议
// ---------------------------------------------------------------------------

export interface AiInsight<T> {
  /** llm=大模型生成；rule=规则兜底（AI 不可用时） */
  source: 'llm' | 'rule'
  /** 置信度 0~1 */
  confidence: number
  /** 推导依据（确定性事实） */
  derivation: string[]
  /** 理由（LLM 或规则说明） */
  reasoning: string
  data: T
}

export interface QuoteData {
  specId: string
  specName: string
  quantityM: number
  costPerM: number
  materialCostPerM: number
  overheadPerM: number
  suggestedPrice: number
  marginRate: number
  grossProfitPerM: number
  priceBand: { min: number; max: number; avg: number; count: number } | null
  targetMarginRate: number
}

export interface SpecLossRow {
  specId: string
  specName: string
  inputM: number
  outputM: number
  inputYarnKg: number
  outputKg: number
  standardYield: number
  actualYield: number
  excessLossM: number
  excessLossKg: number
  excessLossRate: number
  lossAmount: number
  outputCount: number
}

export interface LossData {
  rows: SpecLossRow[]
  totalExcessKg: number
  totalLossAmount: number
  specCount: number
}

/** 损耗热点（到匹）：规格级超额损耗 + 该规格织造产出的件卡（各匹标注产出工单/机台） */
export interface LossHotspotWire {
  specId: string
  specName: string
  inputM: number
  outputM: number
  excessLossM: number
  excessLossRate: number
  lossAmount: number
  rolls: { rollNo: string; meters: number; status: string; orderNo: string; machineName: string }[]
}

export interface SpecCoefficientRow {
  specId: string
  specName: string
  inputM: number
  outputM: number
  sampleSize: number
  /** 实测多耗倍数 = 领用/报工（>1 实际比设计多耗） */
  observedFactor: number
  suggestedFactor: number
  currentFactor: number | null
  sufficient: boolean
  confidence: number
}

export interface CoefficientData {
  rows: SpecCoefficientRow[]
}

export interface SupplierCodeMappingWire {
  id: string
  supplierId: string
  supplierCode: string
  materialId: string
  specId: string
  remark: string | null
}

export interface YarnNeed {
  role: 'warp' | 'weft'
  materialId: string | null
  materialName: string
  needKg: number
  stockKg: number
  gapKg: number
  pricePerKg: number | null
}

export interface PredictionData {
  specId: string
  specName: string
  plannedMeters: number
  warp: YarnNeed
  weft: YarnNeed
  totalNeedKg: number
  totalGapKg: number
  estPurchaseCost: number | null
  warpKgPer100m: number
  weftKgPer100m: number
}

export interface ScheduleRow {
  orderId: string
  orderNo: string
  specName: string
  plannedMeters: number
  machineId: string | null
  machineName: string | null
  days: number
  startDay: number
  endDay: number
  dueInDays: number | null
  meetsDue: boolean | null
  dailyOutputM: number
}

export interface ScheduleData {
  rows: ScheduleRow[]
  orderCount: number
  atRiskCount: number
  machineCount: number
}

export type AlertType = 'order_overdue' | 'low_stock' | 'stale_batch'
export type AlertSeverity = 'info' | 'warning' | 'critical'
export interface AlertWire {
  id: string
  type: AlertType
  severity: AlertSeverity
  title: string
  message: string
  refType: string
  refId: string
  acknowledged: boolean
  createdAt: string
  /** 结构化附加数据（低库存预警带补货建议） */
  data: Record<string, string> | null
}

export interface TrendData {
  days: number
  daily: { date: string; meters: number; weightKg: number; purchaseAmount: number; salesAmount: number }[]
  specShare: { specId: string; specName: string; meters: number }[]
  totals: { meters: number; purchaseAmount: number; salesAmount: number }
  /** 损耗趋势：投料(领用) vs 产出 vs 当日/累计损耗（米） */
  loss: {
    daily: { date: string; inputM: number; outputM: number; excessM: number; cumulativeExcessM: number }[]
    totalExcessM: number
    windowInputM: number
    windowOutputM: number
  }
  /** 匹维度：日产出/发货匹数、在库匹数、机台产出 Top */
  rolls: {
    daily: { date: string; produced: number; shipped: number }[]
    inStock: number
    machineTop: { machineId: string; machineName: string; rolls: number; meters: number }[]
  }
}

// ---------------------------------------------------------------------------
// 生产：机台 / 工单 / 报工
// ---------------------------------------------------------------------------

export type MachineStatusValue = 'idle' | 'running' | 'maintenance' | 'retired'
export type ProductionOrderStatusValue = 'draft' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled'

export interface MachineWire {
  id: string
  code: string
  name: string
  model: string | null
  status: MachineStatusValue
  remark: string | null
  createdAt: string
  updatedAt: string
}

export interface ProductionOrderWire {
  id: string
  orderNo: string
  materialId: string
  specId: string
  specSnapshot: SpecCalculationSnapshot
  plannedQuantityM: string
  producedQuantityM: string
  machineId: string | null
  status: ProductionOrderStatusValue
  plannedStartDate: string | null
  dueDate: string | null
  remark: string | null
  version: number
  createdAt: string
  updatedAt: string
}

export interface ProductionReportWire {
  id: string
  orderId: string
  machineId: string
  reportDate: string
  outputM: string
  stoppageMinutes: number | null
  stopReason: string | null
  operatorId: string
  createdAt: string
}

export interface ProductionOrderDetail {
  order: ProductionOrderWire
  reports: ProductionReportWire[]
  progressPct: number
}

export const MACHINE_STATUS_LABEL: Record<MachineStatusValue, { text: string; color: string }> = {  idle: { text: '空闲', color: 'default' },
  running: { text: '运转中', color: 'green' },
  maintenance: { text: '维修中', color: 'orange' },
  retired: { text: '已报废', color: 'red' },
}

export const PRODUCTION_STATUS_LABEL: Record<ProductionOrderStatusValue, { text: string; color: string }> = {
  draft: { text: '草稿', color: 'default' },
  scheduled: { text: '已排产', color: 'blue' },
  in_progress: { text: '生产中', color: 'processing' },
  completed: { text: '已完成', color: 'green' },
  cancelled: { text: '已取消', color: 'red' },
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
/** 权限码：取自 shared 单一事实源（与后端/desktop 同一份，避免各端漂移） */
export const PERM = Permission

/** 车间工作台视图中文名（key 与 shared WORKSHOP_VIEW_PERM 一致） */
export const WORKSHOP_VIEW_LABEL: Record<string, string> = {
  report: '织机报工',
  board: '车间大屏',
  pick: '扫码出库',
  pickin: '扫码入库',
  label: '标签打印',
  rollcard: '件卡打印',
  scan: '扫码查询',
}

// ---------------------------------------------------------------------------
// 用户 / 角色（系统设置）
// ---------------------------------------------------------------------------

export type UserStatusValue = 'active' | 'disabled' | 'locked'

export interface RoleWire {
  id: string
  code: string
  name: string
  description: string | null
  permissions: string[]
  builtin: boolean
  createdAt: string
  updatedAt: string
}

export interface UserWire {
  id: string
  username: string
  realName: string
  phone: string | null
  email: string | null
  status: UserStatusValue
  companyIds: string[]
  companyNames: string[]
  roleCodes: string[]
  roleNames: string[]
  lastLoginAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CompanyOption {
  id: string
  code: string
  name: string
}

export const USER_STATUS_LABEL: Record<UserStatusValue, { text: string; color: string }> = {
  active: { text: '启用', color: 'green' },
  disabled: { text: '停用', color: 'default' },
  locked: { text: '锁定', color: 'red' },
}

/**
 * 权限目录（与后端 Permission 对应的可选清单）
 * 用于角色编辑器的多选项。后端角色权限可能含通配（如 material.*、*），
 * 这些不在目录里，前端仍以原始码展示，不丢信息。
 */
export const PERMISSION_CATALOG: { group: string; options: { value: string; label: string }[] }[] = [
  {
    group: '基础资料',
    options: [
      { value: 'material.view', label: '物料查看' },
      { value: 'material.edit', label: '物料编辑' },
      { value: 'partner.view', label: '往来单位查看' },
      { value: 'partner.edit', label: '往来单位编辑' },
      { value: 'warehouse.view', label: '仓库查看' },
      { value: 'warehouse.manage', label: '仓库管理' },
    ],
  },
  {
    group: '库存',
    options: [
      { value: 'inventory.view', label: '库存查看' },
      { value: 'inventory.manage', label: '库存管理' },
    ],
  },
  {
    group: '采购 / 销售',
    options: [
      { value: 'purchase.view', label: '采购查看' },
      { value: 'purchase.manage', label: '采购管理' },
      { value: 'sales.view', label: '销售查看' },
      { value: 'sales.manage', label: '销售管理' },
    ],
  },
  {
    group: '生产',
    options: [
      { value: 'production.view', label: '生产查看' },
      { value: 'production.order.edit', label: '工单编辑' },
      { value: 'production.report', label: '生产报工' },
      { value: 'production.self.view', label: '本机产量' },
    ],
  },
  {
    group: '成本 / 报表',
    options: [
      { value: 'cost.view', label: '成本查看' },
      { value: 'cost.manage', label: '成本管理' },
      { value: 'report.view', label: '报表查看' },
      { value: 'report.sales', label: '销售报表' },
    ],
  },
  {
    group: '工艺系数',
    options: [
      { value: 'coefficient.view', label: '系数查看' },
      { value: 'coefficient.edit', label: '系数编辑' },
      { value: 'tech.calc', label: '工艺试算' },
    ],
  },
  {
    group: '用户 / 角色',
    options: [
      { value: 'user.view', label: '用户查看' },
      { value: 'user.manage', label: '用户管理' },
      { value: 'role.view', label: '角色查看' },
      { value: 'role.manage', label: '角色管理' },
    ],
  },
  {
    group: '审计 / AI',
    options: [
      { value: 'audit.view', label: '审计查看' },
      { value: 'ai.use', label: 'AI 使用' },
    ],
  },
]

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

// ---------------------------------------------------------------------------
// 仓库
// ---------------------------------------------------------------------------

export type WarehouseTypeValue = 'raw' | 'greige' | 'finished' | 'auxiliary' | 'scrap' | 'other'

export interface WarehouseWire {
  id: string
  code: string
  name: string
  type: WarehouseTypeValue
  address: string | null
  keeper: string | null
  status: 'active' | 'disabled'
  remark: string | null
  createdAt: string
  updatedAt: string
}

export const WAREHOUSE_TYPE_LABEL: Record<WarehouseTypeValue, { text: string; color: string }> = {
  raw: { text: '原料库', color: 'geekblue' },
  greige: { text: '坯布库', color: 'cyan' },
  finished: { text: '成品库', color: 'green' },
  auxiliary: { text: '辅料库', color: 'purple' },
  scrap: { text: '废料库', color: 'red' },
  other: { text: '其他', color: 'default' },
}

// ---------------------------------------------------------------------------
// 盘点
// ---------------------------------------------------------------------------

export type StocktakeStatusValue = 'draft' | 'completed' | 'cancelled'

export interface StocktakeWire {
  id: string
  stocktakeNo: string
  warehouseId: string
  stocktakeDate: string
  status: StocktakeStatusValue
  operatorId: string
  remark: string | null
  createdAt: string
  updatedAt: string
}

export interface StocktakeItemView {
  id: string
  batchId: string
  batchNo: string
  /** 件卡（件卡级盘点时有值，批次级为 null） */
  rollId: string | null
  rollNo: string | null
  bookQuantityM: number
  countedQuantityM: number | null
  diffQuantityM: number | null
}

export const STOCKTAKE_STATUS_LABEL: Record<StocktakeStatusValue, { text: string; color: string }> = {
  draft: { text: '盘点中', color: 'processing' },
  completed: { text: '已完成', color: 'green' },
  cancelled: { text: '已取消', color: 'default' },
}

// ---------------------------------------------------------------------------
// 全链路追溯
// ---------------------------------------------------------------------------

export interface SpecBrief {
  id: string
  code: string
  name: string
  finishedWidth: string
  warpCount: string
  weftCount: string
  totalGsm: number
}

/** 批次来源链的一环（生产工单 / 采购 / 调拨递归 / 未知） */
export type BatchOrigin =
  | {
      kind: 'production'
      report: { id: string; reportDate: string; outputM: string; stopReason: string | null }
      workOrder: { id: string; orderNo: string; status: string; plannedQuantityM: string; producedQuantityM: string; dueDate: string | null }
      machine: { id: string; code: string; name: string; model: string | null } | null
    }
  | {
      kind: 'purchase'
      purchaseDoc: { id: string; docNo: string }
      purchaseOrder: { id: string; orderNo: string; status: string } | null
      supplier: { id: string; name: string } | null
    }
  | { kind: 'transfer'; fromBatchNo: string; origin: BatchOrigin | null }
  | { kind: 'unknown'; sourceType: string; sourceDocId: string }

export interface SalesTrace {
  salesDoc: {
    id: string
    docNo: string
    docType: string
    partnerName: string | null
    quantityM: string
    weightKg: string
    areaM2: string
    createdAt: string
  }
  salesOrder: { id: string; orderNo: string; status: string } | null
  customer: { id: string; name: string } | null
  spec: SpecBrief | null
  consumedBatches: Array<{
    batchNo: string
    warehouseName: string | null
    consumedM: number
    consumedKg: number
    origin: BatchOrigin
  }>
}

export interface BatchTrace {
  batch: {
    id: string
    batchNo: string
    materialId: string
    quantity: string
    remaining: string
    weightKg: string
    areaM2: string
    sourceType: string
    status: string
    inboundAt: string
  }
  spec: SpecBrief | null
  origin: BatchOrigin | null
  consumedBy: Array<{ docNo: string; docType: string; outM: number; partnerName: string | null; date: string }>
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

// ---------------------------------------------------------------------------
// 成本报表
// ---------------------------------------------------------------------------

/** 纱价来源：最新采购入库成本 / 物料参考价 / 无 */
export type YarnPriceSource = 'latest_purchase' | 'standard_price' | 'none'

/** 成本分析行（成本引擎算出的成本是 number，非 decimal 字符串——由内核实时计算） */
export interface CostRow {
  specId: string
  specCode: string
  specName: string
  warpMaterialName: string | null
  weftMaterialName: string | null
  warpYarnPrice: number
  weftYarnPrice: number
  warpPriceSource: YarnPriceSource
  weftPriceSource: YarnPriceSource
  warpKgPer100m: number
  weftKgPer100m: number
  overheadPerM: number
  warpCostPerM: number
  weftCostPerM: number
  materialCostPerM: number
  totalCostPerM: number
  totalCostPerKg: number
  totalCostPerM2: number
  salesPricePerM: number | null
  grossProfitPerM: number | null
  grossMarginRate: number | null
}

export const YARN_PRICE_SOURCE_LABEL: Record<YarnPriceSource, { text: string; color: string }> = {
  latest_purchase: { text: '最新采购', color: 'green' },
  standard_price: { text: '参考价', color: 'blue' },
  none: { text: '无价格', color: 'red' },
}

/**
 * 列表页表格垂直滚动高度
 *
 * 给 antd Table 的 scroll.y：表格**体内**上下滚动（列头与分页固定），
 * 页面高度被约束在视口内、不会整页撑出屏幕，需拖动整页。
 * 400px ≈ 顶栏(64) + 内容内边距(48) + 页标题(46) + 筛选卡(60) + 表头/分页/卡片内边距(119)
 * 的合计再留约 60px 余量——宁可表格略矮，也不要让整页/内容区出现滚动条。
 * 外壳(html/body)已固定视口不滚动，这里只保证表格能在内容区内放得下。
 */
export const LIST_TABLE_SCROLL_Y = 'calc(100vh - 400px)'
