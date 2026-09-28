import puppeteer from 'puppeteer'
import fs from 'fs'

const json = JSON.parse(fs.readFileSync('/root/uploads/1790521268223013962-20260927_f8e3e2.json', 'utf8'))
const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox'] })
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('PAGEERR:', e.message))
await page.goto('http://127.0.0.1:5173/?aspect=16:9', { waitUntil: 'networkidle2' })
await page.waitForFunction('window.__tlLoadData', { timeout: 15000 })

// 先测小 JSON，确认 loadData 本身无 const 错误
const small = await page.evaluate(() => {
  try { window.__tlLoadData({ meta: { title: 't' }, nodes: [{ year: '2020', title: 'a', desc: 'b' }] }); return { ok: true } }
  catch (e) { return { ok: false, msg: e.message } }
})
console.log('SMALL:', JSON.stringify(small))

// 再测用户 JSON
const r = await page.evaluate((j) => {
  try { window.__tlLoadData(j); return { ok: true, nodes: window.__tlStore.nodes.length } }
  catch (e) { return { ok: false, msg: e.message, stack: (e.stack || '').split('\n').slice(0, 6) } }
}, json)
console.log('USER:', JSON.stringify(r, null, 2))
await browser.close()
