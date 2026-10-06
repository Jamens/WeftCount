// 回归冒烟一键运行：**独立测试库 + 独立端口**，绝不碰开发库。
//
// 为什么要隔离：历史上冒烟直连开发库 weft_count，把几百条测试单据/订单/测试规格/
// 测试机台全写进了开发数据，导致真实界面被测试垃圾淹没（用户截图「找不到入口」）。
// 现在每次跑冒烟都重置 weft_count_test 并只对它操作，开发库保持干净。
//
// 用法：pnpm test:smoke
//   SMOKE_DB=weft_count_test   测试库名（默认）
//   SMOKE_PORT=3199            测试后端端口（默认，避开开发 3180）
//   SMOKE_KEEP_DB=1            跑完不重置（调试用，下次跑仍会重置）
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')
const PORT = process.env.SMOKE_PORT ?? '3199'
const BASE = process.env.SMOKE_BASE ?? `http://127.0.0.1:${PORT}`
const TEST_DB = process.env.SMOKE_DB ?? 'weft_count_test'

async function isUp() {
  try {
    const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2000) })
    return r.ok
  } catch {
    return false
  }
}

async function waitUp(timeoutMs = 30000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (await isUp()) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

/** 重置测试库（drop→create→migrate→seed），保证每次跑都是干净起点、结果可复现 */
function resetTestDb() {
  return new Promise((resolve, reject) => {
    const r = spawn(process.execPath, [join(ROOT, 'reset-db.mjs'), TEST_DB], {
      cwd: ROOT,
      env: { ...process.env },
      stdio: 'inherit',
    })
    r.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`重置测试库 ${TEST_DB} 失败`))))
  })
}

async function main() {
  // 端口被别的进程占了（大概率是开发后端）——冒烟必须用自己的端口，否则会误测开发库
  if (await isUp() && !process.env.SMOKE_BASE) {
    console.error(`[smoke] 端口 ${PORT} 已被占用且未指定 SMOKE_BASE。请换个 SMOKE_PORT 端口。`)
    process.exit(1)
  }

  console.log(`[smoke] 重置测试库 ${TEST_DB} …`)
  await resetTestDb()

  const distMain = join(ROOT, 'apps', 'server', 'dist', 'main.js')
  if (!existsSync(distMain)) {
    console.error('[smoke] 未找到后端构建产物，请先执行 pnpm build:server')
    process.exit(1)
  }
  console.log('[smoke] 启动测试后端…')
  // 关键：DB_NAME 指向测试库，开发库 weft_count 完全不受影响
  const child = spawn(process.execPath, [distMain], {
    cwd: join(ROOT, 'apps', 'server'),
    env: { ...process.env, PORT, DB_NAME: TEST_DB },
    stdio: 'ignore',
  })
  if (!(await waitUp())) {
    console.error('[smoke] 测试后端启动超时')
    child.kill()
    process.exit(1)
  }
  console.log('[smoke] 测试后端就绪')

  const testFiles = ['01-auth', '02-inventory', '03-order-contract', '04-ai', '05-alert', '06-import-export']
    .map((n) => join(__dirname, `${n}.test.mjs`))
  // --test-concurrency=1：测试文件串行。node --test 默认并行跑文件，而这些用例共享同一个
  // 测试数据库、都会创建单据，并行会撞 nextDocNo 的单号（唯一键冲突）。串行也符合冒烟的真实语义。
  const runner = spawn(process.execPath, ['--test', '--test-concurrency=1', ...testFiles], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, SMOKE_BASE: BASE },
  })

  runner.on('exit', (code) => {
    child.kill()
    console.log(code === 0 ? '\n[smoke] 全部通过 ✅（开发库未被触碰）' : '\n[smoke] 存在失败 ❌')
    process.exit(code ?? 1)
  })
}

main()
