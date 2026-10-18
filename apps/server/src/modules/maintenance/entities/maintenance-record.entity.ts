import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'

/** 维保记录类型：计划保养 / 故障停机 */
export type MaintenanceRecordType = 'planned' | 'breakdown'
/** 维保结果：正常 / 待跟进 / 失败 */
export type MaintenanceResult = 'ok' | 'pending' | 'failed'

/**
 * 设备维保执行 / 故障停机记录
 *
 * 一条记录对应一次保养或一次故障。故障带 `downtime_min`（停机时长），是 MTBF/MTTR 的口径来源。
 * 写记录在一个事务里完成：扣减备件库存 + 回写计划 `last_done_date`/`next_due_date`
 * + 回写机台 `last_maintenance_date`。金额字段为 decimal 字符串。
 */
@Entity('maintenance_records')
@Index('idx_records_company', ['companyId'])
@Index('idx_records_machine', ['companyId', 'machineId'])
@Index('idx_records_plan', ['planId'])
@Index('idx_records_date', ['companyId', 'date'])
export class MaintenanceRecordEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'char', length: 36 })
  tenantId!: string

  @Column({ type: 'char', length: 36 })
  companyId!: string

  /** 记录编码，规则 WB + 日期 + 4 位流水（公司内唯一） */
  @Column({ type: 'varchar', length: 32 })
  recordNo!: string

  @Column({ type: 'char', length: 36 })
  machineId!: string

  /** 关联的保养计划，故障停机为 NULL */
  @Column({ type: 'char', length: 36, nullable: true })
  planId!: string | null

  @Column({ type: 'enum', enum: ['planned', 'breakdown'], default: 'planned' })
  type!: MaintenanceRecordType

  /** 保养项目或故障描述 */
  @Column({ type: 'varchar', length: 128 })
  category!: string

  /** 执行日期（YYYY-MM-DD） */
  @Column({ type: 'date' })
  date!: string

  @Column({ type: 'char', length: 36, nullable: true })
  operatorId!: string | null

  /** 操作人姓名（冗余，便于历史追溯，避免删用户后丢失） */
  @Column({ type: 'varchar', length: 64, nullable: true })
  operatorName!: string | null

  /** 作业时长（分钟） */
  @Column({ type: 'int', nullable: true })
  durationMin!: number | null

  /** 停机时长（分钟），仅故障停机有意义 */
  @Column({ type: 'int', nullable: true })
  downtimeMin!: number | null

  /** 费用（元），decimal 字符串 */
  @Column({ type: 'decimal', precision: 12, scale: 2, default: '0.00' })
  cost!: string

  @Column({ type: 'enum', enum: ['ok', 'pending', 'failed'], default: 'ok' })
  result!: MaintenanceResult

  @Column({ type: 'varchar', length: 255, nullable: true })
  remark!: string | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
