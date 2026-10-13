import { app, BrowserWindow, ipcMain, shell, protocol, net } from 'electron'
import { join, normalize, extname } from 'node:path'
import { readFile } from 'node:fs/promises'
import { electronApp, optimizer } from '@electron-toolkit/utils'

/**
 * 关掉硬件加速（软件渲染）
 *
 * 必须在 app.whenReady 之前调用，否则不生效。
 *
 * 车间一体机 / 虚拟机 / 远程桌面环境下常没有可用 GPU，
 * Electron 的 GPU 子进程会反复崩溃并最终打出
 * `FATAL: GPU process isn't usable. Goodbye.`——**整个窗口直接闪退**，
 * 进程列表里一个窗口都留不下。
 *
 * 本应用是表单 + 表格 + 条码标签的实用界面，不做视频/3D，
 * 软件渲染的帧率完全够用，**用稳定换帧率是明确划算的取舍**。
 */
app.disableHardwareAcceleration()

/** 后端地址；车间终端通常是本机部署 */
const BACKEND_ORIGIN = process.env['WEFT_BACKEND_ORIGIN'] ?? 'http://127.0.0.1:3180'

/** 渲染进程的自定义协议名 */
const APP_SCHEME = 'weft'

/**
 * 把自定义协议声明为「标准+ 支持 CORS 的特权协议」
 *
 * ## 为什么不能用 file://
 *
 * `file://` 在 Chromium 眼里是 **opaque origin（不透明来源）**，
 * 页面发起的任何跨源请求都会被 **Private Network Access 直接拦掉**——
 * 请求根本不出浏览器，控制台只有 `TypeError: Failed to fetch`，
 * 界面显示「无法连接服务器，请确认后端已启动」，**提示完全指错方向**。
 *
 * 注册成标准协议后，页面拿到 `weft://app/...` 这样一个**正常的 origin**，
 * 同源访问不再受PNA 约束，主进程代理也随之可以省掉。
 *
 * `standard: true` 让它表现得像 http/https（有 origin 概念、遵守同源策略）；
 * `secure: true` 让 Chromium 把它当安全上下文（否则 getToken 等 API 不可用）；
 * `supportFetchAPI` 是 fetch/XHR 能用的前提。
 *
 * **必须在 app ready 之前调用**，否则不生效。
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
])

/**
 * 注册 `weft://` 协议
 *
 * `/api/*` 转发给后端，其余路径映射到构建产物。
 * **两者在同一个 origin 下**——这样渲染进程用相对路径 `/api` 请求就是纯同源，
 * 没有 CORS、没有 Private Network Access、不依赖任何 Chromium flag。
 */
function registerAppProtocol(backendOrigin: string): void {
  const root = join(__dirname, '../renderer')

  protocol.handle(APP_SCHEME, async (request) => {
    const { pathname } = new URL(request.url)

    // API：交给 Electron 的 net 模块发，它在同一进程内不受 PNA 约束
    if (pathname.startsWith('/api')) {
      const target = `${backendOrigin}${pathname}${new URL(request.url).search}`
      try {
        const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer()
        return await net.fetch(target, {
          method: request.method,
          headers: Object.fromEntries(request.headers.entries()),
          ...(body ? { body } : {}),
        })
      } catch {
        return new Response(
          JSON.stringify({ code: 5000, message: '后端服务不可达，请确认已启动' }),
          { status: 502, headers: { 'Content-Type': 'application/json' } },
        )
      }
    }

    const rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname)
    const target = normalize(join(root, rel))
    // 防目录穿越：解析后必须仍在 root 之内
    if (!target.startsWith(root)) return new Response('Forbidden', { status: 403 })

    // MIME 必须显式给：自定义协议不像 http 有扩展名推断
    const MIME: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.woff2': 'font/woff2',
    }
    try {
      const data = await readFile(target)
      const mime = MIME[extname(target)] ?? 'application/octet-stream'
      return new Response(data, { headers: { 'Content-Type': mime } })
    } catch {
      // SPA 回退：未知路径当作 index.html，交给前端路由处理
      try {
        const data = await readFile(join(root, 'index.html'))
        return new Response(data, { headers: { 'Content-Type': MIME['.html'] } })
      } catch {
        return new Response('Not Found', { status: 404 })
      }
    }
  })
}

/** 注册主进程 IPC 处理器（preload 通过 contextBridge 暴露给渲染进程） */
function registerIpcHandlers(): void {
  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('app:getPlatform', () => process.platform)

  /**
   * 本地标签打印（离线）
   *
   * 渲染进程把自包含的标签 HTML（含内联条码 SVG）传进来，这里开一个隐藏窗口加载后
   * 调系统 print()，**不依赖后端/网络**——车间断网也能打标签。
   */
  ipcMain.handle('app:printLabel', (_event, payload: { html?: string } | undefined) => {
    const html = payload?.html ?? ''
    return new Promise<{ ok: boolean; reason?: string }>((resolve) => {
      if (!html) {
        resolve({ ok: false, reason: 'empty label html' })
        return
      }
      const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true, javascript: false } })
      void win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
      win.webContents.once('did-finish-load', () => {
        win.webContents.print({ silent: false, printBackground: true }, (success, reason) => {
          win.destroy()
          resolve({ ok: success, reason: success ? undefined : reason })
        })
      })
    })
  })
}

/** 车间与仓库工作台窗口 */
function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#14161a',
    title: '纬数 WeftCount · 车间工作台',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.on('ready-to-show', () => {
    win.show()
  })

  // 外部链接走系统浏览器，不在应用内打开
  win.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl) {
    void win.loadURL(devServerUrl)
  } else {
    // 走自定义协议而非 loadFile：file:// 是 opaque origin，
    // 页面发起的所有跨源请求都会被 PNA 拦成「Failed to fetch」
    void win.loadURL(`${APP_SCHEME}://app/index.html`)
  }

  return win
}

void app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.weftcount.desktop')

  registerIpcHandlers()

  // dev 模式由 vite dev server 提供页面与 /api 代理，无需注册协议
  if (!process.env['ELECTRON_RENDERER_URL']) {
    registerAppProtocol(BACKEND_ORIGIN)
  }

  app.on('browser-window-created', (_event, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
