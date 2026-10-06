import { describe, expect, it } from 'vitest'
import {
  computeReorderSuggestion,
  DEFAULT_LEAD_TIME_DAYS,
  type ReorderInput,
} from '../reorder'

/** 期望值一律由输入分量现算，不手写常数（手算极易 100×/1000× 错位） */
function expect2<T>(input: ReorderInput, fn: (s: ReturnType<typeof computeReorderSuggestion>) => T, expected: T, label: string) {
  const s = computeReorderSuggestion(input)
  expect(fn(s), label).toBeCloseTo(expected, 3)
}

describe('补货建议 computeReorderSuggestion', () => {
  const base: ReorderInput = {
    currentStock: 100,
    safetyStock: 200,
    consumedQty: 600,
    windowDays: 30,
    leadTimeDays: 7,
    orderCycleDays: 7,
  }

  it('日均用量 = 观察窗口出库量 / 窗口天数', () => {
    expect2(base, (s) => s.dailyUsage, base.consumedQty / base.windowDays, '日均用量')
  })

  it('补货点 = 日均 × (提前期+采购周期) + 安全库存', () => {
    const daily = base.consumedQty / base.windowDays
    expect2(
      base,
      (s) => s.reorderPoint,
      daily * (base.leadTimeDays + base.orderCycleDays) + base.safetyStock,
      '补货点',
    )
  })

  it('建议补货量 = 补到(补货点+一个周期用量) − 现有库存', () => {
    const daily = base.consumedQty / base.windowDays
    const rp = daily * (base.leadTimeDays + base.orderCycleDays) + base.safetyStock
    expect2(base, (s) => s.suggestQty, rp + daily * base.orderCycleDays - base.currentStock, '建议补货量')
  })

  it('库存充足(≥补货点)时不建议补货', () => {
    const daily = base.consumedQty / base.windowDays
    const rp = daily * (base.leadTimeDays + base.orderCycleDays) + base.safetyStock
    const s = computeReorderSuggestion({ ...base, currentStock: rp + 10 })
    expect(s.shouldReorder).toBe(false)
    expect(s.suggestQty).toBe(0)
  })

  it('观察窗口无出库 → 日均 0，补货点退化为安全库存（不臆造用量）', () => {
    const s = computeReorderSuggestion({ ...base, consumedQty: 0, currentStock: 50 })
    expect(s.dailyUsage).toBe(0)
    expect(s.reorderPoint).toBe(200)
    expect(s.suggestQty).toBe(150) // 200 - 50
  })

  it('提前期与采购周期为 0 时只补到安全库存', () => {
    const s = computeReorderSuggestion({ ...base, leadTimeDays: 0, orderCycleDays: 0, consumedQty: 600 })
    expect(s.reorderPoint).toBe(200) // 0*日均 + 安全库存
  })

  it('负数/非法输入被夹到 0，不产生负补货量', () => {
    const s = computeReorderSuggestion({
      currentStock: -5,
      safetyStock: -10,
      consumedQty: -100,
      windowDays: 0,
      leadTimeDays: -3,
      orderCycleDays: -1,
    })
    expect(s.dailyUsage).toBe(0)
    expect(s.reorderPoint).toBe(0)
    expect(s.suggestQty).toBe(0)
    expect(s.shouldReorder).toBe(false) // 库存 0 不小于补货点 0
  })

  it('提前期越长补货点越高（采购越慢要备更多）', () => {
    const fast = computeReorderSuggestion({ ...base, leadTimeDays: 3 })
    const slow = computeReorderSuggestion({ ...base, leadTimeDays: 30 })
    expect(slow.reorderPoint).toBeGreaterThan(fast.reorderPoint)
  })

  it('默认提前期常量可用', () => {
    expect(DEFAULT_LEAD_TIME_DAYS).toBeGreaterThan(0)
  })

  it('依据文字包含日均/补货点/建议量，可人工核对', () => {
    const s = computeReorderSuggestion(base)
    expect(s.basis).toContain('日均')
    expect(s.basis).toContain('补货点')
    expect(s.basis).toContain('建议补货')
  })
})
