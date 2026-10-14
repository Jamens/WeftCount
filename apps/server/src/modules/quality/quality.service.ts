import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm'
import { DataSource, In, Like, Repository, type EntityManager } from 'typeorm'
import {
  calcGradePrice,
  convert,
  DEFAULT_GRADE_RULES,
  defectPenalty,
  gradeByDensity,
  GREIGE_GRADES,
  MAX_POINTS_PER_DEFECT,
  scoreRoll,
  weightedGradePrice,
  type GreigeGrade,
  type GradePriceMode,
  type GradePriceRule,
  type GradeRule,
} from '@weftcount/shared'
import { DefectTypeEntity, type DefectCategory, type DefectPenaltyMode } from './entities/defect-type.entity'
import { InspectionEntity, type InspectionMode } from './entities/inspection.entity'
import { InspectionRollEntity } from './entities/inspection-roll.entity'
import { InspectionDefectEntity } from './entities/inspection-defect.entity'
import { GradePriceEntity, type GradePriceScope } from './entities/grade-price.entity'
import { RollEntity } from '../inventory/entities/roll.entity'
import { InventoryBatchEntity } from '../inventory/entities/inventory-batch.entity'

const NO_PREFIX = 'JY'

function num(n: number, scale: number): string {
  const f = 10 ** scale
  return String(Math.round((n + Number.EPSILON) * f) / f)
}

function toNum(v: string | null | undefined): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

/**
 * 行业通用疵点初值
 *
 * ## 为什么只给「初值」而不是固定字典
 * 疵点名称各地叫法不同（「百脚」有的厂叫「跳花」）。强推一张系统字典，
 * 检验员找不到自己习惯的词就会随便选一个——**字典不对，后面所有数据都废了**。
 * 所以建公司时灌这套初值，之后由各公司自行增删改。
 */
const DEFAULT_DEFECT_TYPES: { code: string; name: string; category: DefectCategory; penaltyMode: DefectPenaltyMode; fixedPenalty?: number }[] = [
  { code: 'BROKEN_WARP', name: '断经', category: 'warp', penaltyMode: 'by_length' },
  { code: 'BROKEN_WEFT', name: '断纬', category: 'weft', penaltyMode: 'by_length' },
  { code: 'COARSE_WEFT', name: '粗纬', category: 'weft', penaltyMode: 'by_length' },
  { code: 'DOUBLE_WEFT', name: '双纬', category: 'weft', penaltyMode: 'by_length' },
  { code: 'MISSING_WEFT', name: '缺纬', category: 'weft', penaltyMode: 'by_length' },
  { code: 'WEFT_SHRINK', name: '纬缩', category: 'weft', penaltyMode: 'by_length' },
  { code: 'REED_MARK', name: '筘痕', category: 'warp', penaltyMode: 'by_length' },
  { code: 'CLOUDY', name: '云织', category: 'other', penaltyMode: 'by_length' },
  { code: 'DENSE_THIN', name: '稀密路', category: 'other', penaltyMode: 'by_length' },
  { code: 'SKIP_YARN', name: '跳纱', category: 'warp', penaltyMode: 'by_length' },
  { code: 'CENTIPede', name: '百脚', category: 'weft', penaltyMode: 'by_length' },
  { code: 'HOLE', name: '破洞', category: 'broken', penaltyMode: 'fixed', fixedPenalty: MAX_POINTS_PER_DEFECT },
  { code: 'TEAR', name: '撕裂', category: 'broken', penaltyMode: 'fixed', fixedPenalty: MAX_POINTS_PER_DEFECT },
  { code: 'OIL_STAIN', name: '油污', category: 'stain', penaltyMode: 'by_length' },
  { code: 'RUST_STAIN', name: '锈渍', category: 'stain', penaltyMode: 'by_length' },
  { code: 'COLOR_DIFF', name: '色差', category: 'other', penaltyMode: 'by_length' },
]

