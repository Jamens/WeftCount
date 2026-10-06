import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm'
import type { SpecCalculationSnapshot } from '@weftcount/shared'

/**
 * 订单明细行
 *
 * 一行 = 一个「物料+规格」的订购约定：录入单位+数量 → 用规格快照折出米/kg/m² 三视图，
 * 单价(元/米)×数量 = 行金额。可选引用合同行(contractItemId)以按协议价成交。
 */
@Entity('trade_order_items')
@Index('idx_oti_order', ['orderId'])
@Index('idx_oti_spec', ['companyId', 'specId'])
export class TradeOrderItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'char', length: 36 })
  tenantId!: string

  @Column({ type: 'char', length: 36 })
  companyId!: string

  /** 所属订单（订单头） */
  @Column({ type: 'char', length: 36 })
  orderId!: string

  @Column({ type: 'char', length: 36 })
  materialId!: string

  @Column({ type: 'char', length: 36 })
  specId!: string

  /** 规格快照，锁死该行三视图折算依据 */
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

  /** 单价（元/米） */
  @Column({ type: 'decimal', precision: 14, scale: 4, nullable: true })
  unitPrice!: string | null

  /** 行金额（元）= 单价 × 折算米数 */
  @Column({ type: 'decimal', precision: 18, scale: 2, nullable: true })
  lineAmount!: string | null

  /** 可选：来源合同行（按协议价成交时引用） */
  @Column({ type: 'char', length: 36, nullable: true })
  contractItemId!: string | null

  @CreateDateColumn()
  createdAt!: Date
}
