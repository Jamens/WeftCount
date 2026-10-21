import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'

/**
 * 机台电表抄表记录（存表底，不存用量）
 *
 * 用量是**派生量**：本期读数 − 同 (machineId, meterNo) 的上期读数，读时现算。
 * 之所以不落库一个 `consumed_kwh` 冗余列：补录/修正上期读数后历史期的差值会变，
 * 冗余列就成了脏数据，且没有任何机制会提醒它过期。
 *
 * `meterNo` 参与序列键，换表开新号即可（读数可从 0 起算）；
 * 读数回退只可能是抄错或误改表，直接拒绝，不开「回退量」的例外口子。
 */
@Entity('machine_energy_readings')
@Index('idx_energy_reading_key', ['companyId', 'machineId', 'meterNo', 'readingDate'], { unique: true })
@Index('idx_energy_machine', ['companyId', 'machineId'])
@Index('idx_energy_date', ['companyId', 'readingDate'])
export class EnergyReadingEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'char', length: 36 })
  tenantId!: string

  @Column({ type: 'char', length: 36 })
  companyId!: string

  @Column({ type: 'char', length: 36 })
  machineId!: string

  /** 电表编号；同机台可有多块表（换表开新号） */
  @Column({ type: 'varchar', length: 32 })
  meterNo!: string

  /** 抄表日期 YYYY-MM-DD */
  @Column({ type: 'date' })
  readingDate!: string

  /** 当期累计表底读数（kWh），不是用量 */
  @Column({ type: 'decimal', precision: 14, scale: 2 })
  reading!: string

  /** 当期电价（元/kWh），逐条记录，不用现价回算历史 */
  @Column({ type: 'decimal', precision: 10, scale: 4 })
  tariff!: string

  @Column({ type: 'varchar', length: 255, nullable: true })
  remark!: string | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}