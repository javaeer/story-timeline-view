<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { buildSchedule, locate, xAtTravel } from '../composables/useTimeline.js'
import { store, aspectDims } from '../store/timelineStore.js'

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
const TAIL_SEC = 1.2 // 录制时尾帧余量，保证最后一张卡片完整收尾
let raf = 0
let startTime = 0
let recorder = null

// 画幅比例：DW/DH 为设计坐标系（导出与设计同尺寸，零黑边）；OUT 为录制位图尺寸。
// 随 store.aspect 切换重建（见 applyAspect）。PORTRAIT 标记当前是否为竖屏（时间轴纵向铺开）。
let OUT_W = 1920
let OUT_H = 1080
let DW = 1920
let DH = 1080
let PORTRAIT = false

// 响应式缩放因子：以 16:9(1920 宽)为设计基准，所有字号 / 间距 / 线宽 / 圆角按画布宽等比缩放，
// 保证 9:16 / 1:1 / 4:3 等窄画幅下文字与版式比例一致、不溢出、不挤压（16:9 时 S=1，外观完全不变）。
let S = 1
function computeScale() { S = DW / 1920 }

// 轴向配置：横屏时时间轴沿 X 展开、曲线在 Y 方向起伏；竖屏(9:16)时沿 Y 展开、在 X 方向起伏。
// 返回轴范围[a0,a1]、交叉轴中心 base、交叉轴振幅 amp，供 rebuild/draw 统一使用。
function axisCfg() {
  if (DH > DW) {
    // 竖屏：轴 = Y
    const a0 = 0.13 * DH, a1 = 0.87 * DH
    const base = 0.50 * DW
    const amp = 0.065 * DW
    return { portrait: true, a0, a1, base, amp }
  }
  // 横屏/方形：轴 = X
  const a0 = 0.13 * DW, a1 = 0.87 * DW
  const base = 0.50 * DH
  const amp = 0.065 * DH
  return { portrait: false, a0, a1, base, amp }
}

// 播放控制状态：curP 为当前进度 0..1（暂停续播/跳转对齐都用它）；store.paused 是否暂停；
// offX/offY 为 fit 记录的设计坐标→设备像素偏移（点击坐标反算用）；
// lastFrame 缓存最近一帧节点屏幕坐标，供点击命中检测。
let curP = 0
let offX = 0, offY = 0
let lastFrame = null
let lastSubtitle = null     // 最近一帧的活动 SRT 字幕（供验证读取）；无则 null
let dbgCard = null          // 最近一帧当前节点卡片矩形（供兼容验证读取）
let dbgLabels = []         // 最近一帧已绘标签列表（供兼容验证读取）

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
    v.loop = false            // 节点停留期间只播一次，到末帧即停（不循环）
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

