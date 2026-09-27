import puppeteer from 'puppeteer'
const b = await puppeteer.launch({ executablePath:'/usr/bin/chromium', headless:'new', args:['--no-sandbox','--disable-setuid-sandbox','--autoplay-policy=no-user-gesture-required'] })
const p = await b.newPage()
await p.goto('http://127.0.0.1:5180/', { waitUntil:'networkidle2' })
const r = await p.evaluate(() => {
  const v = document.createElement('video')
  return { hasNaturalWidth: 'naturalWidth' in v, nw: v.naturalWidth, vw: v.videoWidth }
})
console.log(JSON.stringify(r))
await b.close()
