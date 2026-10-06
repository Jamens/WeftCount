import { create } from 'zustand'

export type ThemeMode = 'light' | 'dark'

const STORAGE_KEY = 'weft-theme'

function getInitialMode(): ThemeMode {
  if (typeof window === 'undefined') return 'light'
  const saved = window.localStorage.getItem(STORAGE_KEY)
  return saved === 'dark' ? 'dark' : 'light'
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
