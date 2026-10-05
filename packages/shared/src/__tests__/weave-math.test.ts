import { describe, it, expect } from 'vitest'
import {
  warpGsmByTex,
  warpGsmByNeS,
  weftGsmByNeS,
  warpGsmByDenier,
  weftGsmByDenier,
  fabricGsm,
  fabricGsmByCountSystem,
  yarnUsagePer100m,
  yarnUsageForLength,
  weftShrinkageFromMeasure,
  warpShrinkageFromMeasure,
  greigeToFinishedPicks,
  finishedToGreigePicks,
  dailyOutput,
  calculateWeave,
  buildDefaultCoefficients,
  resolveLoomWidth,
  learnGreigeFactor,
  greigeToFinished,
  DEFAULT_COEFFICIENTS,
  DEFAULT_GREIGE_FACTOR,
  ENDS_PER_INCH_TO_PER_METER,
} from '../weave-math'
import { toTex } from '../count-system'
import type { FabricSpec } from '../weave-math'

/**
 * 基准算例：全棉府绸
 * 经密 120 根/英寸，纬密 72 根/英寸，幅宽 150cm，经纬 40S 纯棉
 * 行业实测：坯布克重约 111.6 g/m²
 */
const cottonSpec: FabricSpec = {
  warpDensity: 120,
  weftDensity: 72,
  finishedWidth: 150,
  warpCount: { value: 40, system: 'NeS' },
  weftCount: { value: 40, system: 'NeS' },
}

/** 基准算例二：150D 涤纶长丝塔夫绸，经密 72、纬密 60 根/英寸 */
const filamentSpec: FabricSpec = {
  warpDensity: 72,
  weftDensity: 60,
  finishedWidth: 150,
  warpCount: { value: 150, system: 'D' },
  weftCount: { value: 150, system: 'D' },
}

describe('1. 克重三路交叉验证（恒等式核心）', () => {
  it('经向克重：严格式 ≈ 经验式 23.25', () => {
    const strict = warpGsmByTex(120, toTex(40, 'NeS'))
    const empirical = warpGsmByNeS(120, 40)
    expect(strict).toBeCloseTo(69.749, 2)
    expect(empirical).toBeCloseTo(69.75, 2)
    expect(strict).toBeCloseTo(empirical, 1)
  })

  it('长丝式与短纤式在 40S 上完全一致', () => {
    const tex = toTex(40, 'NeS')
    const denier = tex * 9
    expect(warpGsmByDenier(denier, 120)).toBeCloseTo(warpGsmByTex(120, tex), 3)
  })

  it('纬向克重 = 41.85 g/m²', () => {
    expect(weftGsmByNeS(72, 40)).toBeCloseTo(41.85, 2)
  })

  it('合计克重 = 经向 + 纬向（无独立系数）', () => {
    const g = fabricGsm(cottonSpec)
    expect(g.total).toBeCloseTo(g.warp + g.weft, 2)
    expect(g.total).toBeCloseTo(111.6, 0)
  })

  it('经纬克重比 = 经纬密比', () => {
    const g = fabricGsm(cottonSpec)
    expect(g.warp / g.weft).toBeCloseTo(120 / 72, 6)
  })

  it('克重与幅宽无关（面密度定义使然，幅宽只影响用纱量）', () => {
    const wide = fabricGsm({ ...cottonSpec, finishedWidth: 300 })
    expect(wide.total).toBeCloseTo(fabricGsm(cottonSpec).total, 6)
  })

  it('纱支越细（NeS 越大）克重越低', () => {
    const fine = fabricGsm({
      ...cottonSpec,
      warpCount: { value: 60, system: 'NeS' },
      weftCount: { value: 60, system: 'NeS' },
    })
    // 60S 比 40S 细 => 每根更轻 => 同密度下克重更低
    expect(fine.total).toBeLessThan(fabricGsm(cottonSpec).total)
  })

  it('经验式与严格式在 NeS 口径下对齐', () => {
    const strict = fabricGsm(cottonSpec)
    const empirical = fabricGsmByCountSystem(cottonSpec)
    expect(empirical.total).toBeCloseTo(strict.total, 1)
  })

  it('长丝克重：150D 经72 纬60 = 86.61 g/m²', () => {
    const g = fabricGsm(filamentSpec)
    expect(g.total).toBeCloseTo(86.61, 1)
    expect(warpGsmByDenier(150, 72)).toBeCloseTo(47.24, 2)
    expect(weftGsmByDenier(150, 60)).toBeCloseTo(39.37, 2)
  })

  it('非法密度抛错', () => {
    expect(() => warpGsmByNeS(0, 40)).toThrow()
    expect(() => warpGsmByTex(120, 0)).toThrow()
    expect(() => fabricGsm({ ...cottonSpec, warpDensity: 0 })).toThrow()
  })
})