// 音频：每个有 audio 的节点对应一个 <audio> 元素（与 video 同策略：blob/data/相对/经 /__img 代理的远程）。
// 进入节点时播其音频、离开时暂停（仅当前节点在播）；尊重 store.paused（暂停即停声、继续即续播）。
// 导出时经 WebAudio 汇成音轨混入视频（见 startRecording），全程 best-effort 不影响视频录制本身。
const audioCache = new Map()   // url -> HTMLAudioElement
let activeAudioUrl = null      // 当前正在播放的音频 url（随 cur 切换）
let audioCtx = null            // 单例 AudioContext（首个带音频节点录制时创建）
const audioSrcCache = new Map()// url -> MediaElementAudioSourceNode（每个元素仅创建一次，避免重复 reroute）
let audioDest = null           // 录制用 MediaStreamDestination
let audioTrack = null          // 已加入录制流的音轨
function getAudio(url) {
  if (!url) return null
  let a = audioCache.get(url)
  if (!a) {
    a = new Audio()
    a.loop = false             // 配音/配乐只播一次，到末帧即停（与视频背景同策略：均不循环）
    a.preload = 'auto'
    a.crossOrigin = 'anonymous' // 让远程音频可被 WebAudio 处理（失败则静音兜底，不影响视频）
    a.src = resolveImgUrl(url)
    audioCache.set(url, a)
  }
  return a
}
// 跟随当前节点播放：cv 为当前节点音频 url；allowPlay=false（暂停态）时仅确保静音，不主动播放。
function syncActiveAudio(cur, allowPlay) {
  if (mode === 'static') return
  const cv = cur >= 0 && props.nodes[cur] && props.nodes[cur].audio ? props.nodes[cur].audio : null
  if (cv === activeAudioUrl) {
    // 同一节点：仅处理暂停/继续；自然播完(el.ended)时不重启，否则每帧都会把 ended 的音频重新 play → 表现为"循环"
    const el = cv ? audioCache.get(cv) : null
    if (el && allowPlay && el.paused && !el.ended) { const p = el.play(); if (p && p.catch) p.catch(() => {}) }
    else if (el && !allowPlay && !el.paused) { try { el.pause() } catch (e) { /* ignore */ } }
    return
  }
  // 切换节点：暂停旧的，激活新的（激活时即创建元素，保证暂停态 seek 后继续播放能立即取到元素）
  if (activeAudioUrl) {
    const old = audioCache.get(activeAudioUrl)
    if (old) { try { old.pause() } catch (e) { /* ignore */ } }
  }
  activeAudioUrl = cv
  if (cv) {
    const el = getAudio(cv)
    if (el && allowPlay) {
      try { el.currentTime = 0 } catch (e) { /* ignore */ } // 每次进入节点从头播
      const p = el.play()
      if (p && p.catch) p.catch(() => {}) // 自动播放被拦截（无手势）时静默忽略
    }
  }
}
// 时间线走到最后一帧时调用：停掉当前正在播放的视频/音频，确保不再循环、不再续播；
// 清空激活标记，使后续跳转到其它节点时仍能正常重新激活。
function stopActiveMedia() {
  if (activeVideoUrl) {
    const v = videoCache.get(activeVideoUrl)
    if (v) { try { v.pause() } catch (e) { /* ignore */ } }
  }
  if (activeAudioUrl) {
    const a = audioCache.get(activeAudioUrl)
    if (a) { try { a.pause() } catch (e) { /* ignore */ } }
  }
  activeVideoUrl = null
  activeAudioUrl = null
}
// 单例 AudioContext：首个带音频节点录制时创建；返回 null 表示浏览器不支持（则导出静音视频）。
function ensureAudioCtx() {
  if (audioCtx) return audioCtx
  try {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    audioCtx = new AC()
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {})
  } catch (e) { audioCtx = null }
  return audioCtx
}
// 把某音频元素接入 WebAudio 图：每个元素仅 createMediaElementSource 一次，并接到 ctx.destination 保证预览可听；
// 返回 source 节点（录制时再加连 audioDest 混入导出流）。
function audioSourceFor(url) {
  const el = getAudio(url)
  if (!el || !audioCtx) return null
  let src = audioSrcCache.get(url)
  if (!src) {
    try { src = audioCtx.createMediaElementSource(el); src.connect(audioCtx.destination); audioSrcCache.set(url, src) }
    catch (e) { return null } // 已被其它图占用或元素未就绪：跳过该节点音频
  }
  return src
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
  const cfg = axisCfg()
  const A = cfg.a0, B = cfg.a1, BASE = cfg.base, AMP = cfg.amp
  const pts = []
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0
    const wave = AMP * Math.sin(i * 0.95 + 0.3)
    // 横屏：x 沿轴分布、y 为交叉轴起伏；竖屏：y 沿轴分布、x 为交叉轴起伏
    pts.push(cfg.portrait ? { x: BASE + wave, y: A + (B - A) * t } : { x: A + (B - A) * t, y: BASE + wave })
  }
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
  const TITLE_F = FONT('400', 18 * S, false)
  const YEAR_F = FONT('700', 20 * S, true)
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
  const TITLE_F = FONT('400', 18 * S, false)
  const YEAR_F = FONT('700', 20 * S, true)
  const getW = (text, font) => textWidthCache.get(`${text}_${font}`) || 0
  const cfg = axisCfg()

  const GAP = 26 * S             // 标题与年份的行间距（年在上、标题在下）
  // 竖屏(9:16)标签沿交叉轴(X)偏移：节点圆点半径小但年份/标题文字较宽，需更大偏移才不压住节点；
  // 横屏保持原 30*S 即可（标签在节点上/下，圆点在字间空隙、不挡字）。
  const TOP_OFF = (cfg.portrait ? 104 : 30) * S // 标签距节点圆心的交叉轴偏移
  const PAD = 6 * S              // 矩形外扩，避免贴脸
  const LINE = 26 * S            // 标题行的 em box 高度
  const BOX_H = GAP + LINE       // 标签块在「轴方向」上的高度（用于碰撞与下沉）
  const SH = Math.ceil(BOX_H) + 6 // 每下沉一级的交叉轴偏移，必须 ≥ 标签块高度才不会自重叠
  const MARGIN = 54 * S          // 屏幕外留白：超出此范围的节点不画标签

  // 标签块包围盒：横屏沿 Y(above/below) 偏移，竖屏沿 X(left/right) 偏移；
  // 返回绝对矩形 l/r/t/b，与卡片禁区可比。hw=文字半宽，hh=标签块半高。
  const boxOf = (sx, sy, side, shift, tw, yw) => {
    const hw = Math.max(tw, yw) / 2 + PAD
    const hh = BOX_H / 2 + PAD
    if (cfg.portrait) {
      const near = sx + (side > 0 ? (TOP_OFF + shift) : -(TOP_OFF + shift)) // 交叉轴 = X
      return { l: near - hw, r: near + hw, t: sy - hh, b: sy + hh, side, shift }
    }
    const near = sy + (side > 0 ? (TOP_OFF + shift) : -(TOP_OFF + shift))   // 交叉轴 = Y
    return { l: sx - hw, r: sx + hw, t: near - hh, b: near + hh, side, shift }
  }
  const hits = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t

  const placed = []
  const card = cardRect
    ? { l: cardRect.x - PAD, r: cardRect.x + cardRect.w + PAD, t: cardRect.y - PAD, b: cardRect.y + cardRect.h + PAD }
    : null
  const fits = (cand) => {
    // 画布边界：标签完全落在可视区内才放置，避免窄/方屏下被裁切（放不下则只留圆点）
    if (cand.l < 2 || cand.r > DW - 2 || cand.t < 2 || cand.b > DH - 2) return false
    for (const p of placed) if (hits(cand, p)) return false
    if (card && hits(cand, card)) return false
    return true
  }

  const map = new Map()
  const axisOf = (p) => (cfg.portrait ? p.y : p.x) // 节点在「轴方向」上的坐标
  const vis = []
  for (let i = 0; i < n; i++) {
    if (i === cur) continue
    const ax = axisOf(spts[i])
    if (ax < cfg.a0 - MARGIN || ax > cfg.a1 + MARGIN) continue
    vis.push(i)
  }
  vis.sort((a, b) => axisOf(spts[a]) - axisOf(spts[b]))   // 沿轴贪心
  for (const i of vis) {
    const tw = getW(nodes[i].title || '', TITLE_F)
    const yw = getW(nodes[i].year || '', YEAR_F)
    const pref = i % 2 === 1 ? 1 : -1
    const sides = [pref, -pref]
    let done = false
    // 最多下沉 3 级：避免标签被卡片顶得太远又不重叠；再放不下就只留圆点
    for (let level = 0; level < 3 && !done; level++) {
      for (const s of sides) {
        const cand = boxOf(spts[i].x, spts[i].y, s, level * SH, tw, yw)
        if (fits(cand)) {
          placed.push(cand)
          let x, yearY, titleY
          const off = s > 0 ? (TOP_OFF + level * SH) : -(TOP_OFF + level * SH)
          if (cfg.portrait) {
            // 竖屏：标签在节点左/右，年与标题竖直居中于节点
            x = spts[i].x + off
            yearY = spts[i].y - GAP / 2
            titleY = spts[i].y + GAP / 2
          } else {
            // 横屏：标签在节点上/下，年在上、标题在下
            x = spts[i].x
            yearY = spts[i].y + off
            titleY = yearY + GAP
          }
          map.set(i, { i, x, yearY, titleY, side: s, shift: level * SH, alpha: 1 })
          done = true; break
        }
      }
    }
    if (!done) continue // 放不下：只留圆点，绝不重叠、绝不糊
    // 边缘淡入淡出：越靠近视窗边界越淡，避免标签突然冒出/消失
    const it = map.get(i)
    const edge = Math.min(axisOf(spts[i]) - (cfg.a0 - MARGIN), (cfg.a1 + MARGIN) - axisOf(spts[i]))
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
  const cfg = axisCfg()
  const portrait = cfg.portrait
  // 相邻节点在「轴方向」上的间距（横屏=W，竖屏=H）
  const axisLen = (portrait ? H : W) * 0.74
  const effStep = n > 11
    ? Math.min(230 * S, axisLen / Math.max(1, 7 - 1))
    : (n > 1 ? axisLen / (n - 1) : axisLen)
  // 卡片宽度：受交叉轴方向画布宽限制（竖屏还受画布宽 W 限制）；横屏额外受邻居间距限制
  // （半宽 < 相邻间距即不压左右邻点），故上限取 2×间距 − 安全余量。
  let cardW
  if (portrait) {
    cardW = Math.min(380 * S, 0.46 * W, W - 2 * 16 * S)
  } else {
    const maxByNeighbor = effStep * 2 - 70 * S
    cardW = Math.min(380 * S, 0.32 * W, maxByNeighbor)
  }
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
  // 高度上限：横屏受画布高限制；竖屏还要受相邻节点轴间距限制，避免卡片纵向互相重叠
  const maxH = portrait
    ? Math.min(H - 96 * S, Math.max(120 * S, effStep - 28 * S))
    : H - 96 * S
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
  let x, y
  if (portrait) {
    // 竖屏：卡片置于节点左/右两侧，连接线沿交叉轴(X)接到卡片近边
    const nodeX = pts[cur].x, nodeY = pts[cur].y
    const onRight = nodeX < W / 2
    y = Math.max(14, Math.min(nodeY - cardH / 2, H - cardH - 14))
    x = onRight ? nodeX + connector + 16 * S : nodeX - connector - 16 * S - cardW
    x = Math.max(14, Math.min(x, W - cardW - 14))
  } else {
    // 横屏：卡片居中悬于节点正上方，下方留连接线接到节点圆点
    x = pts[cur].x - cardW / 2
    x = Math.max(16, Math.min(x, W - cardW - 16))
    y = pts[cur].y - cardH - connector
    if (y < 14) y = 14
  }
  return { x, y, w: cardW, h: cardH, padX, yearY, titleY, titleLH, descY, descLH,
           dividerY, connector, titleLines, descLines, titleFont, titleSize, portrait }
}

