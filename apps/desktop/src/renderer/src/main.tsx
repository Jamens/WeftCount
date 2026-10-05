import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfigProvider, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import App from './App'
import './styles/global.css'

dayjs.locale('zh-cn')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#BA7517',
          colorInfo: '#378ADD',
          colorBgBase: '#14161a',
          borderRadius: 8,
          fontFamily:
            '"PingFang SC", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        },
      }}
    >
      <App />
    </ConfigProvider>
  </StrictMode>,
)
