# 架构（Architecture）

`story-timeline-view` 是一个纯前端、数据驱动的静态应用（构建产物为 `dist/`），
核心是一条**时间轴渲染 + 视频导出**链路。

## 渲染层

- **Vue 3** 负责 UI 外壳与可视化编辑面板（`ControlPanel` / `StageFrame` / `TimelineCanvas`）。
- **Canvas 2D 自研时间轴引擎**（`TimelineCanvas.vue` + `composables/useTimeline.js` +
  `store/timelineStore.js`）负责节点排布、节奏计算、发光曲线与 Ken Burns 背景。
- 数据为单一事实源 `src/data/timeline.js`，通过 store 驱动视图。

## 三条出片链路

| 链路 | 入口 | 原理 | 依赖 |
| ---- | ---- | ---- | ---- |
| ① 浏览器 WebM 录制 | 应用内「录制」 | `canvas.captureStream()` + `MediaRecorder` | 浏览器原生 |
| ② 浏览器 MP4 转码 | 应用内「导出 MP4」 | `ffmpeg.wasm` 将 WebM 转 H.264(mp4) | `@ffmpeg/*`，需 `ffmpeg-core.wasm` |
| ③ 脚本化 MP4 | `pnpm render` | Puppeteer 逐帧截图 + 本机 `ffmpeg` 合成 | `puppeteer`、系统 `ffmpeg` |

- 链路 ② 的 `ffmpeg-core.wasm`（约 32MB）默认放 `public/ffmpeg/`（构建时由
  `scripts/setup-ffmpeg.mjs` 从 `node_modules` 拷贝）；当托管平台单文件上限较低时，
  改由 `VITE_FFMPEG_CORE_BASE` 指向 CDN（见 `.env.example` / `DEPLOY.md`）。
- 链路 ③ 适合批量/自动化出片，依赖本机 `ffmpeg` 二进制与 `puppeteer`。

## 构建与部署

- 构建：Vite 5（`vite build`），`prebuild` 钩子自动准备 ffmpeg 核心。
- 部署：纯静态产物，支持 Cloudflare Pages / Netlify / Vercel / InfinityFree，
  配置见仓库根 `netlify.toml` / `vercel.json` / `wrangler.toml` / `infinityfree/`。
- `scripts/imgProxy.mjs`：同源图片代理，避免远程图片导致的 Canvas 跨域污染。

## 目录速览

```
src/
├── App.vue / main.js
├── ffmpegExport.js        # ② ffmpeg.wasm 转码
├── components/            # ControlPanel / StageFrame / TimelineCanvas
├── composables/useTimeline.js
├── store/timelineStore.js
└── data/timeline.js       # 数据单一事实源
scripts/
├── setup-ffmpeg.mjs       # 拷贝 ffmpeg 核心到 public/ffmpeg
├── render.mjs             # ③ 脚本出片
├── imgProxy.mjs           # 同源图片代理
└── shot-*/verify-*/test-* # 开发者调试 / 回归验证（非发布产物）
```
