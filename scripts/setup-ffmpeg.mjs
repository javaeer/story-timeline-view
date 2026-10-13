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

async function findCoreDir() {
  let corePkgDir;
  try {
    corePkgDir = dirname(require.resolve('@ffmpeg/core/package.json'));
  } catch {
    return null;
  }
  // @ffmpeg/core@0.12.x 布局：dist/umd 与 dist/esm 各有一份核心。
  for (const sub of ['dist/umd', 'dist/esm', 'dist']) {
    if (await exists(join(corePkgDir, sub, 'ffmpeg-core.js'))) {
      return join(corePkgDir, sub);
    }
  }
  return null;
}

async function main() {
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
