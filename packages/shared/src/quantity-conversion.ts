import type { SpecCalculationSnapshot } from './material'

/**
 * 数量换算：同一物料在不同计量单位间换算
 *
 * 设计要点：
 * 1. 换算只认「重量 / 长度 / 面积」三个基本维度，数量（piece）不可换算
 *    ——一匹布是几米取决于实际幅宽与长度，不能凭空推算
 * 2. 长度↔面积 需要幅宽参数，重量↔长度/面积 需要克重参数
 *    缺参数就抛错，绝不猜一个默认值糊弄过去
 * 3. 每次换算都返回换算路径，单据里存下依据供追溯
 */

/** 换算结果，带路径说明 */
export interface ConversionResult {
  value: number
  unit: string
  /** 换算路径，如 'm → m2（幅宽 1.5m）' */
  path: string
}

export class ConversionError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
    this.name = 'ConversionError'
  }
}

/** 单位所属维度 */
type Dimension = 'weight' | 'length' | 'area' | 'count'

const UNIT_DIMENSION: Record<string, Dimension> = {
  // 重量
  mg: 'weight', g: 'weight', kg: 'weight', t: 'weight', lb: 'weight', jin: 'weight',
  // 长度
  mm: 'length', cm: 'length', m: 'length', km: 'length',
  yd: 'length', inch: 'length', ft: 'length', chi: 'length',
  // 面积
  m2: 'area', cm2: 'area', ft2: 'area', yd2: 'area',
  // 数量
  piece: 'count', roll: 'count', cone: 'count', set: 'count',
}

/** 单位换算到基本单位的系数（kg / m / m²） */
const UNIT_FACTOR: Record<string, number> = {
  // 重量 → kg
  mg: 1e-6, g: 0.001, kg: 1, t: 1000, lb: 0.45359237, jin: 0.5,
  // 长度 → m
  mm: 0.001, cm: 0.01, m: 1, km: 1000,
  yd: 0.9144, inch: 0.0254, ft: 0.3048, chi: 1 / 3,
  // 面积 → m²
  m2: 1, cm2: 0.0001, ft2: 0.09290304, yd2: 0.83612736,
  // 数量：无系数
  piece: 1, roll: 1, cone: 1, set: 1,
}

function dimensionOf(unit: string): Dimension {
  const d = UNIT_DIMENSION[unit]
  if (!d) throw new ConversionError(`未知单位：${unit}`, 'UNIT_UNKNOWN')
  return d
}

function factorOf(unit: string): number {
  const f = UNIT_FACTOR[unit]
  if (f === undefined) throw new ConversionError(`未知单位：${unit}`, 'UNIT_UNKNOWN')
  return f
}

export interface ContextParams {
  /** 幅宽（米），长度↔面积换算必需 */
  widthM?: number
  /** 克重（g/m²），重量↔长度/面积换算必需 */
  gsm?: number
}

/**
 * 通用换算
 *
 * @param value 原值
 * @param fromUnit 原单位
 * @param toUnit 目标单位
 * @param ctx 换算上下文（幅宽、克重）
 */
