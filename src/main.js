import { createApp } from 'vue'
import App from './App.vue'
import './styles/theme.css'

const app = createApp(App)

// 全局错误边界：捕获渲染/生命周期钩子中的未处理异常，避免整页白屏
app.config.errorHandler = (err, instance, info) => {
  console.error('[story-timeline-view] 渲染错误:', err, info)
}

app.mount('#app')