// 背景：跟随当前节点切换。每个节点可选「视频」(优先) 或「图片集」(images[])。
// - 视频：铺满播放（muted，不循环，只播一次到末帧），本身有运动，仅做极轻推镜；未就绪时回退首图作封面。
// - 单图：铺满 + 轻微 Ken Burns 缓动。
// - 多图：按节点内进度(intra)在 images[] 间缓慢交叉淡入轮播。
// - 节点交界（更平滑的电影感过渡）：当前节点前 ~30% 时长内，上一节点**轻微放大并淡出**(景深后撤)、
//   当前节点**从略大缩小到稳定值并淡入**，两者用 smoothstep 差速缩放交叉融合 —— 比线性硬切/纯淡入更有"推拉"质感；
//   intra 已过渡完则用 Ken Burns 在整个节点内缓慢放大。无状态，静态出片也正确。
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
  // smoothstep 缓动：0→0、0.5→0.5、1→1，比线性更柔
  const ss = (t) => { const x = Math.min(Math.max(t, 0), 1); return x * x * (3 - 2 * x) }

  const media = mediaOf(cur)
  if (!media) return false

  const FADE_DUR = 0.30                                   // 节点前 30% 时长用于背景过渡
  const inFade = ss(Math.min(Math.max(intra, 0), 1) / FADE_DUR)  // 当前节点淡入进度
  const outFade = 1 - inFade                             // 上一节点淡出进度

  // 退场层（上一节点）：随淡出缓慢放大，形成景深后撤
  const prev = mediaOf(cur - 1)
  if (prev) {
    const zOut = 1.0 + 0.08 * inFade                      // 1.00 → 1.08 放大淡出
    if (prev.kind === 'video') paintVid(prev.list[0], outFade, zOut)
    else paintImg(prev.list[0], outFade, zOut)
  }

  // 入场层（当前节点）：从略大缩小到稳定值、随淡入铺满；停留期 Ken Burns 缓慢放大
  const zIn = 1.03 + 0.06 * Math.min(Math.max(intra, 0), 1) + 0.07 * outFade  // 入场前段额外 0.07（≈1.10→稳定）
  if (media.kind === 'video') {
    paintVid(media.list[0], inFade, zIn)
    if (media.poster) paintImg(media.poster, inFade, zIn) // 视频未就绪时的封面兜底
    return true
  }
  // 图片：单张
  if (media.list.length === 1) {
    paintImg(media.list[0], inFade, zIn)
    return true
  }
  // 多张轮播：intra∈[0,1] 映射到图集进度，相邻两张在节点停留末段用 smoothstep 交叉淡入（更软）
  const K = media.list.length
  const fpos = Math.min(Math.max(intra, 0), 0.999) * K
  const idx = Math.floor(fpos)
  const frac = fpos - idx
  const slotFade = ss(Math.min(Math.max((frac - 0.58) / 0.42, 0), 1))
  const zk = 1.03 + 0.06 * (idx + ss(frac))               // 缓慢推近（Ken Burns）
  paintImg(media.list[idx], inFade, zk)
  if (idx < K - 1) paintImg(media.list[idx + 1], inFade * slotFade, zk + 0.03)
  return true
}

