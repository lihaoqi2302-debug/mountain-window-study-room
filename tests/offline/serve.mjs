// 离线验收用的静态服务器：故意不用 vite preview。
//
// 理由：本包要验证「彻底断网后仍能打开」，必须能在测试中途把服务器整个关掉，
// 让 service worker 成为唯一应答者。vite preview 由 Playwright 的 webServer 托管，
// 测试内无法确定地 kill，所以这里自己起一个只读静态服务器。
//
// 口径：
//   - 127.0.0.1 属于安全上下文，service worker 可注册；
//   - sw.js 一律 no-store，避免浏览器 HTTP 缓存掩盖 revision 变化；
//   - 其余文件也不缓存，保证「暖缓存」只在 SW 层发生，测量口径干净；
//   - 支持 Range（bookstore 的媒体与 PDF 走 206 切片时需要）。
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.icc': 'application/octet-stream',
  '.md5': 'text/plain; charset=utf-8',
}

/** 把一个 URL 路径安全地映射到根目录内的文件路径。 */
function resolvePath(root, pathname) {
  const decoded = decodeURIComponent(pathname.split('?')[0])
  const relative = normalize(decoded).replace(/^([/\\])+/, '')
  const full = resolve(root, relative)
  const prefix = resolve(root) + sep
  return full === resolve(root) || full.startsWith(prefix) ? full : null
}

async function pickFile(root, pathname) {
  const full = resolvePath(root, pathname)
  if (!full) return null
  const info = await stat(full).catch(() => null)
  if (!info) return null
  if (info.isDirectory()) {
    const index = join(full, 'index.html')
    const inner = await stat(index).catch(() => null)
    return inner?.isFile() ? { path: index, size: inner.size } : null
  }
  return info.isFile() ? { path: full, size: info.size } : null
}

/**
 * 起一个只读静态服务器。
 *
 * @param {{ root: string, port: number, host?: string,
 *   cacheControl?: string,
 *   extras?: Map<string, { status?: number, body: string, type?: string }>,
 *   faults?: (pathname: string, hit: number) => ('abort' | number | undefined) }} options
 *   cacheControl：默认 no-store，让「暖缓存」只发生在 SW 层，测量口径干净；
 *     体积对照里要单测 HTTP 暖缓存时可显式放开。
 *   extras：内置端点覆盖，用来在同源下模拟 ICE/TURN 凭据端点等真实接口。
 *   faults：故障注入。'abort' 直接断开连接（模拟下载中断），数字则返回该状态码。
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void>, hits: Map<string, number> }>}
 */
export function createStaticServer({ root, port, host = '127.0.0.1', cacheControl = 'no-store', extras, faults }) {
  // 命中计数供证据使用：断网前后各照一次，能直接看出 SW 接管后服务器是否还被访问。
  const hits = new Map()
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://${host}:${port}`)
    hits.set(url.pathname, (hits.get(url.pathname) ?? 0) + 1)
    const fault = faults?.(url.pathname, hits.get(url.pathname))
    if (fault === 'abort') {
      // 传输中断的真实形态是连接被掐断，而不是一个体面的 4xx。
      response.destroy()
      request.destroy()
      return
    }
    if (typeof fault === 'number') {
      response.writeHead(fault, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      response.end(`injected fault ${fault}`)
      return
    }
    const extra = extras?.get(url.pathname)
    if (extra) {
      const body = Buffer.from(extra.body)
      response.writeHead(extra.status ?? 200, {
        'content-type': extra.type ?? 'application/json; charset=utf-8',
        'content-length': String(body.length),
        'cache-control': 'no-store',
      })
      response.end(body)
      return
    }
    const found = await pickFile(root, url.pathname === '/' ? '/index.html' : url.pathname)
    if (!found) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('not found')
      return
    }
    const type = types[extname(found.path).toLowerCase()] ?? 'application/octet-stream'
    const headers = {
      'content-type': type,
      // sw.js 永远不缓存：否则浏览器 HTTP 缓存会掩盖 revision 变化。
      'cache-control': url.pathname.endsWith('/sw.js') ? 'no-store' : cacheControl,
      'accept-ranges': 'bytes',
      // 让 SW 能接管整站，不必在 sw.js 里额外声明 scope。
      'service-worker-allowed': '/',
    }
    const range = request.headers.range
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range)
      if (match && (match[1] || match[2])) {
        const start = match[1] ? Number(match[1]) : Math.max(0, found.size - Number(match[2]))
        const end = match[1] && match[2] ? Math.min(Number(match[2]), found.size - 1) : found.size - 1
        if (start >= found.size || start > end) {
          response.writeHead(416, { 'content-range': `bytes */${found.size}` })
          response.end()
          return
        }
        response.writeHead(206, {
          ...headers,
          'content-range': `bytes ${start}-${end}/${found.size}`,
          'content-length': String(end - start + 1),
        })
        if (request.method === 'HEAD') { response.end(); return }
        createReadStream(found.path, { start, end }).pipe(response)
        return
      }
    }
    response.writeHead(200, { ...headers, 'content-length': String(found.size) })
    if (request.method === 'HEAD') { response.end(); return }
    createReadStream(found.path).pipe(response)
  })
  return new Promise((done, fail) => {
    server.once('error', fail)
    server.listen(port, host, () => {
      done({
        url: `http://${host}:${port}/`,
        port,
        hits,
        close: () => new Promise((closed) => {
          server.closeAllConnections?.()
          server.close(() => closed())
        }),
      })
    })
  })
}

// CLI：node tests/offline/serve.mjs [root] [port]
if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}` || process.argv[1]?.endsWith('serve.mjs')) {
  const root = resolve(process.argv[2] ?? 'dist-public')
  const port = Number(process.argv[3] ?? (5197 + Number(process.env.STUDY_TEST_PORT_EXTRA ?? 0) + 400))
  const running = await createStaticServer({ root, port })
  console.log(`serving ${root} at ${running.url}`)
}