describe('2. 用纱量（由克重推导，恒等自洽）', () => {
  const noLoss = { ...DEFAULT_COEFFICIENTS, warpLossRate: 0, weftLossRate: 0 }

  it('无损耗时与克重严格恒等', () => {
    const u = yarnUsagePer100m(cottonSpec, noLoss)
    const g = fabricGsm(cottonSpec)
    const widthM = cottonSpec.finishedWidth / 100
    // 恒等式：kg/100m = g/m² × widthM ÷ 10  =>  g/m² = u × 10 ÷ widthM
    expect(u.total).toBeCloseTo((g.total * widthM) / 10, 3)
    expect((u.total * 10) / widthM).toBeCloseTo(g.total, 3)
  })

  it('无损耗 100 米用料 ≈ 16.74 kg', () => {
    expect(yarnUsagePer100m(cottonSpec, noLoss).total).toBeCloseTo(16.7398, 2)
  })

  it('加损耗后用量上升', () => {
    expect(yarnUsagePer100m(cottonSpec).total).toBeGreaterThan(
      yarnUsagePer100m(cottonSpec, noLoss).total,
    )
  })

  it('经纬分项之和 = 总量', () => {
    const u = yarnUsagePer100m(cottonSpec)
    expect(u.total).toBeCloseTo(u.warp + u.weft, 3)
  })

  it('弹力经向损耗 45% 显著抬高经纱用量', () => {
    const spandex = buildDefaultCoefficients('spandex', 'plain')
    expect(spandex.warpLossRate).toBe(0.45)
    const u = yarnUsagePer100m(cottonSpec, spandex)
    expect(u.warp).toBeGreaterThan(yarnUsagePer100m(cottonSpec).warp)
  })

  it('按长度线性放大', () => {
    const y100 = yarnUsageForLength(cottonSpec, 100)
    const y500 = yarnUsageForLength(cottonSpec, 500)
    expect(y500.total / y100.total).toBeCloseTo(5, 2)
  })

  it('非法长度抛错', () => {
    expect(() => yarnUsageForLength(cottonSpec, 0)).toThrow()
    expect(() => yarnUsageForLength(cottonSpec, -1)).toThrow()
  })

  it('幅宽翻倍则每百米用料翻倍', () => {
    const narrow = yarnUsagePer100m(cottonSpec, noLoss).total
    const wide = yarnUsagePer100m({ ...cottonSpec, finishedWidth: 300 }, noLoss).total
    expect(wide / narrow).toBeCloseTo(2, 2)
  })
})

describe('3. 织缩率与密度换算（定义式，非系数式）', () => {
  it('纬向织缩：坯布 78 → 成品 74.88', () => {
    expect(weftShrinkageFromMeasure(78, 74.88)).toBeCloseTo(0.04, 4)
  })

  it('经向织缩：坯布 100m → 成品 95m', () => {
    expect(warpShrinkageFromMeasure(100, 95)).toBeCloseTo(0.05, 4)
  })

  it('坯布纬密 → 成品纬密', () => {
    expect(greigeToFinishedPicks(78, 0.04)).toBeCloseTo(74.88, 2)
  })

  it('成品纬密 → 坯布纬密（往返一致）', () => {
    const greige = 78
    const finished = greigeToFinishedPicks(greige, 0.04)
    expect(finishedToGreigePicks(finished, 0.04)).toBeCloseTo(greige, 1)
  })

  it('成品纬密大于坯布时抛错（物理不可能）', () => {
    expect(() => weftShrinkageFromMeasure(70, 75)).toThrow(/不应大于/)
    expect(() => warpShrinkageFromMeasure(90, 100)).toThrow(/不应大于/)
  })

  it('织缩率越界抛错', () => {
    expect(() => greigeToFinishedPicks(78, 1.2)).toThrow()
    expect(() => finishedToGreigePicks(78, -0.1)).toThrow()
  })
})

describe('4. 日产量', () => {
  it('600纬/分、72根/英寸、运转率0.85 → 259.08 米/天', () => {
    expect(dailyOutput(600, 72, DEFAULT_COEFFICIENTS)).toBeCloseTo(259.08, 1)
  })

  it('每米纬数用 39.3701 而非 2.54', () => {
    const picksPerMeter = 72 * ENDS_PER_INCH_TO_PER_METER
    expect(picksPerMeter).toBeCloseTo(2834.65, 1)
    // 若误用 2.54 会得到 15.5 倍的虚高产量
    expect(dailyOutput(600, 72, DEFAULT_COEFFICIENTS)).toBeLessThan(
      (600 * 1440 * 0.85) / (72 * 2.54),
    )
  })

  it('转速越高产量越高', () => {
    expect(dailyOutput(800, 72)).toBeGreaterThan(dailyOutput(600, 72))
  })

  it('纬密越高产量越低', () => {
    expect(dailyOutput(600, 100)).toBeLessThan(dailyOutput(600, 72))
  })

  it('运转率越高产量越高', () => {
    const high = { ...DEFAULT_COEFFICIENTS, machineRunRate: 0.95 }
    expect(dailyOutput(600, 72, high)).toBeGreaterThan(dailyOutput(600, 72, DEFAULT_COEFFICIENTS))
  })

  it('转速为 0 抛错', () => {
    expect(() => dailyOutput(0, 72)).toThrow()
  })
})

