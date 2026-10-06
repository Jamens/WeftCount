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
 * 库存批次
 *
 * 批次以「主单位 = 米」存数量，同时冗余 kg / m² 两个视图。
 * 三视图不是独立录入，而是用规格快照一次性派生，保证自洽：
 *   重量 = 米数 × kgPerMeter
 *   面积 = 米数 × 幅宽
 *
 * 之所以冗余，是为了查询与对账时不必每次重新换算，也便于审计回溯
 * 「当时这批布按什么克重、什么幅宽记的账」。specSnapshot 锁死了换算依据。
 */
@Entity('inventory_batches')
@Index('idx_batches_company', ['companyId'])
@Index('idx_batches_material', ['companyId', 'materialId'])
@Index('idx_batches_spec', ['companyId', 'specId'])
export class InventoryBatchEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'char', length: 36 })
  tenantId!: string

  @Column({ type: 'char', length: 36 })
  companyId!: string

  /** 批次号，公司内唯一，规则：B + 8 位日期 + 4 位流水 */
  @Column({ type: 'varchar', length: 32 })
  batchNo!: string

  @Column({ type: 'char', length: 36 })
  materialId!: string

  @Column({ type: 'char', length: 36 })
  specId!: string

  /** 成品门幅 cm，换算面积用 */
  @Column({ type: 'decimal', precision: 8, scale: 2 })
  widthCm!: string

  /** 规格计算快照，写批次时锁死换算依据，日后改规格不影响历史 */
  @Column({ type: 'json' })
  specSnapshot!: SpecCalculationSnapshot

  /** 入库数量（主单位：米） */
  @Column({ type: 'decimal', precision: 14, scale: 3 })
  quantity!: string

  /** 入库重量 kg（= quantity × kgPerMeter） */
  @Column({ type: 'decimal', precision: 14, scale: 3 })
  weightKg!: string

  /** 入库面积 m²（= quantity × 幅宽米） */
  @Column({ type: 'decimal', precision: 14, scale: 4 })
  areaM2!: string

  /** 剩余数量（米） */
  @Column({ type: 'decimal', precision: 14, scale: 3 })
  remainingQuantity!: string

  /** 剩余重量 kg */
  @Column({ type: 'decimal', precision: 14, scale: 3 })
  remainingWeightKg!: string

  /** 剩余面积 m² */
  @Column({ type: 'decimal', precision: 14, scale: 4 })
  remainingAreaM2!: string

  /** 单位成本（元/米），采购入库时带入 */
  @Column({ type: 'decimal', precision: 14, scale: 4, nullable: true })
  unitCost!: string | null

  /** 入库来源单据类型 */
  @Column({
    type: 'enum',
    enum: ['purchase_inbound', 'production_in', 'stock_transfer', 'stock_adjust', 'count_gain'],
  })
  sourceType!: 'purchase_inbound' | 'production_in' | 'stock_transfer' | 'stock_adjust' | 'count_gain'

  /** 来源单据 id */
  @Column({ type: 'char', length: 36 })
  sourceDocId!: string

  @Column({ type: 'enum', enum: ['normal', 'frozen', 'depleted'], default: 'normal' })
  status!: 'normal' | 'frozen' | 'depleted'

  /** 入库时间，用于先进先出排序 */
  @CreateDateColumn()
  inboundAt!: Date

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
