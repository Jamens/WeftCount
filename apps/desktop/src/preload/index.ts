import { contextBridge, ipcRenderer } from 'electron'

export interface DesktopBridge {
  /** 应用版本 */
  getVersion: () => Promise<string>
  /** 平台标识 */
  getPlatform: () => Promise<string>
  /** 本地标签打印（传自包含标签 HTML，离线可用） */
  printLabel: (html: string) => Promise<{ ok: boolean; reason?: string }>
}

const bridge: DesktopBridge = {
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  getPlatform: () => ipcRenderer.invoke('app:getPlatform'),
  printLabel: (html) => ipcRenderer.invoke('app:printLabel', { html }),
}

contextBridge.exposeInMainWorld('weftDesktop', bridge)
