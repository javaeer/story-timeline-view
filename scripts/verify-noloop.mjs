// 验证：节点视频/音频不循环播放，且时间线走到最后一帧后媒体停止（active 置空）。
import puppeteer from 'puppeteer'

const BASE = process.env.BASE || 'http://127.0.0.1:5188'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e)))

let fails = 0
const assert = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
  if (!ok) fails++
}

await page.goto(`${BASE}/?aspect=16:9`, { waitUntil: 'networkidle2' })
await page.waitForFunction('window.__tlStore && window.__tlCanvas && window.__tlCanvas.value && window.__tlDebug', { timeout: 15000 })

// 注入：第 0 个节点同时带 video 与 audio，总时长很短以便快速跑到末帧
await page.evaluate(() => {
  const s = window.__tlStore
  s.nodes = [
    { year: '2000', title: 'A', desc: '节点A', key: true, duration: 1, images: [], video: 'blob:fake-vid', audio: 'blob:fake-aud' },
    { year: '2001', title: 'B', desc: '节点B', key: false, duration: 1, images: [], video: null, audio: null },
    { year: '2002', title: 'C', desc: '节点C', key: false, duration: 1, images: [], video: null, audio: null },
  ]
  s.recompute()
})

// 跳到第 0 个节点，使其视频/音频被激活（进入节点即创建元素并设置 loop）
await page.evaluate(() => window.__tlCanvas.value.seekToNode(0))
await sleep(400)
const onNode = await page.evaluate(() => window.__tlDebug())
assert('视频元素已创建且不循环', onNode.video.active && onNode.video.loop === false, `loop=${onNode.video.loop}`)
assert('音频元素已创建且不循环', onNode.audio.active && onNode.audio.loop === false, `loop=${onNode.audio.loop}`)

// 从头播放到末帧（replay 重置 curP=0，预览模式到 p>=1 停帧并调 stopActiveMedia）
await page.evaluate(() => window.__tlCanvas.value.replay())

// 轮询直到走到末帧（cur 为最后节点且 raf 停止 → active 置空）
let ended = false
for (let i = 0; i < 40; i++) {
  await sleep(250)
  const dbg = await page.evaluate(() => window.__tlDebug())
  if (dbg.audio.active === null && dbg.video.active === null && dbg.cur === 2) { ended = true; break }
}
const finalDbg = await page.evaluate(() => window.__tlDebug())
assert('走到末帧后音频停止(不循环)', finalDbg.audio.active === null, `audio.active=${finalDbg.audio.active}`)
assert('走到末帧后视频停止(不循环)', finalDbg.video.active === null, `video.active=${finalDbg.video.active}`)
assert('末帧停在第 3 个节点', finalDbg.cur === 2, `cur=${finalDbg.cur}`)
if (!ended) console.log('WARN  未在超时内到达末帧（时间线可能仍在播放）')

assert('无 JS 运行时错误', pageErrors.length === 0, pageErrors.join(' | '))

await browser.close()
console.log(`\nFAILURES: ${fails}`)
process.exit(fails ? 1 : 0)
