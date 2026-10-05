import type { DesktopBridge } from './index'

declare global {
  interface Window {
    weftDesktop?: DesktopBridge
  }
}

export {}
