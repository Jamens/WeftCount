import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'

/** 仓库类型：raw 原料库 / greige 坯布库 / finished 成品库 / auxiliary 辅料库 / scrap 废料库 / other */
export type WarehouseType = 'raw' | 'greige' | 'finished' | 'auxiliary' | 'scrap' | 'other'

/**
 * 仓库主数据
 *
 * 织造厂按物料形态分仓：纱线进原料库、织出的坯布进坯布库、成品进成品库、废布进废料库。
 * 每个库存批次归属一个仓库（inventory_batches.warehouse_id），调拨即批次在仓间移动。
 * 隔离维度与其它主数据一致：tenantId + companyId，编码公司内唯一。
 */
@Entity('warehouses')
@Index('idx_warehouses_company', ['companyId'])
@Index('idx_warehouses_code_company', ['code', 'companyId'], { unique: true })
export class WarehouseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'char', length: 36 })
  tenantId!: string

  @Column({ type: 'char', length: 36 })
  companyId!: string

  /** 仓库编码，规则 W+4 位流水 */
  @Column({ type: 'varchar', length: 32 })
  code!: string

  @Column({ type: 'varchar', length: 64 })
  name!: string

  @Column({ type: 'enum', enum: ['raw', 'greige', 'finished', 'auxiliary', 'scrap', 'other'], default: 'other' })
  type!: WarehouseType

  @Column({ type: 'varchar', length: 255, nullable: true })
  address!: string | null

  /** 仓管员 */
  @Column({ type: 'varchar', length: 64, nullable: true })
  keeper!: string | null

  @Column({ type: 'enum', enum: ['active', 'disabled'], default: 'active' })
  status!: 'active' | 'disabled'

  @Column({ type: 'varchar', length: 255, nullable: true })
  remark!: string | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
