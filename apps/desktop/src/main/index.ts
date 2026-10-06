import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer } from '@electron-toolkit/utils'

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
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

void app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.weftcount.desktop')

  registerIpcHandlers()

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