describe('5. 坯布→成品克重系数自学习', () => {
  it('默认系数下换算', () => {
    const r = greigeToFinished(200)
    expect(r.finishedGsm).toBeCloseTo(190, 2)
    expect(r.factor.source).toBe('default')
  })

  it('无样本时沿用先验', () => {
    const r = learnGreigeFactor([])
    expect(r.value).toBe(DEFAULT_GREIGE_FACTOR.value)
    expect(r.sampleSize).toBe(0)
  })

  it('单样本时向先验收缩，不被异常值带偏', () => {
    const r = learnGreigeFactor([1.5])
    expect(r.value).toBeGreaterThan(0.95)
    expect(r.value).toBeLessThan(1.5)
    expect(r.source).toBe('manual')
  })

  it('样本多时趋近实测均值（信任权重上限 0.8）', () => {
    const r = learnGreigeFactor(Array(50).fill(0.88))
    // 0.95×0.2 + 0.88×0.8 = 0.894
    expect(r.value).toBeCloseTo(0.894, 3)
    expect(r.confidence).toBeGreaterThan(0.7)
    expect(r.source).toBe('learned')
  })

  it('过滤非法样本（0 / 负数 / NaN）', () => {
    const r = learnGreigeFactor([0, -1, 0.9, 0.91, 0.89, 0.9, 0.9, 0.9, 0.9, 0.9, Number.NaN])
    expect(r.sampleSize).toBe(8)
  })

  it('置信度随样本量单调上升', () => {
    const small = learnGreigeFactor([0.9, 0.91, 0.89])
    const large = learnGreigeFactor([0.9, 0.91, 0.89, ...Array(47).fill(0.9)])
    expect(large.confidence).toBeGreaterThan(small.confidence)
  })

  it('越用越准：多轮迭代后系数向样本均值收敛', () => {
    const samples = [0.88, 0.89, 0.9, 0.88, 0.91]
    const sampleMean = samples.reduce((a, b) => a + b, 0) / samples.length // 0.892
    let factor = DEFAULT_GREIGE_FACTOR
    let prev = factor.value
    for (let i = 0; i < 12; i++) {
      factor = learnGreigeFactor(samples, factor)
    }
    // 单轮样本量 5 => 信任权重 5/13≈0.3846，故逐轮向样本均值靠拢但不超过它
    expect(factor.value).toBeCloseTo(0.8921, 3)
    expect(factor.value).toBeLessThanOrEqual(sampleMean + 0.001)
    // 相比初值 0.95 已显著收敛
    expect(factor.value).toBeLessThan(prev)
    expect(factor.source).toBe('learned')
    expect(factor.updatedAt).toBeDefined()
  })

  it('大样本量时信任权重上升，系数更贴近实测均值', () => {
    const mean = 0.9
    const small = learnGreigeFactor([mean, mean, mean, mean, mean])
    const large = learnGreigeFactor(Array(50).fill(mean))
    // 同样向 0.9 靠拢，但大样本更接近（因 prior 被反复更新后信任度更高）
    expect(Math.abs(large.value - mean)).toBeLessThan(Math.abs(small.value - mean))
  })
})

describe('6. calculateWeave 统一入口', () => {
  it('府绸全流程计算', () => {
    const r = calculateWeave({
      spec: cottonSpec,
      picksPerMinute: 600,
      lengthM: 5000,
    })
    expect(r.totalGsm).toBeCloseTo(111.6, 0)
    expect(r.finishedGsm).toBeCloseTo(111.6 * 0.95, 1)
    expect(r.loomWidth).toBe(160)
    expect(r.dailyOutput).toBeCloseTo(259.08, 0)
    expect(r.totalYarnKg).toBeGreaterThan(0)
    expect(r.warpYarnKg! + r.weftYarnKg!).toBeCloseTo(r.totalYarnKg!, 1)
  })

  it('未传转速时日产量为 0', () => {
    expect(calculateWeave({ spec: cottonSpec }).dailyOutput).toBe(0)
  })

  it('未传长度时不返回用纱量', () => {
    const r = calculateWeave({ spec: cottonSpec })
    expect(r.totalYarnKg).toBeUndefined()
  })

  it('显式上机门幅优先于推算值', () => {
    expect(calculateWeave({ spec: { ...cottonSpec, loomWidth: 200 } }).loomWidth).toBe(200)
  })

  it('上机门幅默认 = 成品门幅 + 加放量', () => {
    expect(resolveLoomWidth(cottonSpec)).toBe(160)
    expect(resolveLoomWidth(cottonSpec, { ...DEFAULT_COEFFICIENTS, widthAllowance: 15 })).toBe(165)
  })

  it('自学习系数只影响成品克重，不影响坯布克重', () => {
    const learned = learnGreigeFactor(Array(30).fill(0.9))
    const r = calculateWeave({ spec: cottonSpec, greigeFactor: learned })
    expect(r.totalGsm).toBeCloseTo(111.6, 0)
    expect(r.finishedGsm).toBeCloseTo(111.6 * learned.value, 0)
  })
})
