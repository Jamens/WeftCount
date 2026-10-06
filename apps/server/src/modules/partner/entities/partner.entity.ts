import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'

export type PartnerType = 'supplier' | 'customer' | 'both'
export type PartnerStatus = 'active' | 'disabled'

/**
 * 往来单位（供应商 / 客户）
 * 采购与销售的前置主数据：单据的 counterparty 即指向这里。
 * 隔离维度与物料一致：tenantId + companyId。
 */
@Entity('partners')
@Index('idx_partners_company', ['companyId'])
@Index('idx_partners_code_company', ['code', 'companyId'], { unique: true })
@Index('idx_partners_tenant', ['tenantId'])
export class PartnerEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'char', length: 36 })
  tenantId!: string

  @Column({ type: 'char', length: 36 })
  companyId!: string

  @Column({ type: 'varchar', length: 32 })
  code!: string

  @Column({ type: 'varchar', length: 128 })
  name!: string

  @Column({ type: 'enum', enum: ['supplier', 'customer', 'both'], default: 'supplier' })
  type!: PartnerType

  @Column({ type: 'varchar', length: 64, nullable: true })
  contact!: string | null

  @Column({ type: 'varchar', length: 32, nullable: true })
  phone!: string | null

  @Column({ type: 'varchar', length: 32, nullable: true })
  taxNo!: string | null

  @Column({ type: 'varchar', length: 255, nullable: true })
  address!: string | null

  @Column({ type: 'varchar', length: 128, nullable: true })
  bankName!: string | null

  @Column({ type: 'varchar', length: 64, nullable: true })
  bankAccount!: string | null

  @Column({ type: 'enum', enum: ['active', 'disabled'], default: 'active' })
  status!: PartnerStatus

  @Column({ type: 'varchar', length: 255, nullable: true })
  remark!: string | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
