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
 * 采购 / 销售订单（trade order）
 *
 * 采购与销售共用一张表，用 orderType 区分——与 inventory_documents 同样的
 * 「一表两用」风格。订单是「意向/计划」层，inventory_documents 是「实际收发」层：
 *   - 采购订单  orderType=purchase  → 对应实际「采购入库」单
 *   - 销售订单  orderType=sales     → 对应实际「销售出库」单
 *
 * 关键设计：订单也走「一件事三算」——只按本环节自然单位录入（采购按重量、
 * 销售按面积），系统用规格快照折算出米/kg/m² 三个视图并存下，与单据一致。
 * 另存 partnerName / specSnapshot 名称与规格快照，改名改规格都不影响历史订单。
 *
 * 单行订单（一个订单一条明细），与现有单据一致；多明细后续拆 items 表。
 */
export type TradeOrderType = 'purchase' | 'sales'
export type TradeOrderStatus = 'draft' | 'confirmed' | 'completed' | 'cancelled'

@Entity('trade_orders')
@Index('idx_orders_company', ['companyId'])
@Index('idx_orders_type', ['companyId', 'orderType'])
@Index('idx_orders_no_company', ['orderNo', 'companyId'], { unique: true })
@Index('idx_orders_partner', ['companyId', 'partnerId'])
@Index('idx_orders_status', ['companyId', 'status'])
export class TradeOrderEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'char', length: 36 })
  tenantId!: string

  @Column({ type: 'char', length: 36 })
  companyId!: string

  /** 订单号，规则：类型前缀(PO/SO) + 8 位日期 + 4 位流水 */
  @Column({ type: 'varchar', length: 32 })
  orderNo!: string

  @Column({ type: 'enum', enum: ['purchase', 'sales'] })
  orderType!: TradeOrderType

  /** 往来单位：采购=供应商，销售=客户 */
  @Column({ type: 'char', length: 36 })
  partnerId!: string

  /** 往来单位名称快照，改名不影响历史订单 */
  @Column({ type: 'varchar', length: 128 })
  partnerName!: string

  @Column({ type: 'char', length: 36 })
  materialId!: string

  @Column({ type: 'char', length: 36 })
  specId!: string

  /** 规格快照，锁死三视图折算依据 */
  @Column({ type: 'json' })
  specSnapshot!: SpecCalculationSnapshot

  /** 录入单位（采购多按 kg，销售多按 m2） */
  @Column({ type: 'varchar', length: 8 })
  orderedUnit!: string

  /** 录入数量（按 orderedUnit） */
  @Column({ type: 'decimal', precision: 14, scale: 4 })
  orderedValue!: string

  /** 折算主单位数量（米） */
  @Column({ type: 'decimal', precision: 14, scale: 3 })
  quantityM!: string

  /** 折算重量 kg */
  @Column({ type: 'decimal', precision: 14, scale: 3 })
  weightKg!: string

  /** 折算面积 m² */
  @Column({ type: 'decimal', precision: 14, scale: 4 })
  areaM2!: string

  /** 单价（元/米），与单据一致口径 */
  @Column({ type: 'decimal', precision: 14, scale: 4, nullable: true })
  unitPrice!: string | null

  /** 金额（元） */
  @Column({ type: 'decimal', precision: 16, scale: 2, nullable: true })
  totalAmount!: string | null

  @Column({ type: 'enum', enum: ['draft', 'confirmed', 'completed', 'cancelled'], default: 'draft' })
  status!: TradeOrderStatus

  /** 交期 */
  @Column({ type: 'date', nullable: true })
  expectedDate!: string | null

  @Column({ type: 'varchar', length: 255, nullable: true })
  remark!: string | null

  /** 乐观锁：防并发编辑互相覆盖 */
  @VersionColumn()
  version!: number

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
