import puppeteer from 'puppeteer'

const PORT = process.env.PORT || 5188
const base = `http://127.0.0.1:${PORT}`
const aspects = ['16:9', '9:16', '4:3', '1:1', 'wide']
// 命中每个节点的中部帧（基于 buildSchedule 推算：intro0.8 + 各节点~10.5s）
const framesByNode = [156, 425, 688, 950, 1213, 1475, 1738]

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium', headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-background-timer-throttling', '--force-device-scale-factor=1'],
})

let failures = 0
const out = []
for (const id of aspects) {
  for (const fr of framesByNode) {
    const p = await browser.newPage()
    const errs = []
    p.on('pageerror', (e) => errs.push(String(e)))
    p.on('console', (m) => {
      if (m.type() !== 'error') return
      const t = m.text()
      // 已知的良性网络噪声（favicon 404 / 预览服务空闲断连），非渲染错误，忽略
      if (/Failed to load resource|ERR_CONNECTION_CLOSED|favicon|status of 404/i.test(t)) return
      errs.push('console:' + t)
    })
    await p.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 })
    await p.goto(`${base}/?frame=${fr}&aspect=${id}`, { waitUntil: 'networkidle2', timeout: 30000 })
    await new Promise((r) => setTimeout(r, 400))
    const info = await p.evaluate(() => {
      const dbg = window.__tlDebug && window.__tlDebug()
      const c = document.querySelector('canvas')
      let blank = true, cssW = 0, cssH = 0, cw = 0, ch = 0
      if (c) {
        const r = c.getBoundingClientRect(); cssW = r.width; cssH = r.height
        cw = c.width; ch = c.height
        try {
          const ctx = c.getContext('2d')
          const d = ctx.getImageData(0, 0, c.width, c.height).data
          let painted = 0
          for (let k = 3; k < d.length; k += 4 * 40) if (d[k] > 8) painted++
          blank = painted < 50
        } catch (e) { /* ignore */ }
      }
      return { dbg, cssW, cssH, cw, ch }
    })
    const d = info.dbg
    let ok = true; const why = []
    if (!d) { ok = false; why.push('no debug') }
    else {
      if (Math.abs(d.S - d.DW / 1920) > 0.01) { ok = false; why.push(`S!=DW/1920 (${d.S.toFixed(3)} vs ${(d.DW / 1920).toFixed(3)})`) }
      const exp = d.DW / d.DH, act = info.cw / info.ch
      if (Math.abs(act - exp) > 0.02) { ok = false; why.push(`canvas ratio ${act.toFixed(3)} != ${exp.toFixed(3)}`) }
      if (d.card) {
        const c = d.card
        if (c.x < -1 || c.y < -1 || c.x + c.w > d.DW + 1 || c.y + c.h > d.DH + 1)
          { ok = false; why.push(`card OOB x${c.x.toFixed(0)} y${c.y.toFixed(0)} w${c.w.toFixed(0)} h${c.h.toFixed(0)} / DW${d.DW} DH${d.DH}`) }
      }
      for (const lb of d.labels) {
        if (lb.x < -1 || lb.x > d.DW + 1 || lb.yearY < -1 || lb.yearY > d.DH + 1 || lb.titleY < -1 || lb.titleY > d.DH + 1) {
          ok = false; why.push(`label OOB i${lb.i} x${lb.x.toFixed(0)} yY${lb.yearY.toFixed(0)} tY${lb.titleY.toFixed(0)}`); break
        }
      }
    }
    if (info.blank) { ok = false; why.push('blank canvas') }
    if (errs.length) { ok = false; why.push('ERR:' + errs.slice(0, 2).join('|')) }
    if (!ok) failures++
    out.push(`${ok ? 'OK  ' : 'FAIL'} ${id.padEnd(4)} fr${String(fr).padStart(4)} S=${d ? d.S.toFixed(3) : '-'} card=${d && d.card ? `${d.card.w.toFixed(0)}x${d.card.h.toFixed(0)}` : '-'} labels=${d ? d.labels.length : '-'} ${why.join('; ')}`)
    await p.close()
  }
  // 每个画幅截一张中间节点图，供人工核对
  const sp = await browser.newPage()
  await sp.setViewport({ width: 1100, height: 1100, deviceScaleFactor: 1 })
  await sp.goto(`${base}/?frame=950&aspect=${id}`, { waitUntil: 'networkidle2', timeout: 30000 })
  await new Promise((r) => setTimeout(r, 500))
  const el = await sp.$('canvas')
  if (el) await el.screenshot({ path: `/workspace/compat-${id.replace(':', 'x')}.png` })
  await sp.close()
}
await browser.close()
console.log(out.join('\n'))
console.log(`\nFAILURES: ${failures}`)
process.exit(failures ? 1 : 0)