function draw(p) {
  const cvs = cv.value
  if (!cvs || !ctx || !cachedPath || cachedPath.length === 0) return
  const W = DW, H = DH
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, cvs.width, cvs.height)
  ctx.restore()

  const n = props.nodes.length
  const path = cachedPath
  const pts = cachedPts
  const cfg = axisCfg()
  const A = cfg.a0, B = cfg.a1, BASE = cfg.base, AMP = cfg.amp
  const axisLen = B - A

  const loc = locate(sched, p * sched.totalSec)
  const fade = Math.min(p / 0.04, 1)
  const cur = loc.node

  // —— 滑动视窗（镜头跟随）：沿「轴方向」显示当前节点附近的若干节点；节点>11 保持宽松间距，
  //    节点≤11 退回全宽布局（镜头锁死）。横屏轴=X、竖屏轴=Y，统一用 sAxis/npOfAxis 表达。
  const WINDOW = n > 11 ? 7 : n
  const half = (WINDOW - 1) / 2
  const step = n > 11 ? Math.min(230 * S, axisLen / Math.max(1, WINDOW - 1)) : (n > 1 ? axisLen / (n - 1) : 0)
  const camFrac = loc.node + loc.intra            // 平滑相机位置（节点浮点）
  const cam = Math.max(half, Math.min(n - 1 - half, camFrac))
  const sAxis = (np) => A + (np - (cam - half)) * step          // 节点分数 np → 轴上屏幕坐标
  const npOfAxis = (oa) => (n > 1 ? (oa - A) * (n - 1) / (axisLen || 1) : 0)
  const waveAt = (f) => BASE + AMP * Math.sin(f * 0.95 + 0.3)
  // 节点屏幕坐标：横屏(x=轴坐标, y=交叉轴起伏)，竖屏(x=交叉轴起伏, y=轴坐标)
  const spts = pts.map((p2, i) => (cfg.portrait ? { x: p2.x, y: sAxis(i) } : { x: sAxis(i), y: p2.y }))
  // 曲线屏幕坐标：取曲线在「轴方向」上的坐标映射，交叉轴坐标保持不变
  const spath = path.map((q) => (cfg.portrait ? { x: q.x, y: sAxis(npOfAxis(q.y)) } : { x: sAxis(npOfAxis(q.x)), y: q.y }))
  // 播放头 / 亮色已揭示轨迹终点：跟随真实叙事进度 camFrac（钳在 [0,n-1]）
  const revealFrac = Math.max(0, Math.min(n - 1, camFrac))
  const revealAxis = sAxis(revealFrac)                           // 播放头在「轴方向」上的屏幕坐标
  const playheadCross = waveAt(revealFrac)                       // 播放头在「交叉轴」上的坐标

  // 视频背景播放调度：进入节点播其视频、离开暂停（仅当前节点在播）
  syncActiveVideo(cur)
  // 音频调度：进入节点播其音频、离开暂停（暂停态 allowPlay=false 即停声）
  syncActiveAudio(cur, !store.paused)

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
  // 已揭示轨迹渐变：沿轴方向（横屏 X、竖屏 Y）由朱砂过渡到鎏金
  const grad = ctx.createLinearGradient(cfg.portrait ? 0 : A, cfg.portrait ? A : 0, cfg.portrait ? 0 : B, cfg.portrait ? B : 0)
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
  const axisOfPath = (q) => (cfg.portrait ? q.y : q.x)   // 曲线点在轴方向上的坐标
  for (let k = 1; k < spath.length; k++) {
    const npA = npOfAxis(axisOfPath(path[k - 1])), npB = npOfAxis(axisOfPath(path[k]))
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
    ctx.arc(cfg.portrait ? playheadCross : revealAxis, cfg.portrait ? revealAxis : playheadCross, 7 * S, 0, Math.PI * 2)
    ctx.fillStyle = C.accent2
    ctx.fill()
    ctx.restore()
  }

  // 当前节点卡片的几何需「先算后画」：标签布局要把它当禁区，否则卡片会盖住邻居标签。
  const cardGeo = cardGeometry(cur, spts, W, H, S)
  const labelLayout = layoutLabels(props.nodes, spts, cur, cardGeo)
  dbgCard = cardGeo
  dbgLabels = [...labelLayout.values()]
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
      ctx.textAlign = 'center'
      ctx.textBaseline = 'alphabetic'
      ctx.globalAlpha = (reached ? 1 : 0.4) * fade * (it.alpha ?? 1)
      ctx.fillStyle = reached ? C.nodeOn : C.muted
      ctx.font = FONT('700', 20 * S, true)
      ctx.fillText(props.nodes[i].year, it.x, it.yearY)
      ctx.fillStyle = reached ? C.text : C.muted
      ctx.font = FONT('400', 18 * S, false)
      ctx.fillText(props.nodes[i].title, it.x, it.titleY)
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

    // 连接线：节点圆点 → 卡片近边中点。横屏接卡片底边中点；竖屏接卡片左/右近边中点（与节点同高）。
    {
      const nx = spts[cur].x, ny = spts[cur].y
      let tx, ty
      if (cardGeo.portrait) {
        const onRight = cx > nx
        tx = onRight ? cx : cx + cardW
        ty = ny
      } else {
        tx = Math.max(cx + 18 * S, Math.min(nx, cx + cardW - 18 * S))
        ty = cy + cardH - rise
      }
      ctx.save()
      ctx.globalAlpha = a
      ctx.strokeStyle = 'rgba(201,162,39,0.55)'
      ctx.lineWidth = 2 * S
      ctx.beginPath()
      ctx.moveTo(nx, ny)
      ctx.lineTo(tx, ty)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(tx, ty, 3.5 * S, 0, Math.PI * 2)
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
    ctx.font = FONT('700', 0.18 * Math.min(DW, DH), true)
    const by = props.nodes[cur].year.replace(/\.\d+$/, '').replace('今天', 'NOW')
    ctx.fillText(by, W - 22, H - 14)
    ctx.restore()
  }

  // 字幕：当前节点独立字幕优先；否则回退全局 SRT 轨道（按秒）。居中绘制、烧录进视频。
  // 时间轴用 sched.totalSec（与 loc 同源），避免与 store.totalSec 异步错位导致 SRT 时间错配
  drawSubtitle(W, H, p * (sched ? sched.totalSec : store.totalSec), cur)

  ctx.globalAlpha = 1
  // 缓存本帧节点屏幕坐标（设计坐标系），供点击命中检测
  lastFrame = { spts: spts.map(p => ({ x: p.x, y: p.y })), cur, n }
}

