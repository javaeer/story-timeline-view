# 部署指南

`story-timeline-view` 是纯前端静态应用，构建产物在 `dist/`，可免费托管到多家平台。
本指南覆盖 **Cloudflare Pages / Netlify / Vercel / InfinityFree**。

---

## 0. 关于 ffmpeg-core.wasm（必读）

浏览器端「导出 MP4」依赖 `ffmpeg-core.wasm`，体积约 **32MB**。两个免费平台有硬限制：

- **Cloudflare Pages**：单文件 ≤ **25 MB**
- **InfinityFree**：单文件 ≤ **10 MB**（JS/HTML 还限 1MB）

因此部署到这两类平台时，**不要**把 wasm 打进 `dist/`，而是用 CDN 加载核心：

```bash
# 构建时设置该变量，scripts/setup-ffmpeg.mjs 会跳过本地拷贝
VITE_FFMPEG_CORE_BASE=https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd \
  pnpm build
```

- CDN 版本号需与 `package.json` 中 `@ffmpeg/core` 一致。
- 不设该变量时，构建会把 wasm 拷进 `dist/`，适合本地/GitHub Pages 等无单文件限制的平台。
- WebM 录制不依赖 wasm，任何平台都可用。

> ⚠️ **Cloudflare Pages 关键配置（Git 集成模式）**：
> - **「Deploy command（部署命令）必须留空！** Pages 会在 `build` 完成后自动部署 `dist/`，
>   切勿填入 `npx wrangler deploy`（那是 Workers 命令，会报 `Missing entry-point` 部署失败）。
> - 只需正确设置 **Build command**（`pnpm install && pnpm build`）与下方 **环境变量** 即可。

---

## 1. Cloudflare Pages（推荐）

**方式 A：Git 连接（最简单）**

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/) → Workers & Pages → Create → Pages → Connect to Git。
2. 授权并选择 `javaeer/story-timeline-view`。
3. 构建设置：
   - Framework preset：**None**（或 Vite）
   - Build command：`pnpm install && pnpm build`
   - Output directory：`dist`
   - Node version：20
4. 在 **Settings → Environment variables**（作用域选 **Build**）添加：
   `VITE_FFMPEG_CORE_BASE = https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd`
5. 保存并 Deploy。完成后获得 `*.pages.dev` 域名，可再绑自定义域名（免费）。

**方式 B：GitHub Actions 自动部署**

仓库已含 `.github/workflows/deploy-cloudflare.yml`。在仓库 Secrets 配置：

- `CLOUDFLARE_API_TOKEN`（需 Pages 编辑权限）
- `CLOUDFLARE_ACCOUNT_ID`

推送到 `master` 即自动构建并发布。该工作流默认已启用 CDN 核心。

> 免费额度：500 次构建/月、无限带宽、单文件 25MB、每站 2 万文件。足够个人项目。

---

## 2. Netlify

1. 登录 [Netlify](https://app.netlify.com/) → Add new site → Import from Git。
2. 选择仓库，构建设置会自动读取 `netlify.toml`：
   - Build command：`pnpm install && pnpm build`
   - Publish directory：`dist`
3. 在 **Site settings → Environment variables** 添加
   `VITE_FFMPEG_CORE_BASE`（同上 CDN 地址），然后触发重新部署。
4. 完成，获得 `*.netlify.app` 域名，可绑自定义域名。

> 若不想用 Git，也可本地 `pnpm build` 后把 `dist/` 拖到 Netlify Drop 页面直接发布。

---

## 3. Vercel

1. 登录 [Vercel](https://vercel.com/) → New Project → 导入仓库。
2. Framework 自动识别为 Vite，读取 `vercel.json`：输出 `dist`。
3. 在 **Project Settings → Environment Variables** 添加
   `VITE_FFMPEG_CORE_BASE`（同上 CDN 地址），重新部署。
4. 完成，获得 `*.vercel.app` 域名。

> 免费额度：个人/非商业用途、100GB 带宽/月、6000 构建分钟/月。

---

## 4. InfinityFree（FTP 上传）

InfinityFree 是传统 PHP/MySQL 虚拟主机，通过 FTP 上传静态产物。详见
[`infinityfree/README.md`](./infinityfree/README.md) 与附带的 `.htaccess`。

要点：
- 必须先用 CDN 方案构建（见第 0 节），保证 `dist/` 无 >10MB 文件。
- 用 FTP 把 `dist/` 内容上传到 `htdocs/`，并把 `infinityfree/.htaccess` 一并传上去。
- 单 JS 文件限 1MB：`vite.config.js` 已做 `manualChunks` 拆分，构建后请核对 `dist/assets/*.js`。

---

## 5. 本地预览构建产物

无论哪种方式，部署前都可本地验证：

```bash
pnpm build
pnpm preview   # http://127.0.0.1:4173
```

## 6. 自定义域名与 HTTPS

- Cloudflare Pages / Netlify / Vercel：在控制台添加域名，自动签发免费 SSL。
- InfinityFree：支持自带域名或免费子域，免费 SSL 证书自动配置。

---

## 常见问题

**Q：部署后导出 MP4 失败 / 一直转圈？**
A：多半是 wasm 未加载。检查是否设置了 `VITE_FFMPEG_CORE_BASE` 且版本号与 `@ffmpeg/core` 一致；或确认 `dist/ffmpeg/` 下确实存在核心文件（仅在未设 CDN 时）。

**Q：页面白屏？**
A：确认 `base: './'`（已配置，支持子目录托管）；InfinityFree 请将文件放在 `htdocs/` 根。

**Q：构建报 ffmpeg-core 找不到？**
A：`predev`/`prebuild` 会自动拷贝；若手动构建失败，先执行 `pnpm setup:ffmpeg`。
