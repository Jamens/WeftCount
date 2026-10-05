import { contextBridge, ipcRenderer } from 'electron'

export interface DesktopBridge {
  /** 应用版本 */
  getVersion: () => Promise<string>
  /** 平台标识 */
  getPlatform: () => Promise<string>
  /** 本地打印 */
  printLabel: (payload: unknown) => Promise<{ ok: boolean }>
}

const bridge: DesktopBridge = {
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  getPlatform: () => ipcRenderer.invoke('app:getPlatform'),
  printLabel: (payload) => ipcRenderer.invoke('app:printLabel', payload),
}

contextBridge.exposeInMainWorld('weftDesktop', bridge)