// 字幕：① 当前节点独立字幕（node.subtitle，像音频一样每节点自带）优先；② 否则回退全局 SRT 轨道（按秒）。
// 居中绘制；颜色/字体/底色/位置/描边均可配；烧录进视频。字体支持预设键或任意本地字体名（见 quoteFont）。
const SUB_FONT = {
  sans: 'system-ui, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
  hei: '"Microsoft YaHei", "PingFang SC", "Heiti SC", "Source Han Sans SC", sans-serif',
  song: '"SimSun", "Songti SC", "STSong", "Source Han Serif SC", serif',
  serif: 'Georgia, "Times New Roman", "Songti SC", serif',
  mono: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
}
// 把字体名安全的变成 canvas font-family：含空格的本地字体名（如 "PingFang SC"）自动加引号；
// 预设键解析为对应字体栈，未知字符串按原样（本机已装即生效、未装回退）。
function quoteFont(name) {
  if (!name) return name
  return /\s/.test(name) ? `"${name}"` : name
}
function resolveFont(key) {
  if (SUB_FONT[key]) return SUB_FONT[key]
  if (key) return quoteFont(String(key))
  return SUB_FONT.sans
}
function drawSubtitle(W, H, t, cur) {
  const gst = store.subtitleStyle || {}
  let text = null
  let st = gst
  let perNode = false
  // 1) 优先：当前节点上传的 SRT（时间码相对该节点起点，nodeT = 绝对时间 - 节点起点）
  if (cur >= 0 && store.nodes[cur]) {
    const nd = store.nodes[cur]
    const nst = nd.subtitleStyle
    const base = (nst && typeof nst === 'object') ? { ...gst, ...nst } : gst
    const ns = nd.subtitles
    if (Array.isArray(ns) && ns.length && sched && sched.starts) {
      const nodeT = t - (sched.starts[cur] || 0)
      const hit = ns.find((s) => nodeT >= s.start && nodeT <= s.end)
      if (hit && hit.text) { text = hit.text; st = base; perNode = true }
    }
    // 1b) 兼容：节点纯文本字幕（旧版直接填写的字符串），进入该节点期间一直显示
    if (!text && nd.subtitle) {
      const nsub = String(nd.subtitle).trim()
      if (nsub) { text = nsub; st = base; perNode = true }
    }
  }
  // 2) 回退：全局 SRT 轨道，按当前播放秒取活动条目
  if (!text) {
    const subs = store.subtitles
    if (subs && subs.length) {
      const active = subs.find((s) => t >= s.start && t <= s.end)
      if (active && active.text) { text = active.text; perNode = false }
    }
  }
  if (!text) { lastSubtitle = null; return }
  lastSubtitle = { text, start: null, end: null, style: { ...st }, perNode }
  const base = Math.min(W, H)
  const size = Math.max(18, base * 0.043)
  const family = resolveFont(st.fontFamily)
  const weight = 500
  const lh = size * 1.34
  const maxW = W * 0.86
  const lines = wrapText(text, `${weight} ${size}px ${family}`, maxW)
  if (!lines.length) return

  const padX = size * 0.5, padY = size * 0.4
  const blockH = lines.length * lh + padY * 2
  const margin = base * 0.05
  const top = st.position === 'top' ? margin : H - blockH - margin
  const cx = W / 2

  if (st.background) {
    let bw = 0
    ctx.font = `${weight} ${size}px ${family}`
    for (const l of lines) bw = Math.max(bw, ctx.measureText(l).width)
    bw += padX * 2
    ctx.save()
    roundRect(cx - bw / 2, top, bw, blockH, size * 0.45)
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fill()
    ctx.restore()
  }

  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `${weight} ${size}px ${family}`
  let y = top + padY + size / 2
  for (const l of lines) {
    if (st.stroke) {
      ctx.lineWidth = size * 0.14
      ctx.lineJoin = 'round'
      ctx.strokeStyle = 'rgba(0,0,0,0.9)'
      ctx.strokeText(l, cx, y)
    }
    ctx.fillStyle = st.color || '#FFFFFF'
    ctx.fillText(l, cx, y)
    y += lh
  }
  ctx.restore()
}

