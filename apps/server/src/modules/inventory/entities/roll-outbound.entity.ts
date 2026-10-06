import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

/**
 * 件卡出库流水（一匹可多次出库 = 拆匹发货）
 *
 * 拆匹后 `rolls.outbound_doc_id` 表达不了「一匹分批发给多个客户」，故用本表记
 * 每次出库。件卡的完整去向 = 本表按 created_at 升序的全部分行。
 *
 * 与 `inventory_transactions` 的关系：流水表记**批次级**数量变动（三视图齐全），
 * 本表记**件卡级**出库明细（哪一匹发给了哪张单）。两者互补，不重复。
 */
@Entity('roll_outbounds')
@Index('idx_roll_outbounds_roll', ['companyId', 'rollId'])
@Index('idx_roll_outbounds_doc', ['companyId', 'docId'])
export class RollOutboundEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'char', length: 36 })
  tenantId!: string

  @Column({ type: 'char', length: 36 })
  companyId!: string

  /** 件卡 */
  @Column({ type: 'char', length: 36 })
  rollId!: string

  /** 出库单（发货/领用） */
  @Column({ type: 'char', length: 36 })
  docId!: string

  /** 本次出库米数（整匹发货=该匹全量；拆匹=实际发出的部分） */
  @Column({ type: 'decimal', precision: 14, scale: 3 })
  meters!: string

  @Column({ type: 'decimal', precision: 14, scale: 3, nullable: true })
  weightKg!: string | null

  @Column({ type: 'decimal', precision: 14, scale: 3, nullable: true })
  areaM2!: string | null

  @CreateDateColumn()
  createdAt!: Date
}
