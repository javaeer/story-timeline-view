import puppeteer from 'puppeteer'
const b = await puppeteer.launch({ executablePath:'/usr/bin/chromium', headless:'new',
  args:['--no-sandbox','--disable-setuid-sandbox','--disable-background-timer-throttling'] })
const frames = [['pos03', 800], ['pos14', 3750], ['pos27', 7200]]
for (const [tag, frame] of frames) {
  const p = await b.newPage()
  await p.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 })
  const errs = []
  p.on('pageerror', e => errs.push(String(e)))
  await p.goto(`http://127.0.0.1:5180/?duration=290&frame=${frame}`, { waitUntil:'networkidle2', timeout:30000 })
  await new Promise(r => setTimeout(r, 1000))
  await (await p.$('canvas')).screenshot({ path: `/tmp/town-${tag}.png` })
  console.log(tag, JSON.stringify({ pageErrors: errs }))
  await p.close()
}
await b.close()