function fit() {
  const el = cv.value
  if (!el) return
  // 外层预览框（.canvas-frame）按「所选比例的精确内接矩形」用 JS 定尺寸，
  // 避免 CSS aspect-ratio 在横/竖屏下的兼容性差异；画布铺满该框 → 预览严格等于导出比例、零黑边。
  const frame = el.parentElement
  const host = frame ? frame.parentElement : null
  const avail = (host || frame || el).getBoundingClientRect()
  const availW = Math.max(50, avail.width), availH = Math.max(50, avail.height)
  const kFit = Math.min(availW / DW, availH / DH)
  const cw = Math.max(50, Math.round(DW * kFit))
  const ch = Math.max(50, Math.round(DH * kFit))
  if (frame) { frame.style.width = cw + 'px'; frame.style.height = ch + 'px' }
  const bw = Math.round(cw * DPR)
  const bh = Math.round(ch * DPR)
  if (el.width !== bw) el.width = bw
  if (el.height !== bh) el.height = bh
  ctx = el.getContext('2d')
  const k = Math.min(bw / DW, bh / DH)
  const ox = (bw - DW * k) / 2
  const oy = (bh - DH * k) / 2
  ctx.setTransform(k, 0, 0, k, ox, oy)
  currentScale = k
  offX = ox; offY = oy
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
  offX = ox; offY = oy
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
      stopActiveMedia()        // 导出末帧：停掉背景视频/节点音频，不循环
      if (recorder && recorder.state !== 'inactive') recorder.stop()
      return
    }
    raf = requestAnimationFrame(loop)
    return
  }

  // 预览模式：支持暂停（store.paused 时不再推进、画面停在 curP）；否则持续推进，
  // 播放一遍后停在最后一帧（不自动重播）
  if (store.paused) { raf = 0; return }
  const p = total > 0 ? Math.min(elapsed / total, 1) : 1
  curP = p
  draw(p)
  if (p >= 1) { stopActiveMedia(); raf = 0; return } // 走到末帧：停掉视频/音频，画面停在最后一帧
  raf = requestAnimationFrame(loop)
}

