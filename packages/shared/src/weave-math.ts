/**
 * 织造工艺计算内核 —— 纬数 WeftCount 的核心护城河
 *
 * 行业背景：市面多数 ERP 把这块当「工艺员手工活」，公式散落在Excel 里。
 *
 *## 设计原则
 * 1. **唯一真源**：所有常数从 count-system.ts 派生，禁止在此处硬编码 23.25 / 228.6 / 0.059
 * 2. **恒等式优先**：能用物理推导的绝不用经验系数，克重/用纱量/支数三套量必须能互相对上
 * 3. **系数可配置**：织缩与损耗各厂不同，一律走配置，且支持工厂/客户/订单三级覆盖
 *
 * ## 已核实的行业公式勘误（相对常见公开资料）
 * | 公式 | 资料常见写法 | 本实现 | 说明 |
 * | --- | --- | --- | --- |
 * | 每米纬数 | 纬密 × 2.54 | 纬密 × 39.3701 | 2.54 是「根/英寸→根/厘米」，此处要「→根/米」，差 15.5倍 |
 * | 平方米克重 | (经密+纬密) × 1.159 / (2.54 × 纱支) | (经密+纬密) × 23.2497 / 纱支 | 资料常数 1.159 疑为 59.05 数字错位，偏小 50.9 倍 |
 * | 织缩率 | 坯布纬密 × 组织系数 ×(...) | 独立经/纬向定义 | 原式把横向参数当纵向收缩，物理不成立 |
 *
 * 恒等式（建议写进测试断言）：
 *   经向克重(g/m²) = 经密(根/英寸) × 39.3701 × Tex/1000
 *                  = 经密 × 23.2497 / NeS
 *                  = 经密 × 1.49994 / Nm
 *                  = 经密 × D(旦) / 228.6
 */

import {
  ENDS_PER_INCH_TO_PER_METER,
  GSM_COEF_DENIER,
  GSM_COEF_NES,
  TEX_PER_NES,
  fromTex,
  toTex,
  type CountSystem,
} from './count-system'

export {
  ENDS_PER_INCH_TO_PER_METER,
  GSM_COEF_DENIER,
  GSM_COEF_NES,
  TEX_PER_NES,
  fromTex,
  toTex,
}
export type { CountSystem }

/** 原料类型，影响损耗系数默认值 */
export type YarnMaterial = 'cotton' | 'viscose' | 'polyester' | 'nylon' | 'spandex' | 'acrylic' | 'linen' | 'filament'

/** 基础组织，历史上影响经纬向差异 */
export type WeaveType = 'plain' | 'twill' | 'satin' | 'jacquard' | 'leno' | 'pile'

/**
 * 织造工艺系数（三级覆盖：工厂默认 -> 客户/规格覆盖 -> 订单覆盖）
 *
 * 损耗率与织缩率在此**分列**，而非像行业资料那样合并成一个 1.1。
 * 原因：经纱与纬纱的损耗机理不同（经向有上浆+经缩，纬向有纬缩+落纱），
 * 合并会掩盖差异，导致损耗归因无法定位。
 */
export interface WeaveCoefficients {
  /** 经向损耗率 0-1（上浆率 4-8% + 经缩 3-5%） */
  warpLossRate: number
  /** 纬向损耗率 0-1（纬缩 3-6% + 落纱 2-4%） */
  weftLossRate: number
  /** 上机门幅比成品门幅的加放量（cm），行业惯例纬向须加放 10cm 以上 */
  widthAllowance: number
  /** 经向织缩率 0-1（纵向收缩） */
  warpShrinkage: number
  /** 纬向织缩率 0-1（横向收缩） */
  weftShrinkage: number
  /** 织机运转率 0-1，排产关键变量 */
  machineRunRate: number
}

/** 各原料类型的默认损耗率（经验值，须按客户实测标定） */
export const DEFAULT_LOSS_RATE_BY_MATERIAL: Record<YarnMaterial, { warp: number; weft: number }> = {
  cotton: { warp: 0.055, weft: 0.05 },
  viscose: { warp: 0.05, weft: 0.05 },
  polyester: { warp: 0.05, weft: 0.048 },
  nylon: { warp: 0.06, weft: 0.06 },
  spandex: { warp: 0.45, weft: 0.3 },
  acrylic: { warp: 0.055, weft: 0.052 },
  linen: { warp: 0.06, weft: 0.06 },
  filament: { warp: 0.08, weft: 0.1 },
}

