// MP4 导出真实链路验证：先用画布真实录制一段 webm（非 583B 假数据），再经 ffmpeg.wasm 转码为 mp4。
// 目的：复现用户"选 MP4 导出失败"的真实场景（此前仅用极小 webm 验证过转码链路）。
import puppeteer from 'puppeteer'

const BASE = 'http://127.0.0.1:5188'
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium',
  headless: 'new',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage()
page.setDefaultTimeout(180000)
const errs = []
page.on('pageerror', (e) => errs.push(String(e)))
page.on('console', (m) => {
  if (m.type() !== 'error') return
  const t = m.text()
  if (/favicon|ERR_CONNECTION_CLOSED|net::ERR_ABORTED|Failed to load resource/i.test(t)) return
  errs.push('console:' + t)
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await page.goto(`${BASE}/?aspect=16:9`, { waitUntil: 'networkidle2' })
await page.waitForFunction('window.__tlStore && window.__tlCanvas && window.__tlCanvas.value && window.__tlMp4', { timeout: 15000 })

const total = await page.evaluate(() => {
  const s = window.__tlStore
  s.nodes = [
    { year: '2020', title: 'A', desc: 'x', key: true, duration: 1, images: [], video: null, audio: null },
    { year: '2021', title: 'B', desc: 'x', key: false, duration: 1, images: [], video: null, audio: null },
    { year: '2022', title: 'C', desc: 'x', key: false, duration: 1, images: [], video: null, audio: null },
  ]
  s.recompute()
  s.subtitles = []
  return s.totalSec
})
console.log(`工程总时长: ${total.toFixed(2)}s`)
await sleep(700)

// 1) 真实录制
const rec = await page.evaluate(async () => {
  const t0 = performance.now()
  const blob = await window.__tlCanvas.value.startRecording()
  return { size: blob.size, type: blob.type, ms: performance.now() - t0 }
})
console.log(`录制: ${rec.size}B ${rec.type} 耗时 ${(rec.ms / 1000).toFixed(2)}s`)

// 2) 转码为该录制结果（真实体积）
const out = await page.evaluate(async () => {
  const t0 = performance.now()
  // 重新录制一段拿 blob（上一次的 blob 无法跨 evaluate 传递，这里再录一次用于转码）
  const webm = await window.__tlCanvas.value.startRecording()
  try {
    const mp4 = await window.__tlMp4(webm, () => {})
    return { ok: true, webmSize: webm.size, mp4Size: mp4.size, mp4Type: mp4.type, ms: performance.now() - t0 }
  } catch (e) {
    return { ok: false, webmSize: webm.size, err: String(e && (e.stack || e.message) || e), ms: performance.now() - t0 }
  }
})
if (out.ok) {
  console.log(`PASS  真实录制→MP4 转码成功  → webm=${out.webmSize}B → mp4=${out.mp4Size}B ${out.mp4Type} 耗时 ${(out.ms / 1000).toFixed(1)}s`)
} else {
  console.log(`FAIL  真实录制→MP4 转码失败  → webm=${out.webmSize}B 耗时 ${(out.ms / 1000).toFixed(1)}s`)
  console.log(`      错误: ${out.err}`)
}
console.log(`\n页面错误: ${errs.length ? errs.join(' | ') : 'clean'}`)
await browser.close()
process.exit(out.ok ? 0 : 1)