function startLoop() {
  cancelAnimationFrame(raf)
  // 依据 curP 对齐 startTime：暂停后续播 / 跳转后都从这里无缝继续
  startTime = performance.now() - curP * sched.totalSec * 1000
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
    // 音频混入导出：把各节点音频经 WebAudio 汇成一条音轨加入录制流；无任何音频节点则保持原静音视频。
    // 全程 best-effort：任一环节失败都静默跳过，绝不影响视频录制本身。
    if (ensureAudioCtx() && props.nodes.some((n) => n.audio)) {
      try {
        audioDest = audioCtx.createMediaStreamDestination()
        for (const n of props.nodes) {
          if (n.audio) { const s = audioSourceFor(n.audio); if (s) { try { s.connect(audioDest) } catch (e) {} } }
        }
        const tr = audioDest.stream.getAudioTracks()[0]
        if (tr) { stream.addTrack(tr); audioTrack = tr }
      } catch (e) { /* 音频混入失败：导出静音视频 */ }
    }
    const mime = pickMime()
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    const chunks = []
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data) }
    const done = new Promise((res) => {
      recorder.onstop = () => {
        try {
          // 释放录制用音轨（source 仍连着 ctx.destination，预览音频继续可听；下次录制重建 audioDest）
          if (audioTrack) { try { audioTrack.stop() } catch (e) {} audioTrack = null }
          audioDest = null
        } catch (e) { /* ignore */ }
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
    // 录制必须从头起：startLoop() 会用 curP 对齐 startTime，若预览已跑完（curP=1）或曾跳转到某节点
    // （curP=该节点中点），elapsed 会带着这段进度起步 → p 直接接近 1，录出来的只有尾帧几秒（看似录制失败）。
    curP = 0
    store.paused = false
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
  curP = 0
  store.paused = false
  mode = 'loop'
  startLoop()
}

// === 播放控制：暂停 / 继续 / 跳转 ===
function play() {
  if (mode === 'static' || mode === 'once') return
  store.paused = false
  if (curP >= 1) curP = 0            // 已到尾帧则从头播
  startLoop()
}
function pause() {
  if (mode === 'static' || mode === 'once') return
  store.paused = true
  if (raf) { cancelAnimationFrame(raf); raf = 0 }
  draw(curP)                          // 画面保留当前帧
}
function togglePause() { store.paused ? play() : pause() }

// 屏幕坐标(客户端)→设计坐标(1920×1080 系)，供点击命中检测
function toDesign(clientX, clientY) {
  const el = cv.value
  if (!el) return null
  const rect = el.getBoundingClientRect()
  const X = ((clientX - rect.left) * DPR - offX) / (currentScale || 1)
  const Y = ((clientY - rect.top) * DPR - offY) / (currentScale || 1)
  return { X, Y }
}
// 命中最近的可见节点圆点（设计坐标距离 < 节点半径 + 余量）
function hitNode(X, Y) {
  if (!lastFrame) return -1
  let best = -1, bestD = Infinity
  for (let i = 0; i < lastFrame.n; i++) {
    const sp = lastFrame.spts[i]
    if (!sp) continue
    const r = i === lastFrame.cur ? 13 : 8   // 与 draw 圆点半径一致（设计像素）
    const d = Math.hypot(X - sp.x, Y - sp.y)
    if (d < r + 16 && d < bestD) { bestD = d; best = i }
  }
  return best
}
// 跳转到节点 i：进度对齐到该节点中段（卡片已完整展开），随后暂停聚焦该节点
function seekToNode(i) {
  if (i < 0 || i >= sched.n) return
  const total = sched.totalSec
  const s = sched.starts[i], d = sched.durs[i]
  curP = total > 0 ? Math.min((s + (d || 0) * 0.5) / total, 1) : 0
  if (mode === 'static') { draw(curP); return }
  if (mode === 'once') { startTime = performance.now() - curP * total * 1000; return }
  // 预览：跳转后暂停聚焦该节点（画面停在该帧），用户可点「播放」继续
  store.paused = true
  draw(curP)
  if (raf) { cancelAnimationFrame(raf); raf = 0 }
}
function onClick(e) {
  if (mode === 'static') return
  const pt = toDesign(e.clientX, e.clientY)
  if (!pt) return
  const i = hitNode(pt.X, pt.Y)
  if (i >= 0) seekToNode(i)
}
function onMove(e) {
  if (mode === 'static' || !cv.value) return
  const pt = toDesign(e.clientX, e.clientY)
  cv.value.style.cursor = pt && hitNode(pt.X, pt.Y) >= 0 ? 'pointer' : 'default'
}

// 兼容验证用：返回最近一帧的设计坐标几何（画幅/缩放/卡片/标签），不改变渲染行为
const debugFn = () => ({ DW, DH, S, PORTRAIT, cur: lastFrame && lastFrame.cur, card: dbgCard,
  labels: dbgLabels.map((l) => ({ i: l.i, x: l.x, yearY: l.yearY, titleY: l.titleY, side: l.side })),
  audio: { active: activeAudioUrl, count: audioCache.size,
    loop: activeAudioUrl != null ? !!(audioCache.get(activeAudioUrl) && audioCache.get(activeAudioUrl).loop) : null,
    playing: !!(activeAudioUrl && audioCache.get(activeAudioUrl) && !audioCache.get(activeAudioUrl).paused),
    ended: activeAudioUrl != null ? !!(audioCache.get(activeAudioUrl) && audioCache.get(activeAudioUrl).ended) : null,
    t: activeAudioUrl != null && audioCache.get(activeAudioUrl) ? audioCache.get(activeAudioUrl).currentTime : null },
  video: { active: activeVideoUrl, count: videoCache.size,
    loop: activeVideoUrl != null ? !!(videoCache.get(activeVideoUrl) && videoCache.get(activeVideoUrl).loop) : null },
  subtitle: lastSubtitle })
if (typeof window !== 'undefined') window.__tlDebug = debugFn
defineExpose({ startRecording, replay, pause, resume: play, togglePause, isPaused: () => store.paused, seekToNode, getCanvas: () => cv.value, __debug: debugFn })

// 应用画幅比例：把 DW/DH/OUT/PORTRAIT 同步为所选比例，并重建坐标系 + 重绘（画布已就绪时）。
function applyAspect() {
  const a = aspectDims(store.aspect)
  DW = a.w; DH = a.h; OUT_W = a.w; OUT_H = a.h
  PORTRAIT = DH > DW
  computeScale()
  if (!ctx) return
  rebuild()
  if (mode === 'once') return  // 录制进行中不改画布尺寸，避免打断 captureStream
  fit()
  if (mode === 'static') draw(props.frame / (props.frames - 1))
  else if (mode === 'loop') {
    const total = sched.totalSec
    const p = total > 0 ? ((performance.now() - startTime) / 1000 / total) % 1 : 0
    draw(p < 0 ? p + 1 : p)
  }
}

onMounted(async () => {
  if (document.fonts && document.fonts.ready) {
    try { await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 600))]) } catch (e) { /* 忽略 */ }
  }
  applyAspect()            // 先按 store.aspect 设定 DW/DH（此时 ctx 尚未就绪，仅设尺寸）
  DPR = window.devicePixelRatio || 1
  fit()                    // 设定 ctx 与画布位图
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
  cv.value.addEventListener('click', onClick)
  cv.value.addEventListener('mousemove', onMove)
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
  // 停止所有节点音频，避免组件卸载后仍有声音在播
  for (const el of audioCache.values()) { try { el.pause() } catch (e) {} }
  if (cv.value) {
    cv.value.removeEventListener('click', onClick)
    cv.value.removeEventListener('mousemove', onMove)
  }
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

// 画幅比例切换：重建坐标系并按当前模式重绘（录制中不改画布尺寸，避免打断 captureStream）
watch(() => store.aspect, () => { applyAspect() })
</script>

<template>
  <canvas ref="cv" class="tl-canvas"></canvas>
</template>