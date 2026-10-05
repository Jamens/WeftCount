import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm'
import type { CountSystem, WeaveType } from '@weftcount/shared'

/**
 * 坯布规格
 *
 * 关键约束：calculatedGsm 由工艺内核算出，业务代码不得手填。
 * measuredGsm 是出厂实测值，用于校准内核的坯布→成品换算系数（自学习输入）。
 * 两者分开存，是为了不让人用手填值覆盖计算结果。
 *
 * specVersion 每次规格变更自增，单据存快照时记下版本号，
 * 日后规格改了，历史单据仍能还原当时算的依据。
 */
@Entity('greige_specs')
@Index('idx_greige_specs_company', ['companyId'])
@Index('idx_greige_specs_code_company', ['code', 'companyId'], { unique: true })
export class GreigeSpecEntity {
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

  /** 成品门幅 cm */
  @Column({ type: 'decimal', precision: 8, scale: 2 })
  finishedWidth!: string

  /** 经密，根/英寸 */
  @Column({ type: 'decimal', precision: 8, scale: 2 })
  warpDensity!: string

  /** 纬密，根/英寸 */
  @Column({ type: 'decimal', precision: 8, scale: 2 })
  weftDensity!: string

  @Column({
    type: 'enum',
    enum: ['plain', 'twill', 'satin', 'jacquard', 'leno', 'pile'],
    default: 'plain',
  })
  weaveType!: WeaveType

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  warpCountValue!: string

  @Column({ type: 'enum', enum: ['NeS', 'Nm', 'Tex', 'D'] })
  warpCountSystem!: CountSystem

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  weftCountValue!: string

  @Column({ type: 'enum', enum: ['NeS', 'Nm', 'Tex', 'D'] })
  weftCountSystem!: CountSystem

  @Column({ type: 'char', length: 36, nullable: true })
  warpMaterialId!: string | null

  @Column({ type: 'char', length: 36, nullable: true })
  weftMaterialId!: string | null

  /** 上机门幅 cm，null 则由成品门幅 + 加放量推算 */
  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  loomWidth!: string | null

  /** 上机加放量 cm */
  @Column({ type: 'decimal', precision: 6, scale: 2, default: 10 })
  widthAllowance!: string

  @Column({ type: 'decimal', precision: 6, scale: 4, default: 0.055 })
  warpLossRate!: string

  @Column({ type: 'decimal', precision: 6, scale: 4, default: 0.05 })
  weftLossRate!: string

  /** 织机转速（纬/分钟），null 表示未录入 */
  @Column({ type: 'int', nullable: true })
  picksPerMinute!: number | null

  @Column({ type: 'decimal', precision: 5, scale: 4, default: 0.85 })
  machineRunRate!: string

  /** 内核算出的坯布克重 g/m²（只读，业务代码不得写） */
  @Column({ type: 'decimal', precision: 8, scale: 2 })
  calculatedGsm!: string

  /** 出厂实测克重 g/m²，用于校准 */
  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  measuredGsm!: string | null

  /** 最近一次计算快照，单据落库时一并复制 */
  @Column({ type: 'json', nullable: true })
  lastSnapshot!: Record<string, unknown> | null

  @Column({ type: 'enum', enum: ['active', 'discontinued'], default: 'active' })
  status!: 'active' | 'discontinued'

  @Column({ type: 'varchar', length: 255, nullable: true })
  remark!: string | null

  @VersionColumn()
  specVersion!: number

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
