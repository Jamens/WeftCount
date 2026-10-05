import { describe, it, expect } from 'vitest'
import {
  nmToNeS,
  neSToNm,
  texToD,
  dToTex,
  toTex,
  fromTex,
  convertDensity,
  widthToMm,
  densityPerInchToPerMeter,
  TEX_PER_NES,
  ENDS_PER_INCH_TO_PER_METER,
  GSM_COEF_NES,
  GSM_COEF_DENIER,
  DENIER_PER_TEX,
  TEX_NM_PRODUCT,
} from '../count-system'

describe('支数换算常数（唯一真源）', () => {
  it('TEX_PER_NES = 590.5412', () => {
    // 由 840码×0.9144m = 768.096m，0.45359237kg 推导
    expect(TEX_PER_NES).toBe(590.5412)
  })

  it('根/英寸 → 根/米 = 39.3701（不是 2.54）', () => {
    expect(ENDS_PER_INCH_TO_PER_METER).toBeCloseTo(39.3700787, 6)
  })

  it('DENIER_PER_TEX = 9（不是 9000）', () => {
    expect(DENIER_PER_TEX).toBe(9)
  })

  it('克重系数 23.2497 由两项派生', () => {
    expect(GSM_COEF_NES).toBeCloseTo(23.2497, 4)
  })

  it('长丝克重系数 228.6 = 9000 / 39.3701', () => {
    expect(GSM_COEF_DENIER).toBeCloseTo(228.6, 4)
  })

  it('Nm × Tex = 1000', () => {
    expect(TEX_NM_PRODUCT).toBe(1000)
  })
})

describe('40S 棉纱全链路（行业基准值）', () => {
  it('40 NeS → Tex 14.76（行业标准值）', () => {
    expect(toTex(40, 'NeS')).toBeCloseTo(14.7635, 3)
  })

  it('40 NeS → Nm 67.7（行业标准值）', () => {
    expect(fromTex(toTex(40, 'NeS'), 'Nm')).toBeCloseTo(67.735, 2)
  })

  it('40 NeS → 132.87 旦（行业经验值）', () => {
    expect(toTex(40, 'NeS') * 9).toBeCloseTo(132.872, 2)
  })

  it('40S 线密度 67734.5 米/千克', () => {
    // 独立推导：40×840×0.9144 / 0.45359237
    const metersPerKg = (40 * 840 * 0.9144) / 0.45359237
    expect(metersPerKg).toBeCloseTo(67734.47, 1)
    // 与 Nm 口径一致：67734.47 米/千克 = 67.734 千米/千克
    expect(fromTex(toTex(40, 'NeS'), 'Nm')).toBeCloseTo(metersPerKg / 1000, 2)
  })

  it('32 NeS → Nm 54.19（行业标准值）', () => {
    expect(fromTex(toTex(32, 'NeS'), 'Nm')).toBeCloseTo(54.19, 2)
  })
})

describe('支数体系互转', () => {
  it('公制 Nm → 英制 NeS', () => {
    expect(nmToNeS(67.735)).toBeCloseTo(40, 2)
  })

  it('英制 NeS → 公制 Nm 往返一致', () => {
    expect(neSToNm(nmToNeS(30))).toBeCloseTo(30, 6)
  })

  it('Tex ↔ 旦数互转', () => {
    expect(texToD(150)).toBe(1350)
    expect(dToTex(1350)).toBeCloseTo(150, 6)
  })

  it('150D 长丝 → Tex 16.67（行业标准值）', () => {
    expect(toTex(150, 'D')).toBeCloseTo(16.6667, 3)
  })

  it('300D 长丝 → Tex 33.33', () => {
    expect(toTex(300, 'D')).toBeCloseTo(33.3333, 3)
  })

  it('Tex 折算回各体系往返一致', () => {
    for (const system of ['NeS', 'Nm', 'Tex', 'D'] as const) {
      const tex = toTex(20, system)
      expect(fromTex(tex, system)).toBeCloseTo(20, 3)
    }
  })

  it('Nm 与 Tex 满足乘积 1000', () => {
    const tex = toTex(50, 'Nm')
    const nm = fromTex(tex, 'Nm')
    expect(tex * nm).toBeCloseTo(1000, 6)
  })

  it('非正支数抛错', () => {
    expect(() => toTex(0, 'Nm')).toThrow()
    expect(() => neSToNm(-1)).toThrow()
    expect(() => fromTex(0, 'NeS')).toThrow()
  })
})

describe('密度换算', () => {
  it('根/英寸 → 根/厘米（×2.54 的正确用法）', () => {
    expect(convertDensity(100, 'pi', 'pc')).toBeCloseTo(39.3701, 3)
  })

  it('根/英寸 → 根/米（×39.3701）', () => {
    expect(densityPerInchToPerMeter(100)).toBeCloseTo(3937.008, 2)
  })

  it('120 根/英寸 = 4724.4 根/米', () => {
    expect(densityPerInchToPerMeter(120)).toBeCloseTo(4724.4, 1)
  })

  it('根/英寸 → 根/厘米 往返一致', () => {
    expect(convertDensity(convertDensity(72, 'pi', 'pc'), 'pc', 'pi')).toBeCloseTo(72, 6)
  })
})

describe('门幅单位', () => {
  it('厘米 → 毫米', () => {
    expect(widthToMm(1, 'cm')).toBe(10)
  })

  it('英寸 → 毫米', () => {
    expect(widthToMm(1, 'inch')).toBeCloseTo(25.4, 6)
  })
})
