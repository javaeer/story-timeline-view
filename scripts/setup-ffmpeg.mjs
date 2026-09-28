#!/usr/bin/env node
// 将 @ffmpeg/core 的 UMD 构建拷贝到 public/ffmpeg/，供浏览器同源加载（离线导出 MP4）。
// 由 predev / prebuild 自动调用；若设置了 VITE_FFMPEG_CORE_BASE（使用 CDN），
// 则跳过拷贝，避免将 32MB 的 wasm 打进 dist，从而绕过托管平台的单文件体积限制。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const srcDir = path.join(root, 'node_modules', '@ffmpeg', 'core', 'dist', 'umd')
const destDir = path.join(root, 'public', 'ffmpeg')

// 部署到 Cloudflare Pages / InfinityFree 等单文件受限平台时，通过 CDN 加载核心，跳过本地拷贝。
if (process.env.VITE_FFMPEG_CORE_BASE) {
  console.log('[setup-ffmpeg] 检测到 VITE_FFMPEG_CORE_BASE，跳过本地拷贝（将使用 CDN 加载 ffmpeg-core）。')
  process.exit(0)
}

if (!fs.existsSync(srcDir)) {
  console.error('[setup-ffmpeg] 未找到 node_modules/@ffmpeg/core/dist/umd，请先执行安装（pnpm install）。')
  process.exit(1)
}

fs.mkdirSync(destDir, { recursive: true })
for (const f of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) {
  const from = path.join(srcDir, f)
  const to = path.join(destDir, f)
  if (!fs.existsSync(from)) {
    console.error(`[setup-ffmpeg] 缺少源文件：${from}`)
    process.exit(1)
  }
  fs.copyFileSync(from, to)
  const sizeMB = (fs.statSync(to).size / 1024 / 1024).toFixed(1)
  console.log(`[setup-ffmpeg] 已拷贝 ${f}（${sizeMB} MB）→ public/ffmpeg/`)
}
