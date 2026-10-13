# 常见问题（FAQ）

### 浏览器内「导出 MP4」提示 ffmpeg-core 加载失败？

`ffmpeg-core.wasm` 约 32MB。Cloudflare Pages 单文件上限 25MB、InfinityFree 上限 10MB，
无法托管该文件。解决：部署时通过 `VITE_FFMPEG_CORE_BASE` 改用 CDN 加载核心，
详见 [DEPLOY.md](./DEPLOY.md) 与各平台 `*.toml` 注释。WebM 录制不受影响，始终可用。

### 本地开发如何准备 ffmpeg 核心？

`pnpm dev` / `pnpm build` 的 `predev` / `prebuild` 钩子会自动运行
`scripts/setup-ffmpeg.mjs`，把 `node_modules/@ffmpeg/core` 的 wasm 拷贝到
`public/ffmpeg/`，完全离线。无需手动操作。

### 如何运行测试？

```bash
pnpm preview          # 先启动预览服务（默认 4173）
pnpm test             # 运行 scripts/ci-smoke.mjs（Puppeteer 加载校验）
```

CI 中 `test` job 会自动启动 `pnpm preview` 并执行冒烟测试。开发者本地回归用例
（需固定端口/本地素材/ffmpeg.wasm）走 `scripts/verify-*`、`scripts/test-*`，
不在 CI 默认门禁内。

### 支持哪些部署平台？

Cloudflare Pages / Netlify / Vercel / InfinityFree，均为纯静态托管。
仓库根提供 `netlify.toml` / `vercel.json` / `wrangler.toml` / `infinityfree/`
配置与说明。

### 远程图片做背景会报错？

远程图片需经同源代理避免 Canvas 跨域污染。本地开发可用 `scripts/imgProxy.mjs`，
生产环境请将图片置于同源或开启 CORS。
