// electron.vite.config.ts
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
var __electron_vite_injected_import_meta_url = "file:///D:/WeftCount/apps/desktop/electron.vite.config.ts";
var electron_vite_config_default = defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: fileURLToPath(new URL("./src/main/index.ts", __electron_vite_injected_import_meta_url)) }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: fileURLToPath(new URL("./src/preload/index.ts", __electron_vite_injected_import_meta_url)) }
      }
    }
  },
  renderer: {
    root: fileURLToPath(new URL("./src/renderer", __electron_vite_injected_import_meta_url)),
    resolve: {
      alias: {
        "@renderer": fileURLToPath(new URL("./src/renderer", __electron_vite_injected_import_meta_url)),
        "@weftcount/shared": fileURLToPath(new URL("../../packages/shared/src/index.ts", __electron_vite_injected_import_meta_url))
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: { index: fileURLToPath(new URL("./src/renderer/index.html", __electron_vite_injected_import_meta_url)) }
      }
    }
  }
});
export {
  electron_vite_config_default as default
};
