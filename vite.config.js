import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { handleImgProxy } from './scripts/imgProxy.mjs'

// 同源图片代理中间件：把远程背景图经 /__img?u= 代取为同源资源，
// 避免 Canvas 被跨域图污染导致 captureStream 录制失败（导出视频无背景）。
function imgProxyPlugin() {
  const mw = (req, res, next) => {
    if (req.url && req.url.startsWith('/__img')) {
      handleImgProxy(req, res)
      return
    }
    next()
  }
  return {
    name: 'img-proxy',
    configureServer(server) {
      server.middlewares.use(mw)
    },
    configurePreviewServer(server) {
      server.middlewares.use(mw)
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [vue(), imgProxyPlugin()],
  // ffmpeg.wasm 必须排除依赖预构建：@ffmpeg/ffmpeg 内部以 `./worker.js?worker` 方式导入 Worker，
  // esbuild 预打包无法处理 `?worker`，会在 dev 下报
  // "The file does not exist at .../node_modules/.vite/deps/worker.js?worker_file&type=module"。
  // 排除后由 Vite 原生 ESM + worker 插件处理，dev / build 均正常。
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  // Worker 以 ES module 形式产出（ffmpeg 核心走 ESM，UMD 版无默认导出会报 ERROR_IMPORT_FAILURE）
  worker: { format: 'es' },
  // 分包：将 vue 与 ffmpeg 相关依赖拆出独立 chunk，降低主包体积，
  // 同时满足 InfinityFree 等托管平台对单 JS 文件 ≤1MB 的限制。
  build: {
    target: 'es2018',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/vue')) return 'vue'
          if (id.includes('node_modules/@ffmpeg')) return 'ffmpeg'
        },
      },
    },
  },
  server: { host: '127.0.0.1', port: 5173 },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
})
