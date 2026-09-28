// P0 验证：持久化 / 导入导出 JSON / 字幕(SRT) / MP4 离线导出
import puppeteer from 'puppeteer'
import { writeFileSync } from 'node:fs'

const BASE = 'http://127.0.0.1:5188'
const EXEC = '/usr/bin/chromium'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
const fails = []
function assert(name, ok, info = '') {
  results.push({ name, ok, info })
  if (!ok) fails.push(name)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  → ' + info : ''}`)
}

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: EXEC,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1400, height: 900 })
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e)))
// 仅过滤无害网络噪声（favicon 404 / 预览空闲断连），其余 console error 计入
page.on('console', (m) => {
  if (m.type() !== 'error') return
  const t = m.text()
  // 仅过滤无害噪声：favicon 404、预览空闲断连、资源 404（本应用无 favicon）
  if (/favicon|ERR_CONNECTION_CLOSED|net::ERR_ABORTED|Failed to load resource/i.test(t)) return
  pageErrors.push('console:' + t)
})

// 1) 持久化：写入唯一标记 → 刷新 → 应从 localStorage 恢复
await page.goto(`${BASE}/?aspect=16:9`, { waitUntil: 'networkidle2' })
await page.waitForFunction('window.__tlStore && window.__tlDebug', { timeout: 15000 })
const MARK = 'PERSIST_' + Date.now()
await page.evaluate((mark) => {
  window.__tlStore.meta.title = mark
  window.__tlStore.nodes = [
    { year: '1990', title: '持久化节点A', desc: '刷新后应仍在', key: true, duration: 6, images: [], video: null, audio: null },
    { year: '1995', title: '持久化节点B', desc: '第二节点', key: false, duration: 6, images: [], video: null, audio: null },
  ]
  window.__tlStore.recompute()
}, MARK)
await sleep(900) // 等防抖落盘
await page.reload({ waitUntil: 'networkidle2' })
await page.waitForFunction('window.__tlStore', { timeout: 15000 })
const restored = await page.evaluate(() => ({
  title: window.__tlStore.meta.title,
  n: window.__tlStore.nodes.length,
  first: window.__tlStore.nodes[0] && window.__tlStore.nodes[0].title,
}))
assert('持久化-刷新后恢复 meta.title', restored.title === MARK, restored.title)
assert('持久化-刷新后恢复 nodes 数量', restored.n === 2, 'n=' + restored.n)
assert('持久化-刷新后恢复节点内容', restored.first === '持久化节点A', restored.first)

// 2) 导入 JSON：上传工程文件 → store 更新
const proj = {
  meta: { kicker: '测试', title: '导入工程X', subtitle: '副标题解说', badge: 'b' },
  nodes: [
    { year: '2001', title: '导入节点1', desc: '导入的描述内容', key: true, duration: 8, images: [], video: null, audio: null },
    { year: '2002', title: '导入节点2', desc: 'd2', key: false, duration: 8, images: [], video: null, audio: null },
    { year: '2003', title: '导入节点3', desc: 'd3', key: false, duration: 8, images: [], video: null, audio: null },
  ],
}
writeFileSync('/tmp/proj-import.json', JSON.stringify(proj))
const input = await page.$('input[type=file][accept*="json"]')
await input.uploadFile('/tmp/proj-import.json')
await sleep(500)
const imported = await page.evaluate(() => ({
  title: window.__tlStore.meta.title,
  sub: window.__tlStore.meta.subtitle,
  n: window.__tlStore.nodes.length,
}))
assert('导入JSON-标题生效', imported.title === '导入工程X', imported.title)
assert('导入JSON-副标题生效', imported.sub === '副标题解说', imported.sub)
assert('导入JSON-节点数生效', imported.n === 3, 'n=' + imported.n)

// 3) 字幕机制（SRT 导入，取代原自动硬字幕）：导入 SRT → 播放时 __tlDebug().subtitle 应为活动字幕行
await page.evaluate(() => {
  const s = window.__tlStore
  s.nodes = [{ year: '2020', title: '测试', desc: 'x', key: true, duration: 10, images: [], video: null, audio: null }]
  s.recompute()
  s.subtitles = window.__tlParseSRT('1\n00:00:00,000 --> 00:00:09,000\nSRT测试字幕\n')
  s.subtitleStyle = { color: '#FFFFFF', fontFamily: 'sans', background: false, position: 'bottom', stroke: true }
  window.__tlCanvas.value.replay()
})
await sleep(350)
const sub = await page.evaluate(() => window.__tlDebug().subtitle)
assert('字幕(SRT)-导入后活动字幕渲染', sub && /SRT测试字幕/.test(sub.text || ''), JSON.stringify(sub && sub.text))

// 4) MP4 导出：页内生成一段小 webm → 经 **本地 ffmpeg.wasm 内核**（public/ffmpeg，已本地化、无 CDN 依赖）转码为 mp4
const mp4 = { ok: false, info: '' }
try {
  const r = await Promise.race([
    page.evaluate(async () => {
      if (!window.__tlMp4) return { err: 'webmToMp4 未暴露' }
      const c = document.createElement('canvas'); c.width = 320; c.height = 180
      const cx = c.getContext('2d'); cx.fillStyle = '#10203a'; cx.fillRect(0, 0, 320, 180)
      const s = c.captureStream(15)
      const rec = new MediaRecorder(s); const ch = []
      rec.ondataavailable = (e) => { if (e.data && e.data.size) ch.push(e.data) }
      const done = new Promise((res) => { rec.onstop = () => res(new Blob(ch, { type: 'video/webm' })) })
      rec.start(); await new Promise((r) => setTimeout(r, 350)); rec.stop()
      const webm = await done
      const mp4 = await window.__tlMp4(webm, () => {})
      return { webmSize: webm.size, mp4Size: mp4.size, mp4Type: mp4.type }
    }),
    new Promise((res) => setTimeout(() => res({ err: 'timeout(转码超时)' }), 60000)),
  ])
  if (r.err) { mp4.info = r.err } else {
    mp4.ok = r.mp4Size > 0 && /mp4/.test(r.mp4Type || '')
    mp4.info = `webm=${r.webmSize}B → mp4=${r.mp4Size}B type=${r.mp4Type}`
  }
} catch (e) {
  mp4.info = '异常: ' + (e.message || String(e))
}
assert('MP4导出(本地 ffmpeg.wasm 离线转码)', mp4.ok, mp4.info)

assert('无 JS 运行时错误(确定性项)', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))

await browser.close()

console.log('\n==== 确定性项 FAILURES:', fails.length, '====')
process.exit(fails.length ? 1 : 0)
