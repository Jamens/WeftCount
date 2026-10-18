import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

/**
 * 维保记录耗用的备件（多对多桥表）
 *
 * 一条维保记录可耗用多个备件；写维保记录时按 `qty` 扣减 `spare_parts.stock`。
 * 金额字段为 decimal 字符串。
 */
@Entity('maintenance_spare_parts')
@Index('idx_msp_record', ['recordId'])
@Index('idx_msp_part', ['companyId', 'partId'])
export class MaintenanceSparePartEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'char', length: 36 })
  tenantId!: string

  @Column({ type: 'char', length: 36 })
  companyId!: string

  @Column({ type: 'char', length: 36 })
  recordId!: string

  @Column({ type: 'char', length: 36 })
  partId!: string

  /** 耗用数量，decimal 字符串 */
  @Column({ type: 'decimal', precision: 12, scale: 2, default: '0.00' })
  qty!: string

  /** 耗用金额（元），decimal 字符串 */
  @Column({ type: 'decimal', precision: 12, scale: 2, default: '0.00' })
  cost!: string
}
