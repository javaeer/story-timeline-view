<script setup>
import { ref, onMounted } from 'vue'
import StageFrame from './components/StageFrame.vue'
import TimelineCanvas from './components/TimelineCanvas.vue'
import ControlPanel from './components/ControlPanel.vue'
import { store } from './store/timelineStore.js'

const params = new URLSearchParams(location.search)
const fp = params.get('frame')
const frame = fp !== null ? Math.max(0, parseInt(fp, 10)) : null // 非空 => 出片静态帧模式
const durParam = params.get('duration')
const fps = 25
// 出片模式：根据总时长推导总帧数，渲染脚本会传 ?duration
const frames = frame !== null ? Math.round(fps * (durParam ? parseFloat(durParam) : store.totalSec)) : 300

const canvasRef = ref(null)

onMounted(() => store.recompute())
</script>

<template>
  <div class="app">
    <div class="app__stage">
      <StageFrame :meta="store.meta">
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
