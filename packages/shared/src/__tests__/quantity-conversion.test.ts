import { describe, it, expect } from 'vitest'
import {
  convertQuantity,
  contextFromSnapshot,
  checkTripleLedger,
  ConversionError,
  DEFAULT_TOLERANCE_RATE,
} from '../quantity-conversion'
import type { SpecCalculationSnapshot } from '../material'

/**
 * 基准算例：全棉府绸120×72 根/英寸，40S，幅宽 150cm
 * 内核算出克重 111.6 g/m²
 */
const G = { widthM: 1.5, gsm: 111.6 }

describe('1. 同维度换算', () => {
  it('重量：克 → 千克', () => {
    const r = convertQuantity(5000, 'g', 'kg')
    expect(r.value).toBeCloseTo(5, 6)
  })

  it('重量：千克 → 吨', () => {
    expect(convertQuantity(2500, 'kg', 't').value).toBeCloseTo(2.5, 6)
  })

  it('重量：磅 → 千克（0.45359237 精确）', () => {
    expect(convertQuantity(1, 'lb', 'kg').value).toBeCloseTo(0.45359237, 8)
  })

  it('长度：米 → 码', () => {
    expect(convertQuantity(1, 'm', 'yd').value).toBeCloseTo(1.0936133, 6)
  })

  it('长度：码 → 米', () => {
    expect(convertQuantity(1, 'yd', 'm').value).toBeCloseTo(0.9144, 6)
  })

  it('面积：平方米 → 平方码', () => {
    expect(convertQuantity(1, 'm2', 'yd2').value).toBeCloseTo(1.19599005, 6)
  })

  it('同单位直接返回', () => {
    const r = convertQuantity(12.5, 'kg', 'kg')
    expect(r.value).toBe(12.5)
    expect(r.path).toContain('同单位')
  })
})

describe('2. 长度 ↔ 面积（需幅宽）', () => {
  it('100 米 × 1.5 米幅宽 = 150 平方米', () => {
    const r = convertQuantity(100, 'm', 'm2', G)
    expect(r.value).toBeCloseTo(150, 6)
  })

  it('150 平方米 ÷ 1.5 米幅宽 = 100 米', () => {
    const r = convertQuantity(150, 'm2', 'm', G)
    expect(r.value).toBeCloseTo(100, 6)
  })

  it('换算路径含幅宽说明', () => {
    expect(convertQuantity(100, 'm', 'm2', G).path).toContain('幅宽')
  })

  it('缺幅宽时抛错而非猜默认值', () => {
    expect(() => convertQuantity(100, 'm', 'm2')).toThrow(ConversionError)
    expect(() => convertQuantity(100, 'm', 'm2')).toThrow(/幅宽/)
  })

  it('幅宽为零时抛错', () => {
    expect(() => convertQuantity(100, 'm', 'm2', { widthM: 0 })).toThrow(/幅宽/)
  })
})

describe('3. 重量 ↔ 长度/面积（需克重）', () => {
  it('100 米府绸重量 = 100 × 1.5 × 111.6 ÷ 1000 = 16.74 kg', () => {
    const r = convertQuantity(100, 'm', 'kg', G)
    expect(r.value).toBeCloseTo(16.74, 4)
  })

  it('重量反推长度：16.74 kg ÷ 0.1674 kg/米 = 100 米', () => {
    const r = convertQuantity(16.74, 'kg', 'm', G)
    expect(r.value).toBeCloseTo(100, 4)
  })

  it('150 平方米府绸重量 = 150 × 111.6 ÷ 1000 = 16.74 kg', () => {
    const r = convertQuantity(150, 'm2', 'kg', G)
    expect(r.value).toBeCloseTo(16.74, 4)
  })

  it('重量 → 面积：16.74 kg → 150 m²', () => {
    expect(convertQuantity(16.74, 'kg', 'm2', G).value).toBeCloseTo(150, 4)
  })

  it('换算路径含克重与幅宽说明', () => {
    const r = convertQuantity(100, 'm', 'kg', G)
    expect(r.path).toContain('克重')
    expect(r.path).toContain('幅宽')
  })

  it('缺克重时抛错', () => {
    expect(() => convertQuantity(100, 'm', 'kg')).toThrow(/克重/)
    expect(() => convertQuantity(100, 'm', 'kg', { widthM: 1.5 })).toThrow(ConversionError)
  })

  it('克重为零时抛错', () => {
    expect(() => convertQuantity(100, 'm', 'kg', { widthM: 1.5, gsm: 0 })).toThrow(/克重/)
  })
})

