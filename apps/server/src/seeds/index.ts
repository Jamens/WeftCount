import 'reflect-metadata'
import dataSource from '../data-source'
import { seed } from './seed'

/**
 * 种子数据入口
 * 运行：pnpm --filter @weftcount/server seed
 */
async function main(): Promise<void> {
  const ds = await dataSource.initialize()
  try {
    const pending = await ds.showMigrations()
    if (pending) {
      console.error('存在未执行的迁移，请先运行 pnpm --filter @weftcount/server migration:run')
      process.exitCode = 1
      return
    }
    await seed(ds)
    console.log('[seed] 完成')
  } finally {
    await ds.destroy()
  }
}

main().catch((e: unknown) => {
  console.error('[seed] 失败:', e instanceof Error ? e.message : e)
  process.exitCode = 1
})
