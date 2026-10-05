import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm'
import type { AuditActionType } from '@weftcount/shared'

/**
 * 审计日志
 *
 * 只增不改不删：任何对审计记录的修改本身就是审计对象。
 * 按租户 + 公司 + 时间建索引，支持「某段时间谁做了什么」与「某个对象的变更史」两类查询。
 */
@Entity('audit_logs')
@Index('idx_audit_logs_tenant_company', ['tenantId', 'companyId', 'createdAt'])
@Index('idx_audit_logs_target', ['tenantId', 'targetType', 'targetId'])
@Index('idx_audit_logs_user', ['tenantId', 'userId', 'createdAt'])
export class AuditLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'char', length: 36 })
  tenantId!: string

  @Column({ type: 'char', length: 36 })
  companyId!: string

  @Column({ type: 'char', length: 36 })
  userId!: string

  @Column({ type: 'varchar', length: 64 })
  username!: string

  @Column({ type: 'varchar', length: 64 })
  realName!: string

  @Column({ type: 'varchar', length: 16 })
  action!: AuditActionType

  /** 业务模块，如 purchase.order */
  @Column({ type: 'varchar', length: 64 })
  module!: string

  @Column({ type: 'varchar', length: 128, nullable: true })
  summary!: string | null

  /** 操作对象类型，如 MaterialEntity */
  @Column({ type: 'varchar', length: 64, nullable: true })
  targetType!: string | null

  /** 操作对象 ID */
  @Column({ type: 'varchar', length: 64, nullable: true })
  targetId!: string | null

  /** HTTP 方法 */
  @Column({ type: 'varchar', length: 8 })
  httpMethod!: string

  /** 请求路径 */
  @Column({ type: 'varchar', length: 255 })
  path!: string

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip!: string | null

  @Column({ type: 'varchar', length: 255, nullable: true })
  userAgent!: string | null

  /** 变更前后快照（已脱敏），仅记录发生变化的字段 */
  @Column({ type: 'json', nullable: true })
  diff!: Record<string, { before: unknown; after: unknown }> | null

  /** 执行耗时，毫秒 */
  @Column({ type: 'int', nullable: true })
  durationMs!: number | null

  @CreateDateColumn()
  createdAt!: Date
}
