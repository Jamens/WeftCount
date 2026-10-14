import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'
import type { GreigeGrade } from '@weftcount/shared'

/**
 * 检验单 - 匹明细（一匹一行）
 *
 * 这是**定等真正发生的地方**：扣分在 `inspection_defects` 里逐条记，
 * 汇总到这里算出密度，再落到 `grade`。
 *
 * ## 为什么实测匹长 / 门幅要另存，不直接读件卡上的数
 * 件卡上的 `meters` 是**织机报工数**，验布机实测往往对不上（短匹、长匹、
 * 回缩）。密度公式的分母是面积，用错一个数整匹等级就错。
 * 所以这里存**检验时的实测值**，与件卡登记值并存——
 * 差异本身就是有用的数据（短匹率）。
 *
 * ## 冗余存 `sq_yards` 的理由
 * 面积可由实测匹长 × 门幅算出，但存下来才能在事后**复核**：
 * 单位换算规则若将来调整，历史单据的密度不能跟着变。
 */
@Entity('inspection_rolls')
@Index('idx_inspection_rolls_insp', ['companyId', 'inspectionId'])
@Index('idx_inspection_rolls_roll', ['companyId', 'rollId'])
@Index('idx_inspection_rolls_uniq', ['inspectionId', 'rollId'], { unique: true })
export class InspectionRollEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'char', length: 36 })
  tenantId!: string

  @Column({ type: 'char', length: 36 })
  companyId!: string

  @Column({ type: 'char', length: 36 })
  inspectionId!: string

  @Column({ type: 'char', length: 36 })
  rollId!: string

  /** 件卡号（冗余，打印与核对用） */
  @Column({ type: 'varchar', length: 64 })
  rollNo!: string

  /** 实测匹长（米） */
  @Column({ type: 'decimal', precision: 14, scale: 3 })
  meters!: string

  /** 实测门幅（英寸） */
  @Column({ type: 'decimal', precision: 8, scale: 2 })
  widthInch!: string

  /** 面积（平方码），算出的，冗余存以便复核 */
  @Column({ type: 'decimal', precision: 14, scale: 4 })
  sqYards!: string

  /** 该匹扣分合计 */
  @Column({ type: 'int', default: 0 })
  totalPoints!: number

  /** 扣分密度（分 / 100 平方码） */
  @Column({ type: 'decimal', precision: 10, scale: 4 })
  pointsPer100SqYd!: string

  /** 是否超出收货红线（> 4 分 / 100 平方码） */
  @Column({ type: 'boolean', default: false })
  overReceivingLimit!: boolean

  /** 定等结果 */
  @Column({ type: 'enum', enum: ['A', 'B', 'C', 'D'], nullable: true })
  grade!: GreigeGrade | null

  @Column({ type: 'varchar', length: 255, nullable: true })
  remark!: string | null

  @CreateDateColumn()
  createdAt!: Date
}
