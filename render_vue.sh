#!/usr/bin/env bash
#  timeline（Vue 3 + Vite，DataViz 风格）渲染脚本
# 链路：vite build → vite preview 起本地服务 → 无头 Chromium 逐帧截图 → ffmpeg 合成 MP4
set -eo pipefail
cd "$(dirname "$0")"

FPS=25
OUT_MP4=out/story_timeline_view.mp4

mkdir -p frames out
[ -d node_modules ] || npm install
npm run build >/tmp/vue_build.log 2>&1

# 动态计算总时长（读取数据 + 节奏调度），节点时长可被显式 duration 覆盖
TOTAL_SEC=$(node --input-type=module -e "
  import('./src/composables/useTimeline.js').then(async (u) => {
    const m = await import('./src/data/timeline.js');
    const s = u.buildSchedule(m.timeline.nodes);
    process.stdout.write(String(s.totalSec));
  });
" 2>/dev/null | tr -d '[:space:]')
TOTAL=$(awk -v t="$TOTAL_SEC" -v f="$FPS" 'BEGIN{printf "%d", t*f}')
echo "总时长 ${TOTAL_SEC}s -> ${TOTAL} 帧 @ ${FPS}fps"

# 起预览服务
npx vite preview --port 4173 --strictPort >/tmp/vue_preview.log 2>&1 &
SRV=$!
for i in $(seq 1 40); do
  curl -s -o /dev/null "http://127.0.0.1:4173/" && break
  sleep 0.5
done

echo "[1/2] 无头 Chromium 逐帧截图（4 并发 x ${TOTAL} 帧）..."
seq 0 $((TOTAL - 1)) | xargs -P 4 -I{} bash -c '
  N={}
  F=$(printf "%05d" "$N")
  chromium --headless --no-sandbox --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=1 --window-size=1920,1080 \
    --virtual-time-budget=1500 \
    --screenshot="frames/${F}.png" \
    "http://127.0.0.1:4173/?frame=$N&duration='"$TOTAL_SEC"'&fps='"$FPS"'" 2>/dev/null
'
echo "    共生成 $(ls frames | wc -l) 帧"

kill "$SRV" 2>/dev/null || true

echo "[2/2] ffmpeg 合成 MP4..."
ffmpeg -y -framerate "$FPS" -i frames/%05d.png \
  -c:v libopenh264 -b:v 8000k -pix_fmt yuv420p \
  -movflags +faststart "$OUT_MP4" 2>/dev/null

echo "完成：$OUT_MP4"
ffprobe -v error -show_entries format=duration,size -of default=noprint_wrappers=1 "$OUT_MP4"
