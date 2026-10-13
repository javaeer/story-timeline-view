# 变更清单（story-timeline-view 治理改造）

本目录为对 `story-timeline-view` 的信任基建 / CI 增强改造交付物。
将本目录内容解压到仓库根目录即可覆盖/新增对应文件（已排除 `node_modules/`、
`.git/`、`dist/` 等）。

## 一、修改的文件（覆盖原文件）

| 文件 | 变更 |
| ---- | ---- |
| `.github/workflows/ci.yml` | 顶层加 `permissions: {contents: read}`；所有 `uses` 钉版到 commit SHA；新增 `test` job（Puppeteer 冒烟测试） |
| `.github/workflows/deploy-cloudflare.yml` | `cloudflare/wrangler-action@v3` 钉版 SHA；新增 `concurrency` 防并发叠加；CDN core 版本 `0.12.6 → 0.12.10` |
| `netlify.toml` | 注释中 CDN core 示例版本 `0.12.6 → 0.12.10` |
| `.env.example` | 注释中 CDN core 示例版本 `0.12.6 → 0.12.10` |
| `package.json` | `scripts` 新增 `"test": "node scripts/ci-smoke.mjs"` |
| `.gitignore` | 追加 `.env`、`.env.local`、`.idea/`（修复已提交的 `.env` / `.idea/` 卫生隐患） |

## 二、新增的文件

| 文件 | 说明 |
| ---- | ---- |
| `.github/CODEOWNERS` | 默认所有者 `@javaeer` |
| `.github/FUNDING.yml` | 赞助信息 |
| `.github/dependabot.yml` | `npm`（自动识别 pnpm-lock.yaml）+ `github-actions` 周更 |
| `.github/workflows/audit.yml` | `pnpm audit --audit-level=high`（本项目有真实依赖，审计有意义，**保留**） |
| `.github/workflows/codeql.yml` | CodeQL JS/TS 分析，全步骤钉版 |
| `.github/workflows/scorecard.yml` | OpenSSF Scorecard 供应链评分，钉版 |
| `.github/workflows/release.yml` | `v*` 标签发布，附 `dist` 压缩包（用 `gh` CLI，无第三方 action） |
| `GOVERNANCE.md` | 治理模型 |
| `ROADMAP.md` | 路线图 |
| `README.en.md` | 英文 README |
| `.editorconfig` | 编辑器一致性 |
| `.gitattributes` | 行尾与二进制文件标记 |
| `scripts/ci-smoke.mjs` | CI 自包含冒烟测试 |
| `docs/architecture.md` | 架构与三条出片链路 |
| `docs/data-format.md` | 时间轴数据格式说明 |
| `docs/faq.md` | 常见问题 |

## 三、关键决策与说明

1. **ffmpeg 版本漂移（审计低估）**：漂移涉及 `deploy-cloudflare.yml` + `netlify.toml`
   + `.env.example` 三处（均 `0.12.6`），统一到 `package.json` 的 `0.12.10`。
2. **无双 lockfile**：实测仓库仅 `pnpm-lock.yaml`（lockfileVersion 9.0），无
   `package-lock.json`，`--frozen-lockfile` 正常。无需删除动作。
3. **CI 测试子集（审计未证前提）**：现有 `scripts/verify-*`、`scripts/test-*` 为开发者
   E2E 调试台，硬编码绝对路径（`/root/uploads/...`）、固定端口（5188）、本地 ffmpeg.wasm，
  不宜直接接入 CI。改为新增**自包含冒烟测试** `scripts/ci-smoke.mjs`：启动 `vite preview`
   → Puppeteer 校验应用加载 / 引擎初始化 / 无运行时错误，可稳定变绿。
4. **部署触发（未加 `paths` 限定）**：push-to-branch=production 是 Cloudflare Pages 预期
   行为；采用 `concurrency` 防并发叠加，而非 `paths` 过滤（避免漏配致静默停部署）。
   请确认 Cloudflare 部署源唯一：控制台 Git 集成 与 `deploy-cloudflare.yml` 二选一，避免双跑。
5. **audit.yml 保留（反向于 bar-chart-race）**：本项目有 `@ffmpeg/*`/`vue`/`vite`/`puppeteer`
   真实依赖，审计有意义，未照搬 race 的「零依赖故砍 audit」逻辑。
6. **未做项**：JSON Schema（数据为内联 JS，非外部 JSON，收益低）、Lighthouse CI（小静态站
   ROI 低）、`prefers-reduced-motion`（源码改动，列入 P3 质量项）、`files` 字段（private 不发包无关）。

## 四、应用后建议

- 若 `.env` 已含敏感内容，执行 `git rm --cached .env` 取消跟踪（仅加 `.gitignore` 不会取消已跟踪文件）。
- 在 Cloudflare Pages 控制台确认部署源唯一。
- 本地验证：`pnpm install && pnpm build && pnpm preview &` 后 `pnpm test`。
- 钉版 SHA 取自各 action 当前 tag 对应 commit（实现时通过 GitHub API 取得）。
