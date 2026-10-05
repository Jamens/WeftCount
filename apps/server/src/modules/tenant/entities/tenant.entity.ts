import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'
import type { SubscriptionPlan, TenantStatus } from '@weftcount/shared'

/**
 * 租户（订阅主体，通常对应一个集团）
 * 公司级工艺系数可覆盖此处的租户默认值
 */
@Entity('tenants')
export class TenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 32 })
  code!: string

  @Column({ type: 'varchar', length: 128 })
  name!: string

  @Column({ type: 'enum', enum: ['basic', 'professional', 'flagship'], default: 'basic' })
  plan!: SubscriptionPlan

  @Column({ type: 'enum', enum: ['active', 'suspended', 'expired'], default: 'active' })
  status!: TenantStatus

  /** 可开公司数配额，-1 表示不限 */
  @Column({ type: 'int', default: 1 })
  maxCompanies!: number

  /** 可注册用户数配额，-1 表示不限 */
  @Column({ type: 'int', default: 5 })
  maxUsers!: number

  /** 租户级工艺系数（JSON），可被公司级覆盖 */
  @Column({ type: 'json', nullable: true })
  defaultCoefficients!: Record<string, unknown> | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
