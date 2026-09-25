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

// === 视频背景：每个有 video 的节点对应一个 <video> 元素（同源：blob/data/相对，或经 /__img 代理的远程）===
const videoCache = new Map() // url -> HTMLVideoElement
let activeVideoUrl = null    // 当前正在播放的视频 url（随 cur 切换）
function getVideo(url) {
  if (!url) return null
  let v = videoCache.get(url)
  if (!v) {
    v = document.createElement('video')
    v.muted = true            // 背景 B-roll 必须静音，否则浏览器拦截自动播放
    v.loop = true             // 节点停留期间循环，像资料片
    v.playsInline = true
    v.preload = 'auto'
    v.setAttribute('muted', '')
    v.style.cssText = 'position:fixed;left:-20px;top:-20px;width:2px;height:2px;opacity:0;pointer-events:none;z-index:-1'
    document.body.appendChild(v) // 挂到 DOM 才能保证无头/部分浏览器解码出可绘制帧
    v.src = resolveImgUrl(url)
    videoCache.set(url, v)
  }
  return v
}
// 进入某节点时播其视频、离开时暂停（只让当前节点在播，省资源）
function syncActiveVideo(cur) {
  if (mode === 'static') return
  const cv = cur >= 0 && props.nodes[cur] && props.nodes[cur].video ? props.nodes[cur].video : null
  if (cv === activeVideoUrl) return
  if (activeVideoUrl) {
    const old = videoCache.get(activeVideoUrl)
    if (old) { try { old.pause() } catch (e) { /* ignore */ } }
  }
  activeVideoUrl = cv
  if (cv) {
    const v = getVideo(cv)
    if (v) {
      try { v.currentTime = 0 } catch (e) { /* ignore */ }
      const pr = v.play()
      if (pr && pr.catch) pr.catch(() => {})
    }
  }
}

// 古典配色（国风/仿古）：墨底 + 朱砂红 + 鎏金 + 宣纸米色文字，告别霓虹感，与仿古衬线字体统一。
const C = {
  text: '#f3ead6',                  // 宣纸米白（正文）
  muted: 'rgba(216,202,172,0.74)',  // 淡米灰（描述）
  accent: '#c4352d',                // 朱砂红（主强调 / 年份记 / 印章）
  accent2: '#caa64a',               // 鎏金（次强调 / 已揭示路径 / 连接点）
  nodeDim: 'rgba(150,128,98,0.42)', // 暖灰（未达节点）
  nodeOn: '#d98c6a',                // 暖陶（已达节点）
  cardBgTop: 'rgba(34,27,21,0.96)', // 墨底（上，略暖）
  cardBgBot: 'rgba(15,11,9,0.97)',  // 墨底（下，沉）
  cardBorder: 'rgba(201,162,39,0.42)',   // 鎏金外线
  cardBorderIn: 'rgba(201,162,39,0.16)', // 鎏金内描边（双线古典感）
  yearBig: 'rgba(243,234,214,0.06)',      // 大号水印年份（宣纸淡）
  lineFaint: 'rgba(160,138,104,0.18)',    // 暗路径
}
// 仿古字体栈：CJK 优先【楷体(书法感) → 仿宋/宋体(传统印刷) → Noto Serif CJK SC(衬线/明朝体兜底)】，
// 保证离线/沙箱也有古意；latin(年份/数字)走衬线(Georgia/Times)以统一古典观感。
// 用户机器装有楷体/仿宋时即呈书法质感；未装则回退宋体衬线，整体仍保持仿古。
const CJK_SERIF = "'KaiTi','STKaiti','Kaiti SC','楷体','FangSong','STFangsong','仿宋','Songti SC','SimSun','Noto Serif CJK SC',serif"
const LATIN_SERIF = "'Georgia','Times New Roman','Noto Serif CJK SC',serif"
const FONT = (wt, sz, latin) =>
    `${wt} ${sz}px ${latin ? LATIN_SERIF : CJK_SERIF}`

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

  // 预计算文本宽度（与原版同款字号，不再随节点数缩小 —— 滑动视窗已保证间距宽松）
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
  // 图片用 naturalWidth/Height；视频元素没有 naturalWidth（为 undefined），必须取 videoWidth/Height，
  // 否则 ir = undefined/undefined = NaN → 后续尺寸全 NaN → drawImage 抛错、整条绘制循环崩掉（视频背景就是不显示）。
  const iw = img.naturalWidth || img.videoWidth
  const ih = img.naturalHeight || img.videoHeight
  if (!iw || !ih) return
  const ir = iw / ih
  const r = w / h
  let dw, dh, dx, dy
  if (ir > r) { dh = h; dw = h * ir; dx = x + (w - dw) / 2; dy = y }
  else { dw = w; dh = w / ir; dx = x; dy = y + (h - dh) / 2 }
  // Ken Burns：以画面中心缓慢放大（zoom>1 即放大并裁切中心，营造资料片推镜）
  const zx = (dw * (zoom - 1)) / 2
  const zy = (dh * (zoom - 1)) / 2
  ctx.drawImage(img, dx - zx, dy - zy, dw + 2 * zx, dh + 2 * zy)
}

