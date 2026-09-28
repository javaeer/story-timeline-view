# 部署到 InfinityFree

InfinityFree 是带 PHP/MySQL 的免费虚拟主机（FTP/文件管理器上传），适合把
`dist/` 静态产物直接传上去。但有几个**硬性限制**需要先解决：

| 限制 | 数值 | 对本项目的影响 |
| ---- | ---- | ------------- |
| 单文件上限 | **10 MB** | `ffmpeg-core.wasm`(32MB) 无法上传 |
| JS/HTML/PHP 单文件 | **1 MB** | 若打包后单个 JS > 1MB 会被拒绝 |
| `.htaccess` 单文件 | 10 KB | 本文件安全 |

## 必做：改用 CDN 加载 ffmpeg-core

InfinityFree 传不了 32MB 的 wasm，因此**必须**走 CDN：

1. 本地构建时设置环境变量，跳过本地拷贝：
   ```bash
   VITE_FFMPEG_CORE_BASE=https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd \
     pnpm build
   ```
2. 这样 `dist/` 不含 wasm，浏览器端「导出 MP4」会按需从 jsDelivr 拉取核心。
   WebM 录制不受此影响，始终可用。

## 可选：确保 JS 单文件 < 1MB

`vite.config.js` 已用 `manualChunks` 把 `vue` 拆成独立 chunk。构建后请检查
`dist/assets/*.js` 是否都 < 1MB：

```bash
ls -l dist/assets | awk '$5 > 1048576 {print "超 1MB:", $9, $5}'
```

若仍有超标的文件，可进一步拆分或精简依赖。

## 上传步骤

1. 在 InfinityFree 注册账号，创建一个免费子域（如 `xxx.great-site.net`）或绑定自己的域名。
2. 用 FTP 客户端（FileZilla 等）连接，账号信息在控制面板「FTP Details」获取。
3. 把本地 `dist/` 目录下的**全部内容**上传到 `htdocs/` 目录（含本 `.htaccess`）。
4. 访问你的子域名即可看到页面。

> 注意：FTP 单文件上限同样是 10MB，所以务必先按上面用 CDN 方案构建，
> 保证 `dist/` 里没有大于 10MB 的文件。
