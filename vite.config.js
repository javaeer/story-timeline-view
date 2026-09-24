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
  server: { host: '127.0.0.1', port: 5173 },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
})
