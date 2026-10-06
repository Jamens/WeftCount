import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { AppModule } from '../app.module'
import dataSource from '../data-source'
import { seed } from './seed'
import { MaterialService } from '../modules/material/material.service'

/**
 * 种子数据入口
 * 运行：pnpm --filter @weftcount/server seed
 *
 * 用 Nest 应用上下文取 MaterialService——建坯布规格必须走 service 才能正确计算
 * 工艺快照(kg/100m、克重)，直接写实体的话成本/单耗/对账全算不出数。
 * createApplicationContext 只初始化 DI 容器、不监听端口。
 */
async function main(): Promise<void> {
  const ds = await dataSource.initialize()
  let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | null = null
  try {
    const pending = await ds.showMigrations()
    if (pending) {
      console.error('存在未执行的迁移，请先运行 pnpm --filter @weftcount/server migration:run')
      process.exitCode = 1
      return
    }
    app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] })
    const materialService = app.get(MaterialService)
    await seed(ds, materialService)
    console.log('[seed] 完成')
  } finally {
    if (app) await app.close()
    await ds.destroy()
  }
}

main().catch((e: unknown) => {
  console.error('[seed] 失败:', e instanceof Error ? e.message : e)
  process.exitCode = 1
})
