// 冷/暖缓存性能基线（任务书 P1-5）。只读 dist-public 快照，不改 src。
// 用法：npm run perf:baseline  [-- --runs 5 --profiles none,fast4g --channel chrome]
import { chromium } from '@playwright/test'
import { spawn, execSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, statSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import os from 'node:os'

const root = resolve(import.meta.dirname, '../..')
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback }
const RUNS = Number(arg('runs', 5))
const PROFILES = arg('profiles', 'none,fast4g').split(',')
const CHANNEL = arg('channel', undefined)
const PORT = Number(arg('port', 5197))
const BASE = `http://127.0.0.1:${PORT}/`
const PROTOCOL = 'mountain-window/scene-2'
const THROTTLE = {
  none: null,
  // Chrome DevTools “Fast 4G” 预设 + 4x CPU
  fast4g: { network: { offline: false, latency: 165, downloadThroughput: (9 * 1024 * 1024) / 8 * 0.9, uploadThroughput: (1.5 * 1024 * 1024) / 8 * 0.9 }, cpu: 4 },
}

const src = join(root, 'dist-public')
if (!existsSync(join(src, 'offline-manifest.json'))) {
  console.error('dist-public 不存在：先 $env:BOOKSTORE_SOURCE=(Join-Path (Get-Location) "bookstore-source"); npm run build:public')
  process.exit(1)
}
// 快照，避免其他代理并发重建 dist-public
const snap = join(root, '.perf-dist')
rmSync(snap, { recursive: true, force: true })
cpSync(src, snap, { recursive: true })
const manifest = JSON.parse(readFileSync(join(snap, 'offline-manifest.json'), 'utf8'))

const server = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--mode', 'public',
  '--host', '127.0.0.1', '--port', String(PORT), '--strictPort', '--outDir', snap], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
await new Promise((ok, fail) => {
  const t = setTimeout(() => fail(new Error('preview 启动超时')), 30000)
  const on = (d) => { if (String(d).includes(String(PORT))) { clearTimeout(t); ok() } }
  server.stdout.on('data', on); server.stderr.on('data', on)
  server.on('exit', (c) => fail(new Error('preview 退出 ' + c)))
})

const browser = await chromium.launch({ channel: CHANNEL, args: ['--enable-gpu-rasterization', '--ignore-gpu-blocklist'] })

async function throttle(page, profile) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: false })
  const p = THROTTLE[profile]
  if (p) {
    await cdp.send('Network.emulateNetworkConditions', p.network)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: p.cpu })
  }
  return cdp
}

function track(cdp) {
  const reqs = new Map(); const stat = { requests: 0, bytes: 0, fromCache: 0, fromSW: 0, byUrl: {} }
  cdp.on('Network.requestWillBeSent', (e) => { reqs.set(e.requestId, e.request.url) })
  cdp.on('Network.responseReceived', (e) => {
    stat.requests++
    if (e.response.fromDiskCache || e.response.fromPrefetchCache) stat.fromCache++
    if (e.response.fromServiceWorker) stat.fromSW++
  })
  cdp.on('Network.loadingFinished', (e) => {
    stat.bytes += e.encodedDataLength
    const u = (reqs.get(e.requestId) ?? '').replace(BASE, '/').split('?')[0]
    stat.byUrl[u] = (stat.byUrl[u] ?? 0) + 1
  })
  return stat
}

