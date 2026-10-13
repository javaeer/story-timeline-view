// 字幕增强验证：① 每节点上传 SRT（时间码相对该节点起点）；② 字体支持任意本机字体名。
// 相对计时验证思路：节点时长 6s，字幕切在 1.0s。从头播放时 nodeT≈0 → 命中「首句」；
// 跳到节点中点（nodeT≈3s，远大于 1.0）→ 命中「次句」。两组断言共同证明"时间码相对节点计时"。
import puppeteer from 'puppeteer'

const BASE = 'http://127.0.0.1:5188'
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium',
  headless: 'new',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage()
page.setDefaultTimeout(30000)
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
await page.waitForFunction('window.__tlStore && window.__tlCanvas && window.__tlCanvas.value && window.__tlParseSRT', { timeout: 15000 })

// 准备：两节点，各带"上传的 SRT"（相对该节点起点计时）；无全局 SRT
await page.evaluate(() => {
  const s = window.__tlStore
  s.nodes = [
    { year: '2020', title: 'A', desc: 'x', key: true, duration: 6, images: [], video: null, audio: null,
      subtitles: [{ start: 0, end: 1, text: '首句' }, { start: 1, end: 6, text: '次句' }] },
    { year: '2021', title: 'B', desc: 'x', key: false, duration: 6, images: [], video: null, audio: null,
      subtitles: [{ start: 0, end: 6, text: '节点B字幕' }] },
  ]
  s.recompute()
  s.subtitles = []
  s.subtitleStyle = { color: '#FFD45A', fontFamily: 'hei', background: true, position: 'bottom', stroke: true }
})
await sleep(700) // 等 sched 异步重建

// 0) 片头 introSec=0.8s 内 locate 返回 node=-1（尚无节点），此时不应有节点字幕
await page.evaluate(() => window.__tlCanvas.value.replay())
await sleep(250)
let d = await page.evaluate(() => window.__tlDebug())
assert('片头(0.8s)内无节点字幕', d.subtitle === null, JSON.stringify(d.subtitle && d.subtitle.text))

// 1) 相对计时：切点在 4.0s，节点中点 nodeT≈3s < 4 → 命中第 1 条
await page.evaluate(() => {
  window.__tlStore.nodes[0].subtitles = [{ start: 0, end: 4, text: '首句' }, { start: 4, end: 6, text: '次句' }]
  window.__tlCanvas.value.seekToNode(0)
})
await sleep(400)
d = await page.evaluate(() => window.__tlDebug())
assert('节点SRT-切点4.0s时中点命中首条', d.subtitle && d.subtitle.text === '首句' && d.subtitle.perNode === true, JSON.stringify(d.subtitle && d.subtitle.text))

// 2) 相对计时：切点改到 1.0s，同一中点 nodeT≈3s > 1 → 命中第 2 条（证明时间码相对节点计时）
await page.evaluate(() => {
  window.__tlStore.nodes[0].subtitles = [{ start: 0, end: 1, text: '首句' }, { start: 1, end: 6, text: '次句' }]
  window.__tlCanvas.value.seekToNode(0)
})
await sleep(400)
d = await page.evaluate(() => window.__tlDebug())
assert('节点SRT-切点1.0s时中点命中次条', d.subtitle && d.subtitle.text === '次句', JSON.stringify(d.subtitle && d.subtitle.text))
assert('节点SRT-沿用全局样式', d.subtitle && d.subtitle.style.color === '#FFD45A' && d.subtitle.style.fontFamily === 'hei', JSON.stringify(d.subtitle && d.subtitle.style))

// 3) 每节点字幕 优先于 全局 SRT
await page.evaluate(() => {
  const s = window.__tlStore
  s.subtitles = window.__tlParseSRT('1\n00:00:00,000 --> 00:09:00,000\n全局SRT字幕\n')
  window.__tlCanvas.value.seekToNode(1)
})
await sleep(400)
d = await page.evaluate(() => window.__tlDebug())
assert('节点SRT 优先于 全局SRT', d.subtitle && d.subtitle.text === '节点B字幕' && d.subtitle.perNode === true, JSON.stringify(d.subtitle && d.subtitle.text))

// 4) 清除节点字幕 → 回退全局 SRT
await page.evaluate(() => {
  window.__tlStore.nodes[1].subtitles = null
  window.__tlCanvas.value.seekToNode(1)
})
await sleep(400)
d = await page.evaluate(() => window.__tlDebug())
assert('无节点字幕时回退全局SRT', d.subtitle && d.subtitle.text === '全局SRT字幕' && d.subtitle.perNode === false, JSON.stringify(d.subtitle && d.subtitle.text))

// 5) 自定义本地字体名透传（含空格自动加引号）
await page.evaluate(() => {
  window.__tlStore.nodes[1].subtitles = [{ start: 0, end: 6, text: '用本地字体显示' }]
  window.__tlStore.subtitleStyle.fontFamily = 'PingFang SC'
  window.__tlCanvas.value.seekToNode(1)
})
await sleep(400)
d = await page.evaluate(() => window.__tlDebug())
assert('自定义字体名透传(PingFang SC)', d.subtitle && d.subtitle.style.fontFamily === 'PingFang SC', JSON.stringify(d.subtitle && d.subtitle.style && d.subtitle.style.fontFamily))

await page.evaluate(() => {
  window.__tlStore.subtitleStyle.fontFamily = 'KaiTi'
  window.__tlCanvas.value.seekToNode(1)
})
await sleep(300)
d = await page.evaluate(() => window.__tlDebug())
assert('自定义字体名透传(KaiTi)', d.subtitle && d.subtitle.style.fontFamily === 'KaiTi', JSON.stringify(d.subtitle && d.subtitle.style && d.subtitle.style.fontFamily))

assert('无 JS 运行时错误', errs.length === 0, errs.join(' | ') || 'clean')

await browser.close()
console.log(`\nFAILURES: ${fails}`)
process.exit(fails ? 1 : 0)
