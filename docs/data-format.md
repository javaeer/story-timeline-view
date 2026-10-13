# 数据格式（Data Format）

时间轴数据来自 **`src/data/timeline.js`**（单一事实源）。换内容只改这一个文件，
无需改动渲染逻辑。结构如下：

```js
export const timeline = {
  meta: {
    kicker: '会师镇 · 红色时间轴',   // 小标题（顶部徽标上方）
    title: '红军三大主力 · 会宁会师', // 主标题
    subtitle: '从战略决策到会师纪念塔——一条时间轴读懂会宁会师镇', // 副标题
    badge: 'Vue 3 · Canvas 2D',     // 右上徽标文字
  },
  nodes: [
    {
      year: '1936.10.10',   // 显示用时间标签（字符串，原样展示）
      title: '胜利会师',     // 节点标题
      desc: '文庙大成殿召开联欢会', // 节点描述
      key: true,            // 是否关键节点（金色环标记）
      images: [],           // 可选背景图：URL / 本地路径 / data URI；支持 {url, ...} 富对象
      video: null,          // 可选背景视频：URL / {url, ...} 富对象
      audio: null,          // 可选节点音频
      duration: 10,         // 可选，节点时长（秒）；省略时由 useTimeline 默认 10s
    },
    // ...
  ],
}
```

## 字段说明

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `meta.kicker` | string | 顶部小标题 |
| `meta.title` | string | 主标题 |
| `meta.subtitle` | string | 副标题 |
| `meta.badge` | string | 右上角徽标 |
| `node.year` | string | 时间标签，原样展示 |
| `node.title` | string | 节点标题 |
| `node.desc` | string | 节点描述 |
| `node.key` | boolean | 关键节点（金色环） |
| `node.images` | (string \| object)[] | 背景图，支持 URL/路径/data URI 或 `{ url, ... }` 富对象 |
| `node.video` | string \| object \| null | 背景视频 |
| `node.audio` | string \| object \| null | 节点音频 |
| `node.duration` | number | 节点时长（秒），省略默认 10s |

## 节奏计算

总时长由 `src/composables/useTimeline.js` 计算：各节点 `duration` 之和（无 `duration`
时按 10s 计），叠加转场余量。可视化编辑面板可导入/导出工程 JSON，结构与上一致。

> 注：当前数据为内联 JS（非外部 JSON 文件）。若后续将 `timeline` 外置为
> `timeline.json`，可在此基础上再补 JSON Schema 校验；现阶段无需。
