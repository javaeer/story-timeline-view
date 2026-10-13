# story-timeline-view · Story Timeline View

> A data-driven story timeline animation visualizer & video exporter · Vue 3 + Canvas 2D

A tool that renders timeline data into an animated, glowing-curve timeline and
exports it as video (WebM via MediaRecorder, or MP4 via in-browser `ffmpeg.wasm` /
scripted Puppeteer + ffmpeg).

## ✨ Features

- **Glowing-curve timeline**: rhythmic node reveal, expanding info cards, gold rings for key nodes.
- **Immersive background**: full-screen image/video, cross-fade + Ken Burns zoom.
- **Subtitles**: per-node subtitles + global `.srt` import; local font names supported.
- **Visual editor**: add/remove nodes, tune pacing, mark key nodes, import/export JSON.
- **Video export**:
  - In-browser WebM recording (fixed 1920×1080);
  - Scripted MP4 export (Puppeteer + ffmpeg), or in-browser `ffmpeg.wasm` transcode.
- **Engineering**: HiDPI (`devicePixelRatio`) aware, fullscreen, click-to-seek, play/pause, scroll viewport, multi-aspect.

## 🧱 Tech Stack

| Layer | Choice |
| ----- | ------ |
| Framework | Vue 3 (`<script setup>` + Composition API) |
| Build | Vite 5 |
| Render | Canvas 2D (custom timeline engine) |
| Video | `@ffmpeg/wasm` (in-browser MP4), MediaRecorder (WebM), Puppeteer + ffmpeg (scripted) |

## 🚀 Quick Start

> Recommended package manager: **pnpm** (repo ships `pnpm-lock.yaml`).

```bash
pnpm install        # predev/prebuild hook copies ffmpeg-core into public/ffmpeg/
pnpm dev            # open http://127.0.0.1:5173
pnpm build          # outputs to dist/
pnpm preview        # preview the build
```

## 🎬 Scripted MP4

```bash
pnpm render         # use store.totalSec as duration
pnpm render 12      # explicit duration (seconds)
```

## 📋 Data Format

Timeline data lives in **`src/data/timeline.js`** (single source of truth):

```js
export const timeline = {
  meta: { kicker: '...', title: '...', subtitle: '...', badge: '...' },
  nodes: [
    { year: '1936.10.10', title: '...', desc: '...', key: true, images: [] },
  ],
}
```

Pacing is computed by `src/composables/useTimeline.js` (default 10s per node when `duration` is omitted).

## 🌐 Deploy

Pure static output (`dist/`) deployable to **Cloudflare Pages / Netlify / Vercel /
InfinityFree**. Browser MP4 export depends on `ffmpeg-core.wasm` (~32MB); Cloudflare
Pages caps a single file at 25MB, so load the core from CDN via `VITE_FFMPEG_CORE_BASE`
(see [DEPLOY.md](./DEPLOY.md)). WebM recording is always available.

See [DEPLOY.md](./DEPLOY.md) for per-platform steps.

## 🤝 Contributing

Issues and PRs welcome — please read [CONTRIBUTING.md](./CONTRIBUTING.md) and
[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md). Governance details in
[GOVERNANCE.md](./GOVERNANCE.md).

## 📄 License

[MIT](./LICENSE) © 2026 javaeer
