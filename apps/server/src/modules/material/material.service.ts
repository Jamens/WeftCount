import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, Like } from 'typeorm'
import {
  DEFAULT_ALLOWED_UNITS,
  ErrorCode,
  MATERIAL_CATEGORY_LABEL,
  calculateWeave,
  type CountSystem,
  type MaterialCategoryValue,
  type MeasureMode,
  type SpecCalculationSnapshot,
  type WeaveType,
  type WeaveCoefficients,
} from '@weftcount/shared'
import { MaterialEntity } from './entities/material.entity'
import { GreigeSpecEntity } from './entities/greige-spec.entity'

export interface CreateMaterialInput {
  code?: string
  name: string
  category: MaterialCategoryValue
  specification: string
  /** 不传则由 category 决定：纱线/辅料按重量，坯布/成品按长度 */
  measureMode?: MeasureMode
  primaryUnit?: string
  allowedUnits?: string[]
  batchManaged?: boolean
  safetyStock?: number | null
  standardPrice?: number | null
  remark?: string | null
}

/** 大类默认主计量方式 */
const DEFAULT_MEASURE_MODE: Record<MaterialCategoryValue, MeasureMode> = {
  yarn: 'weight',
  greige: 'length',
  finished: 'length',
  auxiliary: 'weight',
  spare: 'count',
}

/** 大类默认主单位 */
const DEFAULT_PRIMARY_UNIT: Record<MaterialCategoryValue, string> = {
  yarn: 'kg',
  greige: 'm',
  finished: 'm',
  auxiliary: 'kg',
  spare: 'piece',
}

@Injectable()
export class MaterialService {
  constructor(
    @InjectRepository(MaterialEntity)
    private readonly materials: Repository<MaterialEntity>,
    @InjectRepository(GreigeSpecEntity)
    private readonly specs: Repository<GreigeSpecEntity>,
  ) {}

  // -------------------------------------------------------------------------
  // 物料
  // -------------------------------------------------------------------------

