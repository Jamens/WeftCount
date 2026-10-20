import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'

/**
 * 工资单（计件）
 *
 * 一个工人在一个结算周期一张。表头所有金额字段都由明细/档案在生成时算出，
 * 前端提交不了金额；确认前只有 bonus / deduction / remark 可改（draft 状态）。
 *
 * 状态推进 draft → confirmed → paid，与收款单同构：
 * - confirmed 锁明细，改数必须走重开（本版本不提供，防止「锁了还能改」的假账）
 * - paid 记 paid_at，发放是资金动作，不可回退
 */
@Entity('wage_slips')
@Index('idx_slips_no_company', ['slipNo', 'companyId'], { unique: true })
@Index('idx_slips_user_period', ['companyId', 'userId', 'periodStart', 'periodEnd'], { unique: true })
@Index('idx_slips_company', ['companyId'])
@Index('idx_slips_user', ['companyId', 'userId'])
@Index('idx_slips_period', ['companyId', 'periodStart', 'periodEnd'])
export class WageSlipEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'char', length: 36 })
  tenantId!: string

  @Column({ type: 'char', length: 36 })
  companyId!: string

  /** 工资单号 GZ + 创建日期 + 4 位序 */
  @Column({ type: 'varchar', length: 32 })
  slipNo!: string

  @Column({ type: 'char', length: 36 })
  userId!: string

  /** 姓名快照（生成时冗余，用户改名不影响历史单） */
  @Column({ type: 'varchar', length: 64 })
  realName!: string

  /** 结算周期起 YYYY-MM-DD */
  @Column({ type: 'date' })
  periodStart!: string

  /** 结算周期止 YYYY-MM-DD */
  @Column({ type: 'date' })
  periodEnd!: string

  /** 周期产出合计（米） */
  @Column({ type: 'decimal', precision: 14, scale: 3, default: 0 })
  totalOutputM!: string

  /** 报工次数 */
  @Column({ type: 'int', default: 0 })
  reportCount!: number

  /** 停机分钟合计（参考信息，不自动扣款——扣款规则各厂不同，走 deduction 显式给） */
  @Column({ type: 'int', default: 0 })
  stoppageMin!: number

  /** 底薪快照（生成时取档案，档案后续调价不影响已生成的单） */
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  baseAmount!: string

  /** 计件额 = Σ 明细 amount（服务端累加，前端传不了） */
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  pieceAmount!: string

  /** 奖金（draft 可改） */
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  bonus!: string

  /** 扣款（draft 可改） */
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  deduction!: string

  /** 实发 = base + piece + bonus - deduction */
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  netAmount!: string

  @Column({ type: 'enum', enum: ['draft', 'confirmed', 'paid'], default: 'draft' })
  status!: WageSlipStatus

  @Column({ type: 'datetime', nullable: true })
  paidAt!: Date | null

  @Column({ type: 'varchar', length: 255, nullable: true })
  remark!: string | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}

export type WageSlipStatus = 'draft' | 'confirmed' | 'paid'
