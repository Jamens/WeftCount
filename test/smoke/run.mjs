// 回归冒烟一键运行：确保后端在跑 → node --test 跑全部用例 → 汇总
// 用法：pnpm test:smoke   （若后端已在跑则复用，否则自动起一个跑完停掉）
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')
const PORT = process.env.SMOKE_PORT ?? '3180'
const BASE = process.env.SMOKE_BASE ?? `http://127.0.0.1:${PORT}`

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

async function main() {
  let child = null
  if (await isUp()) {
    console.log(`[smoke] 复用已在运行的后端 ${BASE}`)
  } else {
    const distMain = join(ROOT, 'apps', 'server', 'dist', 'main.js')
    if (!existsSync(distMain)) {
      console.error('[smoke] 未找到后端构建产物，请先执行 pnpm build:server')
      process.exit(1)
    }
    console.log('[smoke] 启动后端…')
    // 在 apps/server 目录启动，保证 .env 被加载
    child = spawn(process.execPath, [distMain], {
      cwd: join(ROOT, 'apps', 'server'),
      env: { ...process.env, PORT },
      stdio: 'ignore',
    })
    if (!(await waitUp())) {
      console.error('[smoke] 后端启动超时')
      child.kill()
      process.exit(1)
    }
    console.log('[smoke] 后端就绪')
  }

  const testFiles = ['01-auth', '02-inventory', '03-order-contract', '04-ai']
    .map((n) => join(__dirname, `${n}.test.mjs`))
  // --test-concurrency=1：测试文件串行。node --test 默认并行跑文件，而这些用例共享同一个
  // 数据库、都会创建单据，并行会撞 nextDocNo 的单号（唯一键冲突）。串行也符合冒烟的真实语义。
  const runner = spawn(process.execPath, ['--test', '--test-concurrency=1', ...testFiles], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, SMOKE_BASE: BASE },
  })

  runner.on('exit', (code) => {
    if (child) child.kill()
    console.log(code === 0 ? '\n[smoke] 全部通过 ✅' : '\n[smoke] 存在失败 ❌')
    process.exit(code ?? 1)
  })
}

main()
