# 规范化与部署准备 · 分析报告

> 分析对象：`https://github.com/javaeer/story-timeline-view`（master 分支）
> 仓库语言：Vue · 大小：约 10 MB（含 32MB 的 `ffmpeg-core.wasm`，见下文）
> 生成日期：2026-09-28

---

## 一、项目概况

`story-timeline-view` 是一个**数据驱动的故事时间轴动画可视化 + 视频导出工具**：

- 前端框架 **Vue 3**（`<script setup>` + Composition API），构建工具 **Vite 5**，渲染自研 **Canvas 2D** 时间轴引擎。
- 功能：发光曲线时间轴、节奏化节点揭示、全屏背景图/视频交叉淡入、每节点字幕 + 全局 `.srt`、可视化编辑面板、JSON 导入导出。
- 视频导出三条路径：① 浏览器内 WebM 录制（MediaRecorder）；② 浏览器端 ffmpeg.wasm 把 WebM 转 MP4；③ 命令行 Puppeteer + 本机 ffmpeg 批量出片。
- 数据单一事实源在 `src/data/timeline.js`（示例为「会宁会师镇」红色时间轴）。

项目本身**功能完整、代码可读、已有 MIT LICENSE 与较详尽的 README**，并非"不规范"到不可用。
本次工作的重点是补齐**开源工程规范**与**免费平台部署能力**。

---

## 二、当前状态评估（问题清单）

| # | 问题 | 严重度 | 说明 |
| - | ---- | ------ | ---- |
| 1 | 32MB 的 `public/ffmpeg/ffmpeg-core.wasm` 入库 | 🔴 高 | 仓库臃肿；且 Cloudflare Pages(≤25MB)/InfinityFree(≤10MB) 单文件超限，**直接部署失败** |
| 2 | 同时提交 `package-lock.json` 与 `pnpm-lock.yaml` | 🟡 中 | 两套锁文件并存，包管理器语义混乱 |
| 3 | `package.json` 缺元数据 | 🟡 中 | 无 `repository`/`author`/`license`/`keywords`/`engines`/`homepage`/`bugs` |
| 4 | `scripts/` 混入大量调试脚本 | 🟡 中 | `shot-*`/`verify-*`/`test-*` 约 20+ 个开发/回归脚本与核心逻辑混放，干扰阅读 |
| 5 | 缺开源治理文件 | 🟡 中 | 无 `CONTRIBUTING`/`CODE_OF_CONDUCT`/`SECURITY`/`CHANGELOG`/Issue/PR 模板 |
| 6 | 缺部署配置 | 🟡 中 | 无 Cloudflare/Netlify/Vercel/InfinityFree 任一部署配置或文档 |
| 7 | 无 CI | 🟢 低 | 没有自动构建校验，PR 易引入构建破坏 |
| 8 | 缺 `.nvmrc` / `.env.example` | 🟢 低 | 协作环境不一致；环境变量无样例 |

---

## 三、本次已生成的文件（可直接落地）

以下文件已生成在 `story-timeline-view/`，覆盖"规范化 + 部署"两部分：

### 开源规范
- `README.md`（重写：徽章、功能、技术栈、快速开始、数据格式、目录结构、部署入口、贡献）
- `CONTRIBUTING.md` · `CODE_OF_CONDUCT.md` · `SECURITY.md` · `CHANGELOG.md`
- `.nvmrc`（锁定 Node 20）· `.env.example`（说明 `VITE_FFMPEG_CORE_BASE`）
- `.gitignore`（**新增忽略 `public/ffmpeg/`**，避免 32MB wasm 入库）
- `.github/workflows/ci.yml`（pnpm 安装 + 构建校验 + 上传 dist 产物）
- `.github/workflows/deploy-cloudflare.yml`（可选自动部署到 Cloudflare Pages）
- `.github/ISSUE_TEMPLATE/bug_report.yml` · `feature_request.yml` · `.github/PULL_REQUEST_TEMPLATE.md`

