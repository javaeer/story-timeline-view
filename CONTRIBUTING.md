# 贡献指南

感谢你考虑为 **story-timeline-view** 做出贡献！🎉

## 开发流程

1. **Fork** 本仓库并克隆到本地。
2. 安装依赖（推荐 pnpm）：
   ```bash
   pnpm install
   ```
   > 安装后会通过 `predev`/`prebuild` 钩子自动把 ffmpeg-core 拷贝到 `public/ffmpeg/`。
3. 启动开发服务器：
   ```bash
   pnpm dev
   ```
4. 本地构建校验：
   ```bash
   pnpm build && pnpm preview
   ```

## 分支与提交

- 从 `master` 切出特性分支：`feat/xxx`、`fix/xxx`、`docs/xxx`。
- 提交信息建议遵循 [Conventional Commits](https://www.conventionalcommits.org/)：
  `feat: 新增节点拖拽`、`fix: 修复高清屏模糊`、`docs: 补充部署文档`。
- 一个 PR 聚焦一件事，描述清楚**动机**与**验证方式**。

## 数据格式

时间轴数据来自 `src/data/timeline.js`（单一事实源）。新增/修改节点请遵循既有结构：

```js
{
  year: '1936.10.10',   // 显示用时间标签
  title: '胜利会师',     // 节点标题
  desc: '文庙大成殿召开联欢会', // 节点描述
  key: true,            // 是否关键节点（金色环）
  images: [],           // 可选背景图（URL / 本地路径 / data URI）
}
```

## 出片（MP4）说明

- 浏览器内点击「导出 MP4」走 ffmpeg.wasm（本地或 CDN，见 `.env.example`）。
- 命令行批量出片：`pnpm render [时长秒数]`（依赖本机 `ffmpeg` 与 `puppeteer`）。
- `scripts/` 下以 `shot-*`、`verify-*`、`test-*` 开头的脚本为**开发调试/回归验证**用途，
  不纳入发布产物，请勿在正式文档中作为用户接口引用。

## 代码风格

- 使用 Prettier 默认风格（2 空格缩进、单引号、末尾分号）。
- Vue 组件 `<script setup>` + Composition API。
- 提交前请确保 `pnpm build` 通过。

## 提交 Issue

- Bug 请使用 Bug Report 模板，附**复现步骤**、**环境信息**、**截图/录屏**。
- 功能建议请使用 Feature Request 模板，说明**使用场景**与**预期行为**。

## 许可证

提交贡献即表示你同意以 [MIT 许可证](./LICENSE) 发布你的代码。
