import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'
import type { CompanyStatus } from '@weftcount/shared'
import { TenantEntity } from './tenant.entity'

/**
 * 公司（工厂/实际经营主体）
 * 库存独立核算的边界，隔离维度为 tenantId + companyId
 */
@Entity('companies')
@Index('idx_companies_tenant', ['tenantId'])
export class CompanyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'char', length: 36 })
  tenantId!: string

  @ManyToOne(() => TenantEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant?: TenantEntity

  @Index('idx_companies_code_tenant', ['code', 'tenantId'], { unique: true })
  @Column({ type: 'varchar', length: 32 })
  code!: string

  @Column({ type: 'varchar', length: 128 })
  name!: string

  @Column({ type: 'varchar', length: 32, nullable: true })
  taxNo!: string | null

  @Column({ type: 'varchar', length: 255, nullable: true })
  address!: string | null

  @Column({ type: 'varchar', length: 32, nullable: true })
  phone!: string | null

  /**
   * 预警确认后的静默天数（按公司）
   *
   * 不同厂子处理节奏差别大：每天报工的厂 7 天合适，一周盘一次货的小厂 7 天太久。
   * 0 = 不静默（确认后只要条件还在就继续提醒）。
   */
  @Column({ type: 'int', default: 7 })
  alertAckSilenceDays!: number

  @Column({ type: 'enum', enum: ['active', 'closed'], default: 'active' })
  status!: CompanyStatus

  /** 公司级工艺系数，优先级高于租户默认 */
  @Column({ type: 'json', nullable: true })
  coefficients!: Record<string, unknown> | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
