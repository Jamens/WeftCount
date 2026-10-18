import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'

export type ReceiptMethod = 'cash' | 'bank' | 'acceptance' | 'other'

/**
 * 收款单（核销应收）
 *
 * 一张收款单对应客户一笔进账，可一次冲抵多张未结清的销售出库单
 * （见 receipt_applications）。`amount` 是实际收到的钱，
 * 各 application 的 appliedAmount 之和必须等于 `amount`。
 */
@Entity('receipts')
@Index('idx_receipts_company', ['companyId'])
@Index('idx_receipts_partner', ['companyId', 'partnerId'])
export class ReceiptEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'char', length: 36 })
  tenantId!: string

  @Column({ type: 'char', length: 36 })
  companyId!: string

  /** 收款单号：SK + 8 位日期 + 4 位流水 */
  @Column({ type: 'varchar', length: 32 })
  receiptNo!: string

  @Column({ type: 'char', length: 36 })
  partnerId!: string

  /** 客户名称快照，partner 改名不影响历史收款单 */
  @Column({ type: 'varchar', length: 128 })
  partnerName!: string

  @Column({ type: 'date' })
  receiptDate!: Date

  @Column({ type: 'decimal', precision: 16, scale: 2 })
  amount!: string

  @Column({ type: 'enum', enum: ['cash', 'bank', 'acceptance', 'other'], default: 'bank' })
  method!: ReceiptMethod

  @Column({ type: 'varchar', length: 255, nullable: true })
  remark!: string | null

  @Column({ type: 'char', length: 36 })
  operatorId!: string

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
