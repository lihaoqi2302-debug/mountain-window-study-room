import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { fakeIce } from './artifacts.mjs'

export const prefix = '/mountain-window-study-room/'
export const port = 5651
export const origin = `http://127.0.0.1:${port}`
export const base = origin + prefix
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.woff2': 'font/woff2' }

export async function serve(initial) {
  let root = initial
  const hits = new Map()
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, origin).pathname
      hits.set(path, (hits.get(path) ?? 0) + 1) // Never store query strings.
      res.setHeader('Cache-Control', 'no-store')
      if (!path.startsWith(prefix)) { res.writeHead(404).end(); return }
      const name = decodeURIComponent(path.slice(prefix.length))
      if (name === 'ice') { res.writeHead(200, { 'Content-Type': 'application/json' }).end(fakeIce); return }
      const file = resolve(root, !name || name.endsWith('/') ? name + 'index.html' : name)
      const info = file.startsWith(root + sep) ? await stat(file).catch(() => null) : null
      if (!info?.isFile()) { res.writeHead(404).end(); return }
      res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Content-Length': info.size })
      if (req.method === 'HEAD') { res.end(); return }
      createReadStream(file).on('error', () => res.destroy()).pipe(res)
    } catch {
      if (res.headersSent) res.destroy()
      else res.writeHead(400).end()
    }
  })
  await new Promise((ok, fail) => {
    server.once('error', fail)
    server.listen({ host: '127.0.0.1', port, exclusive: true }, ok)
  })
  return {
    hits,
    publish: (directory) => { root = directory; hits.clear() },
    close: () => new Promise((ok) => { server.close(ok); server.closeAllConnections() }),
  }
}
