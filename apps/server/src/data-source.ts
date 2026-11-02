import { DataSource } from 'typeorm'
import { WeftNamingStrategy } from './common/naming-strategy'
import { IS_PRODUCTION, resolveDbPassword } from './config/security-env'

/**
 * TypeORM 数据源
 * 迁移命令：pnpm --filter @weftcount/server typeorm migration:run
 *
 * 注意：这里**不设数据库口令默认值**。
 * 以前写着明文兜底值，源码一公开口令就公开了；
 * 现在缺失（或生产下仍是仓库里的示例值）会直接抛错，
 * 让问题在启动那一刻暴露，而不是等到被人连库。
 */
export default new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? '3306'),
  username: process.env.DB_USER ?? 'root',
  password: resolveDbPassword(process.env.DB_PASSWORD, IS_PRODUCTION),
  database: process.env.DB_NAME ?? 'weft_count',
  charset: 'utf8mb4',
  namingStrategy: new WeftNamingStrategy(),
  timezone: '+08:00',
  synchronize: false,
  logging: process.env.DB_LOGGING === 'true',
  entities: ['src/modules/**/entities/*.entity.ts'],
  migrations: ['src/migrations/*.ts'],
})
