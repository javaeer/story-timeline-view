// 响应式数据中枢：所有编辑、导入、导出都围绕它，组件自动联动
import { reactive, watch } from 'vue'
import { timeline as defaultData } from '../data/timeline.js'
import { buildSchedule } from '../composables/useTimeline.js'

// 画幅比例预设：长边统一 1920，导出与设计坐标系同尺寸 → 导出零黑边、所见即所得。
// 竖屏(9:16)下时间轴自动改为「自上而下纵向铺开」（见 TimelineCanvas 轴向重构）。
export const ASPECTS = [
  { id: '16:9', label: '16:9 横屏', w: 1920, h: 1080 },
  { id: '9:16', label: '9:16 竖屏', w: 1080, h: 1920 },
  { id: '4:3', label: '4:3 横屏', w: 1440, h: 1080 },
  { id: '1:1', label: '1:1 方形', w: 1080, h: 1080 },
  { id: 'wide', label: '宽屏 2.26:1', w: 1864, h: 824 },
]
export function aspectDims(id) {
  return ASPECTS.find((a) => a.id === id) || ASPECTS[0]
}

export const store = reactive({
  meta: { ...defaultData.meta },
  nodes: defaultData.nodes.map((n) => ({ ...n })),
  fps: 25,
  totalSec: 12,
  aspect: '16:9', // 画幅比例（预览与导出共用，切换即重建坐标系）
  paused: false,   // 播放控制：是否暂停（画布与编辑器面板共享，保证暂停按钮状态一致）
  // 字幕（SRT 轨道）：用户手动导入的全局字幕；播放时按当前秒显示活动条目，烧录进视频
  subtitles: [],
  // 字幕样式：颜色 / 字体 / 半透明底 / 位置 / 描边，均可由面板配置；字体支持预设键或任意本地字体名
  subtitleStyle: { color: '#FFFFFF', fontFamily: 'sans', background: false, position: 'bottom', stroke: true },
  // 依据当前 nodes 重算总时长（节点时长可被显式 duration 覆盖）
  recompute() {
    this.totalSec = buildSchedule(this.nodes).totalSec
  },
})

export function loadData(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('数据格式错误：应为 JSON 对象')
  if (!obj.meta || typeof obj.meta !== 'object') throw new Error('缺少 meta 字段')
  if (!Array.isArray(obj.nodes) || obj.nodes.length === 0) throw new Error('nodes 必须为非空数组')
  for (const n of obj.nodes) {
    if (!n.year || !n.title || !n.desc) throw new Error('每个节点必须包含 year / title / desc')
  }
  store.meta = {
    kicker: obj.meta.kicker ?? '乡镇 · 时间轴',
    title: obj.meta.title ?? '时间轴标题',
    subtitle: obj.meta.subtitle ?? '',
    badge: obj.meta.badge ?? 'Vue 3 · Canvas 2D',
  }
  store.nodes = obj.nodes.map((n) => ({
    year: String(n.year),
    title: String(n.title),
    desc: String(n.desc),
    key: !!n.key,
    duration: n.duration != null && !Number.isNaN(Number(n.duration)) ? Number(n.duration) : null,
    images: parseImages(n.images),
      // 视频背景：单节点可选一段小视频（data URI 或同源 URL）。富对象取 .url；有 video 时优先于 images 作背景
      video: mediaUrl(n.video),
      // 节点音频：进入该节点时播放（配音/配乐）。与 video 同策略：blob/data/相对/经 /__img 代理的远程
      audio: mediaUrl(n.audio),
      // 节点独立字幕：像音频一样每节点自带——上传该节点的 .srt，时间码相对「进入该节点」起算（0 = 节点起点）
      subtitles: parseNodeSubtitles(n.subtitles),
      // 兼容旧的纯文本节点字幕（早期版本为直接填写的字符串），保留读取
      subtitle: typeof n.subtitle === 'string' ? n.subtitle : null,
      // 节点级字幕样式覆盖（可选）：颜色/字体/底纹/位置/描边，缺省沿用全局 subtitleStyle
      subtitleStyle: n.subtitleStyle && typeof n.subtitleStyle === 'object' ? n.subtitleStyle : null,
    }))
  // 字幕轨道：兼容「SRT 解析后的数组」；缺省为空
  store.subtitles = Array.isArray(obj.subtitles)
    ? obj.subtitles
        .filter((s) => s && typeof s.text === 'string' && Number.isFinite(+s.start))
        .map((s) => ({ start: +s.start, end: Number.isFinite(+s.end) ? +s.end : +s.start, text: String(s.text).replace(/\r/g, '') }))
    : []
  // 字幕样式：以默认值为底，合并导入文件中的覆盖项
  store.subtitleStyle = {
    color: '#FFFFFF', fontFamily: 'sans', background: false, position: 'bottom', stroke: true,
    ...(obj.subtitleStyle && typeof obj.subtitleStyle === 'object' ? obj.subtitleStyle : {}),
  }
  store.recompute()
}