export const DEFAULT_COEFFICIENTS: WeaveCoefficients = {
  warpLossRate: 0.055,
  weftLossRate: 0.05,
  widthAllowance: 10,
  warpShrinkage: 0.05,
  weftShrinkage: 0.04,
  machineRunRate: 0.85,
}

/** 按原料生成一套初始系数 */
export function buildDefaultCoefficients(material: YarnMaterial, _weave: WeaveType): WeaveCoefficients {
  const loss = DEFAULT_LOSS_RATE_BY_MATERIAL[material]
  return {
    ...DEFAULT_COEFFICIENTS,
    warpLossRate: loss.warp,
    weftLossRate: loss.weft,
  }
}

/** 坯布规格（计算所需最小字段集） */
export interface FabricSpec {
  /** 经密，根/英寸 */
  warpDensity: number
  /** 纬密，根/英寸 */
  weftDensity: number
  /** 成品门幅，cm */
  finishedWidth: number
  /** 经纱支数 */
  warpCount: { value: number; system: CountSystem }
  /** 纬纱支数 */
  weftCount: { value: number; system: CountSystem }
  /** 上机门幅，cm，不传则由成品门幅 + 加放量推算 */
  loomWidth?: number
}

/** 计算结果统一保留 4 位小数，避免浮点累积误差 */
function round(n: number, digits = 4): number {
  const f = 10 ** digits
  return Math.round((n + Number.EPSILON) * f) / f
}

function assertPositive(value: number, name: string): void {
  if (!(value > 0)) {
    throw new Error(`${name} 必须大于 0，当前值: ${value}`)
  }
}

/** 上机门幅：未指定时按成品门幅 + 加放量推算 */
export function resolveLoomWidth(spec: FabricSpec, coeffs: WeaveCoefficients = DEFAULT_COEFFICIENTS): number {
  return spec.loomWidth ?? spec.finishedWidth + coeffs.widthAllowance
}

// ---------------------------------------------------------------------------
// 克重（面密度）—— 物理恒等式，无经验系数
// ---------------------------------------------------------------------------

/**
 * 经向克重（g/m²）—— 严格式
 *
 * 每 m² 布含经密(根/英寸) × 39.3701 根经纱，每根长 1m，
 * 故经向克重 = 经密 × 39.3701 × Tex/1000。
 *
 * ⚠️ **不含幅宽**：克重是面密度(g/m²)，幅宽只影响「每百米用多少纱」，
 * 不影响「每平方米多少克」。幅宽若乘进来会得到一个仍叫g/m² 却随幅宽变化的量。
 */
export function warpGsmByTex(warpDensity: number, warpTex: number): number {
  assertPositive(warpDensity, '经密')
  assertPositive(warpTex, '经纱特数')
  return warpDensity * ENDS_PER_INCH_TO_PER_METER * (warpTex / 1000)
}

/**
 * 纬向克重（g/m²）—— 严格式，与经向同构
 */
export function weftGsmByTex(weftDensity: number, weftTex: number): number {
  assertPositive(weftDensity, '纬密')
  assertPositive(weftTex, '纬纱特数')
  return weftDensity * ENDS_PER_INCH_TO_PER_METER * (weftTex / 1000)
}

/**
 * 经向克重（g/m²）—— 行业经验式
 * 经密 / 英制纱支 × 23.25，与严格式等价（误差仅四舍五入），保留供业务人员对照
 */
export function warpGsmByNeS(warpDensity: number, warpNeS: number): number {
  assertPositive(warpDensity, '经密')
  assertPositive(warpNeS, '经纱英制支数')
  return (warpDensity * GSM_COEF_NES) / warpNeS
}

/** 纬向克重（g/m²）—— 行业经验式 */
export function weftGsmByNeS(weftDensity: number, weftNeS: number): number {
  assertPositive(weftDensity, '纬密')
  assertPositive(weftNeS, '纬纱英制支数')
  return (weftDensity * GSM_COEF_NES) / weftNeS
}