// 单次采样：首帧 → 场景可操作 → 打开默认书
async function sample(page, profile) {
  const cdp = await throttle(page, profile)
  const net = track(cdp)
  const t0 = Date.now()
  await page.goto(BASE, { waitUntil: 'commit' })
  const frameEl = await page.waitForSelector('iframe', { timeout: 120000 })
  const frame = await frameEl.contentFrame()
  // 可操作：书屋 iframe 内 body[data-entry=ready]（加载遮罩淡出、相机进入 intro）
  await frame.waitForSelector('body[data-entry="ready"]', { state: 'attached', timeout: 180000 })
  const entry = Date.now() - t0
  // 真正可操作：intro 相机动画结束 → mode=explore，#btnRead 解除 inert（open-book 仅在 explore 下生效）
  await frame.waitForFunction(() => { const b = document.querySelector('#btnRead'); return b && !b.inert && !document.querySelector('#roomTools').inert }, null, { timeout: 180000, polling: 50 })
  const ready = Date.now() - t0
  const paint = await page.evaluate(() => Object.fromEntries(performance.getEntriesByType('paint').map((e) => [e.name, e.startTime])))
  const inner = await frame.evaluate(() => ({
    paint: Object.fromEntries(performance.getEntriesByType('paint').map((e) => [e.name, e.startTime])),
    origin: performance.timeOrigin,
  }))
  const outerOrigin = await page.evaluate(() => performance.timeOrigin)
  const sceneFcp = inner.paint['first-contentful-paint'] != null ? inner.paint['first-contentful-paint'] + inner.origin - outerOrigin : null
  // 打开默认书：与 FormalRoom.openBook 相同的 postMessage
  const tb = Date.now()
  await page.evaluate((protocol) => document.querySelector('iframe').contentWindow.postMessage({ protocol, type: 'open-book', id: 'earth-online' }, location.origin), PROTOCOL)
  await frame.waitForSelector('body[data-mode="reading"]', { state: 'attached', timeout: 120000 })
  const openBook = Date.now() - tb
  await page.waitForTimeout(300)
  return { fcp: paint['first-contentful-paint'] ?? null, sceneFcp, entry, ready, openBook, requests: net.requests, bytes: net.bytes, fromCache: net.fromCache, fromSW: net.fromSW, dupes: Object.entries(net.byUrl).filter(([, n]) => n > 1) }
}

async function saveOffline(page) {
  return page.evaluate(async () => {
    const reg = await navigator.serviceWorker.register(new URL('sw.js', document.baseURI), { updateViaCache: 'none' })
    const worker = reg.active ?? (await navigator.serviceWorker.ready).active
    const t = performance.now()
    const result = await new Promise((ok) => { const ch = new MessageChannel(); ch.port1.onmessage = (e) => { if (e.data?.status !== 'saving') ok(e.data) }; worker.postMessage({ type: 'study-offline-save', packs: [] }, [ch.port2]) })
    return { ms: performance.now() - t, result }
  })
}

const stats = (xs) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); if (!v.length) return null; const m = v.length >> 1; return { median: Math.round(v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2), min: Math.round(v[0]), max: Math.round(v.at(-1)), n: v.length } }
const summarize = (rows) => Object.fromEntries(['fcp', 'sceneFcp', 'entry', 'ready', 'openBook', 'requests', 'bytes', 'fromSW'].map((k) => [k, stats(rows.map((r) => r[k]))]))

const out = { date: new Date().toISOString(), runs: RUNS, env: {
  browser: `${browser.browserType().name()} ${browser.version()}${CHANNEL ? ' (' + CHANNEL + ')' : ''}`,
  cpu: os.cpus()[0].model, cores: os.cpus().length, memGB: +(os.totalmem() / 2 ** 30).toFixed(1), os: `${os.type()} ${os.release()}`, node: process.version,
  commit: execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim(),
}, offlineManifest: manifest, profiles: {} }

for (const profile of PROFILES) {
  const cold = [], warmHttp = [], warmSW = []; let save
  for (let i = 0; i < RUNS; i++) {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } })
    const page = await ctx.newPage()
    cold.push(await sample(page, profile))
    warmHttp.push(await sample(page, profile)) // 同 context 二次加载（HTTP 缓存）
    const s = await saveOffline(page); if (i === 0) save = s
    await page.reload({ waitUntil: 'commit' }) // 让 SW 接管
    warmSW.push(await sample(page, profile))
    await ctx.close()
    console.log(profile, i + 1, 'cold', cold.at(-1).ready, 'warm', warmHttp.at(-1).ready, 'sw', warmSW.at(-1).ready)
  }
  out.profiles[profile] = { cold: summarize(cold), warmHttp: summarize(warmHttp), warmSW: summarize(warmSW), offlineSave: save, dupesCold: cold[0].dupes, raw: { cold, warmHttp, warmSW } }
}

await browser.close(); server.kill()
const dir = join(root, 'docs/delegated/evidence/perf'); mkdirSync(dir, { recursive: true })
const file = join(dir, `baseline-${out.date.slice(0, 19).replace(/[:T]/g, '')}.json`)
writeFileSync(file, JSON.stringify(out, null, 2)); writeFileSync(join(dir, 'latest.json'), JSON.stringify(out, null, 2))
console.log(JSON.stringify({ env: out.env, summary: Object.fromEntries(Object.entries(out.profiles).map(([k, v]) => [k, { cold: v.cold, warmHttp: v.warmHttp, warmSW: v.warmSW, save: v.offlineSave }])) }, null, 1))
console.log('写入', file)
rmSync(snap, { recursive: true, force: true })
