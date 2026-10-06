import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm'

/**
 * 挡车工报工记录
 *
 * 一次报工 = 某机台在某天/某班次为某工单产出多少米、可选停机原因。
 * outputM 累加到工单的 producedQuantityM，满额自动完成工单。
 * 单据不可编辑/删除（与库存单据一致），产出只增不减。
 */
@Entity('production_reports')
@Index('idx_reports_order', ['companyId', 'orderId'])
@Index('idx_reports_machine_date', ['companyId', 'machineId', 'reportDate'])
export class ProductionReportEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'char', length: 36 })
  tenantId!: string

  @Column({ type: 'char', length: 36 })
  companyId!: string

  /** 所属生产工单 */
  /**
   * 客户端幂等键（可空=不启用幂等）
   *
   * 报工是车间高频写操作，网络抖动重试/双击会**重复计量**导致产量虚高、件卡翻倍。
   * 客户端为一次报工生成唯一值，重试时**复用同一个**；服务端据此去重。
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  clientRequestId!: string | null

  @Column({ type: 'char', length: 36 })
  orderId!: string

  /** 报工机台 */
  @Column({ type: 'char', length: 36 })
  machineId!: string

  /** 报工日期 YYYY-MM-DD */
  @Column({ type: 'date' })
  reportDate!: string

  /** 实际产出（米） */
  @Column({ type: 'decimal', precision: 14, scale: 3 })
  outputM!: string

  /** 停机分钟（可选） */
  @Column({ type: 'int', nullable: true })
  stoppageMinutes!: number | null

  /** 停机/备注原因（可选） */
  @Column({ type: 'varchar', length: 255, nullable: true })
  stopReason!: string | null

  /** 报工人（操作员） */
  @Column({ type: 'char', length: 36 })
  operatorId!: string

  @CreateDateColumn()
  createdAt!: Date
}
