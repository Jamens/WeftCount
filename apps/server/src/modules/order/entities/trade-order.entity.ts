import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm'

/**
 * 采购 / 销售订单（trade order）—— 订单头
 *
 * 采购与销售共用一张表，用 orderType 区分。订单是「意向/计划」层，inventory_documents 是
 * 「实际收发」层：
 *   - 采购订单 orderType=purchase → 对应「采购入库」单
 *   - 销售订单 orderType=sales    → 对应「销售出库」单
 *
 * **多明细**：一个订单含多条明细行（trade_order_items），每行一个「物料+规格+数量+单价」。
 * 订单头只冗余汇总(total_quantity_m / total_amount)，明细为准。往来单位/订单号等在头。
 * 可选关联合同(contract_id)，明细行可引用合同行取协议价。
 *
 * 三视图（米/kg/m²）与规格快照都落在**明细行**上（每行一个规格），订单头只存汇总。
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

  /** 往来单位：采购=供应商，销售=客户（订单头统一一个相对方） */
  @Column({ type: 'char', length: 36 })
  partnerId!: string

  /** 往来单位名称快照，改名不影响历史订单 */
  @Column({ type: 'varchar', length: 128 })
  partnerName!: string

  /** 汇总数量（米），= 明细 quantity_m 合计。冗余用于履约进度 */
  @Column({ type: 'decimal', precision: 16, scale: 3, default: 0 })
  totalQuantityM!: string

  /** 汇总金额（元），= 明细 line_amount 合计 */
  @Column({ type: 'decimal', precision: 18, scale: 2, nullable: true })
  totalAmount!: string | null

  /** 可选：来源合同（从合同建单时关联） */
  @Column({ type: 'char', length: 36, nullable: true })
  contractId!: string | null

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
