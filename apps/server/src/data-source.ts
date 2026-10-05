import { DataSource } from 'typeorm'
import { config as loadEnv } from 'dotenv'
import { WeftNamingStrategy } from './common/naming-strategy'

loadEnv()

/**
 * TypeORM 数据源
 * 迁移命令：pnpm --filter @weftcount/server typeorm migration:run
 */
export default new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? '3306'),
  username: process.env.DB_USER ?? 'root',
  password: process.env.DB_PASSWORD ?? '1234560',
  database: process.env.DB_NAME ?? 'weft_count',
  charset: 'utf8mb4',
  namingStrategy: new WeftNamingStrategy(),
  timezone: '+08:00',
  synchronize: false,
  logging: process.env.DB_LOGGING === 'true',
  entities: ['src/modules/**/entities/*.entity.ts'],
  migrations: ['src/migrations/*.ts'],
})
