import puppeteer from 'puppeteer'

const URL = process.env.TEST_URL || 'http://127.0.0.1:5180/'
const CLIP = '/tmp/test-clip.webm'

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium',
  headless: 'new',
  args: [
    '--no-sandbox', '--disable-setuid-sandbox',
    '--disable-background-timer-throttling',
    '--autoplay-policy=no-user-gesture-required',
  ],
})
const page = await browser.newPage()
const errors = []
const consoleErrs = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text()) })

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 })

// 找到视频隐藏 input 并上传测试文件
const handle = await page.evaluateHandle(() => {
  return document.querySelector('input[type="file"][accept^="video"]')
})
const input = handle.asElement()
if (!input) throw new Error('未找到视频隐藏 input')

// 上传前记录页面是否存活
const beforeAlive = await page.evaluate(() => !!document.querySelector('canvas'))

await input.uploadFile(CLIP)

// 等待选择处理 + 渲染联动
await new Promise((r) => setTimeout(r, 1200))

// 1) 节点是否显示已选 + video 字段为 blob:
const info = await page.evaluate(() => {
  const aside = document.querySelector('.panel')
  const txt = aside ? aside.innerText : ''
  return {
    alive: !!document.querySelector('canvas'),
    hasPicked: /🎬已选/.test(txt),
    // 视频 URL input 的 value（应为 blob: 短串，而非 data: 巨型串）
    videoInputVal: (() => {
      const inp = [...document.querySelectorAll('input')].find((i) => i.value && i.value.startsWith('blob:'))
      return inp ? inp.value : null
    })(),
  }
})

// 2) 画布里是否真的创建了一个 <video> 且带 blob: src 并尝试播放（无异常）
const vidState = await page.evaluate(() => {
  const vs = [...document.querySelectorAll('video')]
  return vs.map((v) => ({
    src: v.src ? v.src.slice(0, 24) : null,
    readyState: v.readyState,
    paused: v.paused,
    width: v.videoWidth,
  }))
})

console.log(JSON.stringify({
  beforeAlive,
  after: info,
  vidState,
  pageErrors: errors,
  consoleErrors: consoleErrs,
}, null, 2))

await browser.close()