export function convertQuantity(
  value: number,
  fromUnit: string,
  toUnit: string,
  ctx: ContextParams = {},
): ConversionResult {
  if (!Number.isFinite(value)) {
    throw new ConversionError('换算值必须为有限数字', 'VALUE_INVALID')
  }
  if (value < 0) {
    throw new ConversionError('换算值不能为负数', 'VALUE_NEGATIVE')
  }
  if (fromUnit === toUnit) {
    return { value, unit: toUnit, path: `${fromUnit} → ${toUnit}（同单位）` }
  }

  const dFrom = dimensionOf(fromUnit)
  const dTo = dimensionOf(toUnit)

  if (dFrom === dTo) {
    // 同维度，走基本单位中转
    const base = (value * factorOf(fromUnit)) / factorOf(toUnit)
    return { value: round6(base), unit: toUnit, path: `${fromUnit} → ${toUnit}` }
  }

  // 数量维度不可与其他维度换算
  if (dFrom === 'count' || dTo === 'count') {
    throw new ConversionError(
      `数量单位（${dFrom === 'count' ? fromUnit : toUnit}）不能与${
        dFrom === 'count' ? toUnit : fromUnit
      }换算，需要先有实测长度或重量`,
      'COUNT_NOT_CONVERTIBLE',
    )
  }

  // 长度 ↔ 面积：需要幅宽
  if ((dFrom === 'length' && dTo === 'area') || (dFrom === 'area' && dTo === 'length')) {
    if (!ctx.widthM || ctx.widthM <= 0) {
      throw new ConversionError(
        '长度与面积换算需要幅宽参数（widthM）',
        'WIDTH_REQUIRED',
      )
    }
    const meters = dFrom === 'length' ? value * factorOf(fromUnit) : (value * factorOf(fromUnit)) / ctx.widthM
    const result = dFrom === 'length' ? meters * ctx.widthM : meters
    return {
      value: round6(result / factorOf(toUnit)),
      unit: toUnit,
      path: `${fromUnit} → ${toUnit}（幅宽 ${ctx.widthM}m）`,
    }
  }

  // 重量 ↔ 长度/面积：需要克重
  if (dFrom === 'weight' || dTo === 'weight') {
    if (!ctx.gsm || ctx.gsm <= 0) {
      throw new ConversionError(
        '重量与长度/面积换算需要克重参数（gsm, g/m²）',
        'GSM_REQUIRED',
      )
    }
    // 克重是「每平方米克数」，与幅宽无关：
    //   每 m² 重量 = gsm / 1000 (kg)
    //   每 m  重量 = gsm × 幅宽 / 1000 (kg)
    const kgPerM2 = ctx.gsm / 1000

    if (dFrom === 'weight') {
      // 重量 → 目标单位
      const kg = value * factorOf(fromUnit)
      if (dTo === 'area') {
        return {
          value: round6(kg / kgPerM2 / factorOf(toUnit)),
          unit: toUnit,
          path: `${fromUnit} → ${toUnit}（克重 ${ctx.gsm}g/m²）`,
        }
      }
      // 重量 → 长度：需幅宽把每平方米重量摊到每米
      if (!ctx.widthM || ctx.widthM <= 0) {
        throw new ConversionError('重量与长度换算需要幅宽参数（widthM）', 'WIDTH_REQUIRED')
      }
      const kgPerM = kgPerM2 * ctx.widthM
      if (kgPerM <= 0) {
        throw new ConversionError('克重与幅宽组合算出的单位重量为零，请检查规格', 'INVALID_SPEC')
      }
      return {
        value: round6(kg / kgPerM / factorOf(toUnit)),
        unit: toUnit,
        path: `${fromUnit} → ${toUnit}（克重 ${ctx.gsm}g/m²，幅宽 ${ctx.widthM}m）`,
      }
    }

    // 长度 / 面积 → 重量
    if (dTo !== 'weight') {
      throw new ConversionError(`不支持的换算：${fromUnit} → ${toUnit}`, 'UNSUPPORTED')
    }
    if (!ctx.widthM || ctx.widthM <= 0) {
      throw new ConversionError('长度与重量换算需要幅宽参数（widthM）', 'WIDTH_REQUIRED')
    }
    const kgPerM = kgPerM2 * ctx.widthM
    if (kgPerM <= 0) {
      throw new ConversionError('克重与幅宽组合算出的单位重量为零，请检查规格', 'INVALID_SPEC')
    }
    const fromFactor = value * factorOf(fromUnit)
    // 从面积来：每 m² 重 kgPerM2；从长度来：每 m 重 kgPerM
    const kg = dFrom === 'area' ? fromFactor * kgPerM2 : fromFactor * kgPerM
    return {
      value: round6(kg / factorOf(toUnit)),
      unit: toUnit,
      path: `${fromUnit} → ${toUnit}（克重 ${ctx.gsm}g/m²，幅宽 ${ctx.widthM}m）`,
    }
  }

  throw new ConversionError(`不支持的换算：${fromUnit} → ${toUnit}`, 'UNSUPPORTED')
}

/**
 * 从规格计算快照派生的换算上下文
 */
