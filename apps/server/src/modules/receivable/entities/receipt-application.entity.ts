import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

/**
 * 核销明细：一笔收款冲抵某张销售出库单多少金额。
 *
 * 核销的本质是「回写出库单的 settled_amount」——这里只记凭证，
 * 真正的应收余额始终以出库单为准，单一事实源不漂移。
 * 作废收款单时按本表反向回退对应出库单的 settled_amount。
 */
@Entity('receipt_applications')
@Index('idx_app_receipt', ['receiptId'])
@Index('idx_app_doc', ['companyId', 'docId'])
export class ReceiptApplicationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'char', length: 36 })
  tenantId!: string

  @Column({ type: 'char', length: 36 })
  companyId!: string

  @Column({ type: 'char', length: 36 })
  receiptId!: string

  /** 被核销的销售出库单 inventory_documents.id */
  @Column({ type: 'char', length: 36 })
  docId!: string

  /** 本笔收款冲抵该单的金额 */
  @Column({ type: 'decimal', precision: 16, scale: 2 })
  appliedAmount!: string

  @CreateDateColumn()
  createdAt!: Date
}
