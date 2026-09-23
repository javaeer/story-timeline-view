#!/usr/bin/env bash
# 出片便捷入口（Unix）。核心逻辑在 scripts/render.mjs（跨平台，Windows 可直接 `node scripts/render.mjs`）。
# 用法：
#   ./render_vue.sh            # 用 store.totalSec 作为时长
#   ./render_vue.sh 12         # 指定时长 12 秒
#   DURATION=15 ./render_vue.sh
set -euo pipefail
cd "$(dirname "$0")"

for c in node ffmpeg; do
  command -v "$c" >/dev/null 2>&1 || { echo "缺少依赖：$c（请先安装）"; exit 1; }
done
# 校验 puppeteer 是否可用（未安装则提示，不阻断 build）
if ! node -e "require.resolve('puppeteer')" >/dev/null 2>&1; then
  echo "缺少 puppeteer，请先安装：npm i -D puppeteer"
  exit 1
fi

# 无 dist 则先构建
if [ ! -d dist ]; then
  echo "未找到 dist/，先执行 npm run build …"
  npm run build
fi

node scripts/render.mjs "$@"