export function contextFromSnapshot(snap: SpecCalculationSnapshot, widthCm: number): ContextParams {
  return {
    widthM: widthCm / 100,
    // 快照里存的是 g/m² 换算后的 kg/m²，换回 g/m²
    gsm: snap.kgPerM2 > 0 ? snap.kgPerM2 * 1000 : snap.totalGsm,
  }
}

// ---------------------------------------------------------------------------
// 三算一致性校验
// ---------------------------------------------------------------------------

/**
 * 三算差异
 *
 * 同一批坯布：采购按重量入库、生产按米数领用、销售按面积出库。
 * 三个口径折算到同一基准后应完全一致，允许一定误差（回缩、裁剪、检验公差）。
 */
export interface TripleLedger {
  /** 采购入库重量 kg */
  purchaseKg: number
  /** 生产领用长度 m */
  productionM: number
  /** 销售出库面积 m² */
  salesM2: number
  /** 幅宽 m */
  widthM: number
  /** 克重 g/m² */
  gsm: number
}

export interface TripleLedgerCheck {
  /** 以重量为基准折算的三本账，单位 kg */
  purchaseByWeight: number
  productionByWeight: number
  salesByWeight: number
  /** 生产折重量与采购的偏差 kg */
  productionDiff: number
  /** 销售折重量与生产的偏差 kg */
  salesDiff: number
  /** 相对偏差（生产 vs 采购） */
  productionDiffRate: number
  /** 相对偏差（销售 vs 生产） */
  salesDiffRate: number
  /** 是否在容差内 */
  withinTolerance: boolean
  /** 超差提示 */
  warnings: string[]
}

/** 默认容差 3%，超出会提示但不阻断——织造行业本就有正常损耗 */
export const DEFAULT_TOLERANCE_RATE = 0.03

export function checkTripleLedger(
  ledger: TripleLedger,
  toleranceRate = DEFAULT_TOLERANCE_RATE,
): TripleLedgerCheck {
  const { purchaseKg, productionM, salesM2, widthM, gsm } = ledger
  if (widthM <= 0) throw new ConversionError('幅宽必须大于 0', 'WIDTH_INVALID')
  if (gsm <= 0) throw new ConversionError('克重必须大于 0', 'GSM_INVALID')

  // 每米重量 kg = 克重 × 幅宽 ÷ 1000
  const kgPerM = (gsm * widthM) / 1000
  const productionByWeight = productionM * kgPerM
  const salesByWeight = salesM2 * (gsm / 1000)

  const productionDiff = productionByWeight - purchaseKg
  const salesDiff = salesByWeight - productionByWeight
  const productionDiffRate = purchaseKg > 0 ? Math.abs(productionDiff) / purchaseKg : 0
  const salesDiffRate = productionByWeight > 0 ? Math.abs(salesDiff) / productionByWeight : 0

  const warnings: string[] = []
  if (productionDiffRate > toleranceRate) {
    warnings.push(
      `生产领用折算重量与采购入库偏差 ${(productionDiffRate * 100).toFixed(2)}%，超出容差 ${(
        toleranceRate * 100
      ).toFixed(0)}%。可能原因：织缩系数不准、上浆率偏差、或存在未记录的损耗。`,
    )
  }
  if (salesDiffRate > toleranceRate) {
    warnings.push(
      `销售出库折算重量与生产领用偏差 ${(salesDiffRate * 100).toFixed(2)}%，超出容差 ${(
        toleranceRate * 100
      ).toFixed(0)}%。可能原因：后整理缩率、裁剪损耗、或成品与坯布克重关系未校准。`,
    )
  }

  return {
    purchaseByWeight: round6(purchaseKg),
    productionByWeight: round6(productionByWeight),
    salesByWeight: round6(salesByWeight),
    productionDiff: round6(productionDiff),
    salesDiff: round6(salesDiff),
    productionDiffRate: round6(productionDiffRate),
    salesDiffRate: round6(salesDiffRate),
    withinTolerance: warnings.length === 0,
    warnings,
  }
}

/**
 * 保留 10 位小数。
 * 精度要求来自单位换算：1磅 = 0.45359237 千克（8 位有效），
 * 若只保留 6 位，往返换算会产生可见误差。
 */
function round6(n: number): number {
  return Math.round((n + Number.EPSILON) * 1e10) / 1e10
}