// 文本自动折行（中英文混排）：CJK 按字断、Latin 连续词按词断、超长词再按字符断；
// 关键修复：空格/间隔符（如「·」）**附加到当前行**而非在此断行，避免 "红色圣地 · 会宁之心"
// 这种「词 + 间隔 + 词」被拆成多行、间隔符独占一行。返回折行后的字符串数组（去行尾空白）。
// maxW 为单行最大像素宽（与绘制同处用户坐标系，量纲一致）。
const NO_LINE_START = '。，、；：！？）】》」』〉·…—%,.;:!?)]}' // 行首禁则：这些标点不另起一行
function wrapText(text, font, maxW) {
  if (!text) return []
  ctx.font = font
  const out = []
  const tokens = (text + '').match(/[A-Za-z0-9]+|\s+|[^\sA-Za-z0-9]/g) || []
  let line = ''
  const flush = () => {
    if (line && !/^\s*$/.test(line)) { out.push(line.replace(/\s+$/, '')); return true }
    return false
  }
  for (const tk of tokens) {
    // 空白：附加到当前行，不在此处断行（保留“词 间隔 词”的整体性）
    if (/^\s+$/.test(tk)) { line += tk; continue }
    // 超长连续词（如超长英文单词）：按字符断
    if (ctx.measureText(tk).width > maxW) {
      for (const ch of tk) {
        const t = line + ch
        if (ctx.measureText(t).width > maxW && flush()) line = ch
        else line = t
      }
      continue
    }
    const t = line + tk
    if (ctx.measureText(t).width > maxW && !/^\s*$/.test(line)) {
      if (tk.length === 1 && NO_LINE_START.includes(tk)) { line = t; continue } // 标点并回上一行（悬挂标点）
      flush()
      line = tk
    } else line = t
  }
  flush()
  return out
}

