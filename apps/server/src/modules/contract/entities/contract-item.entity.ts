import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'

/**
 * 合同明细行
 *
 * 一行 = 一个「物料+规格」的协议约定：协议单价(元/米) × 协议数量(米) = 行金额。
 * 多行结构同时承载「合同多明细」与「价格层」——订单可在生效合同下按 agreedPrice 取价。
 */
@Entity('contract_items')
@Index('idx_cti_contract', ['contractId'])
@Index('idx_cti_spec', ['companyId', 'specId'])
export class ContractItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'char', length: 36 })
  tenantId!: string

  @Column({ type: 'char', length: 36 })
  companyId!: string

  /** 所属合同 */
  @Column({ type: 'char', length: 36 })
  contractId!: string

  @Column({ type: 'char', length: 36 })
  materialId!: string

  @Column({ type: 'char', length: 36 })
  specId!: string

  /** 协议单价（元/米） */
  @Column({ type: 'decimal', precision: 14, scale: 4 })
  agreedPrice!: string

  /** 协议数量（米，主单位） */
  @Column({ type: 'decimal', precision: 16, scale: 3 })
  agreedQuantityM!: string

  /** 行金额（元）= 单价 × 数量 */
  @Column({ type: 'decimal', precision: 18, scale: 2 })
  amount!: string

  @Column({ type: 'varchar', length: 255, nullable: true })
  remark!: string | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
