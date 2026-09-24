// 节奏调度（单位：秒）。
// 每个节点可显式指定 duration（秒）覆盖默认“基础时长 + 文字长度权重”，实现“节点时长动态控制”。
export function buildSchedule(nodes, opts = {}) {
  const introSec = opts.introSec ?? 0.8   // 片头淡入
  const outroSec = opts.outroSec ?? 1.0   // 片尾停留
  const baseSec = opts.baseSec ?? 10      // 无显式时长时，单节点默认停留 10 秒
  const perCharSec = opts.perCharSec ?? 0.05 // 文字每增加 1 字追加的秒数

  const durs = nodes.map((n) =>
    n.duration != null && !Number.isNaN(Number(n.duration)) && Number(n.duration) > 0
      ? Number(n.duration)
      : baseSec + perCharSec * ((n.title?.length || 0) + (n.desc?.length || 0))
  )
  const contentSec = durs.reduce((a, b) => a + b, 0)
  const totalSec = introSec + contentSec + outroSec

  let acc = introSec
  const starts = [], ends = [], startsFrac = [], endsFrac = []
  for (const d of durs) {
    const s = acc, e = acc + d
    starts.push(s)
    ends.push(e)
    startsFrac.push(contentSec > 0 ? (s - introSec) / contentSec : 0)
    endsFrac.push(contentSec > 0 ? (e - introSec) / contentSec : 1)
    acc = e
  }
  return { introSec, outroSec, contentSec, totalSec, durs, starts, ends, startsFrac, endsFrac, n: nodes.length }
}

// 把“当前秒 tSec”映射到行程 travel∈[0,1]、当前节点与节点内进度 intra
export function locate(sched, tSec) {
  const { n } = sched
  if (tSec <= sched.introSec) return { travel: 0, node: -1, intra: 0 }
  if (tSec >= sched.introSec + sched.contentSec) return { travel: 1, node: n - 1, intra: 1 }
  const local = tSec - sched.introSec // 内容区间内已过的秒数
  let i = 0
  while (i < n - 1 && local > sched.ends[i] - sched.introSec) i++
  const segStart = sched.starts[i] - sched.introSec
  const segEnd = sched.ends[i] - sched.introSec
  const seg = segEnd - segStart
  const intra = seg > 0 ? Math.min(Math.max((local - segStart) / seg, 0), 1) : 1
  const travel = sched.contentSec > 0 ? local / sched.contentSec : 1
  return { travel, node: i, intra }
}

// travel∈[0,1] 映射到几何 x（在节点间按缓动插值，节点处恰好对齐）
export function xAtTravel(sched, travel, nodeXArr) {
  const n = nodeXArr.length
  if (n === 0) return 0
  if (travel <= 0) return nodeXArr[0]
  if (travel >= 1) return nodeXArr[n - 1]
  let i = 0
  while (i < n - 1 && travel >= sched.endsFrac[i]) i++
  // 最后一段：i 已到最后一个节点，没有「下一个节点」可插值。
  // 原实现会取 nodeXArr[n] (undefined) 参与运算得到 NaN，导致 revealX=NaN →
  // 最后一个节点的卡片判定失效、几乎不显示。这里直接停在最后一个节点上（即完整停留 durs[n-1]）。
  if (i >= n - 1) return nodeXArr[n - 1]
  const seg = sched.endsFrac[i] - sched.startsFrac[i]
  const f = seg > 0 ? (travel - sched.startsFrac[i]) / seg : 0
  const fe = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2
  return nodeXArr[i] + (nodeXArr[i + 1] - nodeXArr[i]) * fe
}
