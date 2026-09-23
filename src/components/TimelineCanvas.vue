<script setup>
import { onMounted, ref, watch, nextTick } from 'vue'
import { buildSchedule, locate, xAtTravel } from '../composables/useTimeline.js'

const props = defineProps({
  nodes: { type: Array, required: true },
  fps: { type: Number, default: 25 },
  frame: { type: Number, default: null },   // 非空 => 确定性静态帧（出片用）
  frames: { type: Number, default: 300 },    // 静态帧模式下的总帧数
})

const cv = ref(null)
let ctx = null
let sched = null
let nodeXArr = []
let tSec = 0
let mode = 'loop' // 'static' | 'loop' | 'once'
let raf = 0
let recorder = null
let recordResolve = null
const imgCache = new Map() // url -> HTMLImageElement（懒加载，绘制前预热）

// 预热节点图片：本地/同域图可直接绘制；跨域图会被浏览器限制，需服务端允许 CORS
function preloadImages(nodes) {
  for (const n of nodes || []) {
    const imgs = n.images || []
    for (const url of imgs) {
      if (!url || imgCache.has(url)) continue
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        // 静态帧（出片）模式只画一次，图片就绪后需补画一帧
        if (mode === 'static' && ctx) draw(props.frame / (props.frames - 1))
      }
      img.onerror = () => { /* 加载失败则保持未就绪，绘制时走占位 */ }
      img.src = url
      imgCache.set(url, img)
    }
  }
}

// 主题 token（与 DataViz index.css 一致）
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

// Catmull-Rom 平滑曲线采样
function buildPath(W, H, X0, X1, BASE_Y, AMP, n) {
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
  return { path, pts }
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

// 以 cover 方式把图片绘制进矩形（保持比例、居中裁切）
function drawCover(img, x, y, w, h) {
  const ir = img.naturalWidth / img.naturalHeight
  const r = w / h
  let dw, dh, dx, dy
  if (ir > r) { dh = h; dw = h * ir; dx = x + (w - dw) / 2; dy = y }
  else { dw = w; dh = w / ir; dx = x; dy = y + (h - dh) / 2 }
  ctx.drawImage(img, dx, dy, dw, dh)
}

function draw(p) {
  const cvs = cv.value
  if (!cvs || !ctx) return
  const W = cvs.width, H = cvs.height
  const S = H / 820
  ctx.clearRect(0, 0, W, H)

  const n = props.nodes.length
  const X0 = 0.13 * W, X1 = 0.87 * W, BASE_Y = 0.50 * H, AMP = 0.065 * H
  const { path, pts } = buildPath(W, H, X0, X1, BASE_Y, AMP, n)
  const loc = locate(sched, p * sched.totalSec)
  const revealX = xAtTravel(sched, loc.travel, nodeXArr)
  const fade = Math.min(p / 0.04, 1)

  // 完整路径（暗，提示走向）
  ctx.save()
  ctx.strokeStyle = C.lineFaint
  ctx.lineWidth = 2
  ctx.setLineDash([2, 10])
  ctx.beginPath()
  ctx.moveTo(path[0].x, path[0].y)
  for (const q of path) ctx.lineTo(q.x, q.y)
  ctx.stroke()
  ctx.restore()

  // 已揭示路径（发光曲线推进）
  const grad = ctx.createLinearGradient(X0, 0, X1, 0)
  grad.addColorStop(0, C.accent)
  grad.addColorStop(1, C.accent2)
  ctx.save()
  ctx.strokeStyle = grad
  ctx.lineWidth = 4.5 * S
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.shadowColor = C.accent
  ctx.shadowBlur = 16 * S
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

  // 播放头脉冲点
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

  // 节点 + 标签（按奇偶固定上/下，避免相邻碰撞）
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
      const below = i % 2 === 1
      const ly = pts[i].y + (below ? 30 : -30) * S
      ctx.textAlign = 'center'
      ctx.globalAlpha = (reached ? 1 : 0.4) * fade
      ctx.fillStyle = reached ? C.text : C.muted
      ctx.font = FONT('400', Math.round(18 * S), false)
      ctx.textBaseline = below ? 'top' : 'bottom'
      ctx.fillText(props.nodes[i].title, pts[i].x, ly - (below ? 0 : 30 * S))
      ctx.fillStyle = reached ? C.nodeOn : C.muted
      ctx.font = FONT('700', Math.round(20 * S), true)
      ctx.fillText(props.nodes[i].year, pts[i].x, ly + (below ? 0 : -4 * S))
      ctx.globalAlpha = fade
    }
  }

  // 当前节点展开卡片（含可选图片集，停留期间自动轮播）
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

    // 图片区（自动轮播）：按「节点内进度 × 时长约束」选图，每张至少约 1.6s
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
        // 占位框：图片未加载/跨域受限时显示
        roundRect(ix, iy, iw, ih, 12 * S)
        ctx.fillStyle = 'rgba(138,161,229,0.10)'
        ctx.fill()
        ctx.fillStyle = 'rgba(217,227,255,0.5)'
        ctx.font = FONT('400', Math.round(15 * S), false)
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText('图片加载中 / 受限', ix + iw / 2, iy + ih / 2)
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
      }
      // 图片序号角标
      ctx.fillStyle = 'rgba(3,7,15,0.6)'
      ctx.font = FONT('600', Math.round(14 * S), true)
      ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic'
      ctx.fillText(`${imgIndex + 1}/${imgs.length}`, cx + cardW - 18 * S, iy + ih - 8 * S)
      ctx.textAlign = 'left'
    }

    const textTop = cy + imgH
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = C.accent2
    ctx.font = FONT('700', Math.round(34 * S), true)
    ctx.fillText(d.year, cx + 28 * S, textTop + 40 * S)
    if (d.key) {
      ctx.fillStyle = 'rgba(255,212,90,0.92)'
      ctx.font = FONT('600', Math.round(17 * S), false)
      ctx.textAlign = 'right'
      ctx.fillText('关键节点', cx + cardW - 24 * S, textTop + 18 * S)
      ctx.textAlign = 'left'
    }
    ctx.fillStyle = C.text
    ctx.font = FONT('700', Math.round(27 * S), false)
    ctx.fillText(d.title, cx + 28 * S, textTop + 86 * S)
    ctx.fillStyle = C.muted
    ctx.font = FONT('400', Math.round(21 * S), false)
    ctx.fillText(d.desc, cx + 28 * S, textTop + 128 * S)
    ctx.restore()
  }

  // 右下角巨大年份水印
  if (cur >= 0) {
    ctx.save()
    ctx.textAlign = 'right'
    ctx.textBaseline = 'bottom'
    ctx.fillStyle = C.yearBig
    ctx.font = FONT('700', Math.round(0.20 * H), true)
    const by = props.nodes[cur].year.replace(/\.\d+$/, '').replace('今天', 'NOW')
    ctx.fillText(by, W - 22, H - 14)
    ctx.restore()
  }
  ctx.globalAlpha = 1
}