// 图片集支持「数组」或「逗号/换行分隔字符串」两种写法
// 图片集：兼容「URL 字符串数组」「带 caption 的富对象数组 [{url,caption,source}]」「逗号/换行分隔字符串」
function parseImages(v) {
  const arr = Array.isArray(v) ? v : (typeof v === 'string' ? v.split(/[\n,]/) : [])
  return arr
    .map((x) => (x && typeof x === 'object' ? (x.url || '') : x))
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean)
}
// 节点字幕（由该节点上传的 .srt 解析而来）：[{start,end,text}]，时间相对该节点起点（0 = 进入节点）。
// 与全局 SRT 轨道同结构，只是时基不同；空则回退节点纯文本 / 全局轨道。
function parseNodeSubtitles(v) {
  if (!Array.isArray(v)) return null
  const arr = v
    .filter((s) => s && typeof s.text === 'string' && Number.isFinite(+s.start))
    .map((s) => ({ start: +s.start, end: Number.isFinite(+s.end) ? +s.end : +s.start, text: String(s.text).replace(/\r/g, '') }))
    .sort((a, b) => a.start - b.start)
  return arr.length ? arr : null
}

// 媒体 URL：兼容「字符串」与「富对象 {url}」（取 .url）；其余视为无效
function mediaUrl(v) {
  if (v == null) return null
  const raw = typeof v === 'object' ? (v.url || '') : String(v)
  const s = (raw || '').trim()
  return s.length ? s : null
}

// SRT 字幕解析：标准格式 `序号\n 00:00:01,000 --> 00:00:04,000\n 文本(可多行)\n`，返回 [{start,end,text}](秒)。
// 同时兼容纯时间格式（`HH:MM:SS,mmm` 或 `MM:SS.mmm`）；文本按 \n 保留多行。
export function parseSRT(text) {
  if (typeof text !== 'string') return []
  const toSec = (h, mi, s, ms) => (+h) * 3600 + (+mi) * 60 + (+s) + (+ms || 0) / 1000
  const blocks = text.replace(/\r/g, '').replace(/^﻿/, '').trim().split(/\n\s*\n/)
  const out = []
  for (const b of blocks) {
    const lines = b.split('\n')
    const ti = lines.findIndex((l) => l.includes('-->'))
    if (ti < 0) continue
    const m = lines[ti].match(/(\d+):(\d+):(\d+)[.,](\d+)\s*-->\s*(\d+):(\d+):(\d+)[.,](\d+)/)
    if (!m) continue
    const start = toSec(m[1], m[2], m[3], m[4])
    const end = toSec(m[5], m[6], m[7], m[8])
    const txt = lines.slice(ti + 1).join('\n').trim()
    if (txt) out.push({ start, end, text: txt })
  }
  return out.sort((a, b) => a.start - b.start)
}

