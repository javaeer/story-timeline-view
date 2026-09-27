import puppeteer from 'puppeteer'
const b = await puppeteer.launch({ executablePath:'/usr/bin/chromium', headless:'new',
  args:['--no-sandbox','--disable-setuid-sandbox','--disable-background-timer-throttling'] })
const p = await b.newPage()
await p.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 })
const errs = []
p.on('pageerror', e => errs.push(String(e)))
await p.goto('http://127.0.0.1:5180/?duration=70&frame=875', { waitUntil:'networkidle2', timeout:30000 })
await new Promise(r => setTimeout(r, 1100))
await (await p.$('canvas')).screenshot({ path: '/tmp/sw-7-regression.png' })
console.log(JSON.stringify({ pageErrors: errs }))
await b.close()
