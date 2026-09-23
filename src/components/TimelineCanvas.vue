<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { buildSchedule, locate, xAtTravel } from '../composables/useTimeline.js'

const props = defineProps({
  nodes: { type: Array, required: true },
  fps: { type: Number, default: 25 },
  frame: { type: Number, default: null },
  frames: { type: Number, default: 300 },
})

const cv = ref(null)
let ctx = null
let sched = null
let nodeXArr = []
let tSec = 0
let mode = 'loop'
let DPR = 1
let currentScale = 1
const OUT_W = 1920
const OUT_H = 1080
const DW = 1864
const DH = 824
let raf = 0
let startTime = 0
let recorder = null

// === 优化 1：缓存路径与文本宽度 ===
let cachedPath = null
let cachedPts = null
const textWidthCache = new Map() // key: `${text}_${font}` -> width

// === 优化 2：图片缓存 LRU 限制 ===
const imgCache = new Map()
const MAX_CACHE_SIZE = 60 // 限制缓存数量
const imgErrors = new Set() // 记录加载失败的 url，用于重试

function preloadImages(nodes) {
  for (const n of nodes || []) {
    for (const url of n.images || []) {
      if (!url || imgCache.has(url)) continue
      // 清理过期缓存
      if (imgCache.size >= MAX_CACHE_SIZE) {
        const firstKey = imgCache.keys().next().value
        imgCache.delete(firstKey)
      }
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        imgErrors.delete(url)
        if (mode === 'static' && ctx) draw(props.frame / (props.frames - 1))
      }
      img.onerror = () => {
        imgCache.delete(url) // 失败则从缓存剔除，下次可重试
        imgErrors.add(url)
      }
      img.src = url
      imgCache.set(url, img)
    }
  }
}

const C = {
  text: '#f2f4fb',
  muted: 'rgba(217,227,255,0.62)',
  accent: '#ff6d6d',
  accent2: '#ffd45a',
  nodeDim: 'rgba(138,161,229,0.40)',
  nodeOn: '#ff9a86',
  cardBg: 'rgba(8,14,28,0.90)',
  cardBorder: 'rgba(138,161,229,0.22)',
  yearBig: 'rgba(227,236,255,0.09)',
  lineFaint: 'rgba(138,161,229,0.16)',
}
const FONT = (wt, sz, latin) =>
    `${wt} ${sz}px ${latin ? "'Sora','Noto Sans CJK SC',sans-serif" : "'Noto Sans CJK SC','Noto Sans SC',sans-serif"}`

// === 优化 1：路径构建与文本测量移至 rebuild ===
function rebuild() {
  sched = buildSchedule(props.nodes)
  const n = props.nodes.length
  if (n === 0) {
    cachedPath = []
    cachedPts = []
    return
  }
  const X0 = 0.13 * DW, X1 = 0.87 * DW, BASE_Y = 0.50 * DH, AMP = 0.065 * DH
  const pts = []
  for (let i = 0; i < n; i++) pts.push({ x: X0 + (X1 - X0) * (i / (n - 1)), y: BASE_Y + AMP * Math.sin(i * 0.95 + 0.3) })
  nodeXArr = pts.map((p) => p.x)

  const P = [pts[0], ...pts, pts[n - 1]]
  const SAMPLES = 600
  const per = SAMPLES / (n - 1)
  const path = []
  const cat = (p0, p1, p2, p3, t) => {
    const t2 = t * t, t3 = t2 * t
    return {
      x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
      y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
    }
  }
  for (let i = 0; i < n - 1; i++)
    for (let s = 0; s < per; s++) { const t = s / per; path.push(cat(P[i], P[i + 1], P[i + 2], P[i + 3], t)) }
  path.push({ ...pts[n - 1] })

  cachedPath = path
  cachedPts = pts

  // 预计算文本宽度
  textWidthCache.clear()
  const TITLE_F = FONT('400', 18, false)
  const YEAR_F = FONT('700', 20, true)
  for (const node of props.nodes) {
    const tk = `${node.title || ''}_${TITLE_F}`
    const yk = `${node.year || ''}_${YEAR_F}`
    if (!textWidthCache.has(tk)) {
      ctx.font = TITLE_F
      textWidthCache.set(tk, ctx.measureText(node.title || '').width)
    }
    if (!textWidthCache.has(yk)) {
      ctx.font = YEAR_F
      textWidthCache.set(yk, ctx.measureText(node.year || '').width)
    }
  }
}

