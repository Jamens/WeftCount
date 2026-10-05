import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'

/**
 * 角色
 * 内置角色按租户复制一份（tenantId 指向具体租户），
 * 租户可在内置角色基础上复制改权限，但不能删除内置角色本身。
 */
@Entity('roles')
export class RoleEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Index('idx_roles_tenant_code', ['tenantId', 'code'], { unique: true })
  @Column({ type: 'char', length: 36 })
  tenantId!: string

  @Column({ type: 'varchar', length: 32 })
  code!: string

  @Column({ type: 'varchar', length: 64 })
  name!: string

  @Column({ type: 'varchar', length: 255, nullable: true })
  description!: string | null

  /** 权限码列表，'*' 表示全权限，'*.view' 表示只读 */
  @Column({ type: 'json' })
  permissions!: string[]

  /** 内置角色不可删除 */
  @Column({ type: 'boolean', default: false })
  builtin!: boolean

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
