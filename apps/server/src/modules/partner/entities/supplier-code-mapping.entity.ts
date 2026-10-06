import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'

/**
 * 供应商条码映射
 *
 * 到货时商品上带的是**供应商自己的条码**，系统不认识。把「供应商条码」映射到
 * 我方「物料+规格」，收货时扫供应商条码即可查映射识别是什么、来自哪个供应商，
 * 自动带出建批次所需信息（扫码入库）。
 *
 * 唯一约束 (companyId, supplierId, supplierCode)：同一供应商内条码唯一；不同供应商
 * 可有相同条码——所以扫码解析时按「已选供应商 + 条码」精确匹配(见 lookup)。
 */
@Entity('supplier_code_mappings')
@Index('idx_scm_company', ['companyId'])
@Index('idx_scm_code', ['companyId', 'supplierCode'])
@Index('idx_scm_unique', ['companyId', 'supplierId', 'supplierCode'], { unique: true })
export class SupplierCodeMappingEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'char', length: 36 })
  tenantId!: string

  @Column({ type: 'char', length: 36 })
  companyId!: string

  /** 供应商（映射的归属方） */
  @Column({ type: 'char', length: 36 })
  supplierId!: string

  /** 供应商的条码（收货时扫到的码） */
  @Column({ type: 'varchar', length: 128 })
  supplierCode!: string

  /** 映射到的我方物料 */
  @Column({ type: 'char', length: 36 })
  materialId!: string

  /** 映射到的我方规格 */
  @Column({ type: 'char', length: 36 })
  specId!: string

  @Column({ type: 'varchar', length: 255, nullable: true })
  remark!: string | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