// === 优化 1：使用缓存的文本宽度，不再每帧 measureText ===
// 标签布局：把每个标签当成「真实矩形包围盒」，与已放置标签、以及当前节点卡片禁区做矩形碰撞。
// 关键约束：**只处理当前可见节点**（滑动视窗外的不画），且「放不下就不画（只留圆点）」——绝不重叠。
function layoutLabels(nodes, spts, cur, cardRect) {
  const n = nodes.length
  const S = 1
  const TITLE_F = FONT('400', 18 * S, false)
  const YEAR_F = FONT('700', 20 * S, true)
  const getW = (text, font) => textWidthCache.get(`${text}_${font}`) || 0

  const GAP = 26 * S             // 标题与年份的垂直间距（与绘制保持一致）
  const TOP_OFF = 30 * S         // 贴曲线那一行距节点圆心的偏移
  const PAD = 6 * S              // 矩形外扩，避免贴脸
  const LINE = 26 * S            // 外侧那一行(标题)的 em box 高度
  const BOX_H = GAP + LINE       // 标签整体高度
  const SH = Math.ceil(BOX_H) + 6 // 每下沉一级的纵向偏移，必须 ≥ 标签高度才不会自重叠

  const X0 = 0.13 * DW, X1 = 0.87 * DW
  const MARGIN = 54 * S          // 屏幕外留白：超出此范围的节点不画标签

  // 单个标签的完整包围盒（含标题与年份两行），绝对坐标，与卡片禁区可比。
  const boxOf = (x, y, side, shift, tw, yw) => {
    const w = Math.max(tw, yw) / 2 + PAD
    const near = y + (side > 0 ? (TOP_OFF + shift) : -(TOP_OFF + shift))
    return { l: x - w, r: x + w, t: side > 0 ? near : near - BOX_H, b: side > 0 ? near + BOX_H : near, side, shift, w }
  }
  const hits = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t

  const placed = []
  const card = cardRect
    ? { l: cardRect.x - PAD, r: cardRect.x + cardRect.w + PAD, t: cardRect.y - PAD, b: cardRect.y + cardRect.h + PAD }
    : null
  const fits = (cand) => {
    for (const p of placed) if (hits(cand, p)) return false
    if (card && hits(cand, card)) return false
    return true
  }

  const map = new Map()
  // 仅可见节点参与布局（屏幕坐标 spts 已由相机平移到窗口内）
  const vis = []
  for (let i = 0; i < n; i++) {
    if (i === cur) continue
    const x = spts[i].x
    if (x < X0 - MARGIN || x > X1 + MARGIN) continue
    vis.push(i)
  }
  vis.sort((a, b) => spts[a].x - spts[b].x)   // 从左到右贪心
  for (const i of vis) {
    const tw = getW(nodes[i].title || '', TITLE_F)
    const yw = getW(nodes[i].year || '', YEAR_F)
    const pref = i % 2 === 1 ? 1 : -1
    const sides = [pref, -pref]
    let done = false
    // 最多下沉 3 级：既避免标签被卡片顶得离节点太远，又保证不重叠；再放不下就只留圆点
    for (let level = 0; level < 3 && !done; level++) {
      for (const s of sides) {
        const cand = boxOf(spts[i].x, spts[i].y, s, level * SH, tw, yw)
        if (fits(cand)) { placed.push(cand); map.set(i, { i, mode: 'full', x: spts[i].x, y: spts[i].y, side: s, shift: level * SH, alpha: 1 }); done = true; break }
      }
    }
    if (!done) continue // 放不下：只留圆点，绝不重叠、绝不糊
    // 边缘淡入淡出：越靠近视窗边界越淡，避免标签突然冒出/消失
    const it = map.get(i)
    const edge = Math.min(spts[i].x - (X0 - MARGIN), (X1 + MARGIN) - spts[i].x)
    it.alpha = Math.max(0.14, Math.min(1, edge / (MARGIN + 30 * S)))
  }
  return map
}

