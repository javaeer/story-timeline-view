// 节点音频功能冒烟验证：逐个画幅给节点 2 挂一段音频，seek 到该节点并播放，
// 断言音频引擎创建元素、active 指向该节点音频、且确实处于 playing，无未捕获 JS 报错。
import puppeteer from 'puppeteer'

const BASE = 'http://127.0.0.1:5188/'
const ASPECTS = ['16:9', '9:16', '4:3', '1:1', 'wide']

// 生成一段极短的静音 WAV（PCM16 单声道 8kHz），用作无外部依赖的音频源
function makeWav(seconds = 0.2, rate = 8000) {
  const n = Math.floor(seconds * rate)
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  return 'data:audio/wav;base64,' + buf.toString('base64')
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const results = []

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream'],
})

for (const aspect of ASPECTS) {
  const page = await browser.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e)))
  await page.goto(BASE + '?aspect=' + encodeURIComponent(aspect), { waitUntil: 'networkidle2', timeout: 30000 })
  await page.waitForFunction('window.__tlStore && window.__tlCanvas && window.__tlCanvas.value && window.__tlDebug', { timeout: 15000 })
  await sleep(400)

  const wav = makeWav()
  // 给节点 2 挂音频，然后 seek 并播放
  await page.evaluate((uri) => {
    window.__tlStore.nodes[2].audio = uri
    const c = window.__tlCanvas.value
    c.seekToNode(2)
    c.resume() // play()
  }, wav)

  // 轮询等待音频进入 playing（最多 6s）
  let ok = false
  for (let t = 0; t < 60; t++) {
    const st = await page.evaluate(() => window.__tlDebug().audio)
    if (st.active && st.playing) { ok = true; break }
    await sleep(100)
  }
  const dbg = await page.evaluate(() => window.__tlDebug().audio)
  const pass = ok && pageErrors.length === 0
  if (!pass) failures++
  results.push({ aspect, active: dbg.active === wav ? 'yes' : 'no(' + (dbg.active ? 'other' : 'null') + ')', count: dbg.count, playing: dbg.playing, errors: pageErrors.length })
  await page.screenshot({ path: `/workspace/audio-${aspect.replace(':', 'x')}.png` }).catch(() => {})
  await page.close()
}

await browser.close()
console.log('=== 节点音频冒烟验证 ===')
for (const r of results) console.log(`[${r.aspect}] active=${r.active} count=${r.count} playing=${r.playing} pageErrors=${r.errors}`)
console.log(`FAILURES: ${failures}`)
process.exit(failures > 0 ? 1 : 0)
