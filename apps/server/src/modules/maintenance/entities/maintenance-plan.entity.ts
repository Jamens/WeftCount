import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'

/** 保养类型：巡检 / 润滑 / 维修 / 大修 */
export type MaintenancePlanType = 'inspect' | 'lubricate' | 'repair' | 'overhaul'
/** 循环依据：按天 / 按运转小时 */
export type MaintenanceCycleType = 'day' | 'run_hour'
/** 计划状态：启用 / 暂停 */
export type MaintenancePlanStatus = 'active' | 'paused'

/**
 * 设备保养计划
 *
 * 每台机台的周期性保养任务。按 `cycle_type` + `cycle_value` 推算 `next_due_date`：
 * 执行后回写 `last_done_date` 并顺延 `next_due_date`（= last_done_date + cycle_value）。
 * 维护是生产动作，权限复用 `production.view`（读）/ `production.order.edit`（写）。
 */
@Entity('maintenance_plans')
@Index('idx_plans_company', ['companyId'])
@Index('idx_plans_machine', ['companyId', 'machineId'])
@Index('idx_plans_due', ['companyId', 'nextDueDate'])
export class MaintenancePlanEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'char', length: 36 })
  tenantId!: string

  @Column({ type: 'char', length: 36 })
  companyId!: string

  /** 计划编码，规则 WB + 日期 + 4 位流水（公司内唯一） */
  @Column({ type: 'varchar', length: 32 })
  planNo!: string

  @Column({ type: 'char', length: 36 })
  machineId!: string

  @Column({ type: 'varchar', length: 128 })
  planName!: string

  @Column({ type: 'enum', enum: ['inspect', 'lubricate', 'repair', 'overhaul'], default: 'inspect' })
  type!: MaintenancePlanType

  @Column({ type: 'enum', enum: ['day', 'run_hour'], default: 'day' })
  cycleType!: MaintenanceCycleType

  /** 循环值：cycle_type=day 为天数，=run_hour 为运转小时 */
  @Column({ type: 'int', default: 1 })
  cycleValue!: number

  /** 上次执行日（YYYY-MM-DD） */
  @Column({ type: 'date', nullable: true })
  lastDoneDate!: string | null

  /** 下次到期日（YYYY-MM-DD），由 last_done_date + cycle_value 推算 */
  @Column({ type: 'date', nullable: true })
  nextDueDate!: string | null

  @Column({ type: 'varchar', length: 64, nullable: true })
  responsible!: string | null

  @Column({ type: 'enum', enum: ['active', 'paused'], default: 'active' })
  status!: MaintenancePlanStatus

  @Column({ type: 'varchar', length: 255, nullable: true })
  remark!: string | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