function rebuild() {
  sched = buildSchedule(props.nodes)
}

function loop() {
  if (mode === 'static') return
  tSec += 1 / props.fps
  const total = sched.totalSec
  if (mode === 'once' && tSec >= total) {
    tSec = total
    draw(1)
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    return
  }
  if (mode === 'loop' && tSec > total) tSec = 0
  draw(Math.min(tSec / total, 1))
  raf = requestAnimationFrame(loop)
}

function startLoop() {
  cancelAnimationFrame(raf)
  raf = requestAnimationFrame(loop)
}

function pickMime() {
  if (!window.MediaRecorder) return ''
  const cands = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
  for (const c of cands) if (MediaRecorder.isTypeSupported(c)) return c
  return ''
}

// 从头录制一遍并导出 webm
async function startRecording() {
  if (!cv.value) throw new Error('画布未就绪')
  if (!window.MediaRecorder) throw new Error('当前浏览器不支持 MediaRecorder，请用 Chrome/Edge')
  const stream = cv.value.captureStream(props.fps)
  const mime = pickMime()
  recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
  const chunks = []
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data) }
  const done = new Promise((res) => {
    recorder.onstop = () => res(new Blob(chunks, { type: mime || 'video/webm' }))
  })
  rebuild()
  tSec = 0
  mode = 'once'
  recorder.start()
  startLoop()
  return done
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
    // 最多等 600ms；无网/字体拉取失败时回退系统字体继续绘制
    try { await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 600))]) } catch (e) { /* 忽略 */ }
  }
  const el = cv.value
  const r = el.getBoundingClientRect()
  el.width = Math.max(200, Math.round(r.width) || 1864)
  el.height = Math.max(160, Math.round(r.height) || 824)
  ctx = el.getContext('2d')
  rebuild()
  preloadImages(props.nodes)
  if (props.frame !== null) {
    mode = 'static'
    draw(props.frame / (props.frames - 1))
  } else {
    mode = 'loop'
    startLoop()
  }
})

// 节点数据变化（导入/编辑/增删/调时长）→ 重建节奏；静态帧模式同步重绘
watch(
  () => props.nodes,
  () => {
    rebuild()
    preloadImages(props.nodes)
    if (mode === 'static') draw(props.frame / (props.frames - 1))
  },
  { deep: true }
)
</script>

<template>
  <canvas ref="cv" class="tl-canvas"></canvas>
</template>
