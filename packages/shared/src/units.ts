/**
 * 纺织行业单位体系
 *
 * 织造厂是多单位并存系统，采购按重量、加工按长度、销售按面积是行业常态。
 * 这里定义单位分类与换算关系，baseFactor 表示「1 本单位 = baseFactor 基本单位」。
 *
 * 长度基本单位统一为米(m)，重量基本单位统一为克(g)，面积基本单位为平方米(m²)。
 */

export const LENGTH_BASE = 'm' as const
export const WEIGHT_BASE = 'g' as const
export const AREA_BASE = 'm2' as const

export type UnitDimension = 'length' | 'weight' | 'area' | 'count' | 'width' | 'piece'

export interface UnitDef {
  /** 单位代码 */
  code: string
  /** 中文名 */
  name: string
  /** 所属维度 */
  dimension: UnitDimension
  /** 1 本单位等于多少基本单位 */
  baseFactor: number
  /** 是否允许小数（长度米通常不需要小数展示，kg需要） */
  decimal: number
  /** 行业备注 */
  remark?: string
}

export const UNITS: readonly UnitDef[] = [
  // 长度
  { code: 'm', name: '米', dimension: 'length', baseFactor: 1, decimal: 3, remark: '长度基本单位' },
  { code: 'cm', name: '厘米', dimension: 'length', baseFactor: 0.01, decimal: 1 },
  { code: 'yd', name: '码', dimension: 'length', baseFactor: 0.9144, decimal: 3, remark: '坯布贸易常用' },
  { code: 'ft', name: '英尺', dimension: 'length', baseFactor: 0.3048, decimal: 3 },
  { code: 'inch', name: '英寸', dimension: 'length', baseFactor: 0.0254, decimal: 3 },
  { code: 'zhang', name: '丈', dimension: 'length', baseFactor: 10 / 3, decimal: 4 },

  // 重量
  { code: 'g', name: '克', dimension: 'weight', baseFactor: 1, decimal: 2, remark: '重量基本单位' },
  { code: 'kg', name: '公斤', dimension: 'weight', baseFactor: 1000, decimal: 3, remark: '纱线采购常用' },
  { code: 't', name: '吨', dimension: 'weight', baseFactor: 1_000_000, decimal: 4 },
  { code: 'jin', name: '斤', dimension: 'weight', baseFactor: 500, decimal: 2 },
  { code: 'lb', name: '磅', dimension: 'weight', baseFactor: 453.59237, decimal: 3, remark: '出口订单常用' },
  { code: 'oz', name: '盎司', dimension: 'weight', baseFactor: 28.349523125, decimal: 3 },

  // 面积
  { code: 'm2', name: '平方米', dimension: 'area', baseFactor: 1, decimal: 4, remark: '面积基本单位' },
  { code: 'sqft', name: '平方英尺', dimension: 'area', baseFactor: 0.09290304, decimal: 4 },
  { code: 'sqyd', name: '平方码', dimension: 'area', baseFactor: 0.83612736, decimal: 4 },

  // 门幅宽度（行业按「寸/分」口语表达）
  { code: 'mm', name: '毫米', dimension: 'width', baseFactor: 1, decimal: 1 },
  { code: 'cm_width', name: '厘米', dimension: 'width', baseFactor: 10, decimal: 1 },
  { code: 'inch_width', name: '英寸', dimension: 'width', baseFactor: 25.4, decimal: 2, remark: '门幅常用' },

  // 计数（密度类）
  { code: 'root_per_inch', name: '根/英寸', dimension: 'count', baseFactor: 1, decimal: 1, remark: '经纬密' },
  { code: 'root_per_cm', name: '根/厘米', dimension: 'count', baseFactor: 1 / 2.54, decimal: 2 },
  { code: 'tex', name: '特数 Tex', dimension: 'count', baseFactor: 1, decimal: 2, remark: '纤度' },
  { code: 'd', name: '旦数 D', dimension: 'count', baseFactor: 1, decimal: 2, remark: '长丝纤度' },

  // 计数（布匹量词）
  { code: 'piece', name: '匹', dimension: 'piece', baseFactor: 1, decimal: 0, remark: '成品布量词' },
  { code: 'roll', name: '卷', dimension: 'piece', baseFactor: 1, decimal: 0 },
  { code: 'cone', name: '筒', dimension: 'piece', baseFactor: 1, decimal: 0, remark: '长丝量词' },
  { code: 'bale', name: '件', dimension: 'piece', baseFactor: 1, decimal: 0, remark: '纱线量词' },
]

const UNIT_MAP = new Map(UNITS.map((u) => [u.code, u]))

export function getUnit(code: string): UnitDef {
  const unit = UNIT_MAP.get(code)
  if (!unit) {
    throw new Error(`未知单位代码: ${code}`)
  }
  return unit
}

export function unitsByDimension(dimension: UnitDimension): UnitDef[] {
  return UNITS.filter((u) => u.dimension === dimension)
}

/**
 * 同维度单位换算。跨维度换算需要面积/长度桥接，请使用 weaveMath 中的专用函数。
 */
export function convert(value: number, from: string, to: string): number {
  const f = getUnit(from)
  const t = getUnit(to)
  if (f.dimension !== t.dimension) {
    throw new Error(`单位维度不一致，无法换算: ${f.name}(${f.dimension}) -> ${t.name}(${t.dimension})`)
  }
  return (value * f.baseFactor) / t.baseFactor
}
