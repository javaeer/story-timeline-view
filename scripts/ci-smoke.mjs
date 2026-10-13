// CI 冒烟测试（story-timeline-view）
//
// 启动 `vite preview` 后，用 Puppeteer 校验：
//   1. 应用可加载、时间轴引擎初始化（window.__tlStore / window.__tlCanvas）；
//   2. 默认时间轴数据存在；
//   3. 加载期间无 JS 运行时错误。
//
// 设计原则：自包含、可稳定变绿——不依赖外部资源、不硬编码端口/绝对路径、
// 不触发 ffmpeg.wasm 导出，避免与开发者本地 E2E 调试脚本（scripts/verify-*、
// scripts/test-*，需固定端口/本地素材）耦合。开发者回归用例仍走 verify-*。
import puppeteer from 'puppeteer'

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173'
const fails = []
function assert(name, ok, info = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  → ' + info : ''}`)
  if (!ok) fails.push(name)
}

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
})
try {
  const page = await browser.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e)))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const t = m.text()
    if (/favicon|ERR_ABORTED|Failed to load resource/i.test(t)) return
    errs.push('console:' + t)
  })

  await page.goto(`${BASE}/?aspect=16:9`, { waitUntil: 'networkidle2' })
  await page.waitForFunction(
    'window.__tlStore && window.__tlCanvas && window.__tlCanvas.value',
    { timeout: 20000 }
  )

  const info = await page.evaluate(() => ({
    nodes: window.__tlStore.nodes.length,
    title: window.__tlStore.meta && window.__tlStore.meta.title,
  }))
  assert('应用加载且时间轴引擎初始化', info.nodes > 0, `nodes=${info.nodes}`)
  assert('默认时间轴数据存在', !!info.title, `title=${info.title}`)
  assert('加载期间无 JS 运行时错误', errs.length === 0, errs.slice(0, 3).join(' | '))
} finally {
  await browser.close()
}

console.log(`\nFAILURES: ${fails.length}`)
process.exit(fails.length ? 1 : 0)