/** 经向克重（g/m²）—— 长丝口径，旦数 × 经密 / 228.6 */
export function warpGsmByDenier(warpDenier: number, warpDensity: number): number {
  assertPositive(warpDenier, '经纱旦数')
  assertPositive(warpDensity, '经密')
  return (warpDenier * warpDensity) / GSM_COEF_DENIER
}

/** 纬向克重（g/m²）—— 长丝口径 */
export function weftGsmByDenier(weftDenier: number, weftDensity: number): number {
  assertPositive(weftDenier, '纬纱旦数')
  assertPositive(weftDensity, '纬密')
  return (weftDenier * weftDensity) / GSM_COEF_DENIER
}

/**
 * 经纬向克重（g/m²）—— 统一入口，按支数体系自动折算
 * 合计克重恒等于经向 + 纬向，不存在任何独立系数。
 */
export function fabricGsm(spec: FabricSpec): { warp: number; weft: number; total: number } {
  const warpTex = toTex(spec.warpCount.value, spec.warpCount.system)
  const weftTex = toTex(spec.weftCount.value, spec.weftCount.system)
  const warp = warpGsmByTex(spec.warpDensity, warpTex)
  const weft = weftGsmByTex(spec.weftDensity, weftTex)
  return { warp: round(warp, 2), weft: round(weft, 2), total: round(warp + weft, 2) }
}

/** 由支数体系分派的行业经验式克重（供业务人员核对用） */
export function fabricGsmByCountSystem(spec: FabricSpec): { warp: number; weft: number; total: number } {
  const warpTex = toTex(spec.warpCount.value, spec.warpCount.system)
  const weftTex = toTex(spec.weftCount.value, spec.weftCount.system)
  const warp =
    spec.warpCount.system === 'NeS'
      ? warpGsmByNeS(spec.warpDensity, spec.warpCount.value)
      : spec.warpCount.system === 'D'
        ? warpGsmByDenier(spec.warpCount.value, spec.warpDensity)
        : round(warpGsmByTex(spec.warpDensity, warpTex), 2)
  const weft =
    spec.weftCount.system === 'NeS'
      ? weftGsmByNeS(spec.weftDensity, spec.weftCount.value)
      : spec.weftCount.system === 'D'
        ? weftGsmByDenier(spec.weftCount.value, spec.weftDensity)
        : round(weftGsmByTex(spec.weftDensity, weftTex), 2)
  return { warp, weft, total: round(warp + weft, 2) }
}

// ---------------------------------------------------------------------------
// 用纱量 —— 由克重推导，保证与克重自洽
// ---------------------------------------------------------------------------

/**
 * 百米用纱量（kg/100m）
 *
 * 唯一推荐路径：克重 × 幅宽 ÷ 10 × (1 + 损耗率)。
 * 恒等式：yarnKgPer100m / (widthM) × 10 === fabricGsm（无损耗时严格成立）
 *
 * 行业资料中的 `0.059` 与 `0.0065` 两个常数本质上就是本式的特例：
 *   0.059 = 100 × 590.5412 / 1e6  → 幅宽以英寸计
 *   两者与本式等价，但常数易被抄错，故不直接使用。
 */
export function yarnUsagePer100m(
  spec: FabricSpec,
  coeffs: WeaveCoefficients = DEFAULT_COEFFICIENTS,
): { warp: number; weft: number; total: number; gsm: number } {
  const gsm = fabricGsm(spec)
  const widthM = spec.finishedWidth / 100
  const warp = ((gsm.warp * widthM) / 10) * (1 + coeffs.warpLossRate)
  const weft = ((gsm.weft * widthM) / 10) * (1 + coeffs.weftLossRate)
  return {
    warp: round(warp, 4),
    weft: round(weft, 4),
    total: round(warp + weft, 4),
    gsm: gsm.total,
  }
}

/**
 * 指定长度的总用纱量（kg）
 */
export function yarnUsageForLength(
  spec: FabricSpec,
  lengthM: number,
  coeffs: WeaveCoefficients = DEFAULT_COEFFICIENTS,
): { warp: number; weft: number; total: number } {
  if (!(lengthM > 0)) throw new Error(`长度必须大于 0，当前值: ${lengthM}`)
  const per100 = yarnUsagePer100m(spec, coeffs)
  const factor = lengthM / 100
  return {
    warp: round(per100.warp * factor),
    weft: round(per100.weft * factor),
    total: round(per100.total * factor),
  }
}

