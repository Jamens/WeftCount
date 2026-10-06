import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'
import type { MaterialCategoryValue, MeasureMode } from '@weftcount/shared'

/**
 * 物料主数据
 *
 * measureMode 与 primaryUnit 是「一件事三算」的落点：
 * 纱线主单位是公斤，坯布主单位是米，销售时按平方米换算。
 * 编码公司内唯一（同一集团不同工厂可各自维护自己的物料体系）
 */
@Entity('materials')
@Index('idx_materials_company', ['companyId'])
@Index('idx_materials_code_company', ['code', 'companyId'], { unique: true })
export class MaterialEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'char', length: 36 })
  tenantId!: string

  @Column({ type: 'char', length: 36 })
  companyId!: string

  @Column({ type: 'varchar', length: 32 })
  code!: string

  @Column({ type: 'varchar', length: 128 })
  name!: string

  @Column({ type: 'enum', enum: ['yarn', 'greige', 'finished', 'auxiliary', 'spare'] })
  category!: MaterialCategoryValue

  /** 规格描述，如「40S/2 精梳棉」 */
  @Column({ type: 'varchar', length: 255 })
  specification!: string

  /** 主计量方式，决定三算中该物料按哪个口径走 */
  @Column({ type: 'enum', enum: ['weight', 'length', 'area', 'count'] })
  measureMode!: MeasureMode

  /** 主单位代码（kg / m / m2 / piece） */
  @Column({ type: 'varchar', length: 16 })
  primaryUnit!: string

  /** 允许录入的单位，JSON 数组 */
  @Column({ type: 'json' })
  allowedUnits!: string[]

  /** 是否批次管理：纱线按筒/件，坯布按匹 */
  @Column({ type: 'boolean', default: true })
  batchManaged!: boolean

  /** 安全库存，null 表示不预警 */
  @Column({ type: 'decimal', precision: 14, scale: 4, nullable: true })
  safetyStock!: string | null

  /**
   * 采购提前期 / 采购周期（天）
   *
   * 补货点= 日均用量 × (提前期 + 采购周期) + 安全库存。
   * 提前期 = 下单到货的天数；采购周期 = 两次下单之间的间隔天数。
   * 缺省按 7 天处理（`leadTimeDays` 为空时用DEFAULT_LEAD_TIME_DAYS）。
   */
  @Column({ type: 'decimal', precision: 6, scale: 2, nullable: true })
  leadTimeDays!: string | null

  @Column({ type: 'enum', enum: ['active', 'discontinued'], default: 'active' })
  status!: 'active' | 'discontinued'

  @Column({ type: 'varchar', length: 255, nullable: true })
  remark!: string | null

  /** 标准单价（含税），仅参考价，实际以采购订单为准 */
  @Column({ type: 'decimal', precision: 14, scale: 4, nullable: true })
  standardPrice!: string | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
