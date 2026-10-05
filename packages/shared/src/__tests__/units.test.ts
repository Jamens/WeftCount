import { describe, it, expect } from 'vitest'
import { convert, getUnit, unitsByDimension, UNITS } from '../units'
import { widthToMm } from '../count-system'

/**
 * 单位体系测试
 * 注：支数换算的测试在 count-system.test.ts，此处不重复。
 */

describe('单位体系', () => {
  it('长度换算：米 → 码', () => {
    expect(convert(1, 'm', 'yd')).toBeCloseTo(1.0936133, 6)
  })

  it('长度换算：码 → 米', () => {
    expect(convert(1, 'yd', 'm')).toBeCloseTo(0.9144, 6)
  })

  it('长度换算：米 → 英寸', () => {
    expect(convert(1, 'm', 'inch')).toBeCloseTo(39.3701, 3)
  })

  it('重量换算：公斤 → 克', () => {
    expect(convert(1, 'kg', 'g')).toBe(1000)
  })

  it('重量换算：磅 → 克', () => {
    expect(convert(1, 'lb', 'g')).toBeCloseTo(453.59237, 5)
  })

  it('重量换算：斤 → 克', () => {
    expect(convert(1, 'jin', 'g')).toBe(500)
  })

  it('面积换算：平方码 → 平方米', () => {
    expect(convert(1, 'sqyd', 'm2')).toBeCloseTo(0.83612736, 8)
  })

  it('跨维度换算应抛错', () => {
    expect(() => convert(1, 'kg', 'm')).toThrow(/维度不一致/)
  })

  it('未知单位应抛错', () => {
    expect(() => getUnit('not_exist')).toThrow(/未知单位/)
  })

  it('每个核心维度均有可用单位', () => {
    for (const dim of ['length', 'weight', 'area', 'count', 'width', 'piece'] as const) {
      expect(unitsByDimension(dim).length).toBeGreaterThan(0)
    }
  })

  it('单位代码唯一', () => {
    const codes = UNITS.map((u) => u.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('基本单位换算系数为 1', () => {
    expect(convert(1, 'm', 'm')).toBe(1)
    expect(convert(1, 'g', 'g')).toBe(1)
    expect(convert(1, 'm2', 'm2')).toBe(1)
  })

  it('门幅单位折算毫米', () => {
    expect(widthToMm(1, 'cm')).toBe(10)
    expect(widthToMm(1, 'mm')).toBe(1)
    expect(widthToMm(150, 'cm')).toBe(1500)
  })
})
