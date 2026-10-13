# 治理模型（Governance）

本文件说明 `story-timeline-view` 的维护与决策方式，供贡献者与使用者参考。

## 维护者

- 项目所有者 / 主要负责人：**@javaeer**（见 [CODEOWNERS](./.github/CODEOWNERS)）。
- 所有 Pull Request 至少需一名所有者的审查通过方可合并。

## 决策流程

- 功能与破坏性变更通过 Issue 讨论后，以 Pull Request 形式落地，遵循
  [Conventional Commits](https://www.conventionalcommits.org/)。
- 重大方向（架构、许可证、部署平台）由所有者裁定。

## 分支与发布

- 默认分支：`master`。
- 发布以 `v*` 标签触发（见 `release.yml`），附件为构建产物 `dist/` 的压缩包。
- 版本号遵循语义化版本（SemVer）。

## 质量标准

合并到 `master` 前必须满足：

- `pnpm build` 通过（CI `build` job）；
- `pnpm test` 冒烟测试通过（CI `test` job，Puppeteer 加载校验）；
- 依赖审计无 `high` 及以上漏洞（CI `audit` job）。

## 安全

- 安全漏洞请按 [SECURITY.md](./SECURITY.md) 私披露，勿公开 Issue。
- 浏览器端「导出 MP4」依赖 `ffmpeg-core.wasm`，默认经同源 `public/ffmpeg/`
  本地核心或 CDN 加载（见 `.env.example`），远程图片经同源代理避免 Canvas 污染。

## 自动化

| 工作流            | 作用                                         |
| ----------------- | -------------------------------------------- |
| `ci.yml`          | 构建 + 冒烟测试（push/PR 触发）              |
| `audit.yml`       | 依赖漏洞审计（`--audit-level=high`）         |
| `codeql.yml`      | CodeQL 代码分析（JS/TS）                     |
| `scorecard.yml`   | OpenSSF Scorecard 供应链评分                |
| `deploy-cloudflare.yml` | 部署到 Cloudflare Pages（push master） |
| `release.yml`     | 标签发布，附 `dist` 压缩包                   |

依赖更新由 Dependabot 自动提交（`npm` 与 `github-actions` 两条生态）。
