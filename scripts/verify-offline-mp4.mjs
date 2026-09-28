// 离线 MP4 验证：确认 @ffmpeg 核心已本地化（不再依赖 CDN），并能真实加载 + 转码。
import puppeteer from 'puppeteer'

const BASE = 'http://127.0.0.1:5188'
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium',
  headless: 'new',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage()
page.setDefaultTimeout(60000)

const errs = []
page.on('pageerror', (e) => errs.push(String(e)))
page.on('console', (m) => {
  if (m.type() !== 'error') return
  const t = m.text()
  if (/favicon|ERR_CONNECTION_CLOSED|net::ERR_ABORTED|Failed to load resource/i.test(t)) return
  errs.push('console:' + t)
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let fails = 0
function assert(name, cond, info) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}  → ${info || ''}`)
  if (!cond) fails++
}

await page.goto(`${BASE}/?aspect=16:9`, { waitUntil: 'networkidle2' })
await page.waitForFunction('window.__tlMp4', { timeout: 15000 })

// 1) 核心文件同源可访问（离线证据）：public/ffmpeg 经 BASE_URL 输出到 dist 根，服务在 /ffmpeg/...
const wasmStatus = await page.evaluate(async () => {
  const r = await fetch('ffmpeg/ffmpeg-core.wasm', { method: 'HEAD' })
  return r.status
})
assert('ffmpeg-core.wasm 同源可访问(离线)', wasmStatus === 200, `status=${wasmStatus}`)

// 2) 本地核心可加载并真实转码 webm → mp4
let mp4 = { ok: false, info: '' }
try {
  const r = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 180
    const cx = c.getContext('2d'); cx.fillStyle = '#10203a'; cx.fillRect(0, 0, 320, 180)
    const s = c.captureStream(15)
    const rec = new MediaRecorder(s); const ch = []
    rec.ondataavailable = (e) => { if (e.data && e.data.size) ch.push(e.data) }
    const done = new Promise((res) => { rec.onstop = () => res(new Blob(ch, { type: 'video/webm' })) })
    rec.start(); await new Promise((r) => setTimeout(r, 400)); rec.stop()
    const webm = await done
    const out = await window.__tlMp4(webm, () => {})
    return { webmSize: webm.size, mp4Size: out.size, mp4Type: out.type }
  })
  mp4.ok = r.mp4Size > 0 && /mp4/.test(r.mp4Type || '')
  mp4.info = `webm=${r.webmSize}B → mp4=${r.mp4Size}B type=${r.mp4Type}`
} catch (e) {
  mp4.info = '异常: ' + (e.message || String(e))
}
assert('本地核心加载并转码 MP4', mp4.ok, mp4.info)

// 3) 无 JS 运行时错误
assert('无 JS 运行时错误', errs.length === 0, errs.join(' | ') || 'clean')

await browser.close()
console.log(`\nFAILURES: ${fails}`)
process.exit(fails ? 1 : 0)
