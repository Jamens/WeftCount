import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm'
import type { SpecCalculationSnapshot } from '@weftcount/shared'

/**
 * 生产工单状态机
 *   draft      草稿（可编辑/指派机台）
 *   scheduled  已排产（指派了机台与计划，开始前可改）
 *   in_progress 生产中（已开工，可报工）
 *   completed  已完成（累计产出≥计划量自动转，或手动完成）
 *   cancelled  已取消
 */
export type ProductionOrderStatus = 'draft' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled'

/**
 * 生产工单（织造任务）
 *
 * 「一批纱织成多少米某规格坯布」的生产任务。计划量以主单位「米」计量，
 * 另存规格快照锁死折算依据。指派到机台后，挡车工报工累计实际产出，
 * 满额自动完成。
 */
@Entity('production_orders')
@Index('idx_prod_company', ['companyId'])
@Index('idx_prod_no_company', ['orderNo', 'companyId'], { unique: true })
@Index('idx_prod_machine', ['companyId', 'machineId'])
@Index('idx_prod_status', ['companyId', 'status'])
export class ProductionOrderEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'char', length: 36 })
  tenantId!: string

  @Column({ type: 'char', length: 36 })
  companyId!: string

  /** 工单号，规则：SC + 8 位日期 + 4 位流水 */
  @Column({ type: 'varchar', length: 32 })
  orderNo!: string

  /** 产出物料（坯布） */
  @Column({ type: 'char', length: 36 })
  materialId!: string

  @Column({ type: 'char', length: 36 })
  specId!: string

  /** 规格快照，锁死折算依据 */
  @Column({ type: 'json' })
  specSnapshot!: SpecCalculationSnapshot

  /** 计划产量（米，主单位） */
  @Column({ type: 'decimal', precision: 14, scale: 3 })
  plannedQuantityM!: string

  /** 累计实际产出（米），由报工累计 */
  @Column({ type: 'decimal', precision: 14, scale: 3, default: 0 })
  producedQuantityM!: string

  /** 指派机台，可空（未排产） */
  @Column({ type: 'char', length: 36, nullable: true })
  machineId!: string | null

  @Column({ type: 'enum', enum: ['draft', 'scheduled', 'in_progress', 'completed', 'cancelled'], default: 'draft' })
  status!: ProductionOrderStatus

  @Column({ type: 'date', nullable: true })
  plannedStartDate!: string | null

  /** 交期 */
  @Column({ type: 'date', nullable: true })
  dueDate!: string | null

  @Column({ type: 'varchar', length: 255, nullable: true })
  remark!: string | null

  @VersionColumn()
  version!: number

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