describe('4. 数量单位不可换算', () => {
  it('匹 → 米 抛错（需实测长度）', () => {
    expect(() => convertQuantity(1, 'piece', 'm', G)).toThrow(/不能与/)
  })

  it('米 → 匹 抛错', () => {
    expect(() => convertQuantity(100, 'm', 'piece', G)).toThrow(ConversionError)
  })

  it('错误码为 COUNT_NOT_CONVERTIBLE', () => {
    try {
      convertQuantity(1, 'piece', 'kg', G)
      expect.unreachable('应抛错')
    } catch (e) {
      expect((e as ConversionError).code).toBe('COUNT_NOT_CONVERTIBLE')
    }
  })
})

describe('5. 参数校验', () => {
  it('负数抛错', () => {
    expect(() => convertQuantity(-1, 'kg', 'g')).toThrow(/不能为负/)
  })

  it('NaN 抛错', () => {
    expect(() => convertQuantity(Number.NaN, 'kg', 'g')).toThrow(/有限数字/)
  })

  it('无穷大抛错', () => {
    expect(() => convertQuantity(Number.POSITIVE_INFINITY, 'kg', 'g')).toThrow(/有限数字/)
  })

  it('未知单位抛错', () => {
    expect(() => convertQuantity(1, 'foo', 'kg')).toThrow(/未知单位/)
  })

  it('零值可正常换算', () => {
    expect(convertQuantity(0, 'kg', 'g').value).toBe(0)
  })
})

