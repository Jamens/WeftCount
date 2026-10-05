/**
 * 纱线支数体系（Count System）
 *
 * 同一个「粗细」在不同体系下数字完全不同，选错体系会导致用料算错一个数量级。
 * 短纤用 NeS/Nm，长丝用 Tex/D，织造厂常见的实际口径：
 *   - 棉纱采购常说「32S」「40S」→ 英制 NeS
 *   - 化纤经销常说「150D」「300D」→ 旦数
 *   - 技术单据常说「150Tex」→ 特数
 *
 * ⚠️ 换算链唯一真源，所有常数由此派生，禁止在别处硬编码 23.25 / 228.6 / 0.059：
 *   1 英寸 = 0.0254 m
 *   1 磅= 0.45359237 kg，1 码 = 0.9144 m，1 NeS = 840 码
 *   推导 → Tex = 590.5412 / NeS
 */

export type CountSystem = 'NeS' | 'Nm' | 'Tex' | 'D'

/** 1 英寸 = 0.0254 米 */
export const INCH_TO_METER = 0.0254

/** 1 磅 = 0.45359237 千克（精确值） */
export const POUND_TO_KG = 0.45359237

/** 1 码 = 0.9144 米 */
export const YARD_TO_METER = 0.9144

/** 英制支数定义：1 NeS = 840 码 */
export const YARDS_PER_POUND = 840

/**
 * 根/英寸 → 根/米
 *
 * ⚠️ 这��是最容易出错的地方。行业资料里2.54 有时表示「根/英寸→根/厘米」，
 * 极易被误当成「根/英寸→根/米」而直接套用，误差15.5 倍。
 */
export const ENDS_PER_INCH_TO_PER_METER = 1 / INCH_TO_METER // 39.3700787

/**
 * NeS → Tex 的精确系数
 * 推导：1 NeS = 840 码× 0.9144 m = 768.096 m，质量 0.45359237 kg
 *      每米质量 = 0.45359237/768.096 kg = 590.5412 g/1000m
 */
export const TEX_PER_NES = 590.5412

/** Tex → 旦数：1 旦 = 9000 米长 1 克，故D = Tex × 9 */
export const DENIER_PER_TEX = 9

/**
 * Nm 与 Tex 的关系：Nm × Tex = 1000
 *
 * ⚠️ Nm 的行业口径是「千米/千克」而非「米/千克」，这是最易错的一点：
 *   40S 棉纱 = 67735 米/千克 = 67.735 千米/千克 => Nm 67.7
 *   40S 棉纱 = 14.76 克/千米=> Tex 14.76
 *   14.76 × 67.7 = 1000 ✓
 * 若误按「米/千克」理解 Nm，会差1000 倍。
 */
export const TEX_NM_PRODUCT = 1000

/** 行业经验式系数，由上面两项派生，等价于 39.3701 × 590.5412 / 1000 */
export const GSM_COEF_NES = ENDS_PER_INCH_TO_PER_METER * (TEX_PER_NES / 1000) // 23.2497

/** 长丝克重系数，等价于 9000 / 39.3701 */
export const GSM_COEF_DENIER = 9000 / ENDS_PER_INCH_TO_PER_METER // 228.6

export function nmToNeS(nm: number): number {
  if (nm <= 0) throw new Error('公制支数必须大于 0')
  // Nm → Tex = 1000 / Nm，再 Tex → NeS
  return TEX_PER_NES / (TEX_NM_PRODUCT / nm)
}

export function neSToNm(nes: number): number {
  if (nes <= 0) throw new Error('英制支数必须大于 0')
  // NeS → Tex = 590.5412 / NeS，再 Tex → Nm = 1000 / Tex
  return TEX_NM_PRODUCT / (TEX_PER_NES / nes)
}

/** 特数 Tex（克/千米）与旦数 D（克/9000m）互转 */
export function texToD(tex: number): number {
  return tex * DENIER_PER_TEX
}

export function dToTex(d: number): number {
  return d / DENIER_PER_TEX
}

/**
 * 统一折算为「克/千米」(Tex)，所有公式内部只认这个口径。
 *
 * 单位关系（务必分清，此处历史上错过 1000 倍与 10^6 倍两次）：
 *   Nm = 千米/千克 → Nm × Tex = 1000
 *   D  = 9 × Tex
 *   NeS = 590.5412 / Tex
 */
export function toTex(value: number, system: CountSystem): number {
  switch (system) {
    case 'Tex':
      return value
    case 'D':
      return dToTex(value)
    case 'Nm':
      if (value <= 0) throw new Error('公制支数必须大于 0')
      return TEX_NM_PRODUCT / value
    case 'NeS':
      if (value <= 0) throw new Error('英制支数必须大于 0')
      return TEX_PER_NES / value
    default: {
      const exhaustive: never = system
      throw new Error(`未知支数体系: ${exhaustive}`)
    }
  }
}

/** 反向：折算回指定体系 */
export function fromTex(tex: number, system: CountSystem): number {
  if (tex <= 0) throw new Error('特数必须大于 0')
  switch (system) {
    case 'Tex':
      return tex
    case 'D':
      return texToD(tex)
    case 'Nm':
      return TEX_NM_PRODUCT / tex
    case 'NeS':
      return TEX_PER_NES / tex
    default: {
      const exhaustive: never = system
      throw new Error(`未知支数体系: ${exhaustive}`)
    }
  }
}

/**
 * 密度单位换算：根/英寸 ↔ 根/厘米
 * 注意这是「每厘米」，不是「每米」。需要每米时用 ENDS_PER_INCH_TO_PER_METER。
 */
export function convertDensity(value: number, from: 'pi' | 'pc', to: 'pi' | 'pc'): number {
  if (from === to) return value
  return from === 'pi' ? value / 2.54 : value * 2.54
}

/** 根/英寸 → 根/米 */
export function densityPerInchToPerMeter(value: number): number {
  return value * ENDS_PER_INCH_TO_PER_METER
}

/** 门幅单位换算，统一返回毫米 */
export function widthToMm(value: number, unit: 'mm' | 'cm' | 'inch' | 'chun' | 'fen'): number {
  switch (unit) {
    case 'mm':
      return value
    case 'cm':
      return value * 10
    case 'inch':
      return value * INCH_TO_METER * 1000
    case 'chun':
      // 布行口语「寸」= 1 市寸 ≈ 3.33cm
      return value * 33.33
    case 'fen':
      // 「分」= 寸的十分之一
      return value * 3.333
    default: {
      const exhaustive: never = unit
      throw new Error(`未知门幅单位: ${exhaustive}`)
    }
  }
}
