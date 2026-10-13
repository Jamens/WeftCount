#!/usr/bin/env node
/**
 * 桌面端启动器（Windows 专用）
 *
 * 直接 `pnpm dev:desktop` 在本机会连撞四个坑，每个都表现为
 * 「主进程报 `Cannot read properties of undefined (reading 'isPackaged')`」——
 * 报错指向业务代码，实际原因全在环境：
 *
 * 1. **Electron 二进制没下载**
 *    之前为省时间用了 `--ignore-scripts`，`node_modules/electron/dist/` 是空的。
 *    修法：`ELECTRON_MIRROR=<国内镜像> node node_modules/electron/install.js`
 *    国内必须走镜像——Electron 默认从 githubusercontent 下，实测完全不通。
 *
 * 2. **缺 `node_modules/electron/path.txt`**
 *    Electron 44 的 CLI 靠它定位可执行文件。缺失时 `require('electron')` 返回
 *    `undefined`，于是 `out/main/index.js` 被当普通 Node 脚本跑，栈帧全是
 *    `node:internal/modules/cjs/loader`——**Node 在跑 Electron 的入口**。
 *    修法：写入 `path.txt`（内容为 `electron.exe`）。
 *
 * 3. **`ELECTRON_RUN_AS_NODE=1` 残留在环境里**
 *    这个变量让 electron.exe 退化成纯 Node 解释器，`require('electron')` 同样
 *    拿不到 `app`。本项目构建/测试链路曾用它跑过 Electron 脚本，忘了清。
 *
 * 4. **GPU 子进程反复崩溃**
 *    `exit_code=-1073741819`（Windows 访问冲突），最终
 *    `FATAL: GPU process isn't usable. Goodbye.`——窗口直接闪退，
 *    进程列表里一个窗口都留不下。`--disable-gpu` /清缓存 /换 userData
 *    都无效，得用 `--in-process-gpu` 让 GPU 在主进程内跑。
 *
 * 用法：node scripts/start-desktop.mjs [--dev]
 *   --dev  走 electron-vite dev（带 HMR）；默认走已构建产物，更稳
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, writeFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DESKTOP = join(ROOT, 'apps', 'desktop')
const ELECTRON_DIR = join(ROOT, 'node_modules', 'electron')
const ELECTRON_EXE = join(ELECTRON_DIR, 'dist', 'electron.exe')
const MIRROR = 'https://npmmirror.com/mirrors/electron/'

/** 确保 Electron 二进制与 path.txt 就位；返回是否可直接启动 */
function ensureElectron() {
  if (!existsSync(ELECTRON_EXE)) {
    console.log('[desktop] 未找到 Electron 二进制，开始下载（约 230MB，走国内镜像）…')
    const r = spawnSync(process.execPath, [join(ELECTRON_DIR, 'install.js')], {
      cwd: ELECTRON_DIR,
      env: { ...process.env, ELECTRON_MIRROR: MIRROR },
      stdio: 'inherit',
    })
    if (r.status !== 0 || !existsSync(ELECTRON_EXE)) {
      console.error(
        '[desktop] Electron 下载失败。若是网络问题，可手动执行：\n' +
          `  cd node_modules/electron && ELECTRON_MIRROR=${MIRROR} node install.js`,
      )
      return false
    }
  }

  // path.txt 缺失 → require('electron') 返回 undefined（坑 2）
  const pathFile = join(ELECTRON_DIR, 'path.txt')
  if (!existsSync(pathFile)) {
    writeFileSync(pathFile, 'electron.exe')
    console.log('[desktop] 已补写 path.txt')
  } else if (!readFileSync(pathFile, 'utf-8').trim()) {
    writeFileSync(pathFile, 'electron.exe')
    console.log('[desktop] path.txt 为空，已重写')
  }
  return true
}

/** ELECTRON_RUN_AS_NODE 会让 electron.exe 变纯 Node（坑 3），必须剔除 */
function cleanEnv() {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

const dev = process.argv.includes('--dev')

if (!ensureElectron()) process.exit(1)

const args = []
if (!dev) {
  const main = join(DESKTOP, 'out', 'main', 'index.js')
  if (!existsSync(main)) {
    console.error('[desktop] 未找到构建产物，请先执行 pnpm run build:desktop')
    process.exit(1)
  }
  args.push(main)
}
// 坑 4：GPU 子进程在本机起不来，--in-process-gpu 让它在主进程内跑
args.push('--in-process-gpu', '--disable-gpu')

const child = spawn(ELECTRON_EXE, args, {
  cwd: DESKTOP,
  env: cleanEnv(),
  stdio: 'inherit',
})

child.on('exit', (code) => {
  console.log(`[desktop] 已退出（code=${code}）`)
  process.exit(code ?? 0)
})