// 计算当前节点展开卡片的矩形（绘制与布局共用同一份几何，避免两处数字不同步）。
// 新样式：卡片「居中悬于节点正上方」的标注卡（callout）——水平居中、下方留连接线接到节点圆点；
// 这样无论节点数多少，卡片半宽都远小于相邻节点间距，绝不会压住邻居圆点/标签，整体更协调。
// 图片不再放进卡片；卡片高度按「年份 + 标题 + 描述」真实折行行数自适应，长备注不溢出/不截断标题。
function cardGeometry(cur, pts, W, H, S) {
  if (cur < 0 || !pts[cur]) return null
  const n = props.nodes.length
  const spacing = (0.74 * W) / Math.max(1, n - 1)
  // 卡片宽度：少节点更宽（文字更舒服）、多节点收窄；因卡片「居中悬于节点正上方」，
  // 只要半宽 < 相邻间距（即宽度 < 2×间距）就不会压住左右邻点，故上限取 2×间距 − 安全余量。
  const effSpacing = n > 11 ? 230 : spacing
  const maxByNeighbor = effSpacing * 2 - 70 * S
  // 卡片宽上限略放宽（少节点/滑动视窗下都能拿到更舒展的宽度，且半宽仍 < 相邻间距、不压邻居）
  let cardW = Math.min(380 * S, 0.32 * W, maxByNeighbor)
  cardW = Math.max(200 * S, cardW)
  const padX = 30 * S
  const innerW = cardW - 2 * padX

  const d = props.nodes[cur]
  const descFont = FONT('400', 20 * S, false)
  let descLines = wrapText(d.desc || '', descFont, innerW)

  // 自适应标题字号：标题很长时自动缩小字号（而非无限加高卡片、撑爆版面），
  // 让「标题在卡片内完整展示」且保持卡片紧凑、不压邻居、不溢出画布；
  // 优先把标题收进 ≤ MAX_TITLE_LINES 行，字号下限保证可读性，极端超长才末行省略号兜底。
  const MAX_TITLE_LINES = 3
  const MIN_TITLE = 17 * S
  const MAX_TITLE = 27 * S
  let titleSize = MAX_TITLE
  let titleLines = []
  for (let sz = MAX_TITLE; sz >= MIN_TITLE; sz -= 1 * S) {
    const lines = wrapText(d.title || '', FONT('700', sz, false), innerW)
    titleLines = lines
    titleSize = sz
    if (lines.length <= MAX_TITLE_LINES) break
  }
  const titleFont = FONT('700', titleSize, false)
  const titleLH = titleSize + 9 * S            // 标题行高随字号走

  // 纵向节奏（相对卡片顶）——统一的古典版式：年份记 → 标题 → 金线分隔 → 描述
  const topPad = 30 * S
  const yearH = 34 * S
  const yearY = topPad + yearH * 0.80           // 年份基线
  const titleGap = 20 * S
  const titleY = yearY + titleGap + titleLH * 0.20 // 首行标题基线
  const dividerGap = 16 * S
  const dividerY = titleY + titleLines.length * titleLH + dividerGap // 标题与描述之间的金线
  const descGap = 14 * S
  const descLH = 31 * S                          // 描述行高
  const descY = dividerY + descGap
  const bottomPad = 30 * S

  let cardH = descY + descLines.length * descLH + bottomPad
  const minH = 168 * S
  const maxH = H - 96 * S   // 上方留连接线 + 安全余量，避免顶到画布边
  if (cardH < minH) cardH = minH
  // 超过画布可用高度：优先裁「描述」(末行省略号)；仅当标题本身就极长、裁完描述仍放不下时，
  // 才最后兜底裁「标题」(末行省略号) —— 标题始终优先保证完整展示。
  if (cardH > maxH) {
    cardH = maxH
    const avail = cardH - bottomPad - descY
    const maxDescLines = Math.max(0, Math.floor(avail / descLH))
    if (descLines.length > maxDescLines) {
      if (maxDescLines > 0) {
        descLines = descLines.slice(0, maxDescLines)
        let last = descLines[maxDescLines - 1]
        while (ctx.measureText(last + '…').width > innerW && last.length > 1) last = last.slice(0, -1)
        descLines[maxDescLines - 1] = last + '…'
      } else {
        descLines = []
      }
    }
    // 标题兜底裁剪（仅极长标题触发）
    if (descY + descLines.length * descLH + bottomPad > maxH) {
      const availT = maxH - bottomPad - descY + titleLines.length * titleLH
      const maxT = Math.max(1, Math.floor(availT / titleLH))
      if (titleLines.length > maxT) {
        titleLines.length = maxT
        let last = titleLines[maxT - 1]
        while (ctx.measureText(last + '…').width > innerW && last.length > 1) last = last.slice(0, -1)
        titleLines[maxT - 1] = last + '…'
      }
    }
  }
  // 居中悬于节点正上方，下方留连接线接到节点圆点
  const connector = 26 * S
  let x = pts[cur].x - cardW / 2
  x = Math.max(16, Math.min(x, W - cardW - 16))
  let y = pts[cur].y - cardH - connector
  if (y < 14) y = 14   // 顶部空间不足则贴顶（极少触发）
  return { x, y, w: cardW, h: cardH, padX, yearY, titleY, titleLH, descY, descLH,
           dividerY, connector, titleLines, descLines, titleFont, titleSize }
}

