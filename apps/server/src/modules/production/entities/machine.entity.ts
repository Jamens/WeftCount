import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'

/** 机台状态：idle 空闲 / running 运转中 / maintenance 维修保养 / retired 已报废 */
export type MachineStatus = 'idle' | 'running' | 'maintenance' | 'retired'

/**
 * 机台（织机）主数据
 *
 * 织造厂的核心生产资源。生产工单指派到机台，挡车工在机台上报工。
 * 隔离维度与其它主数据一致：tenantId + companyId，编码公司内唯一。
 */
@Entity('machines')
@Index('idx_machines_company', ['companyId'])
@Index('idx_machines_code_company', ['code', 'companyId'], { unique: true })
export class MachineEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'char', length: 36 })
  tenantId!: string

  @Column({ type: 'char', length: 36 })
  companyId!: string

  /** 机台编码，规则 M+4 位流水 */
  @Column({ type: 'varchar', length: 32 })
  code!: string

  /** 机台名称/编号，如「3 号织机」 */
  @Column({ type: 'varchar', length: 64 })
  name!: string

  /** 型号，如 1515 多剑杆、GA615 */
  @Column({ type: 'varchar', length: 64, nullable: true })
  model!: string | null

  @Column({ type: 'enum', enum: ['idle', 'running', 'maintenance', 'retired'], default: 'idle' })
  status!: MachineStatus

  @Column({ type: 'varchar', length: 255, nullable: true })
  remark!: string | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