describe('6. 三算一致性校验', () => {
  // 标准场景：采购 100kg 纱 → 织成布 → 销售
  // 100kg 棉纱约可织 100/0.0182 = 5494 米（每米约 18.2g 含损耗）
  it('完全一致时无警告', () => {
    const gsm = 111.6
    const widthM = 1.5
    const kgPerM = (gsm * widthM) / 1000 // 0.1674
    const productionM = 500
    const purchaseKg = productionM * kgPerM
    const salesM2 = productionM * widthM
    const r = checkTripleLedger({ purchaseKg, productionM, salesM2, widthM, gsm })
    expect(r.withinTolerance).toBe(true)
    expect(r.warnings).toHaveLength(0)
    expect(r.productionDiff).toBeCloseTo(0, 6)
    expect(r.salesDiff).toBeCloseTo(0, 6)
  })

  it('生产领用少于采购（正常损耗）在容差内', () => {
    const gsm = 111.6
    const widthM = 1.5
    const kgPerM = (gsm * widthM) / 1000
    const productionM = 500
    const purchaseKg = productionM * kgPerM * 1.02 // 采购多 2%
    const r = checkTripleLedger({ purchaseKg, productionM, salesM2: productionM * widthM, widthM, gsm })
    expect(r.productionDiffRate).toBeCloseTo(0.0196, 3)
    expect(r.withinTolerance).toBe(true)
  })

  it('损耗超容差时给出可操作提示', () => {
    const gsm = 111.6
    const widthM = 1.5
    const kgPerM = (gsm * widthM) / 1000
    const productionM = 500
    const purchaseKg = productionM * kgPerM * 1.5 // 采购多 50%
    const r = checkTripleLedger({ purchaseKg, productionM, salesM2: productionM * widthM, widthM, gsm })
    expect(r.withinTolerance).toBe(false)
    expect(r.warnings.length).toBeGreaterThan(0)
    // 提示要指向可能原因，而非只报数字
    expect(r.warnings[0]).toMatch(/织缩|上浆|损耗/)
  })

  it('销售面积与生产长度不匹配时报警', () => {
    const gsm = 111.6
    const widthM = 1.5
    const kgPerM = (gsm * widthM) / 1000
    const productionM = 500
    const purchaseKg = productionM * kgPerM
    const r = checkTripleLedger({ purchaseKg, productionM, salesM2: 400, widthM, gsm })
    expect(r.salesDiffRate).toBeGreaterThan(DEFAULT_TOLERANCE_RATE)
    expect(r.warnings.some((w) => /后整理|裁剪|校准/.test(w))).toBe(true)
  })

  it('对称性：超量生产同样报警', () => {
    const gsm = 111.6
    const widthM = 1.5
    const kgPerM = (gsm * widthM) / 1000
    const productionM = 500
    // 生产折重量远超采购
    const r = checkTripleLedger({
      purchaseKg: productionM * kgPerM * 0.5,
      productionM,
      salesM2: productionM * widthM,
      widthM,
      gsm,
    })
    expect(r.withinTolerance).toBe(false)
  })

  it('自定义容差生效', () => {
    const gsm = 100
    const widthM = 1
    const kgPerM = 0.1
    const productionM = 100
    const purchaseKg = productionM * kgPerM * 1.1
    const base = { productionM, salesM2: productionM * widthM, widthM, gsm }
    expect(checkTripleLedger({ ...base, purchaseKg }, 0.05).withinTolerance).toBe(false)
    expect(checkTripleLedger({ ...base, purchaseKg }, 0.2).withinTolerance).toBe(true)
  })

  it('零采购不产生除零错误', () => {
    const r = checkTripleLedger({ purchaseKg: 0, productionM: 100, salesM2: 150, widthM: 1.5, gsm: 111.6 })
    expect(r.productionDiffRate).toBe(0)
    expect(Number.isFinite(r.productionDiff)).toBe(true)
  })

  it('幅宽或克重非法时抛错', () => {
    expect(() =>
      checkTripleLedger({ purchaseKg: 10, productionM: 100, salesM2: 150, widthM: 0, gsm: 100 }),
    ).toThrow(ConversionError)
    expect(() =>
      checkTripleLedger({ purchaseKg: 10, productionM: 100, salesM2: 150, widthM: 1.5, gsm: 0 }),
    ).toThrow(ConversionError)
  })
})

describe('7. 从规格快照派生换算上下文', () => {
  const snapshot: SpecCalculationSnapshot = {
    specVersion: 1,
    warpGsm: 69.75,
    weftGsm: 41.85,
    totalGsm: 111.6,
    warpKgPer100m: 10.46,
    weftKgPer100m: 6.28,
    totalKgPer100m: 16.74,
    kgPerMeter: 0.1674,
    kgPerM2: 0.1116,
    dailyOutputM: 259.08,
    coefficients: {
      warpLossRate: 0.055,
      weftLossRate: 0.05,
      widthAllowance: 10,
      machineRunRate: 0.85,
    },
    calculatedAt: '2026-01-01T00:00:00.000Z',
  }

  it('派生的上下文克重与规格克重一致', () => {
    const ctx = contextFromSnapshot(snapshot, 150)
    expect(ctx.widthM).toBeCloseTo(1.5, 6)
    expect(ctx.gsm).toBeCloseTo(111.6, 4)
  })

  it('派生上下文后换算结果与规格一致', () => {
    const ctx = contextFromSnapshot(snapshot, 150)
    expect(convertQuantity(100, 'm', 'kg', ctx).value).toBeCloseTo(snapshot.totalKgPer100m, 4)
  })

  it('快照可还原历史计算：改规格不影响旧数据', () => {
    // 同一快照反复换算结果必须稳定
    const ctx = contextFromSnapshot(snapshot, 150)
    const a = convertQuantity(250, 'm', 'kg', ctx).value
    const b = convertQuantity(250, 'm', 'kg', ctx).value
    expect(a).toBe(b)
    expect(a).toBeCloseTo(41.85, 3)
  })
})
