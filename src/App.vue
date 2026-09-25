<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import StageFrame from './components/StageFrame.vue'
import TimelineCanvas from './components/TimelineCanvas.vue'
import ControlPanel from './components/ControlPanel.vue'
import { store } from './store/timelineStore.js'

const params = new URLSearchParams(location.search)
const fp = params.get('frame')
const frameRaw = fp !== null ? parseInt(fp, 10) : NaN
// 仅当参数存在且为合法非负整数时，才进入出片静态帧模式
const frame = Number.isFinite(frameRaw) && frameRaw >= 0 ? frameRaw : null
const durParam = params.get('duration')
const durRaw = durParam !== null ? parseFloat(durParam) : NaN
const fps = 25
// 出片模式：根据总时长推导总帧数；duration 非法时回退到 store.totalSec
const frames = frame !== null ? Math.round(fps * (Number.isFinite(durRaw) ? durRaw : store.totalSec)) : 300

const canvasRef = ref(null)
const stageRef = ref(null)
const isFullscreen = ref(false)

// 场景全屏：对场景容器调用浏览器 Fullscreen API。全屏后 ControlPanel 不在该容器内，
// 浏览器只渲染被全屏的元素及其后代，编辑器自然隐藏，画面只剩纯净场景。
function toggleFullscreen() {
  const el = stageRef.value
  if (!el) return
  if (document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {})
  } else {
    el.requestFullscreen?.().catch(() => {})
  }
}

function onFsChange() {
  isFullscreen.value = !!document.fullscreenElement
  // 全屏/退出会改变舞台尺寸，主动触发一次 resize，让画布按全屏尺寸重新 fit 铺满
  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')))
}

onMounted(() => {
  store.recompute()
  document.addEventListener('fullscreenchange', onFsChange)
})
onUnmounted(() => document.removeEventListener('fullscreenchange', onFsChange))
</script>

<template>
  <div class="app">
    <div class="app__stage" ref="stageRef">
      <StageFrame :meta="store.meta" :fullscreen="isFullscreen" @toggle-fullscreen="toggleFullscreen">
        <TimelineCanvas ref="canvasRef" :nodes="store.nodes" :frame="frame" :fps="fps" :frames="frames" />
      </StageFrame>
    </div>
    <!-- 出片（?frame）模式不显示编辑器 -->
    <ControlPanel v-if="frame === null" :canvas-ref="canvasRef" />
  </div>
</template>

<style scoped>
.app { display: flex; height: 100%; width: 100%; }
.app__stage { flex: 1 1 auto; min-width: 0; height: 100%; display: flex; }
.app__stage :deep(.stage) { width: 100%; height: 100%; }
</style>
