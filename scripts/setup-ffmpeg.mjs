// scripts/setup-ffmpeg.mjs
// 将 @ffmpeg/core 的构建产物拷贝到 public/ffmpeg，供本地/离线加载 ffmpeg-core。
// 部署时通过 VITE_FFMPEG_CORE_BASE 指向 CDN 后，运行时不再依赖本地核心；
// 本脚本被 prebuild/predev 调用，但设计为「非致命」：找不到或拷贝失败仅告警，
// 绝不返回非零退出码，以免阻断 pnpm build / pnpm dev / 部署。
import { access, copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

const DEST = join(here, '..', 'public', 'ffmpeg');
const CORE_FILES = ['ffmpeg-core.js', 'ffmpeg-core.wasm', 'ffmpeg-core.worker.js'];

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// @ffmpeg/core 的 package.json 在 exports 中未暴露 ./package.json，
// 故解析其主入口（通常为 dist/umd/ffmpeg-core.js），再回退查找核心目录。
async function findCoreDir() {
  let coreEntry;
  try {
    coreEntry = require.resolve('@ffmpeg/core');
  } catch {
    return null;
  }
  const dir = dirname(coreEntry); // .../@ffmpeg/core/dist/umd
  const candidates = [dir, join(dir, 'umd'), join(dir, '..', 'umd'), join(dir, '..', '..', 'umd')];
  for (const c of candidates) {
    if (await exists(join(c, 'ffmpeg-core.js'))) return c;
  }
  return null;
}

async function main() {
  // CDN 模式：已通过 VITE_FFMPEG_CORE_BASE 指定远程核心加载地址时，
  // 运行时不再依赖本地 public/ffmpeg/*，跳过拷贝以避免 32MB wasm 进入 dist，
  // 从而规避 Cloudflare Pages(≤25MB) / InfinityFree(≤10MB) 的单文件体积上限。
  const cdnBase = process.env.VITE_FFMPEG_CORE_BASE;
  if (cdnBase) {
    console.log(`[setup-ffmpeg] 检测到 VITE_FFMPEG_CORE_BASE=${cdnBase}，运行时从 CDN 加载 ffmpeg-core，跳过本地核心拷贝。`);
    return;
  }

  const src = await findCoreDir();
  if (!src) {
    console.warn('[setup-ffmpeg] 未在 node_modules 找到 @ffmpeg/core，跳过本地核心拷贝（部署将使用 CDN）。');
    return;
  }
  await mkdir(DEST, { recursive: true });
  for (const f of CORE_FILES) {
    const from = join(src, f);
    if (await exists(from)) {
      await copyFile(from, join(DEST, f));
      console.log(`[setup-ffmpeg] ${f} -> public/ffmpeg/${f}`);
    }
  }
}

main().catch((err) => {
  // 预构建失败不应阻断构建/部署：仅告警。
  console.warn('[setup-ffmpeg] 跳过（非致命）:', err && err.message ? err.message : err);
});
