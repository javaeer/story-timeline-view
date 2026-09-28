# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/) 约定，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.0.0] - 2026-09-28

### 新增
- 数据驱动的故事时间轴动画可视化（Vue 3 + Canvas 2D）。
- 发光曲线时间轴、节奏化节点揭示、展开式信息卡。
- 全屏背景图/视频交叉淡入 + Ken Burns 缩放。
- 每节点独立字幕 + 全局 `.srt` 导入；本地字体名支持。
- 左侧编辑面板：增删节点、调节节奏、标记关键节点、导入/导出 JSON。
- 浏览器内 WebM 录制（固定 1920×1080）与脚本化 MP4 导出（Puppeteer + ffmpeg）。
- 高清屏适配、全屏模式、点击跳转、暂停/播放、滑动视口、多比例支持。

### 修复（对比上游 INIT 提交）
- NaN 校验、高清屏（devicePixelRatio）、resize 重绘。
- 录制分辨率锁定、滑动视口、比例切换。
- SRT 字幕解析、离线 ffmpeg.wasm 本地化加载。

---

## 规范化与部署准备（本次整理）

- 补充开源规范文件：`README` / `CONTRIBUTING` / `CODE_OF_CONDUCT` / `SECURITY` / `CHANGELOG` / `.nvmrc` / `.env.example`。
- 优化 `.gitignore`：将 32MB 的 `public/ffmpeg/*` 移出版本库，改为构建时从 `node_modules` 拷贝。
- 新增 `scripts/setup-ffmpeg.mjs` 与 `predev`/`prebuild` 钩子，本地离线导出 MP4 开箱即用。
- `src/ffmpegExport.js` 支持通过 `VITE_FFMPEG_CORE_BASE` 切换为 CDN 加载，适配单文件体积受限的托管平台。
- 新增部署配置：`netlify.toml` / `vercel.json` / `wrangler.toml` / `public/_redirects` / `infinityfree/.htaccess`。
- 新增 GitHub Actions：`ci.yml`（构建校验）与 `deploy-cloudflare.yml`（可选自动部署）。
