/**
 * 坯布检验分等（四分制 → 定等 → 分等定价）
 *
 * ## 为什么不是「让人直接选等级」
 *
 * 朴素做法是给检验员一个下拉：一等品 / 二等品 / 三等品 / 等外品，勾了就完事。
 * 但这样做出来的等级**不可复核**：为什么这匹是二等？谁也说不清，
 * 客户来扯皮时只能认栽，等级价差 5~15% 就这么白白让掉。
 *
 * 行业的做法是**扣分制**（美标 ASTM D5430 四分制）：
 * 验布机过布，逐个疵点按长度扣分，累计算出「**每 100 平方码扣几分**」，
 * 再按规则落到等级。等级是**算出来的**，不是选出来的——
 * 争执时有据可查，改规则可以整批复算。
 *
 * ## 口径
 * ```
 * 单一疵点扣分   ≤3 英寸 → 1 分；3~6 → 2 分；6~9 → 3 分；>9 → 4 分；破洞一律 4 分
 * 匹面积(平方码) = 匹长 × 门幅 换算到平方码
 * 扣分密度       = 总扣分 × 100 / 平方码数
 * 定等           = 密度落在哪条规则的区间（区间可配置）
 * 收货红线       = 密度 > 4 分/100平方码 → 判不合格（标准原文的收货上限）
 * ```
 *
 * ## 单位
 * 面积走 `units.ts` 的换算体系（m² → sqyd），**不在本文件硬编码 0.83612736**。
 * 门幅入参是英寸（贸易口径），内部换成米再算面积。
 *
 * ## 边界
 * - 平方码 = 0（匹长或门幅为 0）→ 密度记为 0，不除零。
 *   真实数据里这是录入漏项，返回 0 比抛异常好——检验员还在录一半。
 * - 未匹配到任何规则（全部上限都比密度小）→ 落到**最后一条**（等外品）。
 *   不抛错：宁可判等外让人复核，也不能让一匹布没有等级。
 * - `calcGradePrice` 无规则 → 退回原价，不动分文。
 */

import { convert } from './units'

/** 坯布品等（A=一等品 … D=等外品） */
export const GREIGE_GRADES = ['A', 'B', 'C', 'D'] as const

export type GreigeGrade = (typeof GREIGE_GRADES)[number]

export const GRADE_LABELS: Record<GreigeGrade, string> = {
  A: '一等品',
  B: '二等品',
  C: '三等品',
  D: '等外品',
}

/** 单一疵点扣分上限（四分制：任何疵点最多 4 分） */
export const MAX_POINTS_PER_DEFECT = 4

/**
 * 收货红线：每 100 平方码累计扣分上限
 *
 * 这是标准原文的判定线，与「定等区间」是**两件事**——
 * 一等品的密度可能低于 4 分（合格），三等品可能高于 4 分（不合格但仍可降价卖）。
 * 所以单独作为一个布尔位返回，不做进定等规则。
 */
export const RECEIVING_LIMIT_PER_100_SQYD = 4

export interface GradeRule {
  grade: GreigeGrade
  /** 扣分密度上限（分 / 100 平方码），**含等于** */
  maxPenaltyDensity: number
}

/**
 * 默认定等区间
 *
 * 国内坯布厂普遍在 20 / 28 / 40 分三档，故以此为默认值。
 * **必须可配置**：不同客户、不同品种（府绸 vs 帆布）标准不同，
 * 写死在代码里等于逼用户迁就系统。
 */
export const DEFAULT_GRADE_RULES: readonly GradeRule[] = [
  { grade: 'A', maxPenaltyDensity: 20 },
  { grade: 'B', maxPenaltyDensity: 28 },
  { grade: 'C', maxPenaltyDensity: 40 },
  { grade: 'D', maxPenaltyDensity: Number.POSITIVE_INFINITY },
]

export interface DefectPenaltyInput {
  /** 疵点长度（英寸） */
  lengthInch: number
  /** 是否破洞：破洞不论大小一律 4 分 */
  isHole?: boolean
}

/**
 * 单个疵点的扣分
 *
 * 负长度与 NaN 一律按 0 处理（录入瞬时值），但**破洞不看长度**。
 */
export function defectPenalty(input: DefectPenaltyInput): number {
  if (input.isHole) return MAX_POINTS_PER_DEFECT
  const len = Number.isFinite(input.lengthInch) ? Math.max(0, input.lengthInch) : 0
  if (len === 0) return 0
  if (len <= 3) return 1
  if (len <= 6) return 2
  if (len <= 9) return 3
  return MAX_POINTS_PER_DEFECT
}

export interface RollScoreInput {
  /** 匹长（米） */
  meters: number
  /** 门幅（英寸） */
  widthInch: number
  /** 该匹各疵点扣分之和 */
  totalPoints: number
}

