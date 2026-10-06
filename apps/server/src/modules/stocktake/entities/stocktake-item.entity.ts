import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'

/**
 * 盘点明细
 *
 * 每条对应盘点单里的一个批次：建单时冻结 batch_no 与**账面剩余量**(bookQuantityM)，
 * 录入**实盘量**(countedQuantityM)后，差异 diff = 实盘 - 账面。
 * 过账时按批次自己的规格快照把差异折成重量/面积，调批次剩余并记 count_gain/count_loss 流水。
 */
@Entity('stocktake_items')
@Index('idx_sti_stocktake', ['stocktakeId'])
@Index('idx_sti_batch', ['stocktakeId', 'batchId'])
export class StocktakeItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'char', length: 36 })
  tenantId!: string

  @Column({ type: 'char', length: 36 })
  companyId!: string

  @Column({ type: 'char', length: 36 })
  stocktakeId!: string

  /** 被盘批次 */
  @Column({ type: 'char', length: 36 })
  batchId!: string

  /**
   * 件卡（**可空**）
   *
   * - 非空 → 件卡级明细：盘点按件卡核销，能定位到「缺哪一匹」
   * - 为空 → 批次级明细：按米数核销（原有模式，保留）
   */
  @Column({ type: 'char', length: 36, nullable: true })
  rollId!: string | null

  /** 件卡号（冗余存一份，便于打印盘点单/人工核对） */
  @Column({ type: 'varchar', length: 64, nullable: true })
  rollNo!: string | null

  /** 批次号快照（批次号可能后续变更，展示用） */
  @Column({ type: 'varchar', length: 32 })
  batchNo!: string

  /** 建单时冻结的账面剩余量（米） */
  @Column({ type: 'decimal', precision: 14, scale: 3 })
  bookQuantityM!: string

  /** 实盘量（米），未录为 null */
  @Column({ type: 'decimal', precision: 14, scale: 3, nullable: true })
  countedQuantityM!: string | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
