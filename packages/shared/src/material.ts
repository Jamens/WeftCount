import type { MaterialCategoryValue } from './constants'

/**
 * 物料计量方式 —— 本系统最核心的领域概念
 *
 * 同一批坯布在三个环节的「自然计量单位」不同：
 *   采购按重量（公斤）→ 织造按长度（米）→ 销售按面积（平方米）
 * 这不是换算习惯问题，而是行业现实：纱线按公斤计价，织机产出米数，
 * 客户按平方米验货。三套账必须能对上，否则利润算不清。
 *
 * 物料主数据里显式声明 primaryUnit 与 allowedUnits，
 * 单据按主单位录入，系统负责换算并记录换算依据。
 */
export type MeasureMode = 'weight' | 'length' | 'area' | 'count'

export const MEASURE_MODE_LABEL: Record<MeasureMode, string> = {
  weight: '按重量',
  length: '按长度',
  area: '按面积',
  count: '按数量',
}

/** 计量方式对应的主单位代码（与 units.ts 的 unit code 一致） */
export const PRIMARY_UNIT_OF_MODE: Record<MeasureMode, string> = {
  weight: 'kg',
  length: 'm',
  area: 'm2',
  count: 'piece',
}

/** 允许的换算单位，按物料大类给出默认集 */
export const DEFAULT_ALLOWED_UNITS: Record<MaterialCategoryValue, string[]> = {
  // 纱线采购按公斤，厂内领用常按件/卷，但换算最终要落到重量
  yarn: ['kg', 'g', 't', 'piece'],
  // 坯布织造产出按米，销售按平方米
  greige: ['m', 'm2', 'kg', 'piece'],
  // 成品布对外按米或平方米
  finished: ['m', 'm2', 'kg', 'piece'],
  auxiliary: ['kg', 'g', 'm', 'piece', 'm2'],
  spare: ['piece', 'kg'],
}

/** 物料主数据 */
export interface Material {
  id: string
  tenantId: string
  companyId: string
  /** 物料编码，公司内唯一 */
  code: string
  name: string
  category: MaterialCategoryValue
  /** 规格描述，如「40S/2 精梳棉」 */
  specification: string
  /** 主计量方式 */
  measureMode: MeasureMode
  /** 主单位代码 */
  primaryUnit: string
  /** 允许录入的单位 */
  allowedUnits: string[]
  /** 是否为计件管理（如按筒/匹），影响盘点方式 */
  batchManaged: boolean
  /** 安全库存，低于则预警；null 表示不预警 */
  safetyStock: number | null
  status: 'active' | 'discontinued'
  remark: string | null
  createdAt: string
  updatedAt: string
}

/**
 * 坯布规格
 *
 * 关键约束：克重与用纱量**由工艺内核计算得出，不允许手工填写**。
 * 手填的克重必然与纱线规格脱节，导致成本核算失真。
 * 手填的是「实测克重」，用于校准内核的出厂换算系数（AI 自学习的输入）。
 */
export interface GreigeSpec {
  id: string
  tenantId: string
  companyId: string
  /** 规格编码，公司内唯一 */
  code: string
  name: string
  /** 成品门幅 cm */
  finishedWidth: number
  /** 经密，根/英寸 */
  warpDensity: number
  /** 纬密，根/英寸 */
  weftDensity: number
  /** 基础组织 */
  weaveType: 'plain' | 'twill' | 'satin' | 'jacquard' | 'leno' | 'pile'
  /** 经纱支数 */
  warpCount: { value: number; system: 'NeS' | 'Nm' | 'Tex' | 'D' }
  /** 纬纱支数 */
  weftCount: { value: number; system: 'NeS' | 'Nm' | 'Tex' | 'D' }
  /** 经纱物料 id */
  warpMaterialId: string | null
  /** 纬纱物料 id */
  weftMaterialId: string | null
  /** 上机门幅 cm，不填则由成品门幅 + 加放量推算 */
  loomWidth: number | null
  /** 上机加放量 cm */
  widthAllowance: number
  /** 经向损耗率 0-1 */
  warpLossRate: number
  /** 纬向损耗率 0-1 */
  weftLossRate: number
  /** 织机转速（纬/分钟），用于日产量 */
  picksPerMinute: number | null
  /** 运转率 0-1 */
  machineRunRate: number
  /** 内核算出的坯布克重 g/m²（只读，由 calculateWeave 写入） */
  calculatedGsm: number
  /** 出厂实测克重 g/m²，用于校准 */
  measuredGsm: number | null
  status: 'active' | 'discontinued'
  remark: string | null
  createdAt: string
  updatedAt: string
}

/** 规格计算结果快照，写单据时一并存下，保证历史可追溯 */
export interface SpecCalculationSnapshot {
  /** 计算时的规格版本号，规格改动后旧单据仍能还原 */
  specVersion: number
  warpGsm: number
  weftGsm: number
  totalGsm: number
  /** 每百米经纱 kg */
  warpKgPer100m: number
  weftKgPer100m: number
  totalKgPer100m: number
  /** 每米重量 kg/米 */
  kgPerMeter: number
  /** 每平方米重量 kg/m² */
  kgPerM2: number
  /** 日产量 米/天 */
  dailyOutputM: number
  /** 计算所用的系数快照，防止日后改系数导致历史数据漂移 */
  coefficients: {
    warpLossRate: number
    weftLossRate: number
    widthAllowance: number
    machineRunRate: number
  }
  /** 计算时间 */
  calculatedAt: string
}