function pointAtX(path, x) {
  if (x <= path[0].x) return path[0]
  if (x >= path[path.length - 1].x) return path[path.length - 1]
  let lo = 0, hi = path.length - 1
  while (lo < hi) { const mid = (lo + hi) >> 1; if (path[mid].x < x) lo = mid + 1; else hi = mid }
  const a = path[lo - 1] || path[lo], b = path[lo]
  const t = (x - a.x) / (b.x - a.x || 1)
  return { x, y: a.y + (b.y - a.y) * t }
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function drawCover(img, x, y, w, h) {
  const ir = img.naturalWidth / img.naturalHeight
  const r = w / h
  let dw, dh, dx, dy
  if (ir > r) { dh = h; dw = h * ir; dx = x + (w - dw) / 2; dy = y }
  else { dw = w; dh = w / ir; dx = x; dy = y + (h - dh) / 2 }
  ctx.drawImage(img, dx, dy, dw, dh)
}

// === 优化 1：使用缓存的文本宽度，不再每帧 measureText ===
function layoutLabels(nodes, pts, cur) {
  const TITLE_F = FONT('400', 18, false)
  const YEAR_F = FONT('700', 20, true)
  const getW = (text, font) => textWidthCache.get(`${text}_${font}`) || 0
  const items = []
  for (let i = 0; i < nodes.length; i++) {
    if (i === cur) continue
    const tw = getW(nodes[i].title || '', TITLE_F)
    const yw = getW(nodes[i].year || '', YEAR_F)
    items.push({ i, x: pts[i].x, w: Math.max(tw, yw) / 2 + 12, side: i % 2 === 1 ? 1 : -1, shift: 0 })
  }
  items.sort((a, b) => a.x - b.x)
  const lastEnd = { '-1': -Infinity, 1: -Infinity }
  const SH = 56
  for (const it of items) {
    const start = it.x - it.w
    if (lastEnd[it.side] <= start) {
      it.shift = 0
      lastEnd[it.side] = it.x + it.w
    } else if (lastEnd[-it.side] <= start) {
      it.side = -it.side
      it.shift = 0
      lastEnd[it.side] = it.x + it.w
    } else {
      it.shift = SH
      lastEnd[it.side] = it.x + it.w
    }
  }
  const map = new Map()
  for (const it of items) map.set(it.i, it)
  return map
}

function draw(p) {
  const cvs = cv.value
  if (!cvs || !ctx || !cachedPath || cachedPath.length === 0) return
  const W = DW, H = DH, S = 1
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, cvs.width, cvs.height)
  ctx.restore()

  const n = props.nodes.length
  const path = cachedPath
  const pts = cachedPts
  const X0 = 0.13 * W, X1 = 0.87 * W

  const loc = locate(sched, p * sched.totalSec)
  const revealX = xAtTravel(sched, loc.travel, nodeXArr)
  const fade = Math.min(p / 0.04, 1)

  // 完整路径（暗）
  ctx.save()
  ctx.strokeStyle = C.lineFaint
  ctx.lineWidth = 2 / (currentScale || 1) * S
  ctx.setLineDash([2, 10])
  ctx.beginPath()
  ctx.moveTo(path[0].x, path[0].y)
  for (const q of path) ctx.lineTo(q.x, q.y)
  ctx.stroke()
  ctx.restore()

  // 已揭示路径（发光）
  const grad = ctx.createLinearGradient(X0, 0, X1, 0)
  grad.addColorStop(0, C.accent)
  grad.addColorStop(1, C.accent2)
  ctx.save()
  ctx.strokeStyle = grad
  ctx.lineWidth = 2.5 / (currentScale || 1) * S
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.shadowColor = C.accent
  ctx.shadowBlur = 8 / (currentScale || 1) * S
  ctx.beginPath()
  let started = false, last = null
  for (const q of path) {
    if (q.x > revealX) {
      if (last) {
        const t = (revealX - last.x) / (q.x - last.x || 1)
        ctx.lineTo(last.x + (q.x - last.x) * t, last.y + (q.y - last.y) * t)
      }
      break
    }
    if (!started) { ctx.moveTo(q.x, q.y); started = true } else ctx.lineTo(q.x, q.y)
    last = q
  }
  if (!started) ctx.moveTo(path[0].x, path[0].y)
  ctx.stroke()
  ctx.restore()

  let cur = -1
  for (let i = 0; i < n; i++) if (pts[i].x <= revealX + 0.5) cur = i

  if (loc.travel > 0.001) {
    const pp = pointAtX(path, revealX)
    ctx.save()
    ctx.shadowColor = C.accent2
    ctx.shadowBlur = 22 * S
    ctx.beginPath()
    ctx.arc(pp.x, pp.y, 7 * S, 0, Math.PI * 2)
    ctx.fillStyle = C.accent2
    ctx.fill()
    ctx.restore()
  }

  const labelLayout = layoutLabels(props.nodes, pts, cur)
  for (let i = 0; i < n; i++) {
    const reached = pts[i].x <= revealX + 0.5
    const isCur = i === cur
    const r = (isCur ? 13 : reached ? 8 : 6) * S
    ctx.save()
    if (reached) { ctx.shadowColor = C.accent; ctx.shadowBlur = (isCur ? 30 : 14) * S }
    ctx.beginPath()
    ctx.arc(pts[i].x, pts[i].y, r, 0, Math.PI * 2)
    ctx.fillStyle = reached ? (isCur ? C.accent2 : C.nodeOn) : C.nodeDim
    ctx.fill()
    ctx.restore()
    if (props.nodes[i].key && reached) {
      ctx.beginPath()
      ctx.arc(pts[i].x, pts[i].y, r + 7 * S, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(255,212,90,0.6)'
      ctx.lineWidth = 2 * S
      ctx.stroke()
    }
    if (!isCur) {
      const it = labelLayout.get(i)
      const below = it ? it.side > 0 : i % 2 === 1
      const shift = it ? it.shift : 0
      const gap = 22 * S // 标题与年份的垂直间距

      ctx.textAlign = 'center'
      ctx.globalAlpha = (reached ? 1 : 0.4) * fade

      if (below) {
        // 标签在曲线下方：从上往下排。年份在上，标题在下。
        ctx.textBaseline = 'top'
        const startY = pts[i].y + 30 * S + shift

        // 绘制年份
        ctx.fillStyle = reached ? C.nodeOn : C.muted
        ctx.font = FONT('700', 20 * S, true)
        ctx.fillText(props.nodes[i].year, pts[i].x, startY)

        // 绘制标题
        ctx.fillStyle = reached ? C.text : C.muted
        ctx.font = FONT('400', 18 * S, false)
        ctx.fillText(props.nodes[i].title, pts[i].x, startY + gap)
      } else {
        // 标签在曲线上方：从下往上排。年份在下（靠近曲线），标题在上。
        ctx.textBaseline = 'bottom'
        const startY = pts[i].y - 30 * S - shift

        // 绘制年份
        ctx.fillStyle = reached ? C.nodeOn : C.muted
        ctx.font = FONT('700', 20 * S, true)
        ctx.fillText(props.nodes[i].year, pts[i].x, startY)

        // 绘制标题
        ctx.fillStyle = reached ? C.text : C.muted
        ctx.font = FONT('400', 18 * S, false)
        ctx.fillText(props.nodes[i].title, pts[i].x, startY - gap)
      }

      ctx.globalAlpha = fade
    }
  }

  // 当前节点卡片（略，逻辑与原来一致，仅移除重复的文本测量）
  if (cur >= 0) {
    const d = props.nodes[cur]
    const a = Math.min(Math.max(loc.intra / 0.22, 0), 1)
    const cardW = Math.min(380 * S, 0.26 * W)
    const imgs = d.images || []
    const hasImg = imgs.length > 0
    const imgH = hasImg ? 150 * S : 0
    const cardH = (hasImg ? imgH + 150 * S : 180 * S)
    let cx = pts[cur].x > W * 0.62 ? pts[cur].x - cardW - 40 * S : pts[cur].x + 40 * S
    cx = Math.max(20, Math.min(cx, W - cardW - 20))
    let cy = Math.max(16, Math.min(pts[cur].y - cardH / 2, H - cardH - 16))
    const grow = 0.94 + 0.06 * a
    ctx.save()
    ctx.globalAlpha = a
    ctx.translate(cx + cardW / 2, cy + cardH / 2)
    ctx.scale(grow, grow)
    ctx.translate(-(cx + cardW / 2), -(cy + cardH / 2))
    ctx.shadowColor = 'rgba(0,0,0,0.4)'
    ctx.shadowBlur = 26 * S
    ctx.shadowOffsetY = 12 * S
    roundRect(cx, cy, cardW, cardH, 22 * S)
    ctx.fillStyle = C.cardBg
    ctx.fill()
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.shadowOffsetY = 0
    ctx.lineWidth = 1.4 * S
    ctx.strokeStyle = C.cardBorder
    ctx.stroke()
    const lg = ctx.createLinearGradient(cx, cy, cx, cy + cardH)
    lg.addColorStop(0, C.accent)
    lg.addColorStop(1, C.accent2)
    roundRect(cx, cy, 6 * S, cardH, 3 * S)
    ctx.fillStyle = lg
    ctx.fill()

    if (hasImg) {
      const dur = sched.durs[cur] || 3
      const minShow = 1.6
      const maxN = Math.max(1, Math.min(imgs.length, Math.floor(dur / minShow)))
      const imgIndex = Math.min(Math.floor(loc.intra * maxN), maxN - 1)
      const ix = cx + 16 * S, iy = cy + 14 * S, iw = cardW - 32 * S, ih = imgH - 28 * S
      const img = imgCache.get(imgs[imgIndex])
      if (img && img.complete && img.naturalWidth) {
        roundRect(ix, iy, iw, ih, 12 * S)
        ctx.save(); ctx.clip()
        drawCover(img, ix, iy, iw, ih)
        ctx.restore()
      } else {
        roundRect(ix, iy, iw, ih, 12 * S)
        ctx.fillStyle = 'rgba(138,161,229,0.10)'
        ctx.fill()
        ctx.fillStyle = 'rgba(217,227,255,0.5)'
        ctx.font = FONT('400', 15 * S, false)
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText(imgErrors.has(imgs[imgIndex]) ? '图片加载失败' : '图片加载中 / 受限', ix + iw / 2, iy + ih / 2)
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
      }
      ctx.fillStyle = 'rgba(3,7,15,0.6)'
      ctx.font = FONT('600', 14 * S, true)
      ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic'
      ctx.fillText(`${imgIndex + 1}/${imgs.length}`, cx + cardW - 18 * S, iy + ih - 8 * S)
      ctx.textAlign = 'left'
    }

    const textTop = cy + imgH
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = C.accent2
    ctx.font = FONT('700', 34 * S, true)
    ctx.fillText(d.year, cx + 28 * S, textTop + 40 * S)
    if (d.key) {
      ctx.fillStyle = 'rgba(255,212,90,0.92)'
      ctx.font = FONT('600', 17 * S, false)
      ctx.textAlign = 'right'
      ctx.fillText('关键节点', cx + cardW - 24 * S, textTop + 18 * S)
      ctx.textAlign = 'left'
    }
    ctx.fillStyle = C.text
    ctx.font = FONT('700', 27 * S, false)
    ctx.fillText(d.title, cx + 28 * S, textTop + 86 * S)
    ctx.fillStyle = C.muted
    ctx.font = FONT('400', 21 * S, false)
    ctx.fillText(d.desc, cx + 28 * S, textTop + 128 * S)
    ctx.restore()
  }

  if (cur >= 0) {
    ctx.save()
    ctx.textAlign = 'right'
    ctx.textBaseline = 'bottom'
    ctx.fillStyle = C.yearBig
    ctx.font = FONT('700', 0.20 * H, true)
    const by = props.nodes[cur].year.replace(/\.\d+$/, '').replace('今天', 'NOW')
    ctx.fillText(by, W - 22, H - 14)
    ctx.restore()
  }
  ctx.globalAlpha = 1
}

function fit() {
  const el = cv.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const cssW = Math.max(200, Math.round(r.width) || DW)
  const cssH = Math.max(160, Math.round(r.height) || DH)
  const bw = Math.round(cssW * DPR)
  const bh = Math.round(cssH * DPR)
  if (el.width !== bw) el.width = bw
  if (el.height !== bh) el.height = bh
  ctx = el.getContext('2d')
  const k = Math.min(bw / DW, bh / DH)
  const ox = (bw - DW * k) / 2
  const oy = (bh - DH * k) / 2
  ctx.setTransform(k, 0, 0, k, ox, oy)
  currentScale = k
}

function fitForRecording() {
  const el = cv.value
  if (!el) return
  el.width = OUT_W
  el.height = OUT_H
  ctx = el.getContext('2d')
  const k = Math.min(OUT_W / DW, OUT_H / DH)
  const ox = (OUT_W - DW * k) / 2
  const oy = (OUT_H - DH * k) / 2
  ctx.setTransform(k, 0, 0, k, ox, oy)
  currentScale = k
}

function loop(ts) {
  if (mode === 'static') return
  const total = sched.totalSec
  const tailSec = 2.5 // 尾部停留时间：最后一个节点卡片多展示 2.5 秒

  if (mode === 'once') {
    const elapsed = (ts - startTime) / 1000
    let p = total > 0 ? Math.min(elapsed / total, 1) : 1
    draw(p) // p 到达 1 后保持不变，继续绘制完整卡片

    // 只有 动画时长 + 尾部停留时间 都走完，才真正停止
    if (p >= 1 && elapsed > total + tailSec) {
      if (recorder && recorder.state !== 'inactive') recorder.stop()
      return
    }
    raf = requestAnimationFrame(loop)
    return
  }

  // loop 模式：在尾部也停留 tailSec 秒再重置
  const elapsed = (ts - startTime) / 1000
  const cycleTime = total + tailSec // 总周期 = 动画时长 + 停留时长
  const cycleP = elapsed % cycleTime
  let p = total > 0 ? Math.min(cycleP / total, 1) : 0
  draw(p)
  raf = requestAnimationFrame(loop)
}

function startLoop() {
  cancelAnimationFrame(raf)
  startTime = performance.now()
  raf = requestAnimationFrame(loop)
}

function pickMime() {
  if (!window.MediaRecorder) return ''
  const cands = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
  for (const c of cands) if (MediaRecorder.isTypeSupported(c)) return c
  return ''
}

// === 优化 3：录制异常处理，确保失败时恢复预览 ===
async function startRecording() {
  const el = cv.value
  if (!el || !el.captureStream) throw new Error('画布未就绪或浏览器不支持 captureStream')
  if (!window.MediaRecorder) throw new Error('当前浏览器不支持 MediaRecorder，请用 Chrome/Edge')

  try {
    fitForRecording()
    const stream = el.captureStream(props.fps)
    const mime = pickMime()
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    const chunks = []
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data) }
    const done = new Promise((res) => {
      recorder.onstop = () => {
        try {
          DPR = window.devicePixelRatio || 1
          fit()
          mode = 'loop'
          tSec = 0
          startLoop()
        } catch (e) { /* 组件可能已卸载 */ }
        res(new Blob(chunks, { type: mime || 'video/webm' }))
      }
    })
    rebuild()
    tSec = 0
    mode = 'once'
    recorder.start()
    startLoop()
    return done
  } catch (err) {
    // 异常恢复：重置画布与模式
    DPR = window.devicePixelRatio || 1
    fit()
    mode = 'loop'
    startLoop()
    throw err
  }
}

