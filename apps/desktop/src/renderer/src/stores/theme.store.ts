import { create } from 'zustand'

export type ThemeMode = 'light' | 'dark'

const STORAGE_KEY = 'weft-desktop-theme'

/** 首次进入跟随系统；系统不支持判定时默认深色(车间终端惯用深色) */
function getInitialMode(): ThemeMode {
  if (typeof window === 'undefined') return 'dark'
  const saved = window.localStorage.getItem(STORAGE_KEY)
  if (saved === 'dark' || saved === 'light') return saved
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

interface ThemeState {
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
  toggle: () => void
}

function persist(mode: ThemeMode) {
  if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, mode)
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: getInitialMode(),
  setMode: (mode) => {
    persist(mode)
    set({ mode })
  },
  toggle: () => {
    const next: ThemeMode = get().mode === 'light' ? 'dark' : 'light'
    persist(next)
    set({ mode: next })
  },
}))
