import { describe, expect, it } from 'vitest'
import { convert } from '../units'
import {
  calcGradePrice,
  DEFAULT_GRADE_RULES,
  defectPenalty,
  gradeByDensity,
  RECEIVING_LIMIT_PER_100_SQYD,
  scoreRoll,
  weightedGradePrice,
  type GradePriceRule,
  type RollScoreInput,
} from '../grade'

/**
 * 期望值一律由输入分量现算，不手写常数（手算极易 100×/1000× 错位）
 */
function expectNumber(label: string, actual: number, expected: number) {
  expect(actual, label).toBeCloseTo(expected, 3)
}

/** 一匹布的平方码数：与被测实现走同一套单位换算，但独立写一遍以免抄错 */
function sqYardsOf(meters: number, widthInch: number): number {
  return convert(meters * convert(widthInch, 'inch', 'm'), 'm2', 'sqyd')
}

describe('单一疵点扣分 defectPenalty', () => {
  it('按长度分四档：≤3 寸 1 分，3~6 寸 2 分，6~9 寸 3 分，>9 寸 4 分', () => {
    expect(defectPenalty({ lengthInch: 3 })).toBe(1)
    expect(defectPenalty({ lengthInch: 3.001 })).toBe(2)
    expect(defectPenalty({ lengthInch: 6 })).toBe(2)
    expect(defectPenalty({ lengthInch: 6.001 })).toBe(3)
    expect(defectPenalty({ lengthInch: 9 })).toBe(3)
    expect(defectPenalty({ lengthInch: 9.001 })).toBe(4)
  })

  it('破洞不论大小一律 4 分（0.5 寸的破洞也是 4 分）', () => {
    expect(defectPenalty({ lengthInch: 0.5, isHole: true })).toBe(4)
    expect(defectPenalty({ lengthInch: 0.5 })).toBe(1)
  })

  it('长度 0 或非法值不扣分（检验员录到一半的瞬时状态）', () => {
    expect(defectPenalty({ lengthInch: 0 })).toBe(0)
    expect(defectPenalty({ lengthInch: Number.NaN })).toBe(0)
    expect(defectPenalty({ lengthInch: -5 })).toBe(0)
  })
})

describe('整匹扣分密度 scoreRoll', () => {
  const roll: RollScoreInput = { meters: 100, widthInch: 63, totalPoints: 40 }

  it('面积 = 匹长 × 门幅，换算到平方码', () => {
    const s = scoreRoll(roll)
    expectNumber('平方码', s.sqYards, sqYardsOf(roll.meters, roll.widthInch))
  })

  it('扣分密度 = 总扣分 × 100 / 平方码', () => {
    const s = scoreRoll(roll)
    const sqYd = sqYardsOf(roll.meters, roll.widthInch)
    expectNumber('扣分密度', s.pointsPer100SqYd, (roll.totalPoints * 100) / sqYd)
  })

  it('短匹同样扣分 → 密度更高（分母是面积，不是匹长）', () => {
    const long = scoreRoll({ meters: 1000, widthInch: 63, totalPoints: 4 })
    const short = scoreRoll({ meters: 10, widthInch: 63, totalPoints: 4 })
    expectNumber('长匹密度', long.pointsPer100SqYd, (4 * 100) / sqYardsOf(1000, 63))
    expectNumber('短匹密度', short.pointsPer100SqYd, (4 * 100) / sqYardsOf(10, 63))
    expect(short.pointsPer100SqYd).toBeGreaterThan(long.pointsPer100SqYd)
  })

  it('匹长或门幅为 0 → 面积 0、密度 0，不除零', () => {
    const s = scoreRoll({ meters: 0, widthInch: 63, totalPoints: 8 })
    expect(s.sqYards).toBe(0)
    expect(s.pointsPer100SqYd).toBe(0)

    const s2 = scoreRoll({ meters: 100, widthInch: 0, totalPoints: 8 })
    expect(s2.sqYards).toBe(0)
    expect(s2.pointsPer100SqYd).toBe(0)
  })

  it('收货红线独立判定：密度 > 4 才报警，与定等无关', () => {
    const clean = scoreRoll({ meters: 1000, widthInch: 63, totalPoints: 4 })
    const dirty = scoreRoll({ meters: 10, widthInch: 63, totalPoints: 4 })
    const atLimit = scoreRoll({ meters: 100, widthInch: 63, totalPoints: RECEIVING_LIMIT_PER_100_SQYD * sqYardsOf(100, 63) / 100 })

    expect(clean.overReceivingLimit).toBe(false)
    expect(dirty.overReceivingLimit).toBe(true)
    expectNumber('红线处密度', atLimit.pointsPer100SqYd, RECEIVING_LIMIT_PER_100_SQYD)
    // 恰好等于红线不算超（标准是「不超过」）
    expect(atLimit.overReceivingLimit).toBe(false)
  })
})