// ---------------------------------------------------------------------------
// 织缩率与密度换算
// ---------------------------------------------------------------------------

/**
 * 纬向织缩率（0-1，横向收缩）
 * 定义式而非系数式：纬密与幅宽的收缩都源于纬向收缩
 */
export function weftShrinkageFromMeasure(
  greigePicksPerInch: number,
  finishedPicksPerInch: number,
): number {
  assertPositive(greigePicksPerInch, '坯布纬密')
  if (greigePicksPerInch < finishedPicksPerInch) {
    throw new Error('成品纬密不应大于坯布纬密（织造只会收缩，不会拉伸）')
  }
  return round((greigePicksPerInch - finishedPicksPerInch) / greigePicksPerInch, 4)
}

/** 经向织缩率（0-1，纵向收缩） */
export function warpShrinkageFromMeasure(greigeLengthM: number, finishedLengthM: number): number {
  assertPositive(greigeLengthM, '坯布长度')
  if (greigeLengthM < finishedLengthM) {
    throw new Error('成品长度不应大于坯布长度（织造只会收缩，不会拉伸）')
  }
  return round((greigeLengthM - finishedLengthM) / greigeLengthM, 4)
}

/** 坯布纬密 → 成品纬密（按纬向收缩） */
export function greigeToFinishedPicks(greigePicksPerInch: number, weftShrinkage: number): number {
  if (weftShrinkage < 0 || weftShrinkage >= 1) {
    throw new Error(`纬向织缩率必须在 [0,1) 内，当前值: ${weftShrinkage}`)
  }
  return round(greigePicksPerInch * (1 - weftShrinkage), 2)
}

/** 成品纬密 → 坯布纬密（上机口径，反推用） */
export function finishedToGreigePicks(finishedPicksPerInch: number, weftShrinkage: number): number {
  if (weftShrinkage < 0 || weftShrinkage >= 1) {
    throw new Error(`纬向织缩率必须在 [0,1) 内，当前值: ${weftShrinkage}`)
  }
  return round(finishedPicksPerInch / (1 - weftShrinkage), 2)
}

// ---------------------------------------------------------------------------
// 日产量
// ---------------------------------------------------------------------------

/**
 * 日产量（米/天）
 *
 * ⚠️ 每米纬数 =纬密(根/英寸) × 39.3701，不是 × 2.54。
 * 行业资料常误用 2.54（那是根/英寸→根/厘米），结果偏大 15.5 倍。
 *
 * @param picksPerMinute 织机转速，单位必须是「纬/分钟」。有梭织机若为主轴 r/min 需先 ×2。
 */
export function dailyOutput(
  picksPerMinute: number,
  weftDensity: number,
  coeffs: WeaveCoefficients = DEFAULT_COEFFICIENTS,
): number {
  if (!(picksPerMinute > 0)) throw new Error('织机转速必须大于 0')
  assertPositive(weftDensity, '纬密')
  const picksPerMeter = weftDensity * ENDS_PER_INCH_TO_PER_METER
  return round(((picksPerMinute * 24 * 60) / picksPerMeter) * coeffs.machineRunRate, 2)
}

// ---------------------------------------------------------------------------
// 坯布克重 → 成品克重：企业私有系数的自学习
// ---------------------------------------------------------------------------

/**
 * 坯布与成品的换算系数无法通用，因为染整工序引入物理与化学变量。
 * 行业资料明确写道「每个企业均有其标准」—— 这正是自学习引擎的落点。
 */
export interface GreigeToFinishedFactor {
  /** 系数值 */
  value: number
  /** 置信度 0-1，由样本量决定 */
  confidence: number
  /** 参与计算的样本数 */
  sampleSize: number
  /** 系数来源 */
  source: 'default' | 'manual' | 'learned'
  /** 最后更新时间 */
  updatedAt?: string
}

export const DEFAULT_GREIGE_FACTOR: GreigeToFinishedFactor = {
  value: 0.95,
  confidence: 0.1,
  sampleSize: 0,
  source: 'default',
}

