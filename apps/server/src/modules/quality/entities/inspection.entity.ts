import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'

export type InspectionStatus = 'draft' | 'done' | 'void'
export type InspectionMode = 'full' | 'sampling'
export type InspectionStandard = 'four_point'

/**
 * 检验单（验布单）
 *
 * 一张单对一批布（或散匹），是**检验结论的载体**：
 * 谁验的、什么时候验的、用的什么标准、抽了多少、结果如何。
 *
 * ## 为什么要有「单」而不是直接给匹打等级
 * 没有单据，等级就是散落在匹上的一个字段——改了无从追溯，
 * 客户投诉时拿不出「当时是谁按什么标准定的」。
 * 有单才有复核入口：整单作废重验，或逐匹改判并留痕。
 *
 * ## 状态流转
 * `draft`（录入中）→ `done`（已定等，等级写回件卡）→ `void`（作废，等级回退）
 *
 * 只有 `done` 会把等级回写到 `rolls.grade`。
 * `void` 必须能把 grade 回退到上一版——所以定等时要在匹上留 `last_inspection_id`。
 */
@Entity('inspections')
@Index('idx_inspections_no', ['companyId', 'inspectionNo'], { unique: true })
@Index('idx_inspections_batch', ['companyId', 'batchId'])
export class InspectionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'char', length: 36 })
  tenantId!: string

  @Column({ type: 'char', length: 36 })
  companyId!: string

  /** 检验单号（公司内唯一，如 JY202610140001） */
  @Column({ type: 'varchar', length: 32 })
  inspectionNo!: string

  /** 被检批次（散匹检验时可空） */
  @Column({ type: 'char', length: 36, nullable: true })
  batchId!: string | null

  @Column({ type: 'char', length: 36, nullable: true })
  warehouseId!: string | null

  /** 检验人 */
  @Column({ type: 'char', length: 36 })
  inspectorId!: string

  @Column({ type: 'date' })
  inspectedAt!: string

  /**
   * 检验标准
   *
   * 目前只有四分制。留字段而非写死，是因为十分制（日标）
   * 在外贸订单里仍被要求——届时加一个枚举值即可，不用改表结构。
   */
  @Column({ type: 'enum', enum: ['four_point'], default: 'four_point' })
  standard!: InspectionStandard

  /** 全检 / 抽检 */
  @Column({ type: 'enum', enum: ['full', 'sampling'], default: 'full' })
  mode!: InspectionMode

  /** 抽检比例（%），仅抽检时有意义 */
  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  sampleRate!: string | null

  /** 定等规则快照（JSON），避免规则改了之后历史单据无法复核 */
  @Column({ type: 'json', nullable: true })
  gradeRuleSnapshot!: { grade: string; maxPenaltyDensity: number }[] | null

  @Column({ type: 'enum', enum: ['draft', 'done', 'void'], default: 'draft' })
  status!: InspectionStatus

  /** 匹数（冗余，列表页不用 join 明细） */
  @Column({ type: 'int', default: 0 })
  rollCount!: number

  /** 全单总扣分 */
  @Column({ type: 'int', default: 0 })
  totalPoints!: number

  /** 全单总面积（平方码） */
  @Column({ type: 'decimal', precision: 14, scale: 4, default: 0 })
  totalSqYd!: string

  /** 平均扣分密度（分 / 100 平方码）= 全单的加权口径，不是各匹密度的算术平均 */
  @Column({ type: 'decimal', precision: 10, scale: 4, default: 0 })
  avgPenaltyDensity!: string

  /** 合格率（%）——未超收货红线的匹数占比 */
  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  passRate!: string | null

  @Column({ type: 'varchar', length: 255, nullable: true })
  remark!: string | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
