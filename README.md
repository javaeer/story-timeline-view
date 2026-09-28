<h1 align="center">story-timeline-view · 故事时间轴视图</h1>

<p align="center">
  数据驱动的故事时间轴动画可视化与视频导出工具 · Vue 3 + Canvas 2D
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License" />
  <img src="https://img.shields.io/badge/vue-3.5-42b883.svg" alt="Vue" />
  <img src="https://img.shields.io/badge/vite-5.4-646cff.svg" alt="Vite" />
  <img src="https://img.shields.io/badge/node-%3E%3D18-339933.svg" alt="Node" />
  <img src="https://img.shields.io/github/stars/javaeer/story-timeline-view" alt="Stars" />
</p>

---

## ✨ 功能

- **发光曲线时间轴**：节奏化节点揭示，展开式信息卡，关键节点金色环标记。
- **沉浸式背景**：全屏背景图/视频，交叉淡入 + Ken Burns 缩放。
- **字幕系统**：每节点独立字幕 + 全局 `.srt` 导入；本地字体名支持。
- **可视化编辑**：左侧编辑面板增删节点、调节节奏、标记关键节点、导入/导出 JSON。
- **视频导出**：
  - 浏览器内 WebM 录制（固定 1920×1080）；
  - 脚本化 MP4 导出（Puppeteer + ffmpeg），或浏览器端 ffmpeg.wasm 转码。
- **工程细节**：高清屏（devicePixelRatio）适配、全屏模式、点击跳转、暂停/播放、滑动视口、多比例支持。

## 🧱 技术栈

| 层 | 选型 |
| -- | ---- |
| 框架 | Vue 3（`<script setup>` + Composition API） |
| 构建 | Vite 5 |
| 渲染 | Canvas 2D（自研时间轴引擎） |
| 视频 | `@ffmpeg/wasm`（浏览器端 MP4 转码）、MediaRecorder（WebM）、Puppeteer + ffmpeg（脚本出片） |

## 🚀 快速开始

> 推荐包管理器：**pnpm**（仓库已带 `pnpm-lock.yaml`）。

```bash
# 1. 安装依赖
pnpm install

# 2. 本地开发（predev 首次会自动把 ffmpeg 核心拷贝到 public/ffmpeg/）
pnpm dev

# 3. 构建产物到 dist/
pnpm build

# 4. 本地预览构建产物
pnpm preview
```

打开 `http://127.0.0.1:5173` 即可使用。

## 🎬 脚本出片（MP4）

脚本出片适合批量/自动化，依赖本机 `ffmpeg` 与 `puppeteer`：

```bash
# 用 store.totalSec 作为时长
pnpm render

# 指定时长（秒）
pnpm render 12

# 或（Unix 便捷入口，自动先 build）
./render_vue.sh 15
```

原理：Puppeteer 以固定 1920×1080、逐帧打开 `?frame=N` 截图，再用本机 ffmpeg 合成标准 H.264(mp4)。

## 📋 数据格式

时间轴数据来自 **`src/data/timeline.js`**（单一事实源，换内容只改这里）：

```js
export const timeline = {
  meta: {
    kicker: '会师镇 · 红色时间轴',
    title: '红军三大主力 · 会宁会师',
    subtitle: '从战略决策到会师纪念塔——一条时间轴读懂会宁会师镇',
    badge: 'Vue 3 · Canvas 2D',
  },
  nodes: [
    { year: '1936.10.10', title: '胜利会师', desc: '文庙大成殿召开联欢会', key: true,  images: [] },
    // year: 显示用时间标签；key: 是否关键节点；images: 可选背景图（URL/本地路径/data URI）
  ],
}
```

节奏时长由 `src/composables/useTimeline.js` 计算（无 `duration` 时默认每节点 10s）。

## 🗂 目录结构

```
story-timeline-view/
├── index.html
├── vite.config.js
├── public/
│   └── ffmpeg/            # ffmpeg-core（构建时由 scripts/setup-ffmpeg.mjs 拷贝，不入库）
├── scripts/
│   ├── setup-ffmpeg.mjs   # 从 node_modules 拷贝 ffmpeg-core 到 public/ffmpeg
│   ├── render.mjs         # 跨平台出片脚本（Puppeteer + ffmpeg）
│   ├── imgProxy.mjs       # 同源图片代理（避免 Canvas 跨域污染）
│   └── shot-*/verify-*/   # 开发调试/回归验证脚本（非发布产物）
├── src/
│   ├── App.vue
│   ├── main.js
│   ├── ffmpegExport.js    # 浏览器端 WebM→MP4 转码（支持 CDN 核心）
│   ├── components/        # ControlPanel / StageFrame / TimelineCanvas
│   ├── composables/       # useTimeline
│   ├── store/             # timelineStore
│   ├── data/timeline.js   # 数据单一事实源
│   └── styles/theme.css
├── netlify.toml / vercel.json / wrangler.toml   # 部署配置
└── infinityfree/          # InfinityFree 部署说明与 .htaccess
```

## 🌐 部署

本项目是纯静态产物（`dist/`），可免费部署到
**Cloudflare Pages / Netlify / Vercel / InfinityFree** 等平台。

> ⚠️ 注意：浏览器端「导出 MP4」依赖 `ffmpeg-core.wasm`（约 32MB）。
> Cloudflare Pages 单文件上限 25MB、InfinityFree 上限 10MB，**无法直接托管该文件**。
> 解决方案：部署时通过 `VITE_FFMPEG_CORE_BASE` 改用 CDN 加载核心（详见 [DEPLOY.md](./DEPLOY.md)）。
> WebM 录制不受影响，始终可用。

各平台详细步骤见 👉 **[DEPLOY.md](./DEPLOY.md)**

## 🤝 贡献

欢迎 Issue 与 PR！请先阅读 [CONTRIBUTING.md](./CONTRIBUTING.md) 与
[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)。

## 📄 License

[MIT](./LICENSE) © 2026 javaeer
