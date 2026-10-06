import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

export type RollStatus = 'in_stock' | 'consumed' | 'sold'

/**
 * 件卡（逐匹）
 *
 * 织造/仓储按「匹」管理坯布——每匹布有自己的件卡与米数。入库时逐匹扫码计数：
 * 扫一张件卡 = 收进一匹(rollNo + meters)，批次米数 = 各匹米数之和。
 * rollNo 公司内唯一，天然防重扫。
 */
@Entity('rolls')
@Index('idx_rolls_batch', ['companyId', 'batchId'])
@Index('idx_rolls_rollno', ['companyId', 'rollNo'], { unique: true })
export class RollEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'char', length: 36 })
  tenantId!: string

  @Column({ type: 'char', length: 36 })
  companyId!: string

  /** 所属批次 */
  @Column({ type: 'char', length: 36 })
  batchId!: string

  /** 件卡序列号（公司内唯一，防重扫） */
  @Column({ type: 'varchar', length: 64 })
  rollNo!: string

  /** 该匹米数 */
  @Column({ type: 'decimal', precision: 14, scale: 3 })
  meters!: string

  @Column({ type: 'decimal', precision: 14, scale: 3, nullable: true })
  weightKg!: string | null

  @Column({ type: 'enum', enum: ['in_stock', 'consumed', 'sold'], default: 'in_stock' })
  status!: RollStatus

  /** 来源入库单 */
  @Column({ type: 'char', length: 36, nullable: true })
  sourceDocId!: string | null

  @CreateDateColumn()
  createdAt!: Date
}
