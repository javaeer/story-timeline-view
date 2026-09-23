<script setup>
defineProps({ meta: Object })
</script>

<template>
  <div class="stage">
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
