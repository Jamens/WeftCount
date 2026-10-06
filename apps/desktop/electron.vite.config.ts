import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: fileURLToPath(new URL('./src/main/index.ts', import.meta.url)) },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: fileURLToPath(new URL('./src/preload/index.ts', import.meta.url)) },
      },
    },
  },
  renderer: {
    root: fileURLToPath(new URL('./src/renderer', import.meta.url)),
    resolve: {
      alias: {
        '@renderer': fileURLToPath(new URL('./src/renderer', import.meta.url)),
        '@weftcount/shared': fileURLToPath(new URL('../../packages/shared/dist-esm/index.js', import.meta.url)),
      },
    },
    plugins: [react()],
    server: {
      // 渲染进程以相对路径 /api 请求后端，由 dev server 代理转发 → 与后端**同源**。
      // 这样绕开 Chromium 对 file/localhost→127.0.0.1 的 CORS 与 Private Network Access
      // 拦截（直连绝对地址常被 PNA 拦成“网络错误”）。目标端口见下方 target。
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:3180',
          changeOrigin: true,
        },
      },
    },
    build: {
      rollupOptions: {
        input: { index: fileURLToPath(new URL('./src/renderer/index.html', import.meta.url)) },
      },
    },
  },
})
