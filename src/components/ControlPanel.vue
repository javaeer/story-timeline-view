<script setup>
import { ref, computed, toValue } from 'vue'
import {
  store, loadData, downloadJSON, blankTemplate, currentData,
  addNode, removeNode, setNode, updateMeta,
} from '../store/timelineStore.js'

const props = defineProps({
  canvasRef: { type: Object, required: true }, // TimelineCanvas 组件实例（用于录制/重播）
})

const fileInput = ref(null)
const status = ref('')
const exporting = ref(false)

const totalSec = computed(() => store.totalSec)

function flash(msg) { status.value = msg }

function triggerFile() { fileInput.value?.click() }

function onFile(e) {
  const f = e.target.files?.[0]
  if (!f) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const obj = JSON.parse(reader.result)
      loadData(obj)
      flash(`已导入：${store.meta.title}（${store.nodes.length} 个节点，约 ${totalSec.value.toFixed(1)}s）`)
    } catch (err) {
      flash('导入失败：' + (err.message || 'JSON 解析错误'))
    }
  }
  reader.onerror = () => flash('导入失败：文件读取错误')
  reader.readAsText(f)
  e.target.value = ''
}

function downloadTemplate() {
  downloadJSON('时间轴数据模板.json', blankTemplate())
  flash('已下载空白模板：时间轴数据模板.json')
}