@Injectable()
export class QualityService {
  constructor(
    @InjectRepository(DefectTypeEntity)
    private readonly defectTypes: Repository<DefectTypeEntity>,
    @InjectRepository(InspectionEntity)
    private readonly inspections: Repository<InspectionEntity>,
    @InjectRepository(InspectionRollEntity)
    private readonly inspectionRolls: Repository<InspectionRollEntity>,
    @InjectRepository(InspectionDefectEntity)
    private readonly defects: Repository<InspectionDefectEntity>,
    @InjectRepository(GradePriceEntity)
    private readonly gradePrices: Repository<GradePriceEntity>,
    @InjectRepository(RollEntity)
    private readonly rolls: Repository<RollEntity>,
    @InjectRepository(InventoryBatchEntity)
    private readonly batches: Repository<InventoryBatchEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  private async nextNo(companyId: string): Promise<string> {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const last = await this.inspections.findOne({
      where: { companyId, inspectionNo: Like(`${NO_PREFIX}${date}%`) },
      order: { inspectionNo: 'DESC' },
    })
    let next = 1
    if (last) {
      const seq = Number(last.inspectionNo.slice(NO_PREFIX.length + 8))
      if (Number.isFinite(seq)) next = seq + 1
    }
    return `${NO_PREFIX}${date}${String(next).padStart(4, '0')}`
  }

  // ---------------------------------------------------------------- 疵点类型

  async listDefectTypes(
    ctx: { tenantId: string; companyId: string },
    opts: { includeDisabled?: boolean } = {},
  ): Promise<DefectTypeEntity[]> {
    const rows = await this.defectTypes.find({
      where: { tenantId: ctx.tenantId, companyId: ctx.companyId, ...(opts.includeDisabled ? {} : { enabled: true }) },
      order: { sortOrder: 'ASC', code: 'ASC' },
    })
    // 首次使用时灌初值：没有字典检验员无从下手
    if (rows.length === 0 && !opts.includeDisabled) {
      await this.seedDefectTypes(ctx)
      return this.listDefectTypes(ctx, opts)
    }
    return rows
  }

  async seedDefectTypes(ctx: { tenantId: string; companyId: string }): Promise<void> {
    await this.defectTypes.upsert(
      DEFAULT_DEFECT_TYPES.map((d, i) =>
        this.defectTypes.create({
          tenantId: ctx.tenantId,
          companyId: ctx.companyId,
          code: d.code,
          name: d.name,
          category: d.category,
          penaltyMode: d.penaltyMode,
          fixedPenalty: d.fixedPenalty ?? MAX_POINTS_PER_DEFECT,
          sortOrder: i,
          enabled: true,
        }),
      ),
      ['companyId', 'code'],
    )
  }

  async createDefectType(
    ctx: { tenantId: string; companyId: string },
    dto: { code: string; name: string; category?: DefectCategory; penaltyMode?: DefectPenaltyMode; fixedPenalty?: number; sortOrder?: number },
  ): Promise<DefectTypeEntity> {
    const dup = await this.defectTypes.findOne({ where: { companyId: ctx.companyId, code: dto.code } })
    if (dup) throw new BadRequestException(`疵点代码 ${dto.code} 已存在`)
    return this.defectTypes.save(
      this.defectTypes.create({
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        code: dto.code,
        name: dto.name,
        category: dto.category ?? 'other',
        penaltyMode: dto.penaltyMode ?? 'by_length',
        fixedPenalty: dto.penaltyMode === 'fixed' ? (dto.fixedPenalty ?? MAX_POINTS_PER_DEFECT) : MAX_POINTS_PER_DEFECT,
        sortOrder: dto.sortOrder ?? 0,
        enabled: true,
      }),
    )
  }

  async updateDefectType(
    ctx: { tenantId: string; companyId: string },
    id: string,
    dto: { name?: string; category?: DefectCategory; penaltyMode?: DefectPenaltyMode; fixedPenalty?: number; sortOrder?: number; enabled?: boolean },
  ): Promise<DefectTypeEntity> {
    const dt = await this.defectTypes.findOne({ where: { id, tenantId: ctx.tenantId, companyId: ctx.companyId } })
    if (!dt) throw new NotFoundException('疵点类型不存在')
    Object.assign(dt, dto)
    return this.defectTypes.save(dt)
  }

  // ---------------------------------------------------------------- 检验单

  /**
   * 按件卡号查待检匹（验布扫码用）
   *
   * ## 为什么不复用 `/inventory/rolls/lookup`
   * 那个接口要 `inventory.manage`（它是发货扫码用的，顺带查库存）。
   * 质检员通常只被授予 `quality.inspect`，**不该为了验布就把库存管理权也发出去**。
   * 所以这里单独开一个口子，权限与验布动作对齐。
   *
   * 顺带把当前品等带回去：复验时质检员能先看到「这匹已经是 B 等」，
   * 不会在不知情的情况下把一匹降级布又验成一等。
   */
  async lookupRoll(ctx: { tenantId: string; companyId: string }, rollNo: string) {
    const no = String(rollNo ?? '').trim()
    if (!no) throw new BadRequestException('件卡号不能为空')
    const roll = await this.rolls.findOne({ where: { rollNo: no, companyId: ctx.companyId } })
    if (!roll) throw new NotFoundException(`件卡 ${no} 不存在`)
    return {
      id: roll.id,
      rollNo: roll.rollNo,
      meters: toNum(roll.remainingM ?? roll.meters),
      grade: roll.grade,
      inspectedAt: roll.inspectedAt,
      status: roll.status,
    }
  }

  async createInspection(
    ctx: { tenantId: string; companyId: string; userId: string },
    input: { batchId?: string | null; warehouseId?: string | null; inspectedAt?: string | null; mode?: InspectionMode | null; sampleRate?: number | null; remark?: string | null },
  ): Promise<InspectionEntity> {
    const inspectionNo = await this.nextNo(ctx.companyId)
    return this.inspections.save(
      this.inspections.create({
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        inspectionNo,
        batchId: input.batchId ?? null,
        warehouseId: input.warehouseId ?? null,
        inspectorId: ctx.userId,
        inspectedAt: input.inspectedAt ?? new Date().toISOString().slice(0, 10),
        mode: input.mode ?? 'full',
        sampleRate: input.sampleRate != null ? num(input.sampleRate, 2) : null,
        gradeRuleSnapshot: DEFAULT_GRADE_RULES.map((r) => ({
          grade: r.grade,
          maxPenaltyDensity: r.maxPenaltyDensity === Number.POSITIVE_INFINITY ? null : r.maxPenaltyDensity,
        })) as unknown as InspectionEntity['gradeRuleSnapshot'],
        status: 'draft',
        remark: input.remark ?? null,
      }),
    )
  }

  async listInspections(
    ctx: { tenantId: string; companyId: string },
    filter: { status?: string; batchId?: string } = {},
  ): Promise<InspectionEntity[]> {
    return this.inspections.find({
      where: {
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        ...(filter.status ? { status: filter.status as InspectionEntity['status'] } : {}),
        ...(filter.batchId ? { batchId: filter.batchId } : {}),
      },
      order: { createdAt: 'DESC' },
      take: 200,
    })
  }

  /**
   * 检验单详情（含逐匹结果与逐条疵点）
   *
   * 前端录入界面要一次拿到全量：匹列表 + 每匹的疵点明细，
   * 否则每匹一次请求，触摸屏上会卡。
   */
  async getInspection(ctx: { tenantId: string; companyId: string }, id: string) {
    const inspection = await this.inspections.findOne({
      where: { id, tenantId: ctx.tenantId, companyId: ctx.companyId },
    })
    if (!inspection) throw new NotFoundException('检验单不存在')

    const rolls = await this.inspectionRolls.find({
      where: { inspectionId: id },
      order: { rollNo: 'ASC' },
    })
    const rollIds = rolls.map((r) => r.id)
    const defects = rollIds.length
      ? await this.defects.find({ where: { inspectionRollId: In(rollIds) }, order: { positionM: 'ASC' } })
      : []

    return {
      inspection,
      rolls: rolls.map((r) => ({
        ...r,
        meters: toNum(r.meters),
        widthInch: toNum(r.widthInch),
        sqYards: toNum(r.sqYards),
        penaltyDensity: toNum(r.penaltyDensity),
        defects: defects
          .filter((d) => d.inspectionRollId === r.id)
          .map((d) => ({ ...d, positionM: toNum(d.positionM), lengthInch: toNum(d.lengthInch) })),
      })),
    }
  }

  /**
   * 加入待检匹
   *
   * 实测匹长默认取件卡的 `remaining_m ?? meters`，门幅取批次 `width_cm` 换算成英寸。
   * 都是**默认值**，检验员可改——验布机实测常与织机报工数对不上。
   */
  async addRolls(
    ctx: { tenantId: string; companyId: string },
    inspectionId: string,
    rollIds: string[],
  ): Promise<InspectionRollEntity[]> {
    const inspection = await this.inspections.findOne({ where: { id: inspectionId, tenantId: ctx.tenantId, companyId: ctx.companyId } })
    if (!inspection) throw new NotFoundException('检验单不存在')
    if (inspection.status !== 'draft') throw new BadRequestException('检验单已定等或作废，不能再加匹')

    const found = await this.rolls.find({ where: { id: In(rollIds), tenantId: ctx.tenantId, companyId: ctx.companyId } })
    if (found.length === 0) throw new BadRequestException('未找到可检的件卡')

    const batchIds = [...new Set(found.map((r) => r.batchId))]
    const batchList = await this.batches.find({ where: { id: In(batchIds) } })
    const widthByBatch = new Map(batchList.map((b) => [b.id, toNum(b.widthCm)]))

    const existing = await this.inspectionRolls.find({ where: { inspectionId } })
    const already = new Set(existing.map((r) => r.rollId))

    const created: InspectionRollEntity[] = []
    for (const roll of found) {
      if (already.has(roll.id)) continue
      const widthCm = widthByBatch.get(roll.batchId) ?? 0
      const widthInch = widthCm > 0 ? convert(widthCm, 'cm', 'inch') : 0
      const meters = toNum(roll.remainingM ?? roll.meters)
      const { sqYards } = scoreRoll({ meters, widthInch, totalPoints: 0 })
      created.push(
        this.inspectionRolls.create({
          tenantId: ctx.tenantId,
          companyId: ctx.companyId,
          inspectionId,
          rollId: roll.id,
          rollNo: roll.rollNo,
          meters: num(meters, 3),
          widthInch: num(widthInch, 2),
          sqYards: num(sqYards, 4),
          totalPoints: 0,
          penaltyDensity: '0',
          overReceivingLimit: false,
          grade: null,
        }),
      )
    }
    if (created.length === 0) return existing

    await this.inspectionRolls.save(created)
    inspection.rollCount = existing.length + created.length
    await this.inspections.save(inspection)
    return this.inspectionRolls.find({ where: { inspectionId }, order: { rollNo: 'ASC' } })
  }

  /**
   * 记录疵点（整匹替换）
   *
   * 用「整匹替换」而不是「追加」：检验员在触摸屏上删一条、改一个长度很常见，
   * 增量接口要维护一堆 diff 语义，一次传全量最简单也不容易错。
   * 扣分在**服务端**按类型规则算，客户端传的 penalty 一律不采信。
   */
  async recordDefects(
    ctx: { tenantId: string; companyId: string },
    inspectionId: string,
    rollId: string,
    items: { defectTypeId: string; positionM?: number | null; lengthInch?: number | null; remark?: string | null }[],
  ) {
    const ir = await this.inspectionRolls.findOne({
      where: { inspectionId, rollId, tenantId: ctx.tenantId, companyId: ctx.companyId },
    })
    if (!ir) throw new NotFoundException('该匹不在此检验单中')
    const inspection = await this.inspections.findOne({ where: { id: inspectionId } })
    if (!inspection) throw new NotFoundException('检验单不存在')
    if (inspection.status !== 'draft') throw new BadRequestException('检验单已定等或作废，不能再改疵点')

    const types = await this.defectTypes.find({ where: { companyId: ctx.companyId, id: In(items.map((i) => i.defectTypeId)) } })
    const typeById = new Map(types.map((t) => [t.id, t]))

    const rows = items.map((it) => {
      const dt = typeById.get(it.defectTypeId)
      if (!dt) throw new BadRequestException('疵点类型不存在')
      const penalty =
        dt.penaltyMode === 'fixed'
          ? Math.min(MAX_POINTS_PER_DEFECT, dt.fixedPenalty)
          : defectPenalty({ lengthInch: it.lengthInch ?? 0 })
      return this.defects.create({
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        inspectionRollId: ir.id,
        defectTypeId: dt.id,
        defectCode: dt.code,
        positionM: it.positionM != null ? num(it.positionM, 3) : null,
        lengthInch: it.lengthInch != null ? num(it.lengthInch, 2) : null,
        penalty,
        remark: it.remark ?? null,
      })
    })

    return this.dataSource.transaction(async (manager) => {
      await manager.delete(InspectionDefectEntity, { inspectionRollId: ir.id })
      if (rows.length) await manager.save(rows)
      await this.recalcRoll(manager, ir)
      await this.recalcInspection(manager, inspection.id)
      return this.inspectionRolls.findOne({ where: { id: ir.id } })
    })
  }

  /** 重算单匹：扣分合计 → 密度 → 定等 */
  private async recalcRoll(manager: EntityManager, ir: InspectionRollEntity): Promise<void> {
    const rows = await manager.find(InspectionDefectEntity, { where: { inspectionRollId: ir.id } })
    const totalPoints = rows.reduce((s, r) => s + r.penalty, 0)
    const meters = toNum(ir.meters)
    const widthInch = toNum(ir.widthInch)
    const { sqYards, penaltyDensity, overReceivingLimit } = scoreRoll({ meters, widthInch, totalPoints })
    ir.totalPoints = totalPoints
    ir.sqYards = num(sqYards, 4)
    ir.penaltyDensity = num(penaltyDensity, 4)
    ir.overReceivingLimit = overReceivingLimit
    ir.grade = gradeByDensity(penaltyDensity)
    await manager.save(ir)
  }

  /** 重算整单汇总：加权平均密度（不是各匹密度的算术平均） */
  private async recalcInspection(manager: EntityManager, inspectionId: string): Promise<void> {
    const rolls = await manager.find(InspectionRollEntity, { where: { inspectionId } })
    const totalPoints = rolls.reduce((s, r) => s + r.totalPoints, 0)
    const totalSqYd = rolls.reduce((s, r) => s + toNum(r.sqYards), 0)
    const insp = await manager.findOne(InspectionEntity, { where: { id: inspectionId } })
    if (!insp) return
    insp.rollCount = rolls.length
    insp.totalPoints = totalPoints
    insp.totalSqYd = num(totalSqYd, 4)
    insp.avgPenaltyDensity = num(totalSqYd > 0 ? (totalPoints * 100) / totalSqYd : 0, 4)
    insp.passRate =
      rolls.length > 0 ? num((rolls.filter((r) => !r.overReceivingLimit).length / rolls.length) * 100, 2) : null
    await manager.save(insp)
  }

  /** 修改实测匹长 / 门幅（会触发重算，因为分母变了） */
  async updateRollMeasure(
    ctx: { tenantId: string; companyId: string },
    inspectionId: string,
    rollId: string,
    patch: { meters?: number; widthInch?: number; remark?: string | null },
  ) {
    const ir = await this.inspectionRolls.findOne({
      where: { inspectionId, rollId, tenantId: ctx.tenantId, companyId: ctx.companyId },
    })
    if (!ir) throw new NotFoundException('该匹不在此检验单中')
    if (patch.meters != null) ir.meters = num(patch.meters, 3)
    if (patch.widthInch != null) ir.widthInch = num(patch.widthInch, 2)
    if (patch.remark !== undefined) ir.remark = patch.remark
    return this.dataSource.transaction(async (manager) => {
      await this.recalcRoll(manager, ir)
      await this.recalcInspection(manager, inspectionId)
      return this.inspectionRolls.findOne({ where: { id: ir.id } })
    })
  }

  /**
   * 定等：把等级写回件卡
   *
   * 这一步之前，等级只存在于检验单里；这一步之后 `rolls.grade` 才有值，
   * 出库选匹、追溯、打标签、分等计价才读得到。
   */
  async finalize(ctx: { tenantId: string; companyId: string }, id: string): Promise<InspectionEntity> {
    return this.dataSource.transaction(async (manager) => {
      const insp = await manager.findOne(InspectionEntity, { where: { id, tenantId: ctx.tenantId, companyId: ctx.companyId } })
      if (!insp) throw new NotFoundException('检验单不存在')
      if (insp.status !== 'draft') throw new BadRequestException('检验单已定等或作废')

      const rolls = await manager.find(InspectionRollEntity, { where: { inspectionId: id } })
      if (rolls.length === 0) throw new BadRequestException('检验单还没加入任何匹')

      for (const ir of rolls) {
        await this.recalcRoll(manager, ir)
        await manager.update(RollEntity, { id: ir.rollId, companyId: ctx.companyId }, {
          grade: ir.grade,
          inspectedAt: new Date(),
          lastInspectionId: id,
        })
      }
      await this.recalcInspection(manager, id)
      insp.status = 'done'
      return manager.save(insp)
    })
  }

  /**
   * 作废：把等级回退
   *
   * 回退到**除本单外最近一次仍有效检验的等级**，没有就回到未检验（null）。
   * 不能简单置 null——一匹可能被验过两次，第二次作废后应当是第一次的等级。
   */
  async voidInspection(ctx: { tenantId: string; companyId: string }, id: string): Promise<InspectionEntity> {
    return this.dataSource.transaction(async (manager) => {
      const insp = await manager.findOne(InspectionEntity, { where: { id, tenantId: ctx.tenantId, companyId: ctx.companyId } })
      if (!insp) throw new NotFoundException('检验单不存在')
      if (insp.status === 'void') return insp

      const rolls = await manager.find(InspectionRollEntity, { where: { inspectionId: id } })
      for (const ir of rolls) {
        const roll = await manager.findOne(RollEntity, { where: { id: ir.rollId, companyId: ctx.companyId } })
        if (!roll || roll.lastInspectionId !== id) continue

        const prev = await manager.findOne(InspectionRollEntity, {
          where: { rollId: ir.rollId, companyId: ctx.companyId },
          order: { createdAt: 'DESC' },
        })
        const prevValid = prev && prev.inspectionId !== id ? prev : null
        // 上一版必须来自一张 done 的单，draft/void 的不能算
        const fallback = prevValid
          ? await manager.findOne(InspectionEntity, { where: { id: prevValid.inspectionId, status: 'done' } })
          : null

        await manager.update(RollEntity, { id: ir.rollId }, {
          grade: fallback ? prevValid!.grade : null,
          inspectedAt: fallback ? roll.inspectedAt : null,
          lastInspectionId: fallback ? prevValid!.inspectionId : null,
        })
      }
      insp.status = 'void'
      return manager.save(insp)
    })
  }

  // ---------------------------------------------------------------- 分等价目

  async listGradePrices(
    ctx: { tenantId: string; companyId: string },
    scope: GradePriceScope,
    refId: string,
  ): Promise<GradePriceEntity[]> {
    return this.gradePrices.find({
      where: { tenantId: ctx.tenantId, companyId: ctx.companyId, scope, refId },
      order: { grade: 'ASC' },
    })
  }

  async upsertGradePrices(
    ctx: { tenantId: string; companyId: string },
    scope: GradePriceScope,
    refId: string,
    rules: { grade: GreigeGrade; mode: GradePriceMode; value: number }[],
  ): Promise<GradePriceEntity[]> {
    for (const r of rules) {
      if (!GREIGE_GRADES.includes(r.grade)) throw new BadRequestException(`未知品等 ${r.grade}`)
      if (r.mode === 'discount' && (r.value <= 0 || r.value > 1)) {
        throw new BadRequestException('折扣率必须在 (0,1] 之间')
      }
    }
    await this.gradePrices.delete({ companyId: ctx.companyId, scope, refId })
    if (rules.length === 0) return []
    return this.gradePrices.save(
      rules.map((r) =>
        this.gradePrices.create({
          tenantId: ctx.tenantId,
          companyId: ctx.companyId,
          scope,
          refId,
          grade: r.grade,
          mode: r.mode,
          value: num(r.value, 4),
        }),
      ),
    )
  }

  /**
   * 取分等单价（**分等产生价值的地方**）
   *
   * 优先级：合同明细协议价 > 规格挂牌价 > 不分等（原价）。
   * 有合同就按合同走，不因为存在挂牌价就覆盖协议价。
   *
   * 只建质检模块而不接这里，等级就只是个标签——等级价差 5~15% 一分钱收不回来。
   */
  async resolveUnitPrice(
    ctx: { tenantId: string; companyId: string },
    input: { contractItemId?: string | null; specId?: string | null; grade?: GreigeGrade | null; basePrice: number },
  ): Promise<{ price: number; basePrice: number; source: 'contract_item' | 'spec' | 'base'; mode?: GradePriceMode }> {
    const basePrice = input.basePrice
    if (!input.grade) return { price: basePrice, basePrice, source: 'base' }

    if (input.contractItemId) {
      const hit = await this.gradePrices.findOne({
        where: { companyId: ctx.companyId, scope: 'contract_item', refId: input.contractItemId, grade: input.grade },
      })
      if (hit) {
        return {
          price: calcGradePrice(basePrice, { grade: hit.grade, mode: hit.mode, value: toNum(hit.value) }),
          basePrice,
          source: 'contract_item',
          mode: hit.mode,
        }
      }
    }

    if (input.specId) {
      const hit = await this.gradePrices.findOne({
        where: { companyId: ctx.companyId, scope: 'spec', refId: input.specId, grade: input.grade },
      })
      if (hit) {
        return {
          price: calcGradePrice(basePrice, { grade: hit.grade, mode: hit.mode, value: toNum(hit.value) }),
          basePrice,
          source: 'spec',
          mode: hit.mode,
        }
      }
    }

    return { price: basePrice, basePrice, source: 'base' }
  }

  /**
   * 按本次实际发出的件卡等级**加权**算单价
   *
   * ## 为什么是加权，而不是取最高/最低/平均等级
   * 一单可能同时发一等品和等外品。取最高等级算整单价，等外那部分就白送了；
   * 取平均等级又会算出库里不存在的价。正确口径：**各等级分别取价，再按本次发出的米数加权**。
   *
   * ## 为什么只有件卡逐匹发货支持
   * 逐匹发货才知道每一匹的等级；FIFO 与扫码拣货是**批次级**消耗，
   * 一个批次里可能混着不同等级的匹（验布是逐匹的），无从分摊。
   * 那两种模式仍须调用方显式传单价——宁可不自动计价，也不猜一个价出来。
   *
   * ## 未检验的匹怎么算
   * `grade` 为 null 单独归一组，按基准价计。不猜它的等级。
   */
  async weightedGradePrice(
    ctx: { tenantId: string; companyId: string },
    input: {
      rollTakes: { rollId: string; meters: number }[]
      basePrice: number
      contractItemId?: string | null
      specId?: string | null
    },
  ): Promise<{
    price: number
    basePrice: number
    source: 'contract_item' | 'spec' | 'base'
    breakdown: { grade: GreigeGrade | null; meters: number; price: number }[]
  }> {
    const rollIds = [...new Set(input.rollTakes.map((r) => r.rollId))]
    const rolls = rollIds.length
      ? await this.rolls.find({ where: { id: In(rollIds), companyId: ctx.companyId } })
      : []
    const gradeByRoll = new Map(rolls.map((r) => [r.id, r.grade]))

    const metersByGrade = new Map<GreigeGrade | null, number>()
    for (const rt of input.rollTakes) {
      const g = gradeByRoll.get(rt.rollId) ?? null
      metersByGrade.set(g, (metersByGrade.get(g) ?? 0) + rt.meters)
    }

    const breakdown: { grade: GreigeGrade | null; meters: number; price: number }[] = []
    const sourceByGrade = new Map<GreigeGrade | null, 'contract_item' | 'spec' | 'base'>()
    for (const [grade, meters] of metersByGrade) {
      const resolved = await this.resolveUnitPrice(ctx, {
        basePrice: input.basePrice,
        grade,
        contractItemId: input.contractItemId ?? null,
        specId: input.specId ?? null,
      })
      breakdown.push({ grade, meters, price: resolved.price })
      sourceByGrade.set(grade, resolved.source)
    }

    const totalMeters = breakdown.reduce((s, b) => s + b.meters, 0)
    // 占米数最多的那一组决定「这单的价目来源」，便于展示与排查
    const dominant = [...metersByGrade.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

    return {
      // 加权口径收敛在 shared 的 weightedGradePrice，前后端与报表同一套
      price: totalMeters > 0 ? weightedGradePrice(breakdown) : input.basePrice,
      basePrice: input.basePrice,
      source: sourceByGrade.get(dominant) ?? 'base',
      breakdown,
    }
  }

  /** 当前生效的定等规则（供前端预览「改了规则会怎样」） */
  gradeRules(): GradeRule[] {
    return DEFAULT_GRADE_RULES.map((r) => ({ ...r }))
  }
}
