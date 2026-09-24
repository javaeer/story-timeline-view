# story-timeline-view · 故事时间轴视图

数据驱动的「故事时间轴」动画可视化 + 视频出片工具。输入一组时间节点（年份 / 标题 / 描述 / 可选图片），自动渲染一条发光曲线时间轴，节点按节奏依次揭示、弹出信息卡片，并支持**浏览器内录制 webm** 或**脚本无头渲染成 mp4**。

> 默认数据即「会师镇 · 红军三大主力会宁会师」时间轴。`src/data/timeline.js` 是单一事实源，**换乡镇只改这一份 JSON**。

## ✨ 功能

- 发光曲线时间轴、节点按节奏揭示、当前节点展开卡片
- 节点图片作为**整幅背景**展示，随节点切换交叉淡入（非卡片内轮播）
- 播放一遍后停在尾帧，**不自动重播**
- 左侧编辑器：增删节点、调时长、标关键节点、导入/导出 JSON
- 浏览器内一键录制导出 `webm`（MediaRecorder，固定 1920×1080 标准 16:9）
- 脚本出片：无头 Chromium 逐帧截图（1920×1080）→ ffmpeg 合成 `mp4`（编码器自动回退）
- 高 DPI 清晰适配、窗口缩放重绘、卸载自动清理、全局错误兜底

## 🗂 目录结构

```
story-timeline-view/
├── index.html              # 入口 HTML（引入 Sora / Noto Sans SC 字体）
├── package.json
├── vite.config.js
├── render_vue.sh           # 出片便捷入口（Unix），核心逻辑见 scripts/render.mjs
├── scripts/
│   └── render.mjs          # 跨平台出片核心：Puppeteer 截帧 + ffmpeg 合成 mp4
├── LICENSE                 # MIT
└── src/
    ├── main.js             # 挂载 App + 全局 errorHandler
    ├── App.vue             # 解析 ?frame / ?duration 出片参数，布局 stage + 面板
    ├── components/
    │   ├── StageFrame.vue     # 页头 + 画布卡片 + 图例
    │   ├── TimelineCanvas.vue  # Canvas 2D 绘制 + 动画 + 录制 + DPR/resize
    │   └── ControlPanel.vue    # 编辑器：增删改、导入导出、导出视频
    ├── composables/
    │   └── useTimeline.js      # 纯函数节奏调度：buildSchedule / locate / xAtTravel
    ├── store/
    │   └── timelineStore.js    # 响应式数据中枢（store + 增删改导入导出）
    ├── data/
    │   └── timeline.js         # 单一事实源：默认时间轴数据
    └── styles/
        └── theme.css           # 主题 token + .stage 布局
```

## 🚀 快速开始

```bash
npm install
npm run dev        # 开发预览 http://127.0.0.1:5173
npm run build      # 生产构建
npm run preview    # 预览构建产物 http://127.0.0.1:4173
npm run render     # 一键出片：构建 → 截帧 → 合成 mp4
```

浏览器内导出视频：打开预览页 → 右侧「导出视频 (webm)」→ 等待动画播放一遍即下载。

## 🎬 脚本出片（MP4）

依赖：`node`、`ffmpeg`，以及 `npm i -D puppeteer`（首次需联网下载 Chromium）。

```bash
npm install
npm run build                 # 若尚未构建
npm run render                # 或 ./render_vue.sh（Unix）；Windows 直接 node scripts/render.mjs
# 默认时长取自 store.totalSec；也可显式指定：npm run render -- 12
```

输出 `out/timeline-<时长>s.mp4`（1920×1080，可直接上传平台）。
出片原理：`vite build` → 脚本内置轻量 HTTP 服务加载 dist → Puppeteer 以 `deviceScaleFactor=1` 固定 1920×1080 逐帧打开 `?frame=N&duration=总秒` 截图 → `ffmpeg` 合成视频。

> 注意：必须用 HTTP 而非 `file://`。浏览器在 `file://` 下禁止执行 ES module，Vue 不会挂载，截出来每一帧都是空白背景。

容错：① 首帧自检，确认 Canvas 确实绘制了内容，否则中止导出（防止“看似成功、实为空白”）；② 编码器按 `libx264 → libopenh264 → mpeg4 → libvpx-vp9` 自动回退；③ 离线环境自动阻断 Google Fonts 请求，避免每帧卡在字体加载超时。

