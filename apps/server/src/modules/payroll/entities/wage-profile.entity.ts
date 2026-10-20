import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'

/**
 * 计件工资档案
 *
 * 按「系统用户」建档而不是自建员工表：报工记录里 `operatorId` 就是登录账号 id，
 * 工资聚合天然对着 users 走。再建一张员工表要把姓名/在职状态抄两遍，
 * 用户改名或离职后两处必然漂移——档案里冗余 real_name 只为历史单可追溯。
 */
@Entity('wage_profiles')
@Index('idx_profiles_user_company', ['userId', 'companyId'], { unique: true })
@Index('idx_profiles_company', ['companyId'])
export class WageProfileEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'char', length: 36 })
  tenantId!: string

  @Column({ type: 'char', length: 36 })
  companyId!: string

  /** 关联 users.id（报工人即登录账号） */
  @Column({ type: 'char', length: 36 })
  userId!: string

  /** 姓名快照（建档案时冗余，改名不影响历史工资单） */
  @Column({ type: 'varchar', length: 64 })
  realName!: string

  /** 工种，如 挡车工 / 辅助工 / 班长 */
  @Column({ type: 'varchar', length: 32, default: '挡车工' })
  jobType!: string

  /** 底薪 / 固定补贴（元/周期），无底薪填 0 */
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  baseWage!: string

  /** 计件单价（元/米） */
  @Column({ type: 'decimal', precision: 12, scale: 4, default: 0 })
  unitPrice!: string

  @Column({ type: 'varchar', length: 255, nullable: true })
  remark!: string | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