export interface RollScore {
  /** 匹面积（平方码） */
  sqYards: number
  /** 扣分密度（分 / 100 平方码） */
  penaltyDensity: number
  /** 是否超出收货红线（> 4 分 / 100 平方码） */
  overReceivingLimit: boolean
}

/**
 * 计算一匹布的扣分密度
 *
 * 面积走单位换算：门幅(英寸) → 米，与匹长相乘得 m²，再换算成平方码。
 */
export function scoreRoll(input: RollScoreInput): RollScore {
  const meters = Number.isFinite(input.meters) ? Math.max(0, input.meters) : 0
  const widthInch = Number.isFinite(input.widthInch) ? Math.max(0, input.widthInch) : 0
  const points = Number.isFinite(input.totalPoints) ? Math.max(0, input.totalPoints) : 0

  const widthM = convert(widthInch, 'inch', 'm')
  const areaM2 = meters * widthM
  const sqYards = areaM2 > 0 ? convert(areaM2, 'm2', 'sqyd') : 0

  const penaltyDensity = sqYards > 0 ? (points * 100) / sqYards : 0

  return {
    sqYards,
    penaltyDensity,
    overReceivingLimit: penaltyDensity > RECEIVING_LIMIT_PER_100_SQYD,
  }
}

/**
 * 扣分密度 → 品等
 *
 * 未命中任何区间时落到**最后一条**规则（等外品），不抛错。
 */
export function gradeByDensity(
  penaltyDensity: number,
  rules: readonly GradeRule[] = DEFAULT_GRADE_RULES,
): GreigeGrade {
  if (rules.length === 0) return 'D'
  for (const rule of rules) {
    if (penaltyDensity <= rule.maxPenaltyDensity) return rule.grade
  }
  return rules[rules.length - 1]!.grade
}

/** 分等定价方式 */
export type GradePriceMode = 'fixed' | 'discount' | 'delta'

export interface GradePriceRule {
  grade: GreigeGrade
  /**
   * - `fixed`    直接定价：`value` = 该等级的单价（元/米）
   * - `discount` 折扣：`value` = 折扣率，0.92 表示 92 折
   * - `delta`    加减：`value` = 每米加减金额（元），可为负
   */
  mode: GradePriceMode
  value: number
}

/**
 * 按品等算单价
 *
 * - 无规则 → 退回 `basePrice`（**不分等计价时金额分文不动**，这是默认行为）
 * - 结果 < 0 → 夹到 0（防止「折扣率填成负数」这种脏数据算出负金额）
 * - 保留 4 位小数，与 `contract_items.agreed_price` 的 `scale: 4` 对齐。
 *   中途不取整，取整只发生在最后开票环节。
 */
export function calcGradePrice(basePrice: number, rule?: GradePriceRule | null): number {
  const base = Number.isFinite(basePrice) ? Math.max(0, basePrice) : 0
  if (!rule) return base

  let result: number
  switch (rule.mode) {
    case 'fixed':
      result = Number.isFinite(rule.value) ? rule.value : base
      break
    case 'discount':
      result = Number.isFinite(rule.value) ? base * rule.value : base
      break
    case 'delta':
      result = Number.isFinite(rule.value) ? base + rule.value : base
      break
  }

  if (!Number.isFinite(result) || result < 0) result = 0
  return Math.round(result * 1e4) / 1e4
}

/**
 * 按品等分组的「米数 × 单价」加权算整单价
 *
 * ## 为什么是加权，而不是取最高/最低/平均等级
 * 一单可能同时发一等品和等外品：
 * - 取最高等级算整单价 → 等外那部分白送
 * - 取平均等级 → 算出库里根本不存在的价
 * 正确口径：**各等级分别取价，再按本次发出的米数加权**。
 *
 * 例：60m 一等品 @12.5 + 40m 二等品 @11.5
 * → (12.5×60 + 11.5×40) / 100 = **12.1 元/米**
 *
 * `grade: null` 的组照常参与加权（未检验的匹按基准价计）——
 * 权重是米数，与有没有等级无关。
 */
export function weightedGradePrice(
  groups: { grade: GreigeGrade | null; meters: number; price: number }[],
): number {
  let totalMeters = 0
  let amount = 0
  for (const g of groups) {
    const meters = Number.isFinite(g.meters) ? Math.max(0, g.meters) : 0
    const price = Number.isFinite(g.price) ? Math.max(0, g.price) : 0
    totalMeters += meters
    amount += price * meters
  }
  // 没米数无从加权：返回 0 让调用方走「不自动计价」的分支，不猜一个价
  if (totalMeters <= 0) return 0
  return Math.round((amount / totalMeters) * 1e4) / 1e4
}