function replay() {
  rebuild()
  tSec = 0
  mode = 'loop'
  startLoop()
}

defineExpose({ startRecording, replay, getCanvas: () => cv.value })

onMounted(async () => {
  if (document.fonts && document.fonts.ready) {
    try { await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 600))]) } catch (e) { /* 忽略 */ }
  }
  DPR = window.devicePixelRatio || 1
  fit()
  rebuild()
  preloadImages(props.nodes)
  if (props.frame !== null) {
    mode = 'static'
    draw(props.frame / (props.frames - 1))
  } else {
    mode = 'loop'
    startLoop()
  }
  window.addEventListener('resize', onResize)
})

function onResize() {
  DPR = window.devicePixelRatio || 1
  fit()
  if (mode === 'static') draw(props.frame / (props.frames - 1))
}

onUnmounted(() => {
  cancelAnimationFrame(raf)
  if (recorder && recorder.state !== 'inactive') {
    try { recorder.stop() } catch (e) { /* 忽略 */ }
  }
  window.removeEventListener('resize', onResize)
})

// === 优化 4 & 5：监听优化，避免全量深度遍历和重复加载 ===
watch(
    () => props.nodes.length + '|' + props.nodes.map(n => `${n.title}_${n.year}_${(n.images||[]).length}`).join(','),
    (newVal, oldVal) => {
      if (newVal === oldVal) return
      rebuild()
      preloadImages(props.nodes)
      if (mode === 'static') {
        draw(props.frame / (props.frames - 1))
      } else if (mode === 'loop') {
        const total = sched.totalSec
        const p = total > 0 ? ((performance.now() - startTime) / 1000 / total) % 1 : 0
        draw(p < 0 ? p + 1 : p)
      } else {
        mode = 'loop'
        tSec = 0
        startLoop()
      }
    }
)
</script>

<template>
  <canvas ref="cv" class="tl-canvas"></canvas>
</template>