### 部署配置
- `netlify.toml` · `vercel.json` · `wrangler.toml`（含 CDN 核心注释）
- `public/_redirects` · `public/_headers`（缓存策略）
- `infinityfree/.htaccess` · `infinityfree/README.md`（FTP 上传 + 回退规则）
- `DEPLOY.md`（四平台逐步部署指南 + wasm 说明 + FAQ）

### 代码修复（解决部署阻塞）
- `scripts/setup-ffmpeg.mjs`（**新增**）：从 `node_modules/@ffmpeg/core` 拷贝核心到 `public/ffmpeg/`；设置 CDN 变量时自动跳过。
- `package.json`（增强）：补元数据、`engines`、`packageManager`；新增 `setup:ffmpeg` 脚本与 `predev`/`prebuild` 钩子。
- `src/ffmpegExport.js`（修补）：`CORE_BASE` 支持通过 `VITE_FFMPEG_CORE_BASE` 切换为 CDN 加载。
- `vite.config.js`（增强）：`manualChunks` 拆分 `vue`，降低单 JS 体积（应对 InfinityFree 1MB 限制）。

---

## 四、需要你在仓库中手动执行的步骤

本环境无法直连 GitHub 推送，请在**你的本地仓库**按以下顺序合并：

```bash
# 0. 进入你的仓库
cd story-timeline-view

# 1. 用本次生成的文件覆盖/新增（把 story-timeline-view/ 下对应文件拷进来）
#    README.md / CONTRIBUTING.md / CODE_OF_CONDUCT.md / SECURITY.md / CHANGELOG.md
#    .nvmrc / .env.example / .gitignore
#    package.json / vite.config.js / src/ffmpegExport.js / scripts/setup-ffmpeg.mjs
#    netlify.toml / vercel.json / wrangler.toml
#    public/_redirects / public/_headers / infinityfree/*
#    .github/** / DEPLOY.md

# 2. 统一包管理器：删除 npm 锁文件，保留 pnpm
rm -f package-lock.json

# 3. 把调试脚本从发布路径隔离（可选但推荐）
mkdir -p scripts/dev
git mv scripts/shot-*.mjs scripts/verify-*.mjs scripts/test-*.mjs scripts/debug-load.mjs scripts/probe.mjs scripts/dev/ 2>/dev/null

# 4. 从版本库移除已 gitignore 的 wasm（本地保留，仅不再跟踪）
git rm --cached -r public/ffmpeg/ 2>/dev/null || true

# 5. 重新生成锁文件并提交
pnpm install
git add -A && git commit -m "chore: 开源规范化与免费平台部署准备"
git push
```

---

## 五、部署建议（结论）

| 平台 | 推荐度 | 关键点 |
| ---- | ------ | ------ |
| **Cloudflare Pages** | ⭐⭐⭐ 首选 | Git 连接 + 构建命令即可；设 `VITE_FFMPEG_CORE_BASE` 走 CDN 绕过 25MB 限制；无限带宽 |
| **Netlify** | ⭐⭐⭐ | 读 `netlify.toml`；同样设 CDN 变量；支持 Drop 拖拽部署 |
| **Vercel** | ⭐⭐ | 自动识别 Vite；读 `vercel.json`；免费额度限个人/非商业 |
| **InfinityFree** | ⭐⭐ | 传统 FTP 主机；必须 CDN 方案 + 单 JS<1MB；适合"完全免费永久"诉求 |

**一句话结论**：用 Cloudflare Pages（或 Netlify），构建命令 `pnpm install && pnpm build`、输出 `dist`、并配置 `VITE_FFMPEG_CORE_BASE` 指向 jsDelivr 上的 `@ffmpeg/core`；WebM 录制开箱即用，MP4 导出经 CDN 核心按需加载。

---

## 六、后续可优化（非必须）

- 把 `scripts/dev/` 下的调试脚本进一步归档或加 `*.test` 命名约定。
- 为 `lint`/`format` 加入 Prettier + ESLint 与对应 CI 步骤。
- 增加轻量 E2E（如 Playwright）验证核心渲染，替代手写 `verify-*` 脚本。
- 考虑用 TypeScript 提升可维护性（目前为纯 JS）。
