import type { SpecCalculationSnapshot } from './material'

/**
 * 成本核算引擎（确定性）
 *
 * 制造成本 = 纱线成本 + 加工费。纱线成本来自工艺内核算出的每百米经纬纱用量，
 * 乘以经/纬纱单价得出——**用量由内核确定性给出，成本只是把「用量 × 单价」乘起来**，
 * 数字绝不能出错，因此这里是纯函数、无 IO、可单测。
 *
 * 关键：所有用量都取自 SpecCalculationSnapshot（规格快照），
 * 规格改了历史成本仍能按当时快照还原，不会因混用克重而失真。
 */

export interface SpecCostInput {
  /** 规格计算快照，提供每百米经/纬纱用量、每米/每 m² 重量 */
  snapshot: SpecCalculationSnapshot
  /** 经纱单价 元/kg */
  warpYarnPrice: number
  /** 纬纱单价 元/kg */
  weftYarnPrice: number
  /** 加工费 元/米（电费+人工+机台折旧等，按规格核定） */
  overheadPerMeter: number
  /** 销售单价 元/米，传入则算毛利；不传则毛利为 null */
  salesPricePerMeter?: number | null
}

export interface SpecCostResult {
  /** 经纱成本 元/米 */
  warpCostPerM: number
  /** 纬纱成本 元/米 */
  weftCostPerM: number
  /** 纱线物成本 元/米 */
  materialCostPerM: number
  /** 加工费 元/米 */
  overheadPerM: number
  /** 制造成本 元/米 */
  totalCostPerM: number
  /** 制造成本 元/kg */
  totalCostPerKg: number
  /** 制造成本 元/m² */
  totalCostPerM2: number
  /** 销售单价 元/米（未提供为 null） */
  salesPricePerM: number | null
  /** 单位毛利 元/米（售价-制造成本，未提供售价为 null） */
  grossProfitPerM: number | null
  /** 毛利率（毛利/售价，未提供售价或售价<=0 为 null） */
  grossMarginRate: number | null
}

function round(n: number, scale = 6): number {
  const f = 10 ** scale
  return Math.round((n + Number.EPSILON) * f) / f
}

/**
 * 规格成本核算
 *
 * 物成本 = (每百米经纱kg × 经纱单价 + 每百米纬纱kg × 纬纱单价) / 100
 * 制造成本 = 物成本 + 加工费
 * 每kg成本 = 制造成本 / 每米重量；每m²成本 = 每kg成本 × 每m²重量
 */
export function computeSpecCost(input: SpecCostInput): SpecCostResult {
  const s = input.snapshot
  const warpCostPerM = (s.warpKgPer100m * input.warpYarnPrice) / 100
  const weftCostPerM = (s.weftKgPer100m * input.weftYarnPrice) / 100
  const materialCostPerM = warpCostPerM + weftCostPerM
  const overheadPerM = input.overheadPerMeter
  const totalCostPerM = materialCostPerM + overheadPerM

  const totalCostPerKg = s.kgPerMeter > 0 ? totalCostPerM / s.kgPerMeter : 0
  const totalCostPerM2 = totalCostPerKg * (s.kgPerM2 ?? 0)

  const salesPricePerM =
    input.salesPricePerMeter != null && Number.isFinite(input.salesPricePerMeter) ? input.salesPricePerMeter : null
  const grossProfitPerM = salesPricePerM != null ? salesPricePerM - totalCostPerM : null
  const grossMarginRate = grossProfitPerM != null && salesPricePerM != null && salesPricePerM > 0 ? grossProfitPerM / salesPricePerM : null

  return {
    warpCostPerM: round(warpCostPerM),
    weftCostPerM: round(weftCostPerM),
    materialCostPerM: round(materialCostPerM),
    overheadPerM: round(overheadPerM),
    totalCostPerM: round(totalCostPerM),
    totalCostPerKg: round(totalCostPerKg),
    totalCostPerM2: round(totalCostPerM2),
    salesPricePerM: salesPricePerM != null ? round(salesPricePerM) : null,
    grossProfitPerM: grossProfitPerM != null ? round(grossProfitPerM) : null,
    grossMarginRate: grossMarginRate != null ? round(grossMarginRate) : null,
  }
}
