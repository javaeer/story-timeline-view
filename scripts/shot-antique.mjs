import puppeteer from 'puppeteer'
const b = await puppeteer.launch({ executablePath:'/usr/bin/chromium', headless:'new',
  args:['--no-sandbox','--disable-setuid-sandbox','--disable-background-timer-throttling'] })
const frames = [['node03', 760], ['node14', 3800], ['node27', 7450]]
for (const [tag, frame] of frames) {
  const p = await b.newPage()
  await p.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 })
  const errs = []
  p.on('pageerror', e => errs.push(String(e)))
  await p.goto(`http://127.0.0.1:5180/?duration=290&frame=${frame}`, { waitUntil:'networkidle2', timeout:30000 })
  await new Promise(r => setTimeout(r, 1200))
  // 读出当前卡片标题(通过 DOM 不可得，直接截图+报错)
  await (await p.$('canvas')).screenshot({ path: `/tmp/antique-${tag}.png` })
  // 额外：用 canvas 文本探测确认用的是衬线字体(取页面 document.fonts 是否含 Noto Serif CJK SC)
  const info = await p.evaluate(() => {
    const f = [...(document.fonts||[])]
    return { loaded: f.filter(x=>x.status==='loaded').map(x=>x.family+':'+x.weight) }
  })
  console.log(tag, JSON.stringify({ pageErrors: errs, fonts: info.loaded }))
  await p.close()
}
await b.close()
