import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'
import type { GreigeGrade, GradePriceMode } from '@weftcount/shared'

export type GradePriceScope = 'contract_item' | 'spec'

/**
 * 分等价目（品等 → 价格规则）
 *
 * ## 这一张表是「分等」真正产生价值的地方
 * 只建质检模块、把等级写在匹上，然后……销售出库时照样按合同价走，
 * 那等级就只是个标签，等级价差 5~15% 一分钱都收不回来。
 * **定等必须与计价联动，否则整套检验体系的投入全是沉没成本。**
 *
 * ## 两种挂载范围
 * - `contract_item`：某个合同明细下的分等协议价（最常见——大客户按等论价）
 * - `spec`：按坯布规格的挂牌分等价（没签合同的散单走这条）
 *
 * 取价优先级：**合同明细 > 规格挂牌 > 不分等（原价）**。
 * 有合同按合同走，不因为存在挂牌价就覆盖协议价。
 *
 * ## 三种调价方式（与 shared/grade.ts 的 `calcGradePrice` 一一对应）
 * - `fixed`    直接定价（元/米）——客户指定「二等品一律 11.2」
 * - `discount` 折扣率（0.92 = 92 折）——「二等品九二折」最好谈
 * - `delta`    每米加减（元）——「一等品加 0.8」，可为负
 */
@Entity('grade_prices')
@Index('idx_grade_prices_ref', ['companyId', 'scope', 'refId'])
@Index('idx_grade_prices_uniq', ['scope', 'refId', 'grade'], { unique: true })
export class GradePriceEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'char', length: 36 })
  tenantId!: string

  @Column({ type: 'char', length: 36 })
  companyId!: string

  /** 挂载范围 */
  @Column({ type: 'enum', enum: ['contract_item', 'spec'] })
  scope!: GradePriceScope

  /** contract_item.id 或 greige_spec.id */
  @Column({ type: 'char', length: 36 })
  refId!: string

  @Column({ type: 'enum', enum: ['A', 'B', 'C', 'D'] })
  grade!: GreigeGrade

  @Column({ type: 'enum', enum: ['fixed', 'discount', 'delta'] })
  mode!: GradePriceMode

  /**
   * - `fixed`：单价（元/米）
   * - `discount`：折扣率（0.92 = 92 折）
   * - `delta`：每米加减金额（元），可为负
   */
  @Column({ type: 'decimal', precision: 14, scale: 4 })
  value!: string

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
