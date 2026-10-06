import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

export type AlertType = 'order_overdue' | 'low_stock' | 'stale_batch'
export type AlertSeverity = 'info' | 'warning' | 'critical'

/**
 * 预警中心
 *
 * 规则引擎**确定性**扫描：交期逾期 / 库存低于安全库存 / 呆滞批次。
 * 扫描按 (类型, 关联对象, 未确认) 去重——同一问题不重复生成，等确认后下次扫描才再报。
 */
@Entity('alerts')
@Index('idx_alerts_company_ack', ['companyId', 'acknowledged'])
@Index('idx_alerts_dedup', ['companyId', 'type', 'refId', 'acknowledged'])
export class AlertEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'char', length: 36 })
  tenantId!: string

  @Column({ type: 'char', length: 36 })
  companyId!: string

  @Column({ type: 'enum', enum: ['order_overdue', 'low_stock', 'stale_batch'] })
  type!: AlertType

  @Column({ type: 'enum', enum: ['info', 'warning', 'critical'] })
  severity!: AlertSeverity

  @Column({ type: 'varchar', length: 128 })
  title!: string

  @Column({ type: 'varchar', length: 500 })
  message!: string

  /** 关联对象类型：production_order / material / batch */
  @Column({ type: 'varchar', length: 32 })
  refType!: string

  @Column({ type: 'char', length: 36 })
  refId!: string

  @Column({ type: 'boolean', default: false })
  acknowledged!: boolean

  @Column({ type: 'char', length: 36, nullable: true })
  acknowledgedBy!: string | null

  @Column({ type: 'datetime', nullable: true })
  acknowledgedAt!: Date | null

  @CreateDateColumn()
  createdAt!: Date
}
