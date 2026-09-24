// 会师镇时间轴 —— 单一事实源（换乡镇只改这里）
export const timeline = {
  meta: {
    kicker: '会师镇 · 红色时间轴',
    title: '红军三大主力 · 会宁会师',
    subtitle: '从战略决策到会师纪念塔——一条时间轴读懂会宁会师镇',
    badge: 'Vue 3 · Canvas 2D',
  },
  // key=true 的节点显示金色“关键章节”环；节奏时长由 useTimeline 计算（无 duration 时默认 10s/节点）
  // images 为可选背景图（URL / 本地路径 / data URI）：取第一张作为该节点的整幅背景，随节点切换交叉淡入
  nodes: [
    { year: '1936.06',    title: '战略决策',   desc: '中央定下三大主力会师方针',     key: false, images: [] },
    { year: '1936.09',    title: '定址会宁',   desc: '“红军会师，中国安宁”',          key: true,  images: [] },
    { year: '1936.10.02', title: '攻克会宁城', desc: '骑兵团夜袭、一举克城',          key: false, images: [] },
    { year: '1936.10.09', title: '总部进驻',   desc: '红军总司令部进驻会宁城',        key: false, images: [] },
    { year: '1936.10.10', title: '胜利会师',   desc: '文庙大成殿召开联欢会',          key: true,  images: [] },
    { year: '1986',       title: '纪念塔落成', desc: '三塔环抱，高 33.33 米',         key: true,  images: [] },
    { year: '今天',       title: '会师精神',   desc: '红色基因，代代相传',            key: false, images: [] },
  ],
}
