import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

/**
 * 疵点记录（逐条）
 *
 * ## 为什么必须记「位置」
 * `positionM` = 疵点距匹头多少米。这是**整张表里商业价值最高的字段**：
 * 服装厂裁剪时要避开疵点，知道位置就能把一匹二等布当一等布用掉大半；
 * 不知道位置，整匹只能降级卖。等级只决定卖多少钱，位置决定能不能卖得掉。
 *
 * 没有位置信息的检验系统，等于只做了一半。
 *
 * ## 扣分为什么也存下来
 * 扣分可由「类型 + 长度」重算，但**规则会变**（客户改标准、类型改计分方式）。
 * 存下当时的扣分，历史单据才经得起复核；重算只用于「按新规则整批复算」这个明确动作。
 */
@Entity('inspection_defects')
@Index('idx_inspection_defects_roll', ['inspectionRollId'])
export class InspectionDefectEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'char', length: 36 })
  tenantId!: string

  @Column({ type: 'char', length: 36 })
  companyId!: string

  @Column({ type: 'char', length: 36 })
  inspectionRollId!: string

  @Column({ type: 'char', length: 36 })
  defectTypeId!: string

  /** 疵点代码（冗余，导出/打印不用 join） */
  @Column({ type: 'varchar', length: 32 })
  defectCode!: string

  /** 距匹头的米数（裁剪排料用） */
  @Column({ type: 'decimal', precision: 10, scale: 3, nullable: true })
  positionM!: string | null

  /** 疵点长度（英寸），`penaltyMode = 'fixed'` 的类型可为空 */
  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  lengthInch!: string | null

  /** 该条扣分（当时的计算结果，快照） */
  @Column({ type: 'int' })
  penalty!: number

  /** 疵点照片（附件 ID）。本轮先留字段，上传能力见后续附件模块 */
  @Column({ type: 'char', length: 36, nullable: true })
  photoId!: string | null

  @Column({ type: 'varchar', length: 255, nullable: true })
  remark!: string | null

  @CreateDateColumn()
  createdAt!: Date
}
