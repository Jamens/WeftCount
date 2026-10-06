import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm'
import type { StockTxnTypeValue, TxnDirectionValue } from '@weftcount/shared'

/**
 * 库存事务流水
 *
 * 每一次出入库都落一条流水，方向 + 变化量 + 变化后余额三件套齐全。
 * 变化量同时记录米 / 公斤 / 平方米三视图——这正是「一件事三算」的账本形态：
 * 同一笔移动，用重量记、用长度记、用面积记，三本账必须自洽。
 */
@Entity('inventory_transactions')
@Index('idx_txn_company', ['companyId'])
@Index('idx_txn_batch', ['companyId', 'batchId'])
@Index('idx_txn_doc', ['companyId', 'docId'])
@Index('idx_txn_created', ['companyId', 'createdAt'])
export class InventoryTransactionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'char', length: 36 })
  tenantId!: string

  @Column({ type: 'char', length: 36 })
  companyId!: string

  @Column({ type: 'char', length: 36 })
  batchId!: string

  /** 物料与规格，冗余一份方便按物料统计 */
  @Column({ type: 'char', length: 36 })
  materialId!: string

  @Column({ type: 'char', length: 36 })
  specId!: string

  @Column({ type: 'enum', enum: ['in', 'out'] })
  direction!: TxnDirectionValue

  @Column({ type: 'enum', enum: ['purchase_in', 'production_in', 'material_issue', 'sales_out', 'stock_adjust', 'stock_transfer', 'count_gain', 'count_loss', 'scrap'] })
  txnType!: StockTxnTypeValue

  /** 变化量（米，主单位） */
  @Column({ type: 'decimal', precision: 14, scale: 3 })
  changeQuantity!: string

  /** 变化重量 kg */
  @Column({ type: 'decimal', precision: 14, scale: 3 })
  changeWeightKg!: string

  /** 变化面积 m² */
  @Column({ type: 'decimal', precision: 14, scale: 4 })
  changeAreaM2!: string

  /** 变化后批次剩余（米） */
  @Column({ type: 'decimal', precision: 14, scale: 3 })
  afterQuantity!: string

  /** 变化后批次剩余重量 kg */
  @Column({ type: 'decimal', precision: 14, scale: 3 })
  afterWeightKg!: string

  /** 变化后批次剩余面积 m² */
  @Column({ type: 'decimal', precision: 14, scale: 4 })
  afterAreaM2!: string

  /** 单价（元/米） */
  @Column({ type: 'decimal', precision: 14, scale: 4, nullable: true })
  unitPrice!: string | null

  /** 来源单据 id */
  @Column({ type: 'char', length: 36 })
  docId!: string

  /** 经办人 */
  @Column({ type: 'char', length: 36 })
  operatorId!: string

  @Column({ type: 'varchar', length: 255, nullable: true })
  remark!: string | null

  @CreateDateColumn()
  createdAt!: Date
}
