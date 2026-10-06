import { describe, expect, it } from 'vitest'
import { computeSpecCost } from '../cost'
import type { SpecCalculationSnapshot } from '../material'

/**
 * 成本引擎单测
 *
 * 用「全棉府绸 120×72 根/英寸 40S 幅宽 150cm」基准算例：
 * 克重 111.6 g/m²、百米经纱 10.46kg / 纬纱 6.28kg（与 quantity-conversion 测试同源）。
 * 期望值一律由公式分量现算，避免手写常数算错（100×/1000× 错位）。
 */
const snapshot: SpecCalculationSnapshot = {
  specVersion: 1,
  warpGsm: 65,
  weftGsm: 46.6,
  totalGsm: 111.6,
  warpKgPer100m: 10.46,
  weftKgPer100m: 6.28,
  totalKgPer100m: 16.74,
  kgPerMeter: 0.1674,
  kgPerM2: 0.1116,
  dailyOutputM: 259,
  coefficients: { warpLossRate: 0.055, weftLossRate: 0.05, widthAllowance: 10, machineRunRate: 0.85 },
  calculatedAt: '2026-01-01T00:00:00.000Z',
}

const WARP_PRICE = 20 // 元/kg
const WEFT_PRICE = 18 // 元/kg
const OVERHEAD = 0.5 // 元/米

describe('computeSpecCost', () => {
  it('物成本 = 每百米经纬纱用量 × 单价 / 100', () => {
    const warpExp = (snapshot.warpKgPer100m * WARP_PRICE) / 100 // 2.092
    const weftExp = (snapshot.weftKgPer100m * WEFT_PRICE) / 100 // 1.1304
    const r = computeSpecCost({ snapshot, warpYarnPrice: WARP_PRICE, weftYarnPrice: WEFT_PRICE, overheadPerMeter: 0 })
    expect(r.warpCostPerM).toBeCloseTo(warpExp, 6)
    expect(r.weftCostPerM).toBeCloseTo(weftExp, 6)
    expect(r.materialCostPerM).toBeCloseTo(warpExp + weftExp, 6)
  })

  it('制造成本 = 物成本 + 加工费', () => {
    const materialExp =
      (snapshot.warpKgPer100m * WARP_PRICE) / 100 + (snapshot.weftKgPer100m * WEFT_PRICE) / 100
    const r = computeSpecCost({ snapshot, warpYarnPrice: WARP_PRICE, weftYarnPrice: WEFT_PRICE, overheadPerMeter: OVERHEAD })
    expect(r.totalCostPerM).toBeCloseTo(materialExp + OVERHEAD, 6)
  })

  it('每kg成本 = 制造成本 / 每米重量；每m²成本 = 每kg成本 × 每m²重量', () => {
    const materialExp =
      (snapshot.warpKgPer100m * WARP_PRICE) / 100 + (snapshot.weftKgPer100m * WEFT_PRICE) / 100
    const total = materialExp + OVERHEAD
    const perKg = total / snapshot.kgPerMeter
    const r = computeSpecCost({ snapshot, warpYarnPrice: WARP_PRICE, weftYarnPrice: WEFT_PRICE, overheadPerMeter: OVERHEAD })
    expect(r.totalCostPerKg).toBeCloseTo(perKg, 6)
    expect(r.totalCostPerM2).toBeCloseTo(perKg * snapshot.kgPerM2, 6)
  })

  it('提供售价时算单位毛利与毛利率', () => {
    const SALE = 8 // 元/米
    const materialExp =
      (snapshot.warpKgPer100m * WARP_PRICE) / 100 + (snapshot.weftKgPer100m * WEFT_PRICE) / 100
    const total = materialExp + OVERHEAD
    const r = computeSpecCost({ snapshot, warpYarnPrice: WARP_PRICE, weftYarnPrice: WEFT_PRICE, overheadPerMeter: OVERHEAD, salesPricePerMeter: SALE })
    expect(r.grossProfitPerM).toBeCloseTo(SALE - total, 6)
    expect(r.grossMarginRate).toBeCloseTo((SALE - total) / SALE, 6)
  })

  it('不提供售价时毛利为 null（不臆造）', () => {
    const r = computeSpecCost({ snapshot, warpYarnPrice: WARP_PRICE, weftYarnPrice: WEFT_PRICE, overheadPerMeter: OVERHEAD })
    expect(r.salesPricePerM).toBeNull()
    expect(r.grossProfitPerM).toBeNull()
    expect(r.grossMarginRate).toBeNull()
  })
})
