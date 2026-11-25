import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const dist = resolve(root, process.env.PUBLIC_OUT ?? 'dist-public')
const prefix = process.env.RELEASE_PREFIX ?? '/round2-release/'
const basePath = prefix.endsWith('/') ? prefix : prefix + '/'
const port = Number(process.env.RELEASE_PORT ?? 5797)
const evidence = resolve(root, process.env.RELEASE_EVIDENCE ?? 'evidence/round2/e-release/windows/07-pages-contract.json')
const invite = '0123456789abcdef0123456789abcdef'
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.wasm': 'application/wasm' }
const started = performance.now()
let server
let browser
const report = { platform: process.platform, node: process.version, prefix: basePath, port, checks: {}, elapsedMs: 0 }

function fileFor(pathname) {
  const relative = decodeURIComponent(pathname.slice(basePath.length)).replaceAll('/', sep)
  const file = resolve(dist, relative.endsWith(sep) || pathname.endsWith('/') ? relative + 'index.html' : relative)
  return file === dist || file.startsWith(dist + sep) ? file : null
}

try {
  server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (!url.pathname.startsWith(basePath)) { res.writeHead(404); res.end('outside prefix'); return }
      const file = fileFor(url.pathname)
      if (!file || !existsSync(file) || !(await stat(file)).isFile()) { res.writeHead(404); res.end('not found'); return }
      res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
      createReadStream(file).pipe(res)
    } catch (error) { res.writeHead(500); res.end(error.message) }
  })
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolveListen)
  })
  const origin = `http://127.0.0.1:${port}${basePath}`
  const home = await fetch(origin)
  assert.equal(home.status, 200)
  assert((await home.text()).includes('<div id="root"></div>'))
  report.checks.subpathIndex = true

  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  await context.addInitScript(() => {
    Object.defineProperty(window, 'RTCPeerConnection', { configurable: true, value: undefined })
  })
  const page = await context.newPage()
  const badResponses = []
  page.on('response', (response) => { if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`) })
  await page.goto(`${origin}?room=${invite}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.room-state[data-state="failed"]', { state: 'attached', timeout: 30_000 })
  assert.match(await page.locator('.room-description').textContent(), /联机需要支持 WebRTC/)
  assert.equal(new URL(page.url()).searchParams.get('room'), invite)
  const frameSrc = await page.locator('iframe[title="山窗书屋正式场景"]').getAttribute('src')
  assert.ok(frameSrc, 'missing bookstore iframe source')
  const frameUrl = new URL(frameSrc, page.url())
  assert.equal(frameUrl.origin, new URL(origin).origin)
  assert.equal(frameUrl.pathname, `${basePath}bookstore/`)
  report.checks.invitePreserved = true
  report.checks.bookstoreSubpath = frameSrc

  await page.goto(`${origin}bookstore/`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.querySelectorAll('#tocPanel .toc-item').length === 34, undefined, { timeout: 60_000 })
  const content = await page.evaluate(() => ({
    pages: window.__ASSETS__.pages,
    edition: window.__ASSETS__.edition,
    record: window.__ASSETS__.record ?? null,
    toc: document.querySelectorAll('#tocPanel .toc-item').length,
    locked: document.querySelectorAll('#tocPanel .toc-item[aria-disabled="true"]').length,
    defaultRecord: Boolean(document.querySelector('#default-record-data')),
  }))
  assert.equal(content.pages.length, 6)
  assert.deepEqual(content.edition, { trial: true, totalPages: 34 })
  assert.equal(content.toc, 34)
  assert.equal(content.locked, 28)
  assert.equal(content.record, null)
  assert.equal(content.defaultRecord, false)
  for (const pagePath of content.pages) {
    const response = await fetch(new URL(pagePath, `${origin}bookstore/`))
    assert.equal(response.status, 200)
    const buffer = await response.arrayBuffer()
    assert(buffer.byteLength > 0)
  }
  report.checks.trialPages = 6
  report.checks.fullDirectory = content.toc
  report.checks.lockedDirectoryEntries = content.locked
  report.checks.defaultRecordFiltered = true
  assert.deepEqual(badResponses, [])
  report.checks.httpErrors = badResponses
  report.ok = true
} catch (error) {
  report.ok = false
  report.error = error.stack ?? String(error)
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  if (server) await new Promise((resolveClose) => server.close(resolveClose))
  report.elapsedMs = Math.round(performance.now() - started)
  report.distSha256 = createHash('sha256').update(await readFile(resolve(dist, 'offline-manifest.json'))).digest('hex')
  await mkdir(dirname(evidence), { recursive: true })
  await writeFile(evidence, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
}
