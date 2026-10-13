import puppeteer from 'puppeteer'
const browser = await puppeteer.launch({ executablePath:'/usr/bin/chromium', headless:'new',
  args:['--no-sandbox','--disable-setuid-sandbox','--disable-background-timer-throttling','--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto('http://127.0.0.1:5180/', { waitUntil:'networkidle2', timeout:30000 })
const input = (await page.evaluateHandle(() => document.querySelector('input[type="file"][accept^="video"]'))).asElement()
await input.uploadFile('/tmp/test-clip.webm')
await new Promise(r => setTimeout(r, 4000))
// 取第 0.30*H 行整行像素，比较两帧差异（testsrc 的横向移动条会经过此带）
const strip = () => page.evaluate(() => {
  const c = document.querySelector('canvas'); const y = (c.height*0.50)|0
  const d = c.getContext('2d').getImageData(0, y, c.width, 1).data
  return Array.from(d)
})
const a = await strip()
await new Promise(r => setTimeout(r, 700))
const b = await strip()
let diff = 0
for (let i=0;i<a.length;i++) if (a[i] !== b[i]) diff++
// 同时和“纯深色背景”对比：视频存在时该行整体应明显比纯黑亮
let lum = 0; for (let i=0;i<a.length;i+=4) lum += (a[i]+a[i+1]+a[i+2])
const avgLum = lum / (a.length/4)
console.log(JSON.stringify({ pageErrors: errors, stripPixelsChanged: diff, avgRowLum: Math.round(avgLum) }, null, 2))
await browser.close()
