<script setup>
defineProps({ meta: Object, fullscreen: Boolean })
defineEmits(['toggle-fullscreen'])
</script>

<template>
  <div class="stage">
    <!-- 场景全屏按钮：悬浮于右上角，全屏态下可点按退出（ESC 亦可） -->
    <button
      class="fs-btn"
      type="button"
      :title="fullscreen ? '退出全屏 (Esc)' : '进入全屏预览'"
      @click="$emit('toggle-fullscreen')"
    >
      <span class="fs-btn__icon">{{ fullscreen ? '✕' : '⛶' }}</span>
      <span class="fs-btn__label">{{ fullscreen ? '退出全屏' : '全屏' }}</span>
    </button>

    <header class="stage-header">
      <div>
        <span class="kicker">{{ meta.kicker }}</span>
        <h1>{{ meta.title }}</h1>
        <p>{{ meta.subtitle }}</p>
      </div>
      <div class="badge">{{ meta.badge }}</div>
    </header>

    <section class="stage-card">
      <slot />
      <div class="legend">
        <span><span class="legend__dot legend__dot--key"></span>关键章节</span>
        <span><span class="legend__dot legend__dot--node"></span>时间节点</span>
      </div>
    </section>
  </div>
</template>

<style scoped>
.fs-btn {
  position: absolute;
  top: 22px;
  right: 26px;
  z-index: 30;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 9px 15px;
  border-radius: 11px;
  border: 1px solid rgba(138, 161, 229, 0.32);
  background: rgba(8, 14, 28, 0.62);
  color: #f2f4fb;
  font-size: 15px;
  letter-spacing: 0.04em;
  cursor: pointer;
  backdrop-filter: blur(6px);
  transition: background 0.15s, border-color 0.15s;
}
.fs-btn:hover {
  background: rgba(138, 161, 229, 0.22);
  border-color: rgba(138, 161, 229, 0.55);
}
.fs-btn__icon {
  font-size: 17px;
  line-height: 1;
}
</style>
