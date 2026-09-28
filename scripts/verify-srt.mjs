// SRT 字幕改造验证：① 用户工程 JSON 指标 + 富对象媒体兼容；② SRT 解析/渲染/样式/位置。
import puppeteer from 'puppeteer'
import fs from 'fs'

const USER_JSON = '/root/uploads/1790521268223013962-20260927_f8e3e2.json'
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
await page.waitForFunction('window.__tlLoadData && window.__tlStore && window.__tlCanvas && window.__tlCanvas.value && window.__tlParseSRT', { timeout: 15000 })

// ===== Part A：用户工程 JSON 指标 + 富对象媒体兼容 =====
const userJson = JSON.parse(fs.readFileSync(USER_JSON, 'utf8'))
const A = await page.evaluate((json) => {
  window.__tlLoadData(json)
  const s = window.__tlStore
  return {
    nodes: s.nodes.length,
    keyCount: s.nodes.filter((n) => n.key).length,
    totalSec: s.totalSec,
    firstVideo: s.nodes[0].video,
    firstImg: s.nodes[0].images[0],
    videoIsObj: typeof s.nodes[0].video === 'object',
    imgIsObj: typeof s.nodes[0].images[0] === 'object',
    metaTitle: s.meta.title,
  }
}, userJson)
const expectTotal = userJson.nodes.reduce((a, n) => a + (+n.duration || 0), 0)
assert('用户工程节点数 = 13', A.nodes === 13, `nodes=${A.nodes}`)
assert('关键节点数 = 8', A.keyCount === 8, `key=${A.keyCount}`)
assert('总时长≈节点时长之和(含转场余量)', Math.abs(A.totalSec - expectTotal) <= 6, `total=${A.totalSec} expect≈${expectTotal}`)
assert('meta.title 含「会师」', /会师/.test(A.metaTitle || ''), A.metaTitle)
assert('富对象 video 已提取 .url', typeof A.firstVideo === 'string' && A.firstVideo.startsWith('http') && !A.videoIsObj, `video=${A.firstVideo}`)
assert('富对象 images 已提取 .url', typeof A.firstImg === 'string' && A.firstImg.startsWith('http') && !A.imgIsObj, `img=${A.firstImg}`)

// ===== Part B：SRT 字幕功能 =====
const B = await page.evaluate(() => {
  const s = window.__tlStore
  s.nodes = [{ year: '2020', title: '测试', desc: 'x', key: true, duration: 10, images: [], video: null, audio: null }]
  s.recompute()
  const parsed = window.__tlParseSRT('1\n00:00:00,000 --> 00:00:09,000\n第一行字幕\n第二行字幕\n\n2\n00:00:10,000 --> 00:00:15,000\n第二段\n')
  s.subtitles = parsed
  s.subtitleStyle = { color: '#FFD45A', fontFamily: 'hei', background: true, position: 'bottom', stroke: true }
  window.__tlCanvas.value.replay()
  return { parsedLen: parsed.length, p0: parsed[0], p1: parsed[1] }
})
assert('SRT 解析条数 = 2', B.parsedLen === 2, `len=${B.parsedLen}`)
assert('SRT 时间码解析正确', Math.abs(B.p0.start - 0) < 0.001 && Math.abs(B.p0.end - 9) < 0.001 && Math.abs(B.p1.start - 10) < 0.001, `p0=${B.p0.start}-${B.p0.end} p1=${B.p1.start}`)
assert('SRT 多行文本保留', /第一行字幕/.test(B.p0.text) && /第二行字幕/.test(B.p0.text), B.p0.text)

await sleep(250)
const d1 = await page.evaluate(() => window.__tlDebug())
assert('播放时活动字幕渲染(bottom)', d1.subtitle && /第一行字幕/.test(d1.subtitle.text), `sub=${JSON.stringify(d1.subtitle && d1.subtitle.text)}`)
assert('字幕样式生效', d1.subtitle && d1.subtitle.style.color === '#FFD45A' && d1.subtitle.style.fontFamily === 'hei' && d1.subtitle.style.background === true && d1.subtitle.style.position === 'bottom', JSON.stringify(d1.subtitle && d1.subtitle.style))

// 位置切换 top
await page.evaluate(() => { window.__tlStore.subtitleStyle.position = 'top'; window.__tlCanvas.value.replay() })
await sleep(200)
const d2 = await page.evaluate(() => window.__tlDebug())
assert('位置切换 top 生效', d2.subtitle && d2.subtitle.style.position === 'top', d2.subtitle && d2.subtitle.style.position)

// 清空字幕
await page.evaluate(() => { window.__tlStore.subtitles = []; window.__tlCanvas.value.replay() })
await sleep(200)
const d3 = await page.evaluate(() => window.__tlDebug())
assert('清空字幕后无活动字幕', d3.subtitle === null, `sub=${JSON.stringify(d3.subtitle)}`)

assert('无 JS 运行时错误', errs.length === 0, errs.join(' | ') || 'clean')

await browser.close()
console.log(`\nFAILURES: ${fails}`)
process.exit(fails ? 1 : 0)
