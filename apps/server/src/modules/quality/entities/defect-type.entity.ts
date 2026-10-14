import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'

export type DefectPenaltyMode = 'by_length' | 'fixed'
export type DefectCategory = 'warp' | 'weft' | 'stain' | 'broken' | 'other'

export const DEFECT_CATEGORY_LABELS: Record<DefectCategory, string> = {
  warp: '经向',
  weft: '纬向',
  stain: '污渍',
  broken: '破损',
  other: '其他',
}

/**
 * 疵点类型（公司级主数据）
 *
 * 验布时检验员选的是「这是什么疵点」，扣分由**类型规则**算，不由人填——
 * 同一段 8 英寸的疵点，选「断纬」扣 3 分，选「破洞」扣 4 分，
 * 选错了类型结果就不同，所以这张表是扣分口径的源头。
 *
 * ## 两种计分方式
 * - `by_length`：按疵点长度四档扣分（四分制主体，见 shared/grade.ts）
 * - `fixed`：不看长度，固定扣分（破洞一律 4 分；某些客户对油污零容忍也走这条）
 *
 * ## 为什么是公司级而不是系统级
 * 疵点名称各地叫法不同（「百脚」有的厂叫「跳花」），强行统一成一张系统字典
 * 会让检验员找不到自己习惯的词，最后随便选一个——**字典不对，数据就全废**。
 * 所以种子只给一套行业通用初值，各公司可自行增删改。
 */
@Entity('defect_types')
@Index('idx_defect_types_code', ['companyId', 'code'], { unique: true })
export class DefectTypeEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'char', length: 36 })
  tenantId!: string

  @Column({ type: 'char', length: 36 })
  companyId!: string

  /** 疵点代码（公司内唯一） */
  @Column({ type: 'varchar', length: 32 })
  code!: string

  /** 疵点名称（检验员看到的名字） */
  @Column({ type: 'varchar', length: 64 })
  name!: string

  @Column({ type: 'enum', enum: ['warp', 'weft', 'stain', 'broken', 'other'], default: 'other' })
  category!: DefectCategory

  /** 计分方式 */
  @Column({ type: 'enum', enum: ['by_length', 'fixed'], default: 'by_length' })
  penaltyMode!: DefectPenaltyMode

  /**
   * 固定扣分（仅 `penaltyMode = 'fixed'` 时生效）
   *
   * 存储时**不夹到 4**：上限由 shared 的 `MAX_POINTS_PER_DEFECT` 单点控制，
   * 数据库里只存业务意图，不复制规则。
   */
  @Column({ type: 'int', default: 4 })
  fixedPenalty!: number

  /** 排序（检验台界面按此排，常用的排前面） */
  @Column({ type: 'int', default: 0 })
  sortOrder!: number

  @Column({ type: 'boolean', default: true })
  enabled!: boolean

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
