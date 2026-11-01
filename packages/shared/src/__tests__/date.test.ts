import { describe, expect, it } from 'vitest'
import { dateToISO, dayDiffISO, dayShift, isoToDate, today } from '../date'

/**
 * 这些用例守护的是**曾经真实发生过的生产 bug**：
 *
 * 1. `toISOString().slice(0,10)` 在东八区把本地午夜变成前一天 16:00 → 日期差一天。
 *    曾导致：保养到期日算成 4-07（应为 4-08）、能耗期间筛选错位、账龄错判。
 * 2. `new Date('2027-02-12')` 按 UTC 午夜解析 → 写入侧同样差一天。
 * 3. `new Date(dateOnlyStr)` 再 `.getTime()` 排序，date 列与 datetime 列混排时行为不一致。
 *
 * 用例不依赖运行环境时区——断言的是「本地日历日语义」，在任何时区下都应成立
 * （CI 跑 UTC，本机跑 Asia/Shanghai，两者都必须通过）。
 */

/** 模拟 mysql2 驱动读回 `date` 列的行为：本地零点的 Date 对象 */
function asDriverDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d, 0, 0, 0, 0)
}

describe('dateToISO', () => {
  it('Date 对象按本地日历日输出，不受 UTC 偏移影响', () => {
    // 本地 2 月 12 日零点 → toISOString() 在东八区会给出 '2027-02-11'
    expect(dateToISO(asDriverDate('2027-02-12'))).toBe('2027-02-12')
  })

  it('字符串原样取前 10 位', () => {
    expect(dateToISO('2027-02-12')).toBe('2027-02-12')
    expect(dateToISO('2027-02-12T10:30:00.000Z')).toBe('2027-02-12')
  })

  it('空值返回空串', () => {
    expect(dateToISO(null)).toBe('')
    expect(dateToISO(undefined)).toBe('')
    expect(dateToISO('')).toBe('')
  })

  it('非法 Date 返回空串而非 "Invalid Date"', () => {
    expect(dateToISO(new Date('not a date'))).toBe('')
  })

  it('月初/年末边界不串日', () => {
    expect(dateToISO(asDriverDate('2027-01-01'))).toBe('2027-01-01')
    expect(dateToISO(asDriverDate('2027-12-31'))).toBe('2027-12-31')
  })
})

describe('isoToDate', () => {
  it('解析成本地零点，不是 UTC 午夜', () => {
    const d = isoToDate('2027-02-12')
    expect(d.getFullYear()).toBe(2027)
    expect(d.getMonth()).toBe(1)
    expect(d.getDate()).toBe(12)
    expect(d.getHours()).toBe(0)
  })

  it('往返转换稳定', () => {
    expect(dateToISO(isoToDate('2027-02-12'))).toBe('2027-02-12')
  })

  it('闰日可解析', () => {
    expect(dateToISO(isoToDate('2028-02-29'))).toBe('2028-02-29')
  })
})

describe('dayShift', () => {
  it('同月内平移', () => {
    expect(dayShift('2027-02-12', 7)).toBe('2027-02-19')
    expect(dayShift('2027-02-12', -12)).toBe('2027-01-31')
  })

  it('跨月正确', () => {
    expect(dayShift('2027-01-31', 1)).toBe('2027-02-01')
    expect(dayShift('2027-03-01', -1)).toBe('2027-02-28')
  })

  it('跨年正确', () => {
    expect(dayShift('2026-12-31', 1)).toBe('2027-01-01')
    expect(dayShift('2027-01-01', -1)).toBe('2026-12-31')
  })

  it('闰年 2 月末正确', () => {
    expect(dayShift('2028-02-28', 1)).toBe('2028-02-29')
    expect(dayShift('2028-03-01', -1)).toBe('2028-02-29')
  })

  it('平移 0 天返回原值', () => {
    expect(dayShift('2027-02-12', 0)).toBe('2027-02-12')
  })
})

describe('dayDiffISO', () => {
  it('同月天数差', () => {
    expect(dayDiffISO('2027-02-12', '2027-02-05')).toBe(7)
  })

  it('跨月天数差', () => {
    expect(dayDiffISO('2027-03-01', '2027-02-01')).toBe(28)
  })

  it('跨年天数差', () => {
    expect(dayDiffISO('2027-01-01', '2026-01-01')).toBe(365)
  })

  it('相等为 0', () => {
    expect(dayDiffISO('2027-02-12', '2027-02-12')).toBe(0)
  })

  it('与 dayShift 互为逆运算', () => {
    const start = '2027-02-10'
    const end = '2027-02-28'
    const len = dayDiffISO(end, start)
    // 上期与本期等长：上期起点 = 本期起点前推 len+1 天
    expect(dayShift(start, -(len + 1))).toBe('2027-01-22')
    expect(dayShift(start, -1)).toBe('2027-02-09')
  })
})

describe('today', () => {
  it('返回本地日历日 YYYY-MM-DD', () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(today()).toBe(dateToISO(new Date()))
  })
})
