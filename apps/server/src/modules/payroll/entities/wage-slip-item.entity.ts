import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm'

/**
 * 工资单计件明细（按工单聚合）
 *
 * 为什么按工单聚合而不是逐条贴报工：一个周期一个人几十条报工，
 * 全贴到工资单上没人看得过来。按工单聚成一行（产出/次数/金额），
 * 工人认得（哪张单织了多少米）、老板也认。
 * 要逐条追溯：拿 (order_id + 周期) 反查 production_reports 即可。
 */
@Entity('wage_slip_items')
@Index('idx_slip_items_slip', ['slipId'])
@Index('idx_slip_items_company', ['companyId'])
export class WageSlipItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'char', length: 36 })
  tenantId!: string

  @Column({ type: 'char', length: 36 })
  companyId!: string

  @Column({ type: 'char', length: 36 })
  slipId!: string

  /** 关联生产工单 */
  @Column({ type: 'char', length: 36 })
  orderId!: string

  /** 工单号快照 */
  @Column({ type: 'varchar', length: 32 })
  orderNo!: string

  /** 机台 id 快照（冗余，工资单不依赖生产库查询） */
  @Column({ type: 'char', length: 36 })
  machineId!: string

  /** 机台名快照 */
  @Column({ type: 'varchar', length: 128 })
  machineName!: string

  /** 该工单元产出（米） */
  @Column({ type: 'decimal', precision: 14, scale: 3, default: 0 })
  outputM!: string

  /** 报工次数 */
  @Column({ type: 'int', default: 0 })
  reportCount!: number

  /** 计件额 = outputM × 本人单价 */
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  amount!: string

  @CreateDateColumn()
  createdAt!: Date
}
