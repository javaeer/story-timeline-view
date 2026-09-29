// MP4 导出（P0）：把 MediaRecorder 录制的 WebM 经 ffmpeg.wasm 转码为 H.264 + AAC 的 MP4。
// 设计要点：
// - 仅在用户选择「MP4」时按需动态加载（dynamic import），不拖慢首屏、不增大主包。
// - 核心加载基址 CORE_BASE：
//   * 优先使用构建期注入的 VITE_FFMPEG_CORE_BASE（自定义 CDN 或同源路径）。
//   * 未设置时：生产环境（import.meta.env.PROD，即 `vite build`）默认走 jsDelivr CDN，
//     运行时从 CDN 拉取 wasm，dist 不含 32MB 二进制，可直接部署到 Cloudflare Pages 等
//     单文件受限平台，无需在托管控制台手动配置环境变量。
//   * 开发环境（vite dev）回退到同源 public/ffmpeg（由 scripts/setup-ffmpeg.mjs 在 predev
//     阶段从 node_modules 拷贝），完全离线、不依赖任何 CDN。
// - 全程 best-effort：任一环节失败都抛出，由调用方回退为原 WebM 下载，绝不卡死导出流程。
const CDN_FALLBACK = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd'
const CORE_BASE = import.meta.env.VITE_FFMPEG_CORE_BASE
  || (import.meta.env.PROD ? CDN_FALLBACK : `${import.meta.env.BASE_URL}ffmpeg`)

let ffmpeg = null
let loading = null

async function getFFmpeg() {
  if (ffmpeg) return ffmpeg
  if (loading) return loading
  loading = (async () => {
    const { FFmpeg } = await import('@ffmpeg/ffmpeg')
    const { toBlobURL } = await import('@ffmpeg/util')
    const f = new FFmpeg()
    await f.load({
      coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
    })
    ffmpeg = f
    return f
  })()
  return loading
}

// webm Blob → mp4 Blob。onProgress(0..1) 用于 UI 进度提示。
export async function webmToMp4(blob, onProgress) {
  const f = await getFFmpeg()
  const { fetchFile } = await import('@ffmpeg/util')
  // 预设自适应：单线程 wasm 编码很慢（1080p 实测 veryfast ≈2.3× 实时、ultrafast ≈1.0× 实时）。
  // 短视频用 veryfast（压缩率好、体积小）；大文件切 ultrafast，显著提速并降低长视频 OOM/超时风险。
  const preset = blob.size > 8 * 1024 * 1024 ? 'ultrafast' : 'veryfast'
  const ARGS = [
    '-i', 'in.webm',
    '-c:v', 'libx264', '-preset', preset, '-crf', '23', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    'out.mp4',
  ]
  const run = async () => {
    await f.writeFile('in.webm', await fetchFile(blob))
    await f.exec(ARGS)
    // 先释放输入再读输出：把源文件从 wasm 内存里删掉，显著降低峰值占用
    try { await f.deleteFile('in.webm') } catch (e) {}
    const data = await f.readFile('out.mp4')
    try { await f.deleteFile('out.mp4') } catch (e) {}
    return new Blob([data], { type: 'video/mp4' })
  }
  if (onProgress) {
    const handler = ({ progress }) => onProgress(Math.max(0, Math.min(1, Number(progress) || 0)))
    f.on('progress', handler)
    try { return await run() } finally { f.off('progress', handler) }
  }
  return run()
}

// 调试/自动化友好：暴露转码入口到 window（便于无头验证；生产环境无副作用）
if (typeof window !== 'undefined') window.__tlMp4 = webmToMp4
