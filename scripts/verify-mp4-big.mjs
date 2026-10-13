// 大体积 MP4 导出压力测试：用较长工程（约 20s）测转码耗时与是否 OOM/报错，用于判断
// 用户 180s 工程在浏览器内转码为何失败（耗时过长 or 内存溢出）。
import puppeteer from 'puppeteer'

const BASE = 'http://127.0.0.1:5188'
const NODES = Number(process.argv[2] || 8)
const DUR = Number(process.argv[3] || 2.5)
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium',
  headless: 'new',
  // 录制+转码总耗时很容易超过 puppeteer 默认 protocolTimeout(180s)，必须显式抬高，
  // 否则会误报 "Runtime.callFunctionOn timed out"（这是测试框架超时，不是应用失败）。
  protocolTimeout: 900000,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage()
page.setDefaultTimeout(600000)
const errs = []
page.on('pageerror', (e) => errs.push(String(e)))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await page.goto(`${BASE}/?aspect=16:9`, { waitUntil: 'networkidle2' })
await page.waitForFunction('window.__tlStore && window.__tlCanvas && window.__tlCanvas.value && window.__tlMp4', { timeout: 15000 })

const total = await page.evaluate(({ n, d }) => {
  const s = window.__tlStore
  s.nodes = Array.from({ length: n }, (_, i) => ({
    year: String(2000 + i), title: '节点' + i, desc: '描述' + i, key: i === 0,
    duration: d, images: [], video: null, audio: null,
  }))
  s.recompute()
  s.subtitles = []
  return s.totalSec
}, { n: NODES, d: DUR })
console.log(`工程: ${NODES} 节点 × ${DUR}s = ${total.toFixed(2)}s`)
await sleep(700)

const out = await page.evaluate(async () => {
  const t0 = performance.now()
  const webm = await window.__tlCanvas.value.startRecording()
  const tRec = performance.now() - t0
  const t1 = performance.now()
  try {
    const mp4 = await window.__tlMp4(webm, () => {})
    return { ok: true, webmSize: webm.size, mp4Size: mp4.size, recMs: tRec, encMs: performance.now() - t1 }
  } catch (e) {
    return { ok: false, webmSize: webm.size, err: String((e && (e.message || e)) || e), recMs: tRec, encMs: performance.now() - t1 }
  }
})
console.log(`录制: ${(out.recMs / 1000).toFixed(1)}s  webm=${(out.webmSize / 1048576).toFixed(2)}MB`)
if (out.ok) {
  console.log(`PASS  转码成功  → mp4=${(out.mp4Size / 1048576).toFixed(2)}MB 编码耗时=${(out.encMs / 1000).toFixed(1)}s (≈${(out.encMs / 1000 / total).toFixed(1)}× 实时)`)
} else {
  console.log(`FAIL  转码失败  → 编码耗时=${(out.encMs / 1000).toFixed(1)}s 错误: ${out.err}`)
}
console.log(`页面错误: ${errs.length ? errs.join(' | ') : 'clean'}`)
await browser.close()
process.exit(out.ok ? 0 : 1)
