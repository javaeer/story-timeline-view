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
const TAIL_SEC = 1.2 // 录制时尾帧余量，保证最后一张卡片完整收尾
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

// 远程(http/https)背景图统一走同源代理 /__img?u=，避免 Canvas 被跨域图污染导致
// captureStream 录制失败（导出视频无背景）。data: / 相对路径保持原样（本身同源或干净）。
function resolveImgUrl(url) {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) return '/__img?u=' + encodeURIComponent(url)
  return url
}

function preloadImages(nodes) {
  for (const n of nodes || []) {
    for (const url of n.images || []) {
      if (!url || imgCache.has(url)) continue
      // 清理过期缓存
      if (imgCache.size >= MAX_CACHE_SIZE) {
        const firstKey = imgCache.keys().next().value
        imgCache.delete(firstKey)
      }
      const proxied = resolveImgUrl(url)
      const redoStatic = () => { if (mode === 'static' && ctx) draw(props.frame / (props.frames - 1)) }
      const img = new Image()
      img.onload = () => {
        imgErrors.delete(url)
        redoStatic()
      }
      img.onerror = () => {
        // 代理失败（如直接打开静态 dist 无代理服务）→ 回退直连，保预览可见；
        // 但跨域图会污染 Canvas，录制(captureStream)可能失败。
        if (proxied !== url) {
          const f = new Image()
          f.onload = () => { imgErrors.delete(url); redoStatic() }
          f.onerror = () => { imgCache.delete(url); imgErrors.add(url) }
          f.src = url
          imgCache.set(url, f)
          return
        }
        imgCache.delete(url) // 失败则从缓存剔除，下次可重试
        imgErrors.add(url)
      }
      img.src = proxied
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

function drawCover(img, x, y, w, h, zoom = 1) {
  const ir = img.naturalWidth / img.naturalHeight
  const r = w / h
  let dw, dh, dx, dy
  if (ir > r) { dh = h; dw = h * ir; dx = x + (w - dw) / 2; dy = y }
  else { dw = w; dh = w / ir; dx = x; dy = y + (h - dh) / 2 }
  // Ken Burns：以画面中心缓慢放大（zoom>1 即放大并裁切中心，营造资料片推镜）
  const zx = (dw * (zoom - 1)) / 2
  const zy = (dh * (zoom - 1)) / 2
  ctx.drawImage(img, dx - zx, dy - zy, dw + 2 * zx, dh + 2 * zy)
}

// === 优化 1：使用缓存的文本宽度，不再每帧 measureText ===
// 标签布局：把每个标签当成「真实矩形包围盒」，与已放置标签、以及当前节点卡片禁区做矩形碰撞检测。
// 原实现只按 x 区间在单侧单行上排布，存在两类真实重叠：
//   1) 当前节点的展开卡片(最后绘制)直接压在邻居标签上——因为它从不参与避让；
//   2) 只比较 x 区间、不比较 y，无法表达「标题+年份两行」的真实占位。
// 这里改为：候选位置(上/下 × 逐级下沉) → 矩形碰撞 → 取第一个无碰撞的槽位。
function layoutLabels(nodes, pts, cur, cardRect) {
  const S = 1
  const TITLE_F = FONT('400', 18, false)
  const YEAR_F = FONT('700', 20, true)
  const getW = (text, font) => textWidthCache.get(`${text}_${font}`) || 0

  const GAP = 26 * S                 // 标题与年份的垂直间距（与绘制保持一致）
  const TOP_OFF = 30 * S             // 贴曲线那一行距节点圆心的偏移
  const PAD = 6 * S                  // 矩形外扩，避免贴脸
  const LINE = 26 * S                // 外侧那一行(标题 18px)的 em box 高度
  const BOX_H = GAP + LINE           // 标签整体高度 ≈ 52
  const SH = Math.ceil(BOX_H) + 6    // 每下沉一级的纵向偏移，必须 ≥ 标签高度才不会自重叠

  // 单个标签的完整包围盒（含标题与年份两行）。
  // 必须用「绝对坐标」(节点 x/y + 偏移)，否则与同样是绝对坐标的卡片禁区无法比较。
  const boxOf = (x, y, side, shift, tw, yw) => {
    const w = Math.max(tw, yw) / 2 + PAD
    const near = y + (side > 0 ? (TOP_OFF + shift) : -(TOP_OFF + shift)) // 贴曲线那一行(年份)的绝对 y
    // 与绘制保持一致：年份贴曲线，标题在其外侧 GAP 处。
    // side>0(下方, top 基线):    top=near,            bot=near+BOX_H
    // side<0(上方, bottom 基线): top=near-BOX_H,      bot=near
    return { l: x - w, r: x + w, t: side > 0 ? near : near - BOX_H, b: side > 0 ? near + BOX_H : near, side, shift, w }
  }
  const hits = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t

  const items = []
  for (let i = 0; i < nodes.length; i++) {
    if (i === cur) continue
    const tw = getW(nodes[i].title || '', TITLE_F)
    const yw = getW(nodes[i].year || '', YEAR_F)
    items.push({ i, x: pts[i].x, y: pts[i].y, tw, yw, side: i % 2 === 1 ? 1 : -1, shift: 0 })
  }
  items.sort((a, b) => a.x - b.x)   // 从左到右贪心，保证视觉阅读顺序

  const placed = []
  for (const it of items) {
    const pref = it.i % 2 === 1 ? 1 : -1
    const sides = [pref, -pref]
    let done = false
    // 逐级下沉；每级先试优先侧，再试另一侧
    for (let level = 0; level < 6 && !done; level++) {
      for (const s of sides) {
        const cand = boxOf(it.x, it.y, s, level * SH, it.tw, it.yw)
        let ok = true
        for (const p of placed) { if (hits(cand, p)) { ok = false; break } }
        if (ok && cardRect) {
          // 卡片禁区：避免被最后绘制的卡片盖住
          const card = { l: cardRect.x - PAD, r: cardRect.x + cardRect.w + PAD, t: cardRect.y - PAD, b: cardRect.y + cardRect.h + PAD }
          if (hits(cand, card)) ok = false
        }
        if (ok) { it.side = s; it.shift = level * SH; placed.push(cand); done = true; break }
      }
    }
    if (!done) {   // 极端密集：兜底放最外侧，仍记录占位以便后续继续避让
      it.side = pref
      it.shift = 6 * SH
      placed.push(boxOf(it.x, it.y, it.side, it.shift, it.tw, it.yw))
    }
  }
  const map = new Map()
  for (const it of items) map.set(it.i, it)
  return map
}

// 计算当前节点展开卡片的矩形（绘制与布局共用同一份几何，避免两处数字不同步）。
// 图片不再放进卡片，卡片高度固定。
function cardGeometry(cur, pts, W, H, S) {
  if (cur < 0 || !pts[cur]) return null
  const cardW = Math.min(380 * S, 0.26 * W)
  const cardH = 180 * S
  let x = pts[cur].x > W * 0.62 ? pts[cur].x - cardW - 40 * S : pts[cur].x + 40 * S
  x = Math.max(20, Math.min(x, W - cardW - 20))
  let y = Math.max(16, Math.min(pts[cur].y - cardH / 2, H - cardH - 16))
  return { x, y, w: cardW, h: cardH, imgH: 0, hasImg: false, imgs: [] }
}

// 背景图：跟随当前节点切换（原卡片内轮播已改为整幅背景）。
// - 单张：铺满 + 轻微 Ken Burns 缓动。
// - 多张(图片集)：按节点内停留进度(intra)在 images[] 间缓慢交叉淡入轮播，像资料片混剪而非幻灯片快闪。
// - 节点交界：当前节点整体在 intra/0.25 内由「上一节点首图」交叉淡入，无状态，静态出图也正确。
function drawBackground(W, H, cur, intra) {
  const imgsOf = (i) => {
    const nd = i >= 0 ? props.nodes[i] : null
    const im = nd && nd.images
    return im && im.length ? im : null
  }
  const imgs = imgsOf(cur)
  if (!imgs) return false

  const paint = (url, alpha, zoom) => {
    if (alpha <= 0.001) return
    const img = imgCache.get(url)
    if (!img || !img.complete || !img.naturalWidth) return
    ctx.save()
    ctx.globalAlpha = alpha
    drawCover(img, 0, 0, W, H, zoom)
    ctx.restore()
  }

  const inFade = cur < 0 ? 1 : Math.min(Math.max(intra, 0), 1) / 0.25
  // 过渡底层：上一节点首图（仅作节点间交叉淡入的底）
  const prev = imgsOf(cur - 1)
  if (prev) paint(prev[0], 1, 1.0)

  if (imgs.length === 1) {
    paint(imgs[0], inFade, 1.03 + 0.06 * Math.min(Math.max(intra, 0), 1))
    return true
  }
  // 多张：intra∈[0,1] 映射到图集进度（每张停留末段才与下一张交叉淡入，避免全程互溶发糊）
  const K = imgs.length
  const fpos = Math.min(Math.max(intra, 0), 0.999) * K
  const idx = Math.floor(fpos)
  const frac = fpos - idx
  const slotFade = Math.min(Math.max((frac - 0.65) / 0.35, 0), 1)
  paint(imgs[idx], inFade, 1.03 + 0.06 * (idx + frac))
  if (idx < K - 1) paint(imgs[Math.min(idx + 1, K - 1)], inFade * slotFade, 1.03 + 0.06 * (idx + 1 + frac))
  return true
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

  // 当前节点必须与 loc.intra 同源：卡片/背景的淡入进度用的是 loc.intra，
  // 若这里改用几何量(revealX + 容差)判定，它会「领先」于 loc.node，
  // 于是节点交界处会先用旧节点的接近 1 的进度把新卡片画成满透，再回退淡入
  // ——即用户看到的「卡片先显示，又进入淡入动画」。统一取 loc.node 即彻底消除该错位。
  const cur = loc.node

  // 背景图（跟随当前节点更换）+ 渐变遮罩：仅压暗曲线/标签/卡片所在的「信息带」中段，
  // 上下留白让照片透出，更有电影感；卡片自带深色底，文字始终可读。
  if (drawBackground(W, H, cur, loc.intra)) {
    ctx.save()
    const g = ctx.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0.00, 'rgba(3,7,15,0.22)')
    g.addColorStop(0.30, 'rgba(3,7,15,0.55)')
    g.addColorStop(0.50, 'rgba(3,7,15,0.80)')
    g.addColorStop(0.72, 'rgba(3,7,15,0.58)')
    g.addColorStop(1.00, 'rgba(3,7,15,0.42)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
    ctx.restore()
  }

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

  // 当前节点卡片的几何需「先算后画」：标签布局要把它当禁区，否则卡片会盖住邻居标签。
  const cardGeo = cardGeometry(cur, pts, W, H, S)
  const labelLayout = layoutLabels(props.nodes, pts, cur, cardGeo)
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

  // 当前节点卡片（几何复用 cardGeo，与标签避让用的是同一份数字）
  if (cur >= 0 && cardGeo) {
    const d = props.nodes[cur]
    const a = Math.min(Math.max(loc.intra / 0.22, 0), 1)
    const cardW = cardGeo.w
    const cardH = cardGeo.h
    const imgH = cardGeo.imgH
    const imgs = cardGeo.imgs
    const hasImg = cardGeo.hasImg
    const cx = cardGeo.x
    const cy = cardGeo.y
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

    // 图片已改作整幅背景，卡片内不再绘制图片区（见 drawBackground）

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
  const elapsed = (ts - startTime) / 1000

  // 录制模式：跑满一遍即停，尾帧多给一点余量让最后一张卡片完整呈现
  if (mode === 'once') {
    const p = total > 0 ? Math.min(elapsed / total, 1) : 1
    draw(p)
    if (p >= 1 && elapsed > total + TAIL_SEC) {
      if (recorder && recorder.state !== 'inactive') recorder.stop()
      return
    }
    raf = requestAnimationFrame(loop)
    return
  }

  // 预览模式：不自动重播 —— 播放一遍后停在最后一帧
  const p = total > 0 ? Math.min(elapsed / total, 1) : 1
  draw(p)
  if (p >= 1) { raf = 0; return }   // 停在尾帧，不再申请下一帧
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
    () => props.nodes.length + '|' + props.nodes.map(n => `${n.title}_${n.year}_${((n.images || []).join('|'))}`).join('||'),
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