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
| 节点背景图"无法切换"/不显示 | 两层根因：(1) 原加载器设了 `img.crossOrigin = 'anonymous'`，**无 CORS 头的跨域图**一律加载失败→背景永远是深底；(2) 直接删 `crossOrigin` 虽能让图显示，但跨域图会**污染 Canvas**，`captureStream()` 在导出时抛 `SecurityError`→录出来的视频没有背景。彻底修复：① 保留"不读像素"的展示语义、去掉 `crossOrigin`；② 新增**同源图片代理**——dev 服务器（`vite.config.js`）与导出服务器（`scripts/render.mjs`）都实现 `/__img?u=<远程URL>`，组件把远程图统一走代理、由本机服务端代取后**同源**返回，Canvas 不再被污染，预览与导出（captureStream 录制）都能正常切换背景；代理失败再回退直连（保预览可见）。同时把图片 URL 纳入 `watch` 依赖，纯换图也能触发重新预加载 |
| 最后一个节点卡片停留极短 | `xAtTravel()` 末段 `nodeXArr[n]` 越界得 NaN → `cur=-1` 使末卡不显示，仅靠 2.5s 补丁撑场；改为 `i>=n-1` 时返回末节点并删除补丁 |
| 播放一遍后自动重播 | `loop` 模式原用取模循环；改为 `p>=1` 即停帧，停在尾帧 |
| 图片在卡片内轮播 | 改为整幅背景：取 `images[0]` 铺满全屏，叠 0.72 暗化遮罩，随节点切换交叉淡入 |
| 背景遮罩压死照片 / 图片集只取第一张 | ① 遮罩从「整帧平铺 0.72」改为**只压暗曲线·标签·卡片所在的"信息带"中段的渐变遮罩**（上下留白让照片透出，电影感更强）；② 背景支持**图片集轮播**——每节点 `images[]` 多张时，按节点内停留进度(`intra`)在图集内缓慢交叉淡入轮播（每张停留末段才与下一张互溶，像资料片混剪而非幻灯片快闪），并叠加轻微 Ken Burns 推镜；单张时整体缓慢推近。节点交界仍由上一节点首图交叉淡入 |
| 卡片"先满透显示、再重新淡入" | 根因：当前节点 `cur` 用几何量 `revealX + 0.5` 判定会**领先**于时间维度的 `loc.node`，而卡片/背景透明度用的是 `loc.intra`（`loc.node` 的节点内进度）。在节点交界处 `cur` 已跳到新节点、但 `loc.intra` 仍是旧节点的 ~1，于是新卡片被按"满进度"先画成满透，下一帧 `intra` 回退才重新淡入——视觉上即"先显示又进入淡入动画"。节点越多/单节点越长，错位窗口越大（7 个 10s 节点可达约 0.76s）。修复：当前节点统一取 `loc.node`，与 `loc.intra` 同源，两处彻底一致，卡片与背景都从 `intra≈0` 正常淡入 |
| 背景只有图片、缺动态感 | 每个节点新增 **`video` 字段**：有视频时优先作整幅背景，无视频则回退 `images` 图片集/纯色。进入节点 `seek(0)+play`、离开 `pause`（`muted`/`loop`/`playsInline`，避免自动播放被拦）；`drawImage(video)` 逐帧取当前帧，复用现成的交叉淡入 + Ken Burns 推镜逻辑。背景视频与叙事同拍，比"整体一个背景视频"贴合得多 |
| 需要本地图片/视频素材 | `ControlPanel` 每个节点新增**本地文件选择器**：「选图片」（可多选，data URI 存入 `images`）+「选视频」（data URI 存入 `video`），同源、可序列化、不污染画布。`video` 字段优先于 `images` 作背景，`images` 降级为"视频未就绪时的封面/兜底"。保留 URL 文本框兼容远程图源 |
| 远程视频导出时 Canvas 被污染 | 同源代理 `scripts/imgProxy.mjs` 升级支持 **`Range` 请求（206 Partial Content，含 `Accept-Ranges`/`Content-Range`）**：整文件缓存后按 `Range` 切片返回，使远程视频可 `seek`/缓冲，走代理后同源、导出录制不再污染。本地 `public/` 或 `dist/` 内视频本就同源，无需代理 |
| 选图片/选视频按钮"点击无反应" | 原用 `ref([])` 数组 + v-for 函数式 ref `imgInputs[i]=el` 存储隐藏 file input；但模板中 `imgInputs[i]` 会被自动解包为 `.value[i]`（恒为空数组）→ 按钮 `imgInputs[i]?.click()` 取到 `undefined`、不触发文件选择对话框。改为**单个隐藏 input（pickImg/pickVid）+ `pickIdx` 记录当前节点**，点击按钮时 `pickImg.value?.click()`（单元素 ref，与"导入数据"按钮同款可靠写法）；`@change` 按 `pickIdx` 把 data URI 写入对应节点的 `images`/`video` |
| 选视频直接崩溃（白屏） | 根因：本地视频经 `FileReader.readAsDataURL` 编码成与文件等大的 base64 字符串，存入响应式 `store.nodes[i].video` 后，又被 `<input :value="nd.video">` 绑回 DOM，渲染进程内存被撑爆→整页白屏崩溃（几十 MB 的视频即可触发）。修复：`onPickVideo` 改用 `URL.createObjectURL(file)` 生成 `blob:` URL——同源、可 `drawImage` 不污染 Canvas、支持播放与 `seek`、内存占用忽略不计；替换/清除时用 `URL.revokeObjectURL` 回收旧 URL 防泄漏。代价：`blob:` URL 仅当前会话有效，导出 JSON 保存的是该短串，重新导入需再次选择本地视频 |
| 选视频后视频不显示 / 无法播放 | 根因：`drawCover(img,…)` 用 `img.naturalWidth / img.naturalHeight` 求宽高比，但 `<video>` 元素**没有** `naturalWidth`（为 `undefined`）→ 比例 = `undefined/undefined` = `NaN`，后续尺寸全为 `NaN`，`ctx.drawImage(img, NaN, …)` 在 `requestAnimationFrame` 回调里抛 `TypeError`、绘制循环当场崩溃，视频背景永不出现（之前 1.2s 内选视频"看似能播"，是因为那时视频元数据未加载、`videoWidth===0` 被 `paintVid` 提前 return 没走到 `drawCover`，漏掉了这个崩溃）。修复：`drawCover` 同时兼容图片与视频——`const iw = img.naturalWidth \|\| img.videoWidth; const ih = img.naturalHeight \|\| img.videoHeight`，视频走 `videoWidth/videoHeight`；并加 `!iw \|\| !ih` 兜底。另：预览"播放一遍后停尾帧"，若在动画结束后才选视频，循环已停、不会重绘；`onPickVideo` 选择后主动 `replay()` 一遍，确保选中的视频立即可见（正常预览仍不自动重播） |

> 说明：依赖 `package-lock.json` 已随包提供；若缺失可在联网环境执行 `npm install` 重新生成。

## 📄 License

[MIT](./LICENSE) © 2026 javaeer
