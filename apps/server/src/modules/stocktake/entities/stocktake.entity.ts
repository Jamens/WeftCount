import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm'

/**
 * 盘点单状态
 *   draft      草稿（可录实盘数）
 *   completed  已完成（差异已过账，批次量与流水已调整）
 *   cancelled  已取消
 */
export type StocktakeStatus = 'draft' | 'completed' | 'cancelled'

/**
 * 盘点单
 *
 * 对某个仓库做实物盘点：建单时快照仓内活跃批次的**账面剩余量**，
 * 录入**实盘量**后完成过账——有差异的批次按盘盈/盘亏调整剩余量并记 count_gain/count_loss 流水。
 * 账面量在建单时冻结，避免盘点期间出入库影响差异判定。
 */
@Entity('stocktakes')
@Index('idx_st_company', ['companyId'])
@Index('idx_st_no_company', ['stocktakeNo', 'companyId'], { unique: true })
@Index('idx_st_warehouse', ['companyId', 'warehouseId'])
export class StocktakeEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'char', length: 36 })
  tenantId!: string

  @Column({ type: 'char', length: 36 })
  companyId!: string

  /** 盘点单号，规则：PD + 8 位日期 + 4 位流水 */
  @Column({ type: 'varchar', length: 32 })
  stocktakeNo!: string

  /** 盘点仓库 */
  @Column({ type: 'char', length: 36 })
  warehouseId!: string

  /** 盘点日期 YYYY-MM-DD */
  @Column({ type: 'date' })
  stocktakeDate!: string

  @Column({ type: 'enum', enum: ['draft', 'completed', 'cancelled'], default: 'draft' })
  status!: StocktakeStatus

  /** 盘点人（发起人） */
  @Column({ type: 'char', length: 36 })
  operatorId!: string

  @Column({ type: 'varchar', length: 255, nullable: true })
  remark!: string | null

  @VersionColumn()
  version!: number

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
