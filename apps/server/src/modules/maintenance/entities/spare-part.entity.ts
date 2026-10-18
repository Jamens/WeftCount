import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'

/**
 * 备件主数据 + 库存
 *
 * 维保记录可挂多个耗用备件（`maintenance_spare_parts`），耗用即出库（减 `stock`）。
 * `min_stock` 低于即触发低库存预警。`part_code` 公司内唯一（用户录入，非自动生成）。
 */
@Entity('spare_parts')
@Index('idx_parts_company', ['companyId'])
export class SparePartEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'char', length: 36 })
  tenantId!: string

  @Column({ type: 'char', length: 36 })
  companyId!: string

  /** 备件编码，公司内唯一（用户录入） */
  @Column({ type: 'varchar', length: 32 })
  partCode!: string

  @Column({ type: 'varchar', length: 128 })
  name!: string

  @Column({ type: 'varchar', length: 128, nullable: true })
  spec!: string | null

  @Column({ type: 'varchar', length: 16, default: '个' })
  unit!: string

  /** 当前库存，decimal 字符串 */
  @Column({ type: 'decimal', precision: 12, scale: 2, default: '0.00' })
  stock!: string

  /** 安全库存，低于即预警，decimal 字符串 */
  @Column({ type: 'decimal', precision: 12, scale: 2, default: '0.00' })
  minStock!: string

  @Column({ type: 'varchar', length: 64, nullable: true })
  location!: string | null

  @Column({ type: 'varchar', length: 255, nullable: true })
  remark!: string | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
