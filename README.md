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
| 节点很多（如 28 个）时时间轴很乱 | **根本性重构：滑动视窗（镜头跟随）**。放弃"把全部节点硬塞进一屏"——改为**任意时刻只显示当前节点附近的 7 个节点**，屏幕始终保有原版（7 节点）同款的宽松间距（≈230px）与留白，镜头随叙事沿曲线平移；对叙事视频而言本就是"镜头跟着走"，永远不同时看全 28 个。节点 ≤11 时退回原版全宽布局（镜头锁死），小时间轴观感零变化。实现：`draw` 引入平滑相机 `cam = loc.node + loc.intra`，节点屏幕坐标 `sx(np) = X0 + (np - (cam - half)) * step`（`half` 与 `step` 由 `WINDOW`/窗口宽度决定），曲线、圆点、标签、卡片**全部走该屏幕坐标**，超界部分被画布自然裁掉；已揭示的发光路径仍从起点画到播放头 |
| 备注（描述）一多就更难看、文字不换行 | 根因：卡片里的标题与描述都用**单次 `fillText` 直出**、无折行逻辑，且卡片高度写死（150/180）→ 长备注直接溢出卡片或被裁切，备注越多越难看。修复：① 新增 `wrapText(text, font, maxW)` **中英文混排自动折行**（CJK 按字断、Latin 连续词按词断、超长词再按字符断，空白作为换行机会）；② `cardGeometry` 改为**按标题/描述的真实折行行数自适应卡片高度**（标题最多 2 行），并把折行结果与各行基线一并返回，绘制端逐行渲染（几何与绘制同源，不会错位）；③ 高度超出画布可用区时裁剪描述行并**末行加省略号**，绝不溢出画布。少节点卡片更宽（`min(360, 0.27W)`）以减少折行；④ 加**行首禁则**：`。，、；：！？）】》」』` 等标点不另起一行（悬挂标点并回上一行），避免句号被甩成孤立的一行 |
| 标签互相重叠 / 被卡片压住；时间轴半屏"空"没字 | **已被「滑动视窗」方案取代**（见上一行的滑动视窗）：不再在整条轴上强排 28 个标签，只布局"窗口内可见节点"。`layoutLabels` 的约束：① **只处理屏幕可见节点**（视窗外不画）；② 矩形碰撞避让 + 卡片作禁区，**放不下就只留圆点**（宁可少画也不重叠、不糊）；③ 最多下沉 3 级，避免标签被卡片顶得离节点太远；④ 视窗左右边缘按距离 0.14→1 **淡入淡出**，标签不会突然冒出/消失。旧的"聚焦窗口 + 紧凑刻度"方案已弃用——它会让远处只剩小字刻度、近处标签被卡片挤走，整体比原版更乱 |
| 选视频后视频不显示 / 无法播放 | 根因：`drawCover(img,…)` 用 `img.naturalWidth / img.naturalHeight` 求宽高比，但 `<video>` 元素**没有** `naturalWidth`（为 `undefined`）→ 比例 = `undefined/undefined` = `NaN`，后续尺寸全为 `NaN`，`ctx.drawImage(img, NaN, …)` 在 `requestAnimationFrame` 回调里抛 `TypeError`、绘制循环当场崩溃，视频背景永不出现（之前 1.2s 内选视频"看似能播"，是因为那时视频元数据未加载、`videoWidth===0` 被 `paintVid` 提前 return 没走到 `drawCover`，漏掉了这个崩溃）。修复：`drawCover` 同时兼容图片与视频——`const iw = img.naturalWidth \|\| img.videoWidth; const ih = img.naturalHeight \|\| img.videoHeight`，视频走 `videoWidth/videoHeight`；并加 `!iw \|\| !ih` 兜底。另：预览"播放一遍后停尾帧"，若在动画结束后才选视频，循环已停、不会重绘；`onPickVideo` 选择后主动 `replay()` 一遍，确保选中的视频立即可见（正常预览仍不自动重播） |
| 卡片里 title 展示不全（长标题被截断） | 根因：`cardGeometry` 对标题做了 `wrapText(...).slice(0, 2)`——**硬性最多 2 行**，标题一长就被切掉。修复：标题改为**完整换行、不做行数截断**；卡片高度会按完整标题自适应长高。超出画布高度时**优先裁描述**（末行加省略号），**标题始终优先保证完整**；只有当标题本身就极长、裁完描述仍放不下时，才最后兜底裁标题并加省略号 |
| 希望整体「仿古」质感 | `FONT()` 的字体栈由 **黑体(`Noto Sans CJK SC`)** 改为**仿古衬线栈**：CJK 优先 `楷体 → 仿宋/宋体 → Noto Serif CJK SC`（明朝体衬线兜底），年份/数字等 latin 走 `Georgia/Times New Roman` 衬线。用户机器装有**楷体/仿宋**时即呈书法质感；未装则回退宋体衬线，离线也保持古意（`onMounted` 已有 `document.fonts.ready` 等待，首帧即用正确字体）。时间轴标签、卡片标题/描述、年份大字全部统一为仿古衬线 |
| 「红色圣地 · 会宁之心」被挤压成两行 | 根因：`wrapText` 把 **任何空白都当作强制换行点**——遇到「·」两侧的空格就先 `out.push(line)` 并清空，于是「红色圣地 · 会宁之心」被拆成「红色圣地」/「·」/「会宁之心」，间隔点独占一行（视觉上就是被挤成两行）。修复：空白/间隔符改为**附加到当前行、不在此处断行**（`line += tk; continue`），保留「词 + 间隔 + 词」的整体性；断行只在**下一个非空白 token 确实超宽**时才发生（并去除行尾空白）。纯 CJK 长标题（无空格）折行行为不变；Latin 词仍按词断行；行首禁则（悬挂标点）保留 |
| title 太长放不下 | 根因：卡片宽度锁死 360px、标题字号锁死 27px，标题一长就只能无限折行把卡片撑得极高、挤占画面甚至顶出画布。修复：标题改用**自适应字号**——从 27px 起逐级（每 1px）尝试折行，取**能让标题收进 ≤3 行**的最大字号（下限 17px 保证可读性）；`titleLH` 随字号走，纵向节奏（年份记 → 标题 → 金线分隔 → 描述）整体重算。短标题仍保持 27px 大字，长标题自动缩小并完整展示、卡片保持紧凑；同时把卡片宽度上限由 360 放宽到 380（半宽 190 < 窗口间距 230，仍不压邻居）。极端超长标题（连 17px 都超 3 行）才走原有「末行省略号」兜底 |
| 卡片尺寸不够协调、样式不够完美（**重设计**） | **版式重构：卡片由「贴在节点侧边」改为「居中悬于节点正上方」的标注卡（callout）**，并用**节点连接线**从卡片底边接到节点圆点。① **尺寸协调**：侧边布局时卡片宽 360px 而节点仅相距 ≈230px，必然压住相邻节点圆点/标签；改为居中式后约束变为「半宽 < 相邻间距」，`cardW = min(360, 0.30W, 2×间距−70)`，7~28 节点均为 360px 舒适宽度且**从不压住邻点**；卡片高度按「年份行 + 标题 + 金线分隔 + 描述」的真实折行行数自适应，纵向节奏（`topPad/yearH/titleGap/titleLH/dividerGap/descLH/bottomPad`）统一成一套古典版式。② **样式重做（古典国风）**：配色由**霓虹红/亮金**（`#ff6d6d`/`#ffd45a`）整体切换为**朱砂红 `#c4352d` + 鎏金 `#caa64a` + 宣纸米色 `#f3ead6` + 墨底渐变**，与仿古衬线字体统一；卡片层次重排为：**鎏金双线边框**（外线 + 内描边）→ **朱砂年份竖记 + 鎏金年份**（编辑式古典标题）→ 宣纸米白标题 → **鎏金短分隔线** → 淡米灰描述 → 右上角**「关键节点」朱砂印章**（朱砂底 + 米白字 + 细边）。时间轴路径渐变、节点、播放头、大号水印年份同步换为朱砂↔鎏金暖色调 |
| 最后几个节点未看到时间线 | 根因：滑动视窗的相机位置 `cam` 被钳制在 `[half, n-1-half]`（28 节点时 = `[3, 24]`），以保证首尾不空屏；但**已揭示亮色轨迹的终点与播放头**都错用了这个钳制后的 `cam`。于是走到最后 3 个节点（25/26/27）时 `cam` 卡死在 24 不再前进——亮色时间线只画到节点 24，最后几段**只剩暗色虚线**，播放头也停在节点 24，看起来"最后几个节点脱离了时间线"。修复：**屏幕映射 `sx` 继续用钳制后的 `cam`**（决定可见节点、保证首尾不空屏），但**亮色轨迹终点与播放头改用真实叙事进度 `camFrac`**（不受相机钳制），并**钳制在 `[0, n-1]`**——因为末节点没有"下一段"，不加钳制时播放头会在末节点停留期间冲出终点、飘到画面右缘之外。结果：亮色时间线连续贯穿至最后一个节点，播放头精确停在末节点。（顺带修正了一处潜在缺陷：此前 `revealX = sx(cam)` 在 ≤11 节点的全宽布局下 `cam` 恒等于 `half`，会让播放头永远钉在正中、时间线只揭示到中间节点；改用 `camFrac` 后播放头可正常随进度前移。） |
| 缺少「场景全屏」功能 | 新增**场景全屏**：`StageFrame` 右上角加悬浮「⛶ 全屏 / ✕ 退出全屏」按钮，点击 `emit('toggle-fullscreen')` → `App.vue` 对场景容器 `.app__stage` 调用浏览器 **Fullscreen API**（`requestFullscreen()` / `document.exitFullscreen()`）。因 `ControlPanel` 不在该容器内，浏览器全屏时只渲染被全屏元素及其后代，**编辑器自动隐藏**，画面只剩纯净场景。全屏态样式用 `.app__stage:fullscreen`：隐藏页头 `.stage-header` 与图例 `.legend`、去掉 `.stage` 的 `padding/gap` 和 `.stage-card` 的描边/圆角，让画布**铺满整屏**。监听 `fullscreenchange` 同步按钮文案（全屏↔退出），并主动 `dispatchEvent(new Event('resize'))` 令 `TimelineCanvas.fit()` 按全屏尺寸（`getBoundingClientRect`）等比重算铺满、不留黑边；ESC 或点按钮均可退出。出片模式（`?frame`）无编辑器，按钮同样可用 |

> 说明：依赖 `package-lock.json` 已随包提供；若缺失可在联网环境执行 `npm install` 重新生成。

## 📄 License

[MIT](./LICENSE) © 2026 javaeer
