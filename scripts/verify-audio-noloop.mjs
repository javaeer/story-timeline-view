// 验证"音频不循环"的真正根因：同一节点停留期间，音频自然播完(el.ended)后不应被重启。
// 注入一段约 1.2s 的真实可加载 WAV 到单节点（停留 5s），播放后等待 > 音频时长，断言：
//   1) 音频元素 loop === false
//   2) 音频已 ended（自然播完）且未重启（ended 保持 true、currentTime 不回到 ~0）
//   3) 仍在当前节点、active 不为空（不是被 stopActiveMedia 清掉）
import puppeteer from 'puppeteer'

const BASE = 'http://127.0.0.1:5188'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function makeWav(seconds = 1.2, rate = 8000) {
  const n = Math.floor(seconds * rate)
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  return 'data:audio/wav;base64,' + buf.toString('base64')
}

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e)))

let fails = 0
const assert = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) fails++ }

await page.goto(`${BASE}/?aspect=16:9`, { waitUntil: 'networkidle2' })
await page.waitForFunction('window.__tlStore && window.__tlCanvas && window.__tlCanvas.value && window.__tlDebug', { timeout: 15000 })

// 单节点、停留 6s；音频约 1.2s（短于节点停留 → 若循环会反复重启，若修好则播完即停）
await page.evaluate((uri) => {
  const s = window.__tlStore
  s.nodes = [{ year: '2000', title: 'A', desc: '单节点', key: true, duration: 6, images: [], video: null, audio: uri }]
  s.recompute()
}, makeWav())
await page.evaluate(() => window.__tlCanvas.value.replay()) // 从头播放（curP=0）
await sleep(300)

// 等待超过音频时长（1.2s）+ 余量，确认不重启
await sleep(2200)
const dbg = await page.evaluate(() => window.__tlDebug().audio)

assert('音频元素不循环', dbg.loop === false, `loop=${dbg.loop}`)
assert('音频自然播完未重启(ended=true)', dbg.ended === true, `ended=${dbg.ended} t=${dbg.t && dbg.t.toFixed(2)}`)
assert('播完后停留当前节点(active 非空)', dbg.active != null, `active=${dbg.active}`)
assert('播完后未处于 playing(已停)', dbg.playing === false, `playing=${dbg.playing}`)

// 再观察一次：若仍在循环，ended 会再次变 false、t 会被重置；连续采样确认稳定 ending。
// 采样窗口（5×200ms=1s）远小于节点停留(6s)，不会走到末帧（否则 active 会被 stopActiveMedia 置空，属预期行为非循环）。
let stillEnded = true
for (let i = 0; i < 5; i++) {
  await sleep(200)
  const d = await page.evaluate(() => window.__tlDebug().audio)
  if (d.ended !== true) { stillEnded = false; console.log(`  WARN 第${i}次采样 ended=${d.ended} t=${d.t && d.t.toFixed(2)}（疑似重启）`); break }
}
assert('连续采样确认不重启(稳定 ended)', stillEnded)

assert('无 JS 运行时错误', pageErrors.length === 0, pageErrors.join(' | '))

await browser.close()
console.log(`\nFAILURES: ${fails}`)
process.exit(fails ? 1 : 0)
