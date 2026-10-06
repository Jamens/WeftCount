import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConfigProvider, theme as antdTheme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import App from './App'
import './styles/global.css'
import { useThemeStore } from './stores/theme.store'

dayjs.locale('zh-cn')

const FONT_FAMILY =
  '"PingFang SC", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'

/** 主题外壳：按 store 切换 antd 算法，并把 body 背景/文字同步成主题色 */
function RootTheme({ children }: { children: React.ReactNode }) {
  const mode = useThemeStore((s) => s.mode)

  useEffect(() => {
    document.body.style.background = mode === 'dark' ? '#000' : '#f5f5f5'
    document.body.style.color = mode === 'dark' ? 'rgba(255,255,255,0.88)' : 'rgba(0,0,0,0.88)'
  }, [mode])

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: mode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: '#1D9E75',
          colorInfo: '#378ADD',
          borderRadius: 8,
          fontFamily: FONT_FAMILY,
        },
      }}
    >
      {children}
    </ConfigProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootTheme>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </RootTheme>
  </StrictMode>,
)
