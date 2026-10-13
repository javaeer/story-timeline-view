// dev 模式验证：确认 optimizeDeps.exclude 生效、不再出现
// "worker.js?worker_file&type=module does not exist"，且 ffmpeg.wasm 能在 dev 下正常加载转码。
// 用法: node scripts/verify-dev-ffmpeg.mjs <baseUrl>
import puppeteer from 'puppeteer'

const BASE = process.argv[2] || 'http://127.0.0.1:5173'
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium',
  headless: 'new',
  protocolTimeout: 300000,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage()
page.setDefaultTimeout(120000)
const errs = []
page.on('pageerror', (e) => errs.push('pageerror:' + String(e)))
page.on('console', (m) => {
  if (m.type() !== 'error') return
  const t = m.text()
  if (/favicon|ERR_CONNECTION_CLOSED|net::ERR_ABORTED|Failed to load resource/i.test(t)) return
  errs.push('console:' + t)
})

await page.goto(`${BASE}/?aspect=16:9`, { waitUntil: 'networkidle2' })
await page.waitForFunction('window.__tlStore && window.__tlMp4', { timeout: 30000 })
console.log('PASS  dev 页面挂载且 __tlMp4 就绪')

// 触发 ffmpeg.wasm 真实加载（动态 import @ffmpeg/ffmpeg + worker）
const r = await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 320; c.height = 180
  const cx = c.getContext('2d'); cx.fillStyle = '#10203a'; cx.fillRect(0, 0, 320, 180)
  const s = c.captureStream(15)
  const rec = new MediaRecorder(s); const ch = []
  rec.ondataavailable = (e) => { if (e.data && e.data.size) ch.push(e.data) }
  const done = new Promise((res) => { rec.onstop = () => res(new Blob(ch, { type: 'video/webm' })) })
  rec.start(); await new Promise((r) => setTimeout(r, 350)); rec.stop()
  const webm = await done
  try {
    const mp4 = await window.__tlMp4(webm, () => {})
    return { ok: true, webm: webm.size, mp4: mp4.size, type: mp4.type }
  } catch (e) {
    return { ok: false, webm: webm.size, err: String((e && (e.stack || e.message)) || e) }
  }
})
if (r.ok) console.log(`PASS  dev 下 ffmpeg.wasm 转码成功  → webm=${r.webm}B → mp4=${r.mp4}B ${r.type}`)
else console.log(`FAIL  dev 下 ffmpeg.wasm 转码失败  → webm=${r.webm}B\n      ${r.err}`)

const workerErr = errs.filter((e) => /worker\.js\?worker_file|optimize deps|does not exist/i.test(e))
if (workerErr.length) console.log(`FAIL  出现 worker/optimizeDeps 报错:\n      ${workerErr.join('\n      ')}`)
else console.log('PASS  无 worker/optimizeDeps 相关报错')

console.log(`\n页面错误: ${errs.length ? errs.slice(0, 5).join(' | ') : 'clean'}`)
await browser.close()
process.exit(r.ok && !workerErr.length ? 0 : 1)
