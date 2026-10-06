import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'
import type { SpecCalculationSnapshot } from '@weftcount/shared'

/**
 * 库存单据（采购入库 / 生产领用 / 销售出库）
 *
 * 三种单据共用一张表，用 docType 区分。这是「一件事三算」的三个入口：
 *   - purchase_inbound  采购入库：按【重量】录入（公斤）
 *   - production_issue  生产领用：按【长度】录入（米）
 *   - sales_outbound   销售出库：按【面积】录入（平方米）
 *
 * 关键：用户只按本环节的「自然单位」录入，系统用规格快照折算到主单位（米），
 * 并同时存下重量与面积两个视图。三算的差异不在录入习惯，而在行业现实——
 * 纱线按公斤计价、织机产出米数、客户按平方米验货。系统负责让三本账对得上。
 *
 * 单据内联单行明细（一个单据一条明细），简化闭环演示；
 * 如需一单多明细，后续拆 inventory_document_items 即可，不影响现有对账逻辑。
 */
export type InventoryDocType = 'purchase_inbound' | 'production_issue' | 'sales_outbound'

@Entity('inventory_documents')
@Index('idx_docs_company', ['companyId'])
@Index('idx_docs_type', ['companyId', 'docType'])
@Index('idx_docs_no_company', ['docNo', 'companyId'], { unique: true })
@Index('idx_docs_spec', ['companyId', 'specId'])
@Index('idx_docs_partner', ['companyId', 'partnerId'])
@Index('idx_docs_order', ['companyId', 'orderId'])
export class InventoryDocumentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'char', length: 36 })
  tenantId!: string

  @Column({ type: 'char', length: 36 })
  companyId!: string

  /** 单据号，规则：类型前缀 + 8 位日期 + 4 位流水 */
  @Column({ type: 'varchar', length: 32 })
  docNo!: string

  @Column({ type: 'enum', enum: ['purchase_inbound', 'production_issue', 'sales_outbound'] })
  docType!: InventoryDocType

  @Column({ type: 'char', length: 36 })
  materialId!: string

  @Column({ type: 'char', length: 36 })
  specId!: string

  /** 成品门幅 cm */
  @Column({ type: 'decimal', precision: 8, scale: 2 })
  widthCm!: string

  /** 规格快照，锁死折算依据 */
  @Column({ type: 'json' })
  specSnapshot!: SpecCalculationSnapshot

  /** 用户录入单位（kg / m / m2） */
  @Column({ type: 'varchar', length: 8 })
  enteredUnit!: string

  /** 用户录入数量（按 enteredUnit） */
  @Column({ type: 'decimal', precision: 14, scale: 4 })
  enteredValue!: string

  /** 折算后主单位数量（米） */
  @Column({ type: 'decimal', precision: 14, scale: 3 })
  quantityM!: string

  /** 折算重量 kg */
  @Column({ type: 'decimal', precision: 14, scale: 3 })
  weightKg!: string

  /** 折算面积 m² */
  @Column({ type: 'decimal', precision: 14, scale: 4 })
  areaM2!: string

  /** 单价（元/米），销售/采购用 */
  @Column({ type: 'decimal', precision: 14, scale: 4, nullable: true })
  unitPrice!: string | null

  /** 金额（元） */
  @Column({ type: 'decimal', precision: 16, scale: 2, nullable: true })
  totalAmount!: string | null

  /**
   * 往来单位（供应商 / 客户），关联 partners.id。
   * 采购入库=供应商，销售出库=客户，生产领用为内部转移不适用（null）。
   * 停用/删除 partner 不会影响已开单据——这里只存 id + 名称快照。
   */
  @Column({ type: 'char', length: 36, nullable: true })
  partnerId!: string | null

  /** 往来单位名称快照，锁死开单时的抬头（partner 改名不影响历史单据） */
  @Column({ type: 'varchar', length: 128, nullable: true })
  partnerName!: string | null

  /**
   * 关联的订单 id（trade_orders.id），可空。
   * 采购入库/销售出库可挂到「已确认」订单上，累加履约量；满额订单自动转已完成。
   * 生产领用为内部转移，不挂订单。
   */
  @Column({ type: 'char', length: 36, nullable: true })
  orderId!: string | null

  /**
   * 履约的订单明细行 id（trade_order_items.id），可空。
   * 多明细订单下单据须指明履约哪一行，用于**按行**计算到货/发货进度；
   * 未指定时服务端按规格自动归到首个未满行。生产领用不挂订单故为空。
   */
  @Column({ type: 'char', length: 36, nullable: true })
  orderItemId!: string | null

  /** 经办人 */
  @Column({ type: 'char', length: 36 })
  operatorId!: string

  @Column({ type: 'varchar', length: 255, nullable: true })
  remark!: string | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
