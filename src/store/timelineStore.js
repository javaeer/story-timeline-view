// 响应式数据中枢：所有编辑、导入、导出都围绕它，组件自动联动
import { reactive } from 'vue'
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
      // 视频背景：单节点可选一段小视频（data URI 或同源 URL）。有 video 时优先于 images 作背景
      video: n.video != null && String(n.video).length ? String(n.video) : null,
      // 节点音频：进入该节点时播放（配音/配乐）。与 video 同策略：blob/data/相对/经 /__img 代理的远程
      audio: n.audio != null && String(n.audio).length ? String(n.audio) : null,
    }))
  store.recompute()
}

// 图片集支持「数组」或「逗号/换行分隔字符串」两种写法
function parseImages(v) {
  if (Array.isArray(v)) return v.map(String).filter(Boolean)
  if (typeof v === 'string') return v.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)
  return []
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
      { year: '2020', title: '节点一', desc: '该节点的核心事实或故事', key: true, duration: 10, images: [], video: null, audio: null },
      { year: '2021', title: '节点二', desc: '可写一句话描述', key: false, duration: 10, images: [], video: null, audio: null },
      { year: '2022', title: '节点三', desc: '节点时长 duration 单位为秒，留空则默认 10s', key: false, duration: 10, images: [], video: null, audio: null },
    ],
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
    })),
  }
}

export function addNode() {
  store.nodes.push({ year: '2024', title: '新节点', desc: '节点描述', key: false, duration: null, images: [], video: null, audio: null })
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

// 模块加载即按默认数据算一次总时长，保证出片时帧数正确
store.recompute()

// 调试/自动化友好：暴露 store 到 window（便于无头验证与排查；生产环境无副作用）
if (typeof window !== 'undefined') window.__tlStore = store