export function downloadJSON(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// 空白模板：结构清晰、字段带示例值，供用户下载后填空
export function blankTemplate() {
  return {
    meta: {
      kicker: '乡镇名 · 主题时间轴',
      title: '标题（一句话点题）',
      subtitle: '副标题（补充一句话语境）',
      badge: 'Vue 3 · Canvas 2D',
    },
    nodes: [
      { year: '2020', title: '节点一', desc: '该节点的核心事实或故事', key: true, duration: 10, images: [], video: null, audio: null, subtitles: null },
      { year: '2021', title: '节点二', desc: '可写一句话描述', key: false, duration: 10, images: [], video: null, audio: null, subtitles: null },
      { year: '2022', title: '节点三', desc: '节点时长 duration 单位为秒，留空则默认 10s', key: false, duration: 10, images: [], video: null, audio: null, subtitles: null },
    ],
    subtitles: [],
  }
}

export function currentData() {
  return {
    meta: { ...store.meta },
    nodes: store.nodes.map((n) => ({
      year: n.year,
      title: n.title,
      desc: n.desc,
      key: n.key,
      duration: n.duration,
      ...(n.images && n.images.length ? { images: n.images } : {}),
      ...(n.video ? { video: n.video } : {}),
      ...(n.audio ? { audio: n.audio } : {}),
      ...(n.subtitles && n.subtitles.length ? { subtitles: n.subtitles } : {}),
      ...(n.subtitle ? { subtitle: n.subtitle } : {}),
      ...(n.subtitleStyle ? { subtitleStyle: n.subtitleStyle } : {}),
    })),
    subtitles: store.subtitles,
    subtitleStyle: store.subtitleStyle,
  }
}

export function addNode() {
  store.nodes.push({ year: '2024', title: '新节点', desc: '节点描述', key: false, duration: null, images: [], video: null, audio: null, subtitles: null, subtitle: null })
  store.recompute()
}

export function removeNode(i) {
  if (store.nodes.length <= 1) return
  store.nodes.splice(i, 1)
  store.recompute()
}

export function setNode(i, patch) {
  if (!store.nodes[i]) return
  Object.assign(store.nodes[i], patch)
  store.recompute()
}

export function updateMeta(patch) {
  Object.assign(store.meta, patch)
}

// === 工程持久化（P0）：编辑自动存入 localStorage，刷新/重开不丢失；导入即覆盖 ===
const PROJECT_LS_KEY = 'tl_project_v1'
function persistProject() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(PROJECT_LS_KEY, JSON.stringify(currentData()))
  } catch (e) { /* 隐私模式/配额满：静默跳过，不影响编辑 */ }
}
let persistTimer = null
function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(persistProject, 600)
}
// 启动时尝试恢复上次工程；失败（数据损坏/旧版）则回退默认数据。
// 说明：节点里的 video/audio 若为 blob: 临时地址，刷新后失效属正常（仅本会话有效）；
// 图片以 data URI 存储可完整恢复，文本字段均可完整恢复。
function restoreProject() {
  try {
    if (typeof localStorage === 'undefined') return
    const raw = localStorage.getItem(PROJECT_LS_KEY)
    if (!raw) return
    loadData(JSON.parse(raw))
  } catch (e) { /* 损坏数据：忽略，沿用默认 */ }
}

// 模块加载：先恢复工程（有则覆盖默认），再算一次总时长兜底
restoreProject()
store.recompute()

// 编辑监听：节点/标题/比例等任意变更都防抖落盘（深层监听；浏览器环境才装）
if (typeof window !== 'undefined') {
  watch(() => currentData(), schedulePersist, { deep: true })
}

// 调试/自动化友好：暴露 store / 解析函数到 window（便于无头验证与排查；生产环境无副作用）
if (typeof window !== 'undefined') window.__tlStore = store
if (typeof window !== 'undefined') window.__tlParseSRT = parseSRT
if (typeof window !== 'undefined') window.__tlLoadData = loadData