// 背景：跟随当前节点切换。每个节点可选「视频」(优先) 或「图片集」(images[])。
// - 视频：铺满播放（muted/loop），本身有运动，仅做极轻推镜；未就绪时回退首图作封面。
// - 单图：铺满 + 轻微 Ken Burns 缓动。
// - 多图：按节点内进度(intra)在 images[] 间缓慢交叉淡入轮播。
// - 节点交界：当前节点整体在 intra/0.25 内由「上一节点」交叉淡入，无状态，静态出图也正确。
function drawBackground(W, H, cur, intra) {
  const mediaOf = (i) => {
    const nd = i >= 0 ? props.nodes[i] : null
    if (!nd) return null
    if (nd.video) return { kind: 'video', list: [nd.video], poster: nd.images && nd.images[0] }
    if (nd.images && nd.images.length) return { kind: 'image', list: nd.images }
    return null
  }
  const paintImg = (url, alpha, zoom) => {
    if (alpha <= 0.001) return
    const img = imgCache.get(url)
    if (!img || !img.complete || !img.naturalWidth) return
    ctx.save()
    ctx.globalAlpha = alpha
    drawCover(img, 0, 0, W, H, zoom)
    ctx.restore()
  }
  const paintVid = (url, alpha, zoom) => {
    if (alpha <= 0.001) return
    const v = videoCache.get(url)
    if (!v || v.readyState < 2 || !v.videoWidth) return
    ctx.save()
    ctx.globalAlpha = alpha
    drawCover(v, 0, 0, W, H, zoom)
    ctx.restore()
  }

  const media = mediaOf(cur)
  if (!media) return false
  const inFade = cur < 0 ? 1 : Math.min(Math.max(intra, 0), 1) / 0.25
  // 过渡底层：上一节点（仅作节点间交叉淡入的底）
  const prev = mediaOf(cur - 1)
  if (prev) {
    if (prev.kind === 'video') paintVid(prev.list[0], 1, 1.0)
    else paintImg(prev.list[0], 1, 1.0)
  }

  if (media.kind === 'video') {
    paintVid(media.list[0], inFade, 1.0)
    if (media.poster) paintImg(media.poster, inFade, 1.0) // 视频未就绪时的封面兜底
    return true
  }
  // 图片
  if (media.list.length === 1) {
    paintImg(media.list[0], inFade, 1.03 + 0.06 * Math.min(Math.max(intra, 0), 1))
    return true
  }
  // 多张轮播：intra∈[0,1] 映射到图集进度（每张停留末段才与下一张交叉淡入）
  const K = media.list.length
  const fpos = Math.min(Math.max(intra, 0), 0.999) * K
  const idx = Math.floor(fpos)
  const frac = fpos - idx
  const slotFade = Math.min(Math.max((frac - 0.65) / 0.35, 0), 1)
  paintImg(media.list[idx], inFade, 1.03 + 0.06 * (idx + frac))
  if (idx < K - 1) paintImg(media.list[idx + 1], inFade * slotFade, 1.03 + 0.06 * (idx + 1 + frac))
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
  const BASE_Y = 0.50 * DH, AMP = 0.065 * DH

  const loc = locate(sched, p * sched.totalSec)
  const fade = Math.min(p / 0.04, 1)
  const cur = loc.node

  // —— 滑动视窗（镜头跟随）：任意时刻只显示当前节点附近的若干节点，镜头随叙事沿曲线平移；
  //    节点很多(>11)时仍保持「原版全宽小时间轴」同款宽松间距(≈230px)与干净观感，
  //    不再把全部节点硬塞一屏导致拥挤；节点≤11 时退回原版全宽布局（镜头锁死）。
  const WINDOW = n > 11 ? 7 : n
  const half = (WINDOW - 1) / 2
  const step = n > 11 ? 230 : (X1 - X0) / Math.max(1, n - 1)
  const camFrac = loc.node + loc.intra            // 平滑相机位置（节点浮点）
  const cam = Math.max(half, Math.min(n - 1 - half, camFrac))
  const sx = (np) => X0 + (np - (cam - half)) * step
  const npOfX = (ox) => (n > 1 ? (ox - X0) * (n - 1) / (X1 - X0) : 0)
  const spts = pts.map((p2, i) => ({ x: sx(i), y: p2.y }))          // 节点屏幕坐标（经相机平移）
  const spath = path.map((q) => ({ x: sx(npOfX(q.x)), y: q.y }))    // 曲线屏幕坐标
  // 播放头 / 亮色已揭示轨迹的终点：跟随真实叙事进度 camFrac（不受相机钳制影响，保证末尾几段不再
  // 只剩暗色虚线），但必须钳制在 [0, n-1] —— 最后一个节点没有「下一段」，否则末节点停留期间
  // 播放头会冲出终点、飘到画面右缘之外，看起来像「时间线断了 / 越过末节点」。
  const revealFrac = Math.max(0, Math.min(n - 1, camFrac))
  const revealX = sx(revealFrac)                                   // 播放头（引领边）屏幕位置
  const playheadY = BASE_Y + AMP * Math.sin(revealFrac * 0.95 + 0.3) // 播放头处曲线纵坐标

  // 视频背景播放调度：进入节点播其视频、离开暂停（仅当前节点在播）
  syncActiveVideo(cur)

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

  // 完整路径（暗，经相机映射；超界部分被画布自然裁掉）
  ctx.save()
  ctx.strokeStyle = C.lineFaint
  ctx.lineWidth = 2 / (currentScale || 1) * S
  ctx.setLineDash([2, 10])
  ctx.beginPath()
  ctx.moveTo(spath[0].x, spath[0].y)
  for (const q of spath) ctx.lineTo(q.x, q.y)
  ctx.stroke()
  ctx.restore()

  // 已揭示路径（发光）至播放头 revealX
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
  ctx.moveTo(spath[0].x, spath[0].y)
  // 已揭示亮色轨迹：终点跟随真实叙事进度 revealFrac（未受相机钳制，且钳在 [0,n-1]），
  // 保证最后一帧/最后几个节点的轨迹与播放头仍连接到当前节点，不卡在相机钳制位。
  for (let k = 1; k < spath.length; k++) {
    const npA = npOfX(path[k - 1].x), npB = npOfX(path[k].x)
    if (npB <= revealFrac) ctx.lineTo(spath[k].x, spath[k].y)
    else if (npA < revealFrac) {
      const t = (revealFrac - npA) / (npB - npA || 1)
      ctx.lineTo(spath[k - 1].x + (spath[k].x - spath[k - 1].x) * t, spath[k - 1].y + (spath[k].y - spath[k - 1].y) * t)
      break
    } else break
  }
  ctx.stroke()
  ctx.restore()

  // 播放头发光点（引领边）
  {
    ctx.save()
    ctx.shadowColor = C.accent2
    ctx.shadowBlur = 22 * S
    ctx.beginPath()
    ctx.arc(revealX, playheadY, 7 * S, 0, Math.PI * 2)
    ctx.fillStyle = C.accent2
    ctx.fill()
    ctx.restore()
  }

  // 当前节点卡片的几何需「先算后画」：标签布局要把它当禁区，否则卡片会盖住邻居标签。
  const cardGeo = cardGeometry(cur, spts, W, H, S)
  const labelLayout = layoutLabels(props.nodes, spts, cur, cardGeo)
  for (let i = 0; i < n; i++) {
    const reached = i <= camFrac + 0.001
    const isCur = i === cur
    const r = (isCur ? 13 : reached ? 8 : 6) * S
    ctx.save()
    if (reached) { ctx.shadowColor = C.accent; ctx.shadowBlur = (isCur ? 30 : 14) * S }
    ctx.beginPath()
    ctx.arc(spts[i].x, spts[i].y, r, 0, Math.PI * 2)
    ctx.fillStyle = reached ? (isCur ? C.accent2 : C.nodeOn) : C.nodeDim
    ctx.fill()
    ctx.restore()
    if (props.nodes[i].key && reached) {
      ctx.beginPath()
      ctx.arc(spts[i].x, spts[i].y, r + 7 * S, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(255,212,90,0.6)'
      ctx.lineWidth = 2 * S
      ctx.stroke()
    }
    // 标签绘制（完整标签：年份 + 标题两行；仅可见节点，放不下则已在布局阶段跳过）
    const it = labelLayout.get(i)
    if (it) {
      const below = it.side > 0
      const shift = it.shift
      const gap = 22 * S
      ctx.textAlign = 'center'
      ctx.globalAlpha = (reached ? 1 : 0.4) * fade * (it.alpha ?? 1)
      if (below) {
        ctx.textBaseline = 'top'
        const startY = spts[i].y + 30 * S + shift
        ctx.fillStyle = reached ? C.nodeOn : C.muted
        ctx.font = FONT('700', 20 * S, true)
        ctx.fillText(props.nodes[i].year, spts[i].x, startY)
        ctx.fillStyle = reached ? C.text : C.muted
        ctx.font = FONT('400', 18 * S, false)
        ctx.fillText(props.nodes[i].title, spts[i].x, startY + gap)
      } else {
        ctx.textBaseline = 'bottom'
        const startY = spts[i].y - 30 * S - shift
        ctx.fillStyle = reached ? C.nodeOn : C.muted
        ctx.font = FONT('700', 20 * S, true)
        ctx.fillText(props.nodes[i].year, spts[i].x, startY)
        ctx.fillStyle = reached ? C.text : C.muted
        ctx.font = FONT('400', 18 * S, false)
        ctx.fillText(props.nodes[i].title, spts[i].x, startY - gap)
      }
      ctx.globalAlpha = fade
    }
  }

  // 当前节点卡片（几何复用 cardGeo，与标签避让用的是同一份数字）。
  // 新版式：墨底 + 鎏金双线边框 + 朱砂年份记 + 金线分隔 + 关键节点印章 + 节点连接线，整体古典协调。
  if (cur >= 0 && cardGeo) {
    const d = props.nodes[cur]
    const a = Math.min(Math.max(loc.intra / 0.22, 0), 1)
    const cx = cardGeo.x, cy = cardGeo.y, cardW = cardGeo.w, cardH = cardGeo.h
    const padX = cardGeo.padX
    const rise = (1 - a) * 12 * S   // 入场轻微上浮

    // 连接线：节点圆点 → 卡片底边中点（落在卡片之下，被卡片底盖住一点，像从卡片“长出”）
    {
      const tx = Math.max(cx + 18 * S, Math.min(spts[cur].x, cx + cardW - 18 * S))
      ctx.save()
      ctx.globalAlpha = a
      ctx.strokeStyle = 'rgba(201,162,39,0.55)'
      ctx.lineWidth = 2 * S
      ctx.beginPath()
      ctx.moveTo(spts[cur].x, spts[cur].y)
      ctx.lineTo(tx, cy + cardH - rise)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(tx, cy + cardH - rise, 3.5 * S, 0, Math.PI * 2)
      ctx.fillStyle = C.accent2
      ctx.fill()
      ctx.restore()
    }

    ctx.save()
    ctx.globalAlpha = a
    ctx.translate(0, -rise)

    // 卡片底（带暖色投影）
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.5)'
    ctx.shadowBlur = 30 * S
    ctx.shadowOffsetY = 14 * S
    roundRect(cx, cy, cardW, cardH, 18 * S)
    const bg = ctx.createLinearGradient(cx, cy, cx, cy + cardH)
    bg.addColorStop(0, C.cardBgTop)
    bg.addColorStop(1, C.cardBgBot)
    ctx.fillStyle = bg
    ctx.fill()
    ctx.restore()

    // 鎏金外线
    roundRect(cx, cy, cardW, cardH, 18 * S)
    ctx.lineWidth = 1.4 * S
    ctx.strokeStyle = C.cardBorder
    ctx.stroke()
    // 鎏金内描边（双线，古典册页感）
    roundRect(cx + 8 * S, cy + 8 * S, cardW - 16 * S, cardH - 16 * S, 13 * S)
    ctx.lineWidth = 1 * S
    ctx.strokeStyle = C.cardBorderIn
    ctx.stroke()

    // 年份：左侧朱砂竖记 + 鎏金年份（编辑式古典标题）
    const yearTickX = cx + padX
    const yearBaseline = cy + cardGeo.yearY
    ctx.fillStyle = C.accent
    ctx.fillRect(yearTickX, yearBaseline - 22 * S, 4 * S, 26 * S)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = C.accent2
    ctx.font = FONT('700', 32 * S, true)
    ctx.fillText(d.year, yearTickX + 14 * S, yearBaseline)

    // 关键节点印章（右上角，朱砂底 + 米白字，像一枚闲章）
    if (d.key) {
      const sw = 74 * S, sh = 28 * S
      const sx = cx + cardW - padX - sw
      const sy = cy + 22 * S
      roundRect(sx, sy, sw, sh, 5 * S)
      ctx.fillStyle = 'rgba(176,51,43,0.92)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(243,234,214,0.35)'
      ctx.lineWidth = 1 * S
      ctx.stroke()
      ctx.fillStyle = '#f3ead6'
      ctx.font = FONT('600', 16 * S, false)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('关键节点', sx + sw / 2, sy + sh / 2 + 0.5 * S)
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
    }

    // 标题（自适应字号、完整折行，宣纸米白）
    ctx.fillStyle = C.text
    ctx.font = cardGeo.titleFont
    cardGeo.titleLines.forEach((tl, k) => ctx.fillText(tl, cx + padX, cy + cardGeo.titleY + k * cardGeo.titleLH))

    // 标题与描述之间的短金线分隔（左对齐，古典栏隔）
    {
      const dw = 46 * S
      ctx.save()
      ctx.globalAlpha = a * 0.7
      ctx.strokeStyle = C.accent2
      ctx.lineWidth = 2 * S
      ctx.beginPath()
      ctx.moveTo(cx + padX, cy + cardGeo.dividerY)
      ctx.lineTo(cx + padX + dw, cy + cardGeo.dividerY)
      ctx.stroke()
      ctx.restore()
    }

    // 描述（自动折行，淡米灰；长文按卡片高度自适应，超出则省略号收尾，绝不溢出画布）
    ctx.fillStyle = C.muted
    ctx.font = FONT('400', 20 * S, false)
    cardGeo.descLines.forEach((dl, k) => ctx.fillText(dl, cx + padX, cy + cardGeo.descY + k * cardGeo.descLH))

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