function downloadCurrent() {
  const name = (store.meta.title || 'timeline').replace(/[\\/:*?"<>|]/g, '_')
  downloadJSON(`${name}-数据.json`, currentData())
  flash('已下载当前数据')
}

async function exportVideo() {
  const inst = toValue(props.canvasRef)
  if (!inst || typeof inst.startRecording !== 'function') {
    flash('画布未就绪，请稍候重试')
    return
  }
  exporting.value = true
  flash('正在录制…（请等待动画播放一遍）')
  try {
    const blob = await inst.startRecording()
    const url = URL.createObjectURL(blob)
    const name = (store.meta.title || 'timeline').replace(/[\\/:*?"<>|]/g, '_')
    const a = document.createElement('a')
    a.href = url
    a.download = `${name}-时间轴.webm`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    flash(`导出完成：${name}-时间轴.webm（1920×1080，${(blob.size / 1024 / 1024).toFixed(1)} MB）`)
  } catch (err) {
    flash('导出失败：' + (err.message || '未知错误'))
  } finally {
    exporting.value = false
  }
}

function replay() {
  const inst = toValue(props.canvasRef)
  inst?.replay?.()
  flash('已重播')
}

// 本地图片选择：读为 data URI（体积小、可序列化进 JSON、同源不污染 Canvas）。
// 用【单个隐藏 input + pickIdx】复用，避免 v-for 里函数式 ref 数组的坑
// （数组 ref 在函数式 ref 下不会被正确填充，按钮 click 取不到 input → 点击无反应）。
const pickIdx = { i: 0 } // 当前正在选文件的节点索引
const pickImg = ref(null)
const pickVid = ref(null)
function fileToDataURI(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}
// 本地【视频】绝不用 data URI：readAsDataURL 会把几十~上百 MB 的视频编码成同等量级的
// base64 字符串塞进响应式状态，再被 <input :value="nd.video"> 绑定到 DOM，直接撑爆
// 渲染进程、白屏崩溃。改用 blob: URL（同源、可绘制、支持播放与 seek），内存占用忽略不计。
// 代价：blob URL 仅当前会话有效；导出 JSON 会带上这个短字符串，但重新导入需再次选本地视频。
const vidObjectUrls = Object.create(null) // 索引 -> 已创建的 blob URL，替换/清除时回收避免泄漏
function openImages(i) { pickIdx.i = i; pickImg.value?.click() }
function openVideo(i) { pickIdx.i = i; pickVid.value?.click() }
async function onPickImages(e) {
  const i = pickIdx.i
  const files = Array.from(e.target.files || []).filter((f) => f.type.startsWith('image/'))
  for (const f of files) {
    try {
      const uri = await fileToDataURI(f)
      setNode(i, { images: [...(store.nodes[i].images || []), uri] })
    } catch (_) { /* 忽略单文件失败 */ }
  }
  e.target.value = ''
}
async function onPickVideo(e) {
  const i = pickIdx.i
  const f = Array.from(e.target.files || []).find((x) => x.type.startsWith('video/'))
  if (f) {
    // 回收旧 URL，避免反复选视频导致内存泄漏
    if (vidObjectUrls[i]) { try { URL.revokeObjectURL(vidObjectUrls[i]) } catch (_) {}; delete vidObjectUrls[i] }
    const url = URL.createObjectURL(f)
    vidObjectUrls[i] = url
    setNode(i, { video: url })
    // 预览默认「播放一遍后停在尾帧」；若用户是在动画结束后才选视频，循环已停、不会重绘，
    // 视频永远不会被 play()/绘制。这里主动重播一遍，确保选中的视频立即可见。
    const inst = toValue(props.canvasRef)
    inst?.replay?.()
    flash('已选视频，正在预览')
  }
  e.target.value = ''
}
function clearVideo(i) {
  if (vidObjectUrls[i]) { try { URL.revokeObjectURL(vidObjectUrls[i]) } catch (_) {}; delete vidObjectUrls[i] }
  setNode(i, { video: null })
}
</script>

<template>
  <aside class="panel">
    <h2 class="panel__title">时间轴编辑器</h2>

    <section class="panel__sec">
      <label class="panel__label">标题 / 副标题</label>
      <input class="panel__input" v-model="store.meta.kicker" placeholder="kicker" @input="updateMeta({ kicker: store.meta.kicker })" />
      <input class="panel__input" v-model="store.meta.title" placeholder="标题" @input="updateMeta({ title: store.meta.title })" />
      <input class="panel__input" v-model="store.meta.subtitle" placeholder="副标题" @input="updateMeta({ subtitle: store.meta.subtitle })" />
    </section>

    <section class="panel__sec">
      <div class="panel__row">
        <label class="panel__label">时间节点</label>
        <button class="panel__btn panel__btn--ghost" @click="addNode(); flash('已新增节点')">+ 新增</button>
      </div>
      <ul class="nodes">
        <li v-for="(nd, i) in store.nodes" :key="i" class="node">
          <div class="node__head">
            <span class="node__idx">{{ i + 1 }}</span>
            <input class="panel__input panel__input--sm" v-model="nd.year" placeholder="年份" @input="setNode(i, { year: nd.year })" />
            <button class="node__del" title="删除" @click="removeNode(i)">×</button>
          </div>
          <input class="panel__input panel__input--sm" v-model="nd.title" placeholder="标题" @input="setNode(i, { title: nd.title })" />
          <input class="panel__input panel__input--sm" v-model="nd.desc" placeholder="描述" @input="setNode(i, { desc: nd.desc })" />
          <label class="node__label">图片集（每行一个 URL，或下方选本地；停留时自动轮播）</label>
          <textarea class="panel__input panel__textarea" rows="2"
            :value="(nd.images || []).join('\n')"
            placeholder="https://example.com/a.jpg"
            @input="setNode(i, { images: $event.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })"></textarea>
          <div class="node__media">
            <button type="button" class="panel__btn panel__btn--ghost panel__btn--xs" @click="openImages(i)">📁 选图片</button>
            <button type="button" class="panel__btn panel__btn--ghost panel__btn--xs" @click="openVideo(i)">🎬 选视频</button>
            <span class="node__media-info" v-if="(nd.images || []).length || nd.video">
              {{ (nd.images || []).length ? '🖼' + (nd.images || []).length : '' }}{{ nd.video ? ' · 🎬已选' : '' }}
            </span>
          </div>
          <label class="node__label">视频 URL（或上方选本地；有视频时优先作背景）</label>
          <div class="node__vid">
            <input class="panel__input panel__input--sm" :value="nd.video || ''" placeholder="https://…/clip.mp4"
              @input="setNode(i, { video: $event.target.value || null })" />
            <button v-if="nd.video" type="button" class="panel__btn panel__btn--xs panel__btn--danger" @click="clearVideo(i)">清除</button>
          </div>
          <div class="node__row">
            <label class="node__check">
              <input type="checkbox" v-model="nd.key" @change="setNode(i, { key: nd.key })" /> 关键节点
            </label>
            <label class="node__dur">
              时长
              <input class="panel__input panel__input--num" type="number" min="0.5" step="0.5"
                :value="nd.duration ?? ''" placeholder="自动"
                @input="setNode(i, { duration: $event.target.value === '' ? null : Number($event.target.value) })" />
              s
            </label>
          </div>
        </li>
      </ul>
    </section>

    <section class="panel__sec">
      <div class="panel__row">
        <button class="panel__btn" @click="triggerFile">导入数据</button>
        <button class="panel__btn panel__btn--ghost" @click="downloadTemplate">下载模板</button>
      </div>
      <div class="panel__row">
        <button class="panel__btn panel__btn--ghost" @click="downloadCurrent">下载当前数据</button>
        <button class="panel__btn panel__btn--ghost" @click="replay">重播</button>
      </div>
      <button class="panel__btn panel__btn--primary" :disabled="exporting" @click="exportVideo">
        {{ exporting ? '录制中…' : '导出视频 (webm)' }}
      </button>
      <p class="panel__total">总时长：约 {{ totalSec.toFixed(1) }}s · {{ store.nodes.length }} 节点</p>
      <p v-if="status" class="panel__status">{{ status }}</p>
      <input ref="fileInput" type="file" accept="application/json,.json" hidden @change="onFile" />
      <input ref="pickImg" type="file" accept="image/*" multiple hidden @change="onPickImages" />
      <input ref="pickVid" type="file" accept="video/*" hidden @change="onPickVideo" />
    </section>
  </aside>
</template>

<style scoped>
.panel {
  width: 360px;
  flex: 0 0 360px;
  height: 100%;
  overflow-y: auto;
  padding: 22px 20px;
  background: rgba(8, 14, 28, 0.66);
  border-left: 1px solid rgba(138, 161, 229, 0.16);
  backdrop-filter: blur(6px);
}
.panel__title { margin: 0 0 16px; font-size: 20px; letter-spacing: 0.04em; color: #f2f4fb; }
.panel__sec { margin-bottom: 22px; }
.panel__label { display: block; font-size: 13px; color: #87a1ff; letter-spacing: 0.08em; margin-bottom: 8px; text-transform: uppercase; }
.panel__input {
  width: 100%; margin-bottom: 8px; padding: 9px 11px;
  background: rgba(3, 7, 15, 0.6); border: 1px solid rgba(138, 161, 229, 0.2);
  border-radius: 9px; color: #f2f4fb; font-size: 14px; outline: none;
}
.panel__input:focus { border-color: rgba(255, 109, 109, 0.6); }
.panel__input--sm { font-size: 13px; padding: 7px 9px; }
.panel__input--num { width: 64px; display: inline-block; margin: 0 4px; padding: 5px 7px; text-align: center; }
.panel__textarea { font-size: 12px; line-height: 1.5; resize: vertical; font-family: inherit; }
.node__label { display: block; font-size: 12px; color: rgba(217, 227, 255, 0.55); margin: 6px 0 4px; }
.node__media { display: flex; align-items: center; gap: 8px; margin: 4px 0 2px; flex-wrap: wrap; }
.node__media-info { font-size: 12px; color: #ffd45a; }
.node__vid { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }
.node__vid .panel__input--sm { flex: 1 1 auto; }
.panel__btn--xs { flex: 0 0 auto; padding: 6px 10px; font-size: 12px; border-radius: 8px; }
.panel__btn--danger { background: rgba(255, 109, 109, 0.14); border-color: rgba(255, 109, 109, 0.4); color: #ff9a86; }
.panel__row { display: flex; gap: 8px; margin-bottom: 10px; }
.panel__btn {
  flex: 1; padding: 10px 12px; border-radius: 10px; cursor: pointer;
  font-size: 14px; border: 1px solid rgba(138, 161, 229, 0.28);
  background: rgba(138, 161, 229, 0.1); color: #f2f4fb; transition: 0.15s;
}
.panel__btn:hover { background: rgba(138, 161, 229, 0.2); }
.panel__btn--ghost { background: transparent; }
.panel__btn--primary {
  width: 100%; margin-top: 4px; border: none;
  background: linear-gradient(90deg, #ff6d6d, #ffd45a); color: #1a0d0d; font-weight: 700;
}
.panel__btn--primary:disabled { opacity: 0.6; cursor: default; }
.nodes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.node { padding: 12px; border: 1px solid rgba(138, 161, 229, 0.18); border-radius: 12px; background: rgba(3, 7, 15, 0.4); }
.node__head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.node__idx {
  width: 22px; height: 22px; flex: 0 0 22px; border-radius: 50%;
  background: rgba(255, 109, 109, 0.16); color: #ff9a86; font-size: 12px;
  display: flex; align-items: center; justify-content: center;
}
.node__del { margin-left: auto; width: 26px; height: 26px; border: none; border-radius: 7px; cursor: pointer;
  background: rgba(255, 109, 109, 0.12); color: #ff9a86; font-size: 16px; line-height: 1; }
.node__del:hover { background: rgba(255, 109, 109, 0.25); }
.node__row { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; }
.node__check, .node__dur { display: inline-flex; align-items: center; font-size: 13px; color: #d9e3ff; gap: 4px; }
.panel__total { margin: 10px 0 0; font-size: 13px; color: rgba(217, 227, 255, 0.7); }
.panel__status { margin: 8px 0 0; font-size: 13px; color: #ffd45a; min-height: 18px; }
</style>