/**
 * 根据样本计算私有换算系数
 *
 *采用带阻尼的加权均值，防止个别异常样本把系数带偏：
 * - 样本少时向经验值收缩
 * - 信任权重上限 0.8，始终留一部分给异常波动
 * - 样本 >= 5 时标记为 learned
 */
export function learnGreigeFactor(
  samples: number[],
  prior: GreigeToFinishedFactor = DEFAULT_GREIGE_FACTOR,
): GreigeToFinishedFactor {
  const valid = samples.filter((s) => s > 0 && Number.isFinite(s))
  if (valid.length === 0) {
    return { ...prior }
  }
  const sampleMean = valid.reduce((a, b) => a + b, 0) / valid.length
  const trust = Math.min(0.8, valid.length / (valid.length + 8))
  const value = prior.value * (1 - trust) + sampleMean * trust
  return {
    value: round(value, 4),
    confidence: round(Math.min(0.95, 0.2 + valid.length / (valid.length + 20)), 4),
    sampleSize: valid.length,
    source: valid.length >= 5 ? 'learned' : 'manual',
    updatedAt: new Date().toISOString(),
  }
}

/** 坯布克重换算为成品克重 */
export function greigeToFinished(
  greigeGsm: number,
  factor: GreigeToFinishedFactor = DEFAULT_GREIGE_FACTOR,
): { finishedGsm: number; factor: GreigeToFinishedFactor } {
  return { finishedGsm: round(greigeGsm * factor.value, 2), factor }
}

// ---------------------------------------------------------------------------
// 统一计算入口
// ---------------------------------------------------------------------------

export interface WeaveCalculationInput {
  spec: FabricSpec
  coeffs?: WeaveCoefficients
  /** 织机转速（纬/分钟），用于算日产量 */
  picksPerMinute?: number
  /** 织造长度（米），用于算总用纱 */
  lengthM?: number
  /** 坯布→成品克重换算系数 */
  greigeFactor?: GreigeToFinishedFactor
}

export interface WeaveCalculationResult {
  warpGsm: number
  weftGsm: number
  /** 坯布平方米克重 */
  totalGsm: number
  /** 成品平方米克重（经自学习系数换算） */
  finishedGsm: number
  /** 每百米经纱用量kg */
  warpPer100m: number
  /** 每百米纬纱用量 kg */
  weftPer100m: number
  /** 每百米总用纱 kg */
  totalPer100m: number
  /** 经向织缩率 */
  warpShrinkage: number
  /** 纬向织缩率 */
  weftShrinkage: number
  /** 织机日产量 米/天，0 表示未提供转速 */
  dailyOutput: number
  /** 上机门幅 cm */
  loomWidth: number
  /** 指定长度的总用纱 kg */
  totalYarnKg?: number
  /** 指定长度的经纬分项 kg */
  warpYarnKg?: number
  weftYarnKg?: number
}

export function calculateWeave(input: WeaveCalculationInput): WeaveCalculationResult {
  const { spec } = input
  const coeffs = input.coeffs ?? DEFAULT_COEFFICIENTS
  const loomWidth = resolveLoomWidth(spec, coeffs)
  const gsm = fabricGsm(spec)
  const usage = yarnUsagePer100m(spec, coeffs)
  const finished = greigeToFinished(gsm.total, input.greigeFactor ?? DEFAULT_GREIGE_FACTOR)

  const result: WeaveCalculationResult = {
    warpGsm: gsm.warp,
    weftGsm: gsm.weft,
    totalGsm: gsm.total,
    finishedGsm: finished.finishedGsm,
    warpPer100m: usage.warp,
    weftPer100m: usage.weft,
    totalPer100m: usage.total,
    warpShrinkage: coeffs.warpShrinkage,
    weftShrinkage: coeffs.weftShrinkage,
    dailyOutput: input.picksPerMinute ? dailyOutput(input.picksPerMinute, spec.weftDensity, coeffs) : 0,
    loomWidth,
  }

  if (input.lengthM && input.lengthM > 0) {
    const yarn = yarnUsageForLength(spec, input.lengthM, coeffs)
    result.warpYarnKg = yarn.warp
    result.weftYarnKg = yarn.weft
    result.totalYarnKg = yarn.total
  }

  return result
}