describe('定等 gradeByDensity', () => {
  it('区间边界含等于：20→A，20.001→B', () => {
    expect(gradeByDensity(20)).toBe('A')
    expect(gradeByDensity(20.001)).toBe('B')
  })

  it('区间边界含等于：28→B，28.001→C', () => {
    expect(gradeByDensity(28)).toBe('B')
    expect(gradeByDensity(28.001)).toBe('C')
  })

  it('区间边界含等于：40→C，40.001→D', () => {
    expect(gradeByDensity(40)).toBe('C')
    expect(gradeByDensity(40.001)).toBe('D')
  })

  it('超过所有上限 → 落到最后一条（等外品），不抛错', () => {
    expect(gradeByDensity(1e9)).toBe('D')
    expect(gradeByDensity(Number.POSITIVE_INFINITY)).toBe('D')
  })

  it('默认规则最后一条必须是 D 且上限无穷，否则上面这条会失效', () => {
    const last = DEFAULT_GRADE_RULES[DEFAULT_GRADE_RULES.length - 1]!
    expect(last.grade).toBe('D')
    expect(last.maxPointsPer100SqYd).toBe(Number.POSITIVE_INFINITY)
  })

  it('规则可配置：客户收紧标准时整批复算', () => {
    const strict = [
      { grade: 'A' as const, maxPointsPer100SqYd: 10 },
      { grade: 'B' as const, maxPointsPer100SqYd: 15 },
      { grade: 'C' as const, maxPointsPer100SqYd: 20 },
      { grade: 'D' as const, maxPointsPer100SqYd: Number.POSITIVE_INFINITY },
    ]
    // 同一匹布，默认规则下是 A，收紧后掉到 C
    expect(gradeByDensity(20)).toBe('A')
    expect(gradeByDensity(20, strict)).toBe('C')
  })

  it('空规则表不崩，兜底等外品', () => {
    expect(gradeByDensity(5, [])).toBe('D')
  })
})

