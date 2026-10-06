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
 * 合同状态
 *   draft      草稿（可编辑明细）
 *   active     生效（可被订单引用取协议价）
 *   completed  已完成
 *   cancelled  已取消
 */
export type ContractStatus = 'draft' | 'active' | 'completed' | 'cancelled'

/**
 * 合同（框架协议）
 *
 * 与往来单位签订的多行采购/销售协议：约定若干「物料+规格」的**协议单价**(元/米)与
 * 协议数量(米)，订单可在其下按协议价成交。合同总价与总量由明细行汇总（冗余存头部，
 * 便于列表展示与对账；明细为准）。
 *
 * 采购合同(contractType=purchase)约束供应商供纱/坯布，销售合同约束客户买坯布。
 */
@Entity('contracts')
@Index('idx_ct_company', ['companyId'])
@Index('idx_ct_no_company', ['contractNo', 'companyId'], { unique: true })
@Index('idx_ct_partner', ['companyId', 'partnerId'])
export class ContractEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'char', length: 36 })
  tenantId!: string

  @Column({ type: 'char', length: 36 })
  companyId!: string

  /** 合同号，规则：HT+日期+流水 */
  @Column({ type: 'varchar', length: 32 })
  contractNo!: string

  /** 采购合同 / 销售合同 */
  @Column({ type: 'enum', enum: ['purchase', 'sales'] })
  contractType: 'purchase' | 'sales'

  /** 往来单位：采购=供应商，销售=客户 */
  @Column({ type: 'char', length: 36 })
  partnerId!: string

  /** 往来单位名称快照 */
  @Column({ type: 'varchar', length: 128 })
  partnerName!: string

  @Column({ type: 'enum', enum: ['draft', 'active', 'completed', 'cancelled'], default: 'draft' })
  status!: ContractStatus

  /** 协议总数量（米），= 明细数量合计 */
  @Column({ type: 'decimal', precision: 16, scale: 3, default: 0 })
  totalQuantityM!: string

  /** 协议总金额（元），= 明细金额合计 */
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  totalAmount!: string

  @Column({ type: 'date', nullable: true })
  startDate!: string | null

  @Column({ type: 'date', nullable: true })
  endDate!: string | null

  @Column({ type: 'varchar', length: 255, nullable: true })
  remark!: string | null

  @VersionColumn()
  version!: number

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
