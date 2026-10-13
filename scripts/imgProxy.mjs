// 同源图片/视频代理：浏览器侧通过 /__img?u=<编码后的远程URL> 请求，
// 由本机（dev 服务器 / 导出服务器）服务端代取，再以“同源”返回。
// 这样画到 Canvas 时不会污染（origin-clean），captureStream 录制才能成功。
// 整文件缓存后按 Range 返回 206（Accept-Ranges / Content-Range），支持视频 seek。
// 远程图床即使没有 CORS 头也无所谓。
import { Buffer } from 'node:buffer'

const cache = new Map() // target -> { buf, ct }

export async function handleImgProxy(req, res) {
  try {
    const u = new URL(req.url, 'http://localhost')
    const target = u.searchParams.get('u')
    if (!target || !/^https?:\/\//i.test(target)) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('bad request')
      return
    }
    let entry = cache.get(target)
    if (!entry) {
      const r = await fetch(target, { redirect: 'follow', headers: { 'User-Agent': 'story-timeline-imgproxy/1.0' } })
      if (!r.ok) {
        res.writeHead(r.status, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('upstream ' + r.status)
        return
      }
      const buf = Buffer.from(await r.arrayBuffer())
      const ct = r.headers.get('content-type') || 'application/octet-stream'
      entry = { buf, ct }
      cache.set(target, entry)
    }
    const { buf, ct } = entry
    const headers = {
      'Content-Type': ct,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=86400',
    }
    const range = req.headers.range
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range)
      let start = 0
      let end = buf.length - 1
      if (m) {
        if (m[1]) start = parseInt(m[1], 10)
        if (m[2]) end = parseInt(m[2], 10)
        if (Number.isNaN(end) || end >= buf.length) end = buf.length - 1
      }
      if (start > end || start >= buf.length) {
        res.writeHead(416, { 'Content-Range': `bytes */${buf.length}` })
        res.end()
        return
      }
      const chunk = buf.subarray(start, end + 1)
      res.writeHead(206, {
        ...headers,
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${buf.length}`,
        'Content-Length': chunk.length,
      })
      res.end(chunk)
    } else {
      res.writeHead(200, { ...headers, 'Accept-Ranges': 'bytes', 'Content-Length': buf.length })
      res.end(buf)
    }
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('proxy error: ' + String(e))
  }
}
