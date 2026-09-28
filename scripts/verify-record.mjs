// 录制验证：复现「预览跑完/跳转后再导出」场景（curP 已非 0），断言录制覆盖整条时间轴而非只有尾帧。
// 回归点：startRecording 必须重置 curP=0，否则 startLoop 按 curP 对齐 startTime，录制只录到尾帧几秒。
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
await page.waitForFunction('window.__tlStore && window.__tlCanvas && window.__tlCanvas.value', { timeout: 15000 })

// 短工程：3 节点 × 1s，总时长约 3s（远大于 TAIL_SEC=1.2，便于区分"整条"与"仅尾帧"）
const total = await page.evaluate(() => {
  const s = window.__tlStore
  s.nodes = [
    { year: '2020', title: 'A', desc: 'x', key: true, duration: 1, images: [], video: null, audio: null, subtitle: null },
    { year: '2021', title: 'B', desc: 'x', key: false, duration: 1, images: [], video: null, audio: null, subtitle: null },
    { year: '2022', title: 'C', desc: 'x', key: false, duration: 1, images: [], video: null, audio: null, subtitle: null },
  ]
  s.recompute()
  s.subtitles = []
  return s.totalSec
})
await sleep(700) // 等 sched 异步重建

// 场景：让预览完整播完（正常状态就是"播完停在尾帧"，此时内部 curP=1）
await page.evaluate(() => window.__tlCanvas.value.replay())
await sleep(total * 1000 + 800)

// 录制：应从头录制整条时间轴
const r = await page.evaluate(async () => {
  const t0 = performance.now()
  const blob = await window.__tlCanvas.value.startRecording()
  return { size: blob.size, type: blob.type, ms: performance.now() - t0 }
})
const recSec = r.ms / 1000
assert('录制产出非空 blob', r.size > 0, `size=${r.size}B type=${r.type}`)
// 内部 TAIL_SEC=1.2；正常应约 total+1.2 秒。若只录到尾帧则约 1.2 秒（远小于 total）
assert('录制覆盖整条时间轴(非仅尾帧)', recSec >= total * 0.9, `录制耗时=${recSec.toFixed(2)}s 总时长=${total.toFixed(2)}s`)

// 场景二：跳转到某节点后再导出（curP=该节点中点），同样应从头录
await page.evaluate(() => window.__tlCanvas.value.seekToNode(2))
await sleep(300)
const r2 = await page.evaluate(async () => {
  const t0 = performance.now()
  const blob = await window.__tlCanvas.value.startRecording()
  return { size: blob.size, ms: performance.now() - t0 }
})
assert('跳转后导出仍录制完整', r2.size > 0 && r2.ms / 1000 >= total * 0.9, `size=${r2.size}B 耗时=${(r2.ms / 1000).toFixed(2)}s`)

assert('无 JS 运行时错误', errs.length === 0, errs.join(' | ') || 'clean')

await browser.close()
console.log(`\nFAILURES: ${fails}`)
process.exit(fails ? 1 : 0)
