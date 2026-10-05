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
    build: {
      rollupOptions: {
        input: { index: fileURLToPath(new URL('./src/renderer/index.html', import.meta.url)) },
      },
    },
  },
})
