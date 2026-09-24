// 同源图片代理：浏览器侧通过 /__img?u=<编码后的远程URL> 请求，
// 由本机（dev 服务器 / 导出服务器）服务端代取，再以“同源”返回。
// 这样画到 Canvas 时不会污染（origin-clean），captureStream 录制才能成功，
// 导出的视频里背景图才会正常切换。远程图床即使没有 CORS 头也无所谓。
import { Buffer } from 'node:buffer'

export async function handleImgProxy(req, res) {
  try {
    const u = new URL(req.url, 'http://localhost')
    const target = u.searchParams.get('u')
    if (!target || !/^https?:\/\//i.test(target)) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('bad request')
      return
    }
    const r = await fetch(target, { redirect: 'follow', headers: { 'User-Agent': 'story-timeline-imgproxy/1.0' } })
    if (!r.ok) {
      res.writeHead(r.status, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('upstream ' + r.status)
      return
    }
    const buf = Buffer.from(await r.arrayBuffer())
    const ct = r.headers.get('content-type') || 'application/octet-stream'
    res.writeHead(200, {
      'Content-Type': ct,
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*',
    })
    res.end(buf)
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('proxy error: ' + String(e))
  }
}
