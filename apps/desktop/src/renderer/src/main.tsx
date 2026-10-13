import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfigProvider, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import App from './App'
import './styles/global.css'
import { useThemeStore } from './stores/theme.store'

dayjs.locale('zh-cn')

const FONT_FAMILY =
  '"PingFang SC", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'

/** 主题外壳：按 store 切换 antd 算法(明/暗)，并把 body 背景/文字同步成主题色 */
function RootTheme({ children }: { children: React.ReactNode }) {
  const mode = useThemeStore((s) => s.mode)

  useEffect(() => {
    // 背景色必须与 App.tsx 里 Layout 的层级色一致，
    // 否则会出现「body 一色、内容区另一色」的接缝（此前 body #14161a / 内容 #000）
    document.body.style.background = mode === 'dark' ? '#101215' : '#f2f3f5'
    document.body.style.color = mode === 'dark' ? 'rgba(255,255,255,0.88)' : 'rgba(0,0,0,0.88)'
  }, [mode])

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: mode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          /**
           * 品牌色：车间终端用**琥珀金**，与 admin 端的青绿区分开——
           * 车间是生产现场、admin 是办公管理，两端同屏时一眼能分清。
           *
           * 选亮金（#D98A1F）而非暗金（#BA7517）：深色背景上暗金对比度不足，
           * 菜单选中态几乎看不出高亮。现在这个值在 #1c1f26 底上对比度约 5.3:1，达 WCAG AA。
           */
          colorPrimary: '#D98A1F',
          colorInfo: '#378ADD',
          borderRadius: 8,
          fontFamily: FONT_FAMILY,
          // 层级色：统一「更深的面板 / 更浅的内容区」，
          // 让卡片从背景里浮出来，而不是所有元素糊成一片黑
          colorBgLayout: mode === 'dark' ? '#101215' : '#f2f3f5',
          colorBgContainer: mode === 'dark' ? '#1c1f26' : '#ffffff',
          colorBgElevated: mode === 'dark' ? '#242830' : '#ffffff',
        },
        components: {
          Menu: {
            /**
             * 选中态改为**左侧金色竖条 + 文字提亮**，不用实心色块。
             *
             * 实心金色块在 176px 宽的深色侧栏里过于抢眼：
             * 整个界面的视觉重心被拉到一个二级菜单项上，
             * 而菜单本身只是导航。当前页高亮应该「可辨认但不喧哗」。
             */
            itemSelectedBg: mode === 'dark' ? 'rgba(217,138,31,0.14)' : 'rgba(217,138,31,0.10)',
            itemSelectedColor: mode === 'dark' ? '#F0A94A' : '#8A5A12',
          },
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
      <App />
    </RootTheme>
  </StrictMode>,
)
