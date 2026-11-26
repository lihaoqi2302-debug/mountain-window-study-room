import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { availableParallelism, platform, release } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, devices, expect } from '@playwright/test'
import { createStaticServer } from '../../offline/serve.mjs'
import { makePdf } from './fixture.mjs'

const args = new Set(process.argv.slice(2))
const valid = ['--360', '--390', '--warm20', '--warm-only', '--headed', '--pdf']
assert([...args].every((a) => valid.includes(a)), `Options: ${valid.join(' ')}`)
assert(!(args.has('--360') && args.has('--390')), 'Select one width or omit both for two widths')
assert(!args.has('--warm-only') || (args.has('--360') || args.has('--390')), '--warm-only requires one selected width')
const widths = args.has('--360') ? [360] : args.has('--390') ? [390] : [360, 390]
const evidence = resolve('test-results/round3-b', new Date().toISOString().replace(/[:.]/g, '-'))
await mkdir(evidence, { recursive: true })
const pdf = makePdf()
await writeFile(resolve(evidence, 'round3-synthetic.pdf'), pdf)
console.log(evidence)
if (args.has('--pdf')) process.exit(0)

const port = 5621
const root = resolve('dist-public')
const { commit, revision, packs } = JSON.parse(await readFile(resolve(root, 'release-info.json'), 'utf8'))
const sampler = fileURLToPath(new URL('./sampler.js', import.meta.url))
const launchArgs = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio']
const browser = await chromium.launch({ args: launchArgs, headless: !args.has('--headed') })
let failed = false
try {
  for (const width of widths) {
    const dir = resolve(evidence, String(width))
    await mkdir(dir)
    let server
    let stepId
    const networkCounts = () => ({ pageErrors: 0, consoleErrors: 0, failedRequests: 0, criticalAssetErrors: 0, externalRequests: 0, crashes: 0 })
    let phase = networkCounts()
    const context = await browser.newContext({ ...devices[width === 390 ? 'iPhone 13' : 'Pixel 7'],
      viewport: { width, height: width === 390 ? 844 : 800 }, deviceScaleFactor: 3, defaultBrowserType: undefined })
    await context.addInitScript({ path: sampler })
    context.setDefaultTimeout(25_000)
    const report = { kind: 'Windows desktop Chromium touch simulation; not real hardware',
      browser: browser.version(), os: `${platform()} ${release()}`, logicalProcessorsAvailable: availableParallelism(),
      node: process.version, width, args: launchArgs, headless: !args.has('--headed'), commit, revision, packs,
      power: 'not measured', thermal: 'not observable', realDevice: 'not tested', steps: [] }
    const save = () => writeFile(resolve(dir, 'report.json'), JSON.stringify(report, null, 2) + '\n')
    function observe(page) {
      page.on('pageerror', () => phase.pageErrors++)
      page.on('console', (msg) => { if (msg.type() === 'error') phase.consoleErrors++ })
      const critical = (url) => /\.(?:m?js|wasm|webp|glb|bcmap|pfb)(?:\?|$)/i.test(url)
      page.on('requestfailed', (req) => {
        phase.failedRequests++
        if (critical(req.url()) && req.failure()?.errorText !== 'net::ERR_ABORTED') phase.criticalAssetErrors++
      })
      page.on('response', (res) => { if (res.status() >= 400 && critical(res.url())) phase.criticalAssetErrors++ })
      page.on('crash', () => phase.crashes++)
    }
    context.on('request', (request) => {
      const url = new URL(request.url())
      if (/^https?:$/.test(url.protocol) && url.origin !== `http://127.0.0.1:${port}`) phase.externalRequests++
    })
    const step = async (id, fn) => {
      stepId = id
      const start = performance.now()
      const row = { id, status: 'RUNNING' }
      report.steps.push(row)
      await save()
      try {
        row.details = await fn()
        row.status = row.details?.untested ? 'NOT_TESTED' : 'PASS'
      } catch (err) {
        row.status = 'FAIL'
        // Everything on this isolated origin is a public/synthetic fixture; strip URL query/fragment and control codes anyway.
        row.error = err.message.replace(/(?:\?|#)[^\s"']+(?=[\s"'])/g, (s) => s.startsWith('?') ? '?[redacted]' : s)
          .replace(/\x1b\[[0-9;]*m/g, '')
        failed = true
        if (page && !page.isClosed()) {
          const name = `${id}-failed.png`
          if (await page.screenshot({ path: resolve(dir, name), timeout: 4000 }).then(() => true, () => false)) row.screenshot = name
        }
      }
      row.elapsedMs = Math.round(performance.now() - start)
      console.log(`${width} ${id} ${row.status} ${row.elapsedMs}ms`)
      await save()
      return row.status === 'PASS'
    }
    let page, frame, exploreAt, coldSession
    const snap = () => frame.evaluate(() => window.round3Mobile.snapshot())
    const capture = async () => {
      const name = `${stepId}.png`
      await page.screenshot({ path: resolve(dir, name), timeout: 25_000, scale: 'css' })
      return name
    }
    const poll = (fn, expected) => expect.poll(fn, { timeout: 25_000 }).toEqual(expected)
    const waitState = (mode) => frame.waitForFunction((m) => window.__debug?.app.state.mode === m
      && (m !== 'reading' || !window.__debug.book?.isTurning()), mode, { timeout: 60_000, polling: 200 })
    const tap = (selector) => frame.locator(selector).tap()
    const hud = () => frame.evaluate(() => ({ pages: window.__debug.book.getPages(), zoom: document.querySelector('#readZoomValue').textContent }))
    const sample = async (label) => {
      const s = await frame.evaluate((label) => window.round3Mobile.sample({ label }), label)
      await writeFile(resolve(dir, `${stepId}-sample.json`), JSON.stringify(s, null, 2) + '\n')
      assert.equal(s.status, 'complete')
      assert(s.after.appRenderCallsCompleted > s.before.appRenderCallsCompleted, 'scene render counter did not advance')
      return s
    }
    const open = async () => {
      frame = null
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' })
      const handle = await page.locator('iframe[title="山窗书屋正式场景"]').elementHandle()
      frame = await handle.contentFrame()
      assert(frame, 'scene frame missing')
      await frame.waitForURL((url) => url.pathname.endsWith('/bookstore/'), { waitUntil: 'commit' })
    }
    const movePage = async (selector, delta) => {
      const before = (await hud()).pages.active
      await tap(selector)
      await poll(async () => Math.sign((await hud()).pages.active - before), delta)
      await waitState('reading')
      return (await hud()).pages.active
    }
    try {
      server = await createStaticServer({ root, port })
      page = await context.newPage()
      observe(page)
      if (!await step('01-cold', async () => {
        const start = performance.now()
        await open()
        await waitState('explore')
        exploreAt = performance.now()
        const navigationToExploreMs = Math.round(exploreAt - start)
        const s = await sample('cold')
        coldSession = s.before.timeOrigin
        return { s, navigationToExploreMs, screenshot: await capture() }
      })) continue
      const warm = () => step('07-warm20', async () => {
        if (!args.has('--warm20') && !args.has('--warm-only')) return { untested: 'optional 20-minute simulation omitted; use --warm20 or physical-device card' }
        await waitState('explore')
        const baseline = await snap(), start = performance.now()
        if (baseline.timeOrigin !== coldSession) return { untested: 'scene reloaded since cold sample' }
        await page.waitForTimeout(20 * 60_000)
        const end = await snap()
        if (end.hiddenEvents !== baseline.hiddenEvents || end.timeOrigin !== baseline.timeOrigin || end.visibility !== 'visible'
          || end.mode !== baseline.mode || end.quality !== baseline.quality) {
          return { untested: 'continuous foreground hold interrupted', baseline, end }
        }
        return { baseline, end, elapsedSinceExploreMs: Math.round(performance.now() - exploreAt),
          foregroundHoldMs: Math.round(performance.now() - start), s: await sample('warm20'), screenshot: await capture() }
      })
      if (args.has('--warm-only')) { await warm(); continue }
      await step('02-auto-quality', async () => {
        const s = await snap()
        // The tools menu is opened by a real tap; no JS click/inert overrides.
        await tap('#roomMenu')
        const qualityChoice = await frame.locator('#roomQuality').inputValue()
        await tap('#roomMenu')
        assert.equal(qualityChoice, 'auto')
        assert.equal(s.viewport[0], width)
        assert.equal(s.coarsePointer, true)
        assert.equal(s.quality, 'low')
        assert(s.rendererDpr > 0 && s.rendererDpr <= 1.25)
        return { s, qualityChoice }
      })
      await step('03-touch-viewpoints', async () => {
        const camera = () => frame.evaluate(() => window.__debug.camera.position.toArray())
        const home = await camera()
        await tap('[data-view="hearth"]')
        await waitState('explore')
        const hearth = await camera()
        assert(Math.hypot(hearth[0] - 1, hearth[2] - 2.7) < 0.15, 'hearth viewpoint was not reached')
        const screenshot = await capture()
        await tap('[data-view="shelves"]')
        await expect(frame.locator('#toast')).toContainText('中层五本布面精装书可以拿起')
        await waitState('explore')
        const shelves = await camera()
        assert(Math.hypot(...shelves.map((v, i) => v - hearth[i])) > 0.1, 'shelf viewpoint did not move')
        await tap('[data-view="home"]')
        await frame.waitForFunction((p) => window.__debug.camera.position.distanceTo({ x: p[0], y: p[1], z: p[2] }) < 0.08,
          home, { polling: 200, timeout: 25_000 })
        await waitState('explore')
        return { home, hearth, shelves, returned: await camera(), screenshot }
      })
      await step('04-background-return', async () => {
        // Valid only when visibility actually changes; some headless builds always report visible.
        await waitState('explore')
        const before = await snap()
        const cameraBefore = await frame.evaluate(() => window.__debug.camera.position.toArray())
        const other = await context.newPage()
        let returnedAt
        try {
          await other.bringToFront()
          let hidden = false
          const deadline = performance.now() + 4000
          while (performance.now() < deadline) {
            hidden = await frame.evaluate(() => document.hidden)
            if (hidden) break
            await other.waitForTimeout(200)
          }
          if (!hidden) return { untested: 'Chromium kept the scene visible while the second tab was foregrounded' }
          await other.waitForTimeout(3000)
        } finally {
          returnedAt = performance.now()
          await other.close()
          await page.bringToFront()
        }
        await poll(() => frame.evaluate(() => document.visibilityState), 'visible')
        await waitState('explore')
        const after = await snap()
        assert.equal(after.timeOrigin, before.timeOrigin, 'scene document reloaded after tab return')
        assert(after.hiddenEvents > before.hiddenEvents, 'no hidden event observed by scene')
        const cameraAfter = await frame.evaluate(() => window.__debug.camera.position.toArray())
        assert(Math.hypot(...cameraAfter.map((v, i) => v - cameraBefore[i])) < 0.1, 'viewpoint changed after tab return')
        return { before, after, cameraBefore, cameraAfter, recoveryMs: Math.round(performance.now() - returnedAt), s: await sample('background-return'), screenshot: await capture() }
      })
      await step('05-reading-turns', async () => {
        await tap('[data-view="read"]')
        await waitState('reading')
        const before = await snap(), pages = [(await hud()).pages.active]
        const turns = [['#btnNext', 1], ['#btnNext', 1], ['#btnPrev', -1], ['#btnPrev', -1]]
        for (const [button, delta] of [...turns, ...turns, ...turns]) {
          pages.push(await movePage(button, delta))
        }
        const during = await snap(), screenshot = await capture()
        assert(during.residentPages > 0 && during.residentPages <= 6, 'low-tier page occupancy missing or over 6')
        await tap('#btnCloseBook')
        await waitState('explore')
        return { pages, before, during, closed: await snap(), screenshot }
      })
      await step('06-scenery-reclamation', async () => {
        await waitState('explore')
        const before = await snap()
        await tap('#roomMenu')
        await tap('#btnScenery')
        const states = []
        for (const key of ['aurora', 'forest', 'snow', 'mountain']) {
          await tap(`[data-scenery="${key}"]`)
          await poll(() => frame.evaluate((key) => window.__debug.scenery.current === key && !window.__debug.scenery.changing, key), true)
          await expect(frame.locator(`[data-scenery="${key}"]`)).toHaveAttribute('aria-pressed', 'true')
          const s = await snap()
          assert(s.sceneryCached > 0 && s.sceneryCached <= 2, 'settled scenery occupancy missing or over 2')
          states.push({ key, ...s })
        }
        await tap('#sceneryClose')
        return { before, states, screenshot: await capture() }
      })
      await warm()
      const online = phase
      if (await step('08-save-offline', async () => {
        await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { polling: 200, timeout: 30_000 })
        await tap('#roomMenu')
        await tap('#btnStudyCompanions')
        const controls = page.locator('dialog.formal-controls .offline-controls')
        await controls.getByRole('button', { name: '保存离线版', exact: true }).tap()
        await expect(controls.getByText('已保存离线版', { exact: false })).toBeVisible({ timeout: 75_000 })
        const screenshot = await capture()
        assert.equal(online.externalRequests, 0)
        assert.equal(online.pageErrors + online.crashes, 0)
        return { controller: true, screenshot }
      })) {
        await step('09-offline-reopen-and-pdf', async () => {
          await server.close()
          server = null
          await context.setOffline(true)
          const previous = page
          page = await context.newPage()
          await page.bringToFront()
          observe(page)
          const cdp = await context.newCDPSession(page)
          await cdp.send('Network.enable')
          await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
          await previous.close()
          phase = networkCounts()
          await open()
          await waitState('explore')
          await poll(() => page.evaluate(() => navigator.onLine === false && Boolean(navigator.serviceWorker?.controller)), true)
          await tap('[data-view="read"]')
          await waitState('reading')
          const builtIn = await movePage('#btnNext', 1)
          const [chooser] = await Promise.all([page.waitForEvent('filechooser'), tap('#btnPdf')])
          await chooser.setFiles({ name: 'round3-synthetic.pdf', mimeType: 'application/pdf', buffer: pdf })
          await frame.waitForFunction(() => window.__debug.app.state.pdfMode === true && !window.__debug.app.state.importing
            && window.__debug.app.state.mode === 'reading' && window.__debug.book.pageCount === 6,
          null, { polling: 200, timeout: 90_000 })
          const before = await hud()
          const next = await movePage('#btnNext', 1)
          const previousPage = await movePage('#btnPrev', -1)
          await tap('#btnZoomIn')
          await poll(async () => (await hud()).zoom === before.zoom, false)
          const zoomIn = (await hud()).zoom
          await tap('#btnZoomOut')
          await poll(async () => (await hud()).zoom, before.zoom)
          const screenshot = await capture()
          assert.equal(phase.pageErrors + phase.externalRequests + phase.crashes + phase.criticalAssetErrors, 0)
          return { offlineLayers: ['server stopped', 'context offline', 'CDP network offline'], builtIn, pdfPages: before.pages.count,
            pdfTurns: [before.pages.active, next, previousPage], zoom: [before.zoom, zoomIn, (await hud()).zoom], screenshot }
        })
      } else {
        await step('09-offline-reopen-and-pdf', async () => ({ untested: 'requires successful 08-save-offline' }))
      }
      report.network = { online, offline: phase === online ? null : phase }
      await save()
    } finally {
      await context.close()
      await server?.close()
    }
  }
} finally {
  await browser.close()
}
process.exitCode = failed ? 1 : 0