describe('分等计价 calcGradePrice', () => {
  const base = 12.5

  it('无分等规则 → 原价不动（不分等计价时分文不改）', () => {
    expect(calcGradePrice(base, null)).toBe(base)
    expect(calcGradePrice(base, undefined)).toBe(base)
  })

  it('fixed：直接取该等级单价', () => {
    const rule: GradePriceRule = { grade: 'B', mode: 'fixed', value: 11.2 }
    expect(calcGradePrice(base, rule)).toBe(11.2)
  })

  it('discount：原价 × 折扣率', () => {
    const rule: GradePriceRule = { grade: 'B', mode: 'discount', value: 0.92 }
    expectNumber('九二折', calcGradePrice(base, rule), base * 0.92)
  })

  it('delta：原价 + 加减金额，可为负', () => {
    const down: GradePriceRule = { grade: 'C', mode: 'delta', value: -1.5 }
    const up: GradePriceRule = { grade: 'A', mode: 'delta', value: 0.8 }
    expectNumber('降价', calcGradePrice(base, down), base - 1.5)
    expectNumber('加价', calcGradePrice(base, up), base + 0.8)
  })

  it('结果不为负：折扣率填成负数这类脏数据夹到 0', () => {
    const bad: GradePriceRule = { grade: 'D', mode: 'discount', value: -0.2 }
    expect(calcGradePrice(base, bad)).toBe(0)

    const huge: GradePriceRule = { grade: 'D', mode: 'delta', value: -999 }
    expect(calcGradePrice(base, huge)).toBe(0)
  })

  it('保留 4 位小数，与 contract_items.agreed_price 的 scale 对齐', () => {
    const rule: GradePriceRule = { grade: 'B', mode: 'discount', value: 0.923456 }
    expect(calcGradePrice(base, rule)).toBe(Math.round(base * 0.923456 * 1e4) / 1e4)
  })

  it('等级越低价格越低（默认规则的单调性）', () => {
    const rules: GradePriceRule[] = [
      { grade: 'A', mode: 'delta', value: 0 },
      { grade: 'B', mode: 'delta', value: -0.6 },
      { grade: 'C', mode: 'delta', value: -1.5 },
      { grade: 'D', mode: 'discount', value: 0.7 },
    ]
    const prices = rules.map((r) => calcGradePrice(base, r))
    for (let i = 1; i < prices.length; i++) {
      expect(prices[i]!).toBeLessThan(prices[i - 1]!)
    }
  })
})

describe('分等加权计价 weightedGradePrice', () => {
  it('等量不同价 → 算术平均', () => {
    const price = weightedGradePrice([
      { grade: 'A', meters: 50, price: 12.5 },
      { grade: 'B', meters: 50, price: 11.5 },
    ])
    expectNumber('等量', price, (12.5 * 50 + 11.5 * 50) / 100)
  })

  it('米数不等 → 按米数加权，不是取平均等级', () => {
    const price = weightedGradePrice([
      { grade: 'A', meters: 60, price: 12.5 },
      { grade: 'B', meters: 40, price: 11.5 },
    ])
    expectNumber('加权', price, (12.5 * 60 + 11.5 * 40) / 100)
    // 反证：若取两级的算术平均价会得到 12.0，与加权结果不同
    expect(price).not.toBeCloseTo(12.0, 3)
  })

  it('单一品等 → 就是该等级单价', () => {
    expect(weightedGradePrice([{ grade: 'C', meters: 30, price: 9.25 }])).toBe(9.25)
  })

  it('未检验的匹(grade=null)按基准价照常参与加权，不跳过', () => {
    const price = weightedGradePrice([
      { grade: null, meters: 100, price: 10 },
      { grade: 'A', meters: 100, price: 12 },
    ])
    expectNumber('含未检验', price, (10 * 100 + 12 * 100) / 200)
  })

  it('等级越低整体单价越低（单调性）', () => {
    const mix = (aPrice: number, bPrice: number) =>
      weightedGradePrice([
        { grade: 'A', meters: 50, price: aPrice },
        { grade: 'B', meters: 50, price: bPrice },
      ])
    expect(mix(12.5, 11.5)).toBeLessThan(mix(12.5, 12.5))
    expect(mix(12.5, 9)).toBeLessThan(mix(12.5, 11.5))
  })

  it('总米数为 0 → 返回 0，让调用方走「不自动计价」而不是猜价', () => {
    expect(weightedGradePrice([])).toBe(0)
    expect(weightedGradePrice([{ grade: 'A', meters: 0, price: 12.5 }])).toBe(0)
    expect(weightedGradePrice([{ grade: 'A', meters: -5, price: 12.5 }])).toBe(0)
  })

  it('保留 4 位小数，与 agreed_price 的 scale 对齐', () => {
    const price = weightedGradePrice([
      { grade: 'A', meters: 3, price: 12.3456789 },
      { grade: 'B', meters: 7, price: 11.1111111 },
    ])
    const raw = (12.3456789 * 3 + 11.1111111 * 7) / 10
    expect(price).toBe(Math.round(raw * 1e4) / 1e4)
  })
})
