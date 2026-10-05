import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'
import type { UserStatus } from '@weftcount/shared'

/**
 * 系统用户
 * 一个用户可属于多个公司（companyIds），登录后需选择当前操作公司
 */
@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Index('idx_users_tenant', ['tenantId'])
  @Column({ type: 'char', length: 36 })
  tenantId!: string

  /** 登录账号全局唯一 */
  @Index('idx_users_username', ['username'], { unique: true })
  @Column({ type: 'varchar', length: 64 })
  username!: string

  /** bcrypt 哈希，绝不存明文 */
  @Column({ type: 'varchar', length: 100 })
  passwordHash!: string

  @Column({ type: 'varchar', length: 64 })
  realName!: string

  @Column({ type: 'varchar', length: 32, nullable: true })
  phone!: string | null

  @Column({ type: 'varchar', length: 128, nullable: true })
  email!: string | null

  @Column({ type: 'enum', enum: ['active', 'disabled', 'locked'], default: 'active' })
  status!: UserStatus

  @Column({ type: 'json' })
  companyIds!: string[]

  @Column({ type: 'json' })
  roleCodes!: string[]

  @Column({ type: 'datetime', nullable: true })
  lastLoginAt!: Date | null

  @Column({ type: 'datetime', nullable: true })
  passwordChangedAt!: Date | null

  /** 连续登录失败次数，达阈值锁定 */
  @Column({ type: 'int', default: 0 })
  failedAttempts!: number

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