  /**
   * 生成物料编码
   * 规则：前缀 + 4 位流水，如 Y0001 / G0001
   * 前缀按大类固定，便于人工识别与条码前缀统一
   */
  private async nextCode(tenantId: string, companyId: string, category: MaterialCategoryValue): Promise<string> {
    const prefix: Record<MaterialCategoryValue, string> = {
      yarn: 'Y',
      greige: 'G',
      finished: 'F',
      auxiliary: 'A',
      spare: 'S',
    }
    const p = prefix[category]
    const last = await this.materials.findOne({
      where: { companyId, code: Like(`${p}%`) },
      order: { code: 'DESC' },
    })
    const nextNum = last ? Number(last.code.slice(1)) + 1 : 1
    if (!Number.isFinite(nextNum) || nextNum > 9999) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: `编码 ${p}9999 已用尽，请改用其他编码规则`,
      })
    }
    return `${p}${String(nextNum).padStart(4, '0')}`
  }

  async create(tenantId: string, companyId: string, input: CreateMaterialInput): Promise<MaterialEntity> {
    const code = input.code ?? (await this.nextCode(tenantId, companyId, input.category))

    const exists = await this.materials.findOne({ where: { companyId, code } })
    if (exists) {
      throw new ConflictException({
        code: ErrorCode.DUPLICATE_CODE,
        message: `物料编码 ${code} 已存在`,
      })
    }

    const measureMode = input.measureMode ?? DEFAULT_MEASURE_MODE[input.category]
    const primaryUnit = input.primaryUnit ?? DEFAULT_PRIMARY_UNIT[input.category]
    const allowedUnits = input.allowedUnits ?? DEFAULT_ALLOWED_UNITS[input.category]

    if (!allowedUnits.includes(primaryUnit)) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: `主单位 ${primaryUnit} 必须包含在允许单位列表中`,
      })
    }

    return this.materials.save(
      this.materials.create({
        tenantId,
        companyId,
        code,
        name: input.name,
        category: input.category,
        specification: input.specification,
        measureMode,
        primaryUnit,
        allowedUnits,
        batchManaged: input.batchManaged ?? true,
        safetyStock: input.safetyStock != null ? String(input.safetyStock) : null,
        standardPrice: input.standardPrice != null ? String(input.standardPrice) : null,
        status: 'active',
        remark: input.remark ?? null,
      }),
    )
  }

  async findAll(
    tenantId: string,
    companyId: string,
    filter?: { category?: MaterialCategoryValue; keyword?: string; status?: 'active' | 'discontinued' },
  ): Promise<MaterialEntity[]> {
    const qb = this.materials
      .createQueryBuilder('m')
      .where('m.tenant_id = :tenantId', { tenantId })
      .andWhere('m.company_id = :companyId', { companyId })
      .orderBy('m.category', 'ASC')
      .addOrderBy('m.code', 'ASC')

    if (filter?.category) {
      qb.andWhere('m.category = :category', { category: filter.category })
    }
    if (filter?.status) {
      qb.andWhere('m.status = :status', { status: filter.status })
    }
    if (filter?.keyword) {
      qb.andWhere('(m.name LIKE :kw OR m.code LIKE :kw OR m.specification LIKE :kw)', {
        kw: `%${filter.keyword}%`,
      })
    }
    return qb.getMany()
  }

  async findOne(tenantId: string, companyId: string, id: string): Promise<MaterialEntity> {
    const m = await this.materials.findOne({ where: { id, tenantId, companyId } })
    if (!m) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: '物料不存在' })
    }
    return m
  }

  async update(
    tenantId: string,
    companyId: string,
    id: string,
    input: Partial<CreateMaterialInput>,
  ): Promise<MaterialEntity> {
    const m = await this.findOne(tenantId, companyId, id)
    if (input.code && input.code !== m.code) {
      const dup = await this.materials.findOne({ where: { companyId, code: input.code } })
      if (dup) {
        throw new ConflictException({ code: ErrorCode.DUPLICATE_CODE, message: `物料编码 ${input.code} 已存在` })
      }
      m.code = input.code
    }
    if (input.name !== undefined) m.name = input.name
    if (input.specification !== undefined) m.specification = input.specification
    if (input.measureMode !== undefined) m.measureMode = input.measureMode
    if (input.primaryUnit !== undefined) m.primaryUnit = input.primaryUnit
    if (input.allowedUnits !== undefined) m.allowedUnits = input.allowedUnits
    if (input.batchManaged !== undefined) m.batchManaged = input.batchManaged
    if (input.remark !== undefined) m.remark = input.remark
    if (input.safetyStock !== undefined) {
      m.safetyStock = input.safetyStock == null ? null : String(input.safetyStock)
    }
    if (input.standardPrice !== undefined) {
      m.standardPrice = input.standardPrice == null ? null : String(input.standardPrice)
    }
    return this.materials.save(m)
  }

  /**
   * 停用物料
   * 有库存时不允许停用——否则库存报表会指向一个不存在的物料
   * TODO: 库存模块完成后补上库存量校验
   */
  async discontinue(tenantId: string, companyId: string, id: string): Promise<MaterialEntity> {
    const m = await this.findOne(tenantId, companyId, id)
    m.status = 'discontinued'
    return this.materials.save(m)
  }

  // -------------------------------------------------------------------------
  // 坯布规格
  // -------------------------------------------------------------------------

  /**
   * 计算规格的工艺参数
   *
   * **克重与用纱量全部由工艺内核算出，此处不接受手填。**
   * 这是一道硬约束：手填克重必然与纱线规格脱节，
   * 后续成本核算与三算校验会全线失真。
   */
  calculateSpec(spec: {
    finishedWidth: number
    warpDensity: number
    weftDensity: number
    warpCount: { value: number; system: CountSystem }
    weftCount: { value: number; system: CountSystem }
    loomWidth?: number | null
    widthAllowance: number
    warpLossRate: number
    weftLossRate: number
    picksPerMinute?: number | null
    machineRunRate: number
  }): SpecCalculationSnapshot {
    const coeffs: WeaveCoefficients = {
      warpLossRate: spec.warpLossRate,
      weftLossRate: spec.weftLossRate,
      widthAllowance: spec.widthAllowance,
      warpShrinkage: 0.05,
      weftShrinkage: 0.04,
      machineRunRate: spec.machineRunRate,
    }

    const result = calculateWeave({
      spec: {
        warpDensity: spec.warpDensity,
        weftDensity: spec.weftDensity,
        finishedWidth: spec.finishedWidth,
        warpCount: spec.warpCount,
        weftCount: spec.weftCount,
        ...(spec.loomWidth ? { loomWidth: spec.loomWidth } : {}),
      },
      coeffs,
      ...(spec.picksPerMinute ? { picksPerMinute: spec.picksPerMinute } : {}),
    })

    const widthM = spec.finishedWidth / 100
    return {
      specVersion: 0,
      warpGsm: result.warpGsm,
      weftGsm: result.weftGsm,
      totalGsm: result.totalGsm,
      warpKgPer100m: result.warpPer100m,
      weftKgPer100m: result.weftPer100m,
      totalKgPer100m: result.totalPer100m,
      kgPerMeter: round6((result.totalGsm * widthM) / 1000),
      kgPerM2: round6(result.totalGsm / 1000),
      dailyOutputM: result.dailyOutput,
      coefficients: {
        warpLossRate: spec.warpLossRate,
        weftLossRate: spec.weftLossRate,
        widthAllowance: spec.widthAllowance,
        machineRunRate: spec.machineRunRate,
      },
      calculatedAt: new Date().toISOString(),
    }
  }

  async createSpec(
    tenantId: string,
    companyId: string,
    input: {
      code?: string
      name: string
      finishedWidth: number
      warpDensity: number
      weftDensity: number
      weaveType?: WeaveType
      warpCount: { value: number; system: CountSystem }
      weftCount: { value: number; system: CountSystem }
      warpMaterialId?: string | null
      weftMaterialId?: string | null
      loomWidth?: number | null
      widthAllowance?: number
      warpLossRate?: number
      weftLossRate?: number
      picksPerMinute?: number | null
      machineRunRate?: number
      measuredGsm?: number | null
      remark?: string
    },
  ): Promise<GreigeSpecEntity> {
    const code = input.code ?? (await this.nextSpecCode(companyId))

    const dup = await this.specs.findOne({ where: { companyId, code } })
    if (dup) {
      throw new ConflictException({ code: ErrorCode.DUPLICATE_CODE, message: `规格编码 ${code} 已存在` })
    }

    const snapshot = this.calculateSpec({
      finishedWidth: input.finishedWidth,
      warpDensity: input.warpDensity,
      weftDensity: input.weftDensity,
      warpCount: input.warpCount,
      weftCount: input.weftCount,
      loomWidth: input.loomWidth ?? null,
      widthAllowance: input.widthAllowance ?? 10,
      warpLossRate: input.warpLossRate ?? 0.055,
      weftLossRate: input.weftLossRate ?? 0.05,
      picksPerMinute: input.picksPerMinute ?? null,
      machineRunRate: input.machineRunRate ?? 0.85,
    })

    if (input.warpMaterialId) {
      await this.findOne(tenantId, companyId, input.warpMaterialId)
    }
    if (input.weftMaterialId) {
      await this.findOne(tenantId, companyId, input.weftMaterialId)
    }

    return this.specs.save(
      this.specs.create({
        tenantId,
        companyId,
        code,
        name: input.name,
        finishedWidth: String(input.finishedWidth),
        warpDensity: String(input.warpDensity),
        weftDensity: String(input.weftDensity),
        weaveType: input.weaveType ?? 'plain',
        warpCountValue: String(input.warpCount.value),
        warpCountSystem: input.warpCount.system,
        weftCountValue: String(input.weftCount.value),
        weftCountSystem: input.weftCount.system,
        warpMaterialId: input.warpMaterialId ?? null,
        weftMaterialId: input.weftMaterialId ?? null,
        loomWidth: input.loomWidth != null ? String(input.loomWidth) : null,
        widthAllowance: String(input.widthAllowance ?? 10),
        warpLossRate: String(input.warpLossRate ?? 0.055),
        weftLossRate: String(input.weftLossRate ?? 0.05),
        picksPerMinute: input.picksPerMinute ?? null,
        machineRunRate: String(input.machineRunRate ?? 0.85),
        // 克重来自内核，不是入参
        calculatedGsm: String(snapshot.totalGsm),
        measuredGsm: input.measuredGsm != null ? String(input.measuredGsm) : null,
        lastSnapshot: snapshot as unknown as Record<string, unknown>,
        status: 'active',
        remark: input.remark ?? null,
      }),
    )
  }

  private async nextSpecCode(companyId: string): Promise<string> {
    const last = await this.specs.findOne({
      where: { companyId, code: Like('B%') },
      order: { code: 'DESC' },
    })
    const nextNum = last ? Number(last.code.slice(1)) + 1 : 1
    if (!Number.isFinite(nextNum) || nextNum > 9999) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: '规格编码 B9999 已用尽',
      })
    }
    return `B${String(nextNum).padStart(4, '0')}`
  }

  async findSpecs(tenantId: string, companyId: string, keyword?: string): Promise<GreigeSpecEntity[]> {
    const qb = this.specs
      .createQueryBuilder('s')
      .where('s.tenant_id = :tenantId', { tenantId })
      .andWhere('s.company_id = :companyId', { companyId })
      .andWhere('s.status = :status', { status: 'active' })
      .orderBy('s.code', 'ASC')
    if (keyword) {
      qb.andWhere('(s.name LIKE :kw OR s.code LIKE :kw)', { kw: `%${keyword}%` })
    }
    return qb.getMany()
  }

  async findSpec(tenantId: string, companyId: string, id: string): Promise<GreigeSpecEntity> {
    const s = await this.specs.findOne({ where: { id, tenantId, companyId } })
    if (!s) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: '坯布规格不存在' })
    }
    return s
  }

  /**
   * 更新规格
   * 任何影响计算的字段变更都会重算克重，并让 specVersion 自增
   */
  async updateSpec(
    tenantId: string,
    companyId: string,
    id: string,
    input: {
      name?: string
      finishedWidth?: number
      warpDensity?: number
      weftDensity?: number
      weaveType?: WeaveType
      warpCount?: { value: number; system: CountSystem }
      weftCount?: { value: number; system: CountSystem }
      warpMaterialId?: string | null
      weftMaterialId?: string | null
      loomWidth?: number | null
      widthAllowance?: number
      warpLossRate?: number
      weftLossRate?: number
      picksPerMinute?: number | null
      machineRunRate?: number
      measuredGsm?: number | null
      remark?: string
    },
  ): Promise<GreigeSpecEntity> {
    const s = await this.findSpec(tenantId, companyId, id)

    if (input.name !== undefined) s.name = input.name
    if (input.remark !== undefined) s.remark = input.remark
    if (input.measuredGsm !== undefined) {
      s.measuredGsm = input.measuredGsm == null ? null : String(input.measuredGsm)
    }
    if (input.warpMaterialId !== undefined) s.warpMaterialId = input.warpMaterialId
    if (input.weftMaterialId !== undefined) s.weftMaterialId = input.weftMaterialId
    if (input.weaveType !== undefined) s.weaveType = input.weaveType
    if (input.picksPerMinute !== undefined) s.picksPerMinute = input.picksPerMinute

    const affectsCalculation =
      input.finishedWidth !== undefined ||
      input.warpDensity !== undefined ||
      input.weftDensity !== undefined ||
      input.warpCount !== undefined ||
      input.weftCount !== undefined ||
      input.loomWidth !== undefined ||
      input.widthAllowance !== undefined ||
      input.warpLossRate !== undefined ||
      input.weftLossRate !== undefined ||
      input.machineRunRate !== undefined

    if (!affectsCalculation) {
      return this.specs.save(s)
    }

    if (input.finishedWidth !== undefined) s.finishedWidth = String(input.finishedWidth)
    if (input.warpDensity !== undefined) s.warpDensity = String(input.warpDensity)
    if (input.weftDensity !== undefined) s.weftDensity = String(input.weftDensity)
    if (input.warpCount) {
      s.warpCountValue = String(input.warpCount.value)
      s.warpCountSystem = input.warpCount.system
    }
    if (input.weftCount) {
      s.weftCountValue = String(input.weftCount.value)
      s.weftCountSystem = input.weftCount.system
    }
    if (input.loomWidth !== undefined) {
      s.loomWidth = input.loomWidth == null ? null : String(input.loomWidth)
    }
    if (input.widthAllowance !== undefined) s.widthAllowance = String(input.widthAllowance)
    if (input.warpLossRate !== undefined) s.warpLossRate = String(input.warpLossRate)
    if (input.weftLossRate !== undefined) s.weftLossRate = String(input.weftLossRate)
    if (input.machineRunRate !== undefined) s.machineRunRate = String(input.machineRunRate)

    const snapshot = this.calculateSpec({
      finishedWidth: Number(s.finishedWidth),
      warpDensity: Number(s.warpDensity),
      weftDensity: Number(s.weftDensity),
      warpCount: { value: Number(s.warpCountValue), system: s.warpCountSystem },
      weftCount: { value: Number(s.weftCountValue), system: s.weftCountSystem },
      loomWidth: s.loomWidth == null ? null : Number(s.loomWidth),
      widthAllowance: Number(s.widthAllowance),
      warpLossRate: Number(s.warpLossRate),
      weftLossRate: Number(s.weftLossRate),
      picksPerMinute: s.picksPerMinute,
      machineRunRate: Number(s.machineRunRate),
    })

    s.calculatedGsm = String(snapshot.totalGsm)
    s.lastSnapshot = { ...snapshot, specVersion: s.specVersion + 1 } as unknown as Record<string, unknown>
    // @VersionColumn 会在 save 时自增，业务层不手动改
    return this.specs.save(s)
  }

  /** 取规格的计算快照，供单据落库时复制 */
  getSnapshot(spec: GreigeSpecEntity): SpecCalculationSnapshot {
    const snap = this.recomputeGsm(spec)
    const widthM = Number(spec.finishedWidth) / 100
    return {
      specVersion: spec.specVersion,
      warpGsm: snap.warpGsm,
      weftGsm: snap.weftGsm,
      totalGsm: snap.totalGsm,
      warpKgPer100m: snap.warpKgPer100m,
      weftKgPer100m: snap.weftKgPer100m,
      totalKgPer100m: snap.totalKgPer100m,
      kgPerMeter: round6((snap.totalGsm * widthM) / 1000),
      kgPerM2: round6(snap.totalGsm / 1000),
      dailyOutputM: snap.dailyOutputM,
      coefficients: snap.coefficients,
      calculatedAt: new Date().toISOString(),
    }
  }

  private recomputeGsm(spec: GreigeSpecEntity): SpecCalculationSnapshot {
    return this.calculateSpec({
      finishedWidth: Number(spec.finishedWidth),
      warpDensity: Number(spec.warpDensity),
      weftDensity: Number(spec.weftDensity),
      warpCount: { value: Number(spec.warpCountValue), system: spec.warpCountSystem },
      weftCount: { value: Number(spec.weftCountValue), system: spec.weftCountSystem },
      loomWidth: spec.loomWidth == null ? null : Number(spec.loomWidth),
      widthAllowance: Number(spec.widthAllowance),
      warpLossRate: Number(spec.warpLossRate),
      weftLossRate: Number(spec.weftLossRate),
      picksPerMinute: spec.picksPerMinute,
      machineRunRate: Number(spec.machineRunRate),
    })
  }

  /** 分类标签，供前端下拉 */
  categoryOptions(): { value: MaterialCategoryValue; label: string }[] {
    return (Object.keys(MATERIAL_CATEGORY_LABEL) as MaterialCategoryValue[]).map((k) => ({
      value: k,
      label: MATERIAL_CATEGORY_LABEL[k],
    }))
  }
}

function round6(n: number): number {
  return Math.round((n + Number.EPSILON) * 1e10) / 1e10
}
