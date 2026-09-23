#!/usr/bin/env node
// 跨平台出片脚本（核心逻辑）：用 Puppeteer 以固定 1920×1080、deviceScaleFactor=1
// 逐帧打开 ?frame=N 静态帧截图，再用 ffmpeg 合成为标准 H.264(mp4)。
// 与旧版每帧起一个 Chromium 进程、且只认 libopenh264 的方案相比，本方案：
//  - 单浏览器实例内逐帧截图，避免反复启动进程；
//  - 位图分辨率锁定 1920×1080，不再受屏幕高 DPI 影响导致拉伸/模糊；
//  - ffmpeg 用 libx264 + yuv420p + scale=1920:1080，兼容性更好。
import puppeteer from 'puppeteer'
import { spawnSync } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const dist = path.join(root, 'dist')
const framesDir = path.join(root, 'frames')
const outDir = path.join(root, 'out')

const FPS = Number(process.env.FPS || 25)
const DUR = Number(process.argv[2] || process.env.DURATION || 12)

if (!fs.existsSync(dist)) {
  console.error('未找到 dist/，请先执行 `npm run build`（或 `npm run render` 前已自动构建）')
  process.exit(1)
}
fs.mkdirSync(framesDir, { recursive: true })
fs.mkdirSync(outDir, { recursive: true })

const total = Math.max(1, Math.round(FPS * DUR))

// 必须用 HTTP 加载 dist：file:// 协议下浏览器禁止执行 ES module（CORS），
// 会导致 Vue 不挂载、页面只剩空白背景，截出来的每一帧都是空的。
function serveDist(dir) {
  const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
    '.json': 'application/json', '.woff2': 'font/woff2',
  }
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || '/').split('?')[0])
    if (p === '/' || p === '') p = '/index.html'
    const fp = path.join(dir, p)
    fs.readFile(fp, (err, data) => {
      if (err) { res.writeHead(404); res.end('404'); return }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' })
      res.end(data)
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

// 按优先级选取本机可用的视频编码器：不同机器预编译 ffmpeg 的编码器不同，
// 硬编码 libx264 在缺少该编码器的环境会直接失败，故做自动回退。
function pickEncoder() {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' })
  const out = (r.stdout || '') + (r.stderr || '')
  const cands = [
    { name: 'libx264', ext: 'mp4', quality: ['-crf', '20'] },
    { name: 'libopenh264', ext: 'mp4', quality: ['-b:v', '6M'] },
    { name: 'mpeg4', ext: 'mp4', quality: ['-q:v', '3'] },
    { name: 'libvpx-vp9', ext: 'webm', quality: ['-crf', '32', '-b:v', '0'] },
  ]
  for (const c of cands) {
    if (new RegExp(`\\s${c.name}\\s`).test(out)) return c
  }
  return null
}

async function main() {
  const { server, port } = await serveDist(dist)
  const baseUrl = `http://127.0.0.1:${port}/index.html`
  console.log(`本地预览服务：${baseUrl}`)

  const browser = await puppeteer.launch({
    headless: true,
    // 允许复用系统已安装的 Chromium：PUPPETEER_EXECUTABLE_PATH=/path/to/chrome
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-gpu', '--force-device-scale-factor=1', '--disable-dev-shm-usage'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 })

  // 阻断外部字体请求：离线/无外网环境下避免每帧卡在字体加载超时（组件已内置系统字体回退）
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    const u = req.url()
    if (u.includes('fonts.googleapis.com') || u.includes('fonts.gstatic.com')) req.abort().catch(() => {})
    else req.continue().catch(() => {})
  })

  for (let i = 0; i < total; i++) {
    const url = `${baseUrl}?duration=${DUR}&frame=${i}`
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 })
    } catch (e) {
      // CDN 字体可能超时：组件已内置 600ms 回退，超时也继续截图
      console.warn(`第 ${i} 帧加载超时，已回退系统字体继续`)
    }
    // 等两帧 RAF，让 Canvas 完成静态帧绘制
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))).catch(() => {})

    // 首帧“空白检测”：确认 Vue 已挂载且 Canvas 真的画了东西，避免导出空白视频
    if (i === 0) {
      const probe = await page.evaluate(() => {
        const c = document.querySelector('canvas')
        if (!c) return { ok: false, reason: '未找到 canvas（应用可能未挂载）' }
        const ctx = c.getContext('2d')
        const d = ctx.getImageData(0, 0, c.width, c.height).data
        let painted = 0
        for (let k = 3; k < d.length; k += 4 * 40) if (d[k] > 8) painted++
        return { ok: painted > 50, reason: `canvas ${c.width}x${c.height}，已绘制采样点 ${painted}`, painted }
      }).catch((e) => ({ ok: false, reason: String(e) }))
      console.log(`首帧自检：${probe.ok ? 'OK' : 'FAIL'} — ${probe.reason}`)
      if (!probe.ok) {
        console.error('自检未通过：页面可能空白，已中止导出。请确认 `npm run build` 产物正常。')
        await browser.close()
        server.close()
        process.exit(1)
      }
    }

    const out = path.join(framesDir, `frame_${String(i).padStart(5, '0')}.png`)
    await page.screenshot({ path: out })
    if (i % 30 === 0 || i === total - 1) console.log(`截图进度 ${i + 1}/${total}`)
  }
  await browser.close()
  server.close()

  const pattern = path.join(framesDir, 'frame_%05d.png')
  const enc = pickEncoder()
  if (!enc) {
    console.error('未找到可用的视频编码器（libx264 / libopenh264 / mpeg4 / libvpx-vp9），请安装带编码器的 ffmpeg')
    process.exit(1)
  }
  const outFile = path.join(outDir, `timeline-${DUR}s.${enc.ext}`)
  console.log(`合成视频中…（编码器：${enc.name} → ${enc.ext}）`)
  const r = spawnSync('ffmpeg', [
    '-y', '-framerate', String(FPS), '-i', pattern,
    '-c:v', enc.name, '-pix_fmt', 'yuv420p', ...enc.quality,
    '-vf', 'scale=1920:1080', outFile,
  ], { stdio: 'inherit' })
  if (r.status !== 0) {
    console.error('ffmpeg 合成失败：请确认 ffmpeg 可用（macOS: brew install ffmpeg / Ubuntu: apt install ffmpeg）')
    process.exit(r.status || 1)
  }
  console.log('已生成视频：', outFile)
}

main().catch((e) => { console.error(e); process.exit(1) })