## 📋 数据格式

`src/data/timeline.js` 的 `timeline` 对象即数据：

```js
export const timeline = {
  meta: { kicker: '乡镇名 · 主题', title: '标题', subtitle: '副标题', badge: 'Vue 3 · Canvas 2D' },
  nodes: [
    { year: '1936.10', title: '节点标题', desc: '节点描述', key: true,  duration: 10, images: [] },
    // year: 年份字符串（可为 '1936.10.02' / '1986' / '今天'）
    // key: 是否关键节点（金色环）
    // duration: 单节点停留秒数，留空/null 时按 10s + 字数×0.05s 自动计算
    // images: 可选图片 URL 数组，取第一张作为该节点的整幅背景图（随节点切换）
  ],
}
```

也可在编辑器点「下载模板」获取空白 JSON，填空后「导入数据」。

## 🔧 本次修复（对比上游 INIT 提交）

在原始单 commit 基础上应用了以下修复：

| 问题 | 修复 |
|------|------|
| 无 LICENSE | 新增 `MIT LICENSE` |
| 无 README | 新增本说明 |
| 无 .gitignore | 新增（忽略 node_modules / dist / frames / out） |
| URL 参数 NaN 未校验 (#1) | `App.vue` 用 `Number.isFinite` 校验 `frame`/`duration`，非法值安全回退 |
| 无全局错误边界 (#4) | `main.js` 增加 `app.config.errorHandler` |
| 未适配高 DPI (#11) | `TimelineCanvas` 按 `devicePixelRatio` 缩放位图 + 坐标系 |
| RAF 卸载未取消 (#13) | `onUnmounted` 取消 `requestAnimationFrame` 并停止录制 |
| 窗口 resize 未重算 (#15) | 监听 `resize` 重算画布尺寸并重绘 |
| 动画依赖刷新率、录制快进失真 | `loop()` 改用真实时间戳（`performance.now`）驱动，不同设备/录制节奏一致、不再快进 |
| 导入新 JSON 画布不替换 | `watch` 节点变化时强制刷新：loop 重绘 / once 回放最新 / static 补画，始终显示最新结果 |
| canvas CSS 尺寸被写死致拉伸/模糊 | `fit()` 不再写死 `style.width/height`，由父容器 100% 撑满，位图 = 容器×DPR |
| webm 导出分辨率随窗口/DPR 漂移致失真 | 录制时把画布位图锁定为 1920×1080（标准 16:9），录制结束恢复预览尺寸 |
| ffmpeg 硬编码 libx264，缺编码器即失败 | 编码器自动回退：libx264 → libopenh264 → mpeg4 → libvpx-vp9 |
| 离线环境出片每帧卡在字体请求超时 | Puppeteer 拦截 Google Fonts 请求，走内置系统字体回退 |
| 下方节点标题与年份完全重叠 | 根因一：`below` 分支把两者都画在 `ly`（纵向零间距）→ 改为显式错开 `GAP=26` |
| 标签被当前节点卡片压住（如"纪念碑落成"叠在"会师精神"上） | 根因二（关键）：`layoutLabels()` 的标签包围盒用的是**相对节点圆心的偏移**，却去和**绝对坐标的卡片矩形**做碰撞检测 → 两者永远不相交、避让恒不触发。修正为两者统一用绝对坐标（`boxOf(x, y, …)` 带入 `pts[i].y`），并按「标题+间隙+年份」的**真实两行高度**建盒、逐级下沉寻找无碰撞槽位 |
| 导出/缩放后线条“变粗” | 引入固定设计坐标系 1864×824，绘制与分辨率解耦，统一等比缩放并居中 |
| 出片用 file:// 截到空白页 | 改用内置 HTTP 静态服务加载 dist，并增加首帧绘制自检 |
| 出片脚本仅 Unix 且每帧启进程 (#22) | 新增跨平台 `scripts/render.mjs`（Puppeteer 单实例截帧）+ `render_vue.sh` 入口 |

> 说明：依赖 `package-lock.json` 已随包提供；若缺失可在联网环境执行 `npm install` 重新生成。

## 📄 License

[MIT](./LICENSE) © 2026 javaeer
