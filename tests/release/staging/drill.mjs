// Replays the frozen D candidate and a synthetic upgrade, entirely on loopback.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { dist, fakeIce, hash, makeUpgrade, probe, root, runNode, verifyFrozen } from './artifacts.mjs'
import { base, origin, port, prefix, serve } from './server.mjs'

const results = join(root, 'test-results', 'round3-e')
const started = performance.now()
const report = { ok: false, platform: process.platform, node: process.version, base, realPages: false, steps: [] }
let server, browser, context
const check = expect.configure({ timeout: 30_000 })
const step = async (name, action) => {
  const start = performance.now()
  try {
    const detail = await action()
    const elapsedMs = Math.round(performance.now() - start)
    report.steps.push({ name, ok: true, elapsedMs, detail })
    console.log(`PASS ${name} ${elapsedMs} ms`)
    return detail
  }
  catch (error) {
    report.steps.push({ name, ok: false, elapsedMs: Math.round(performance.now() - start) })
    throw error
  }
}
const button = (scope, name) => scope.getByRole('button', { name, exact: true })
const panel = (page) => page.getByRole('dialog', { name: '山窗共学', exact: true })
const scene = (page) => page.frameLocator('iframe[title="山窗书屋正式场景"]')
const sceneEntry = (page) => button(scene(page), '共学房间')
const close = (page) => button(panel(page), '关闭共学面板')
const controls = (page) => panel(page).locator('.offline-controls')
const ready = async (page) => check(scene(page).locator('body')).toHaveAttribute('data-entry', 'ready', { timeout: 60_000 })

async function readBook(page) {
  await ready(page)
  await check(scene(page).locator('body')).toHaveAttribute('data-mode', 'explore')
  await button(scene(page), '翻开这本书').click()
  const hud = scene(page).locator('#readPage')
  await check(hud).toHaveText(/第 .+ 页 \/ 共 6 页/)
  const before = (await hud.textContent()).trim()
  // Reading progress persists across new tabs. At the last spread, turn backward.
  const next = button(scene(page), '下一页')
  const previous = button(scene(page), '上一页')
  await check.poll(async () => await next.isEnabled() || await previous.isEnabled()).toBe(true)
  const forward = await next.isEnabled()
  await (forward ? next : previous).click()
  await check(hud).not.toHaveText(before)
  await check(hud).toHaveText(/第 .+ 页 \/ 共 6 页/)
  return { before, after: (await hud.textContent()).trim(), direction: forward ? 'next' : 'previous' }
}

const status = (page) => page.evaluate(() => new Promise((resolve, reject) => {
  const controller = navigator.serviceWorker.controller
  if (!controller) return resolve(null)
  const { port1, port2 } = new MessageChannel()
  const timer = setTimeout(() => { port1.close(); reject(new Error('SW status timeout')) }, 5000)
  port1.onmessage = ({ data }) => { clearTimeout(timer); port1.close(); resolve(data) }
  controller.postMessage('study-offline-status', [port2])
}))
async function waitStatus(page, revision, savedRevision, expected) {
  await check.poll(() => status(page)).toMatchObject({ revision, savedRevision, status: expected })
  return status(page)
}
async function updateWorker(page, revision) {
  const served = await fetch(base + 'sw.js', { cache: 'no-store' })
  assert(served.ok)
  assert.equal(served.headers.get('cache-control'), 'no-store')
  assert((await served.text()).startsWith(`const revision = "${revision}";`))
  // Listen before update(), which can resolve while the next worker is still installing.
  const changed = await page.evaluate(async () => {
    const sw = navigator.serviceWorker
    const registration = await sw.getRegistration()
    if (!registration) throw new Error('No registered worker')
    const previous = sw.controller
    let timer, listener
    const claim = new Promise((resolve) => {
      listener = () => resolve(sw.controller !== previous)
      sw.addEventListener('controllerchange', listener)
      timer = setTimeout(() => resolve(false), 15_000)
    })
    try {
      await registration.update()
      return sw.controller !== previous || await claim
    } finally {
      clearTimeout(timer)
      sw.removeEventListener('controllerchange', listener)
    }
  })
  await check.poll(async () => (await status(page))?.revision).toBe(revision)
  return changed
}
async function save(page, name) {
  await button(controls(page), name).click()
  await check(controls(page).locator('p.field-message', { hasText: '已保存离线版' })).toBeVisible({ timeout: 75_000 })
}
const markers = (page) => page.evaluate(async () => {
  const result = []
  for (const key of await caches.keys()) {
    const cache = await caches.open(key)
    const marker = await cache.match(new URL('.offline-ready', location.href))
    if (!marker) throw new Error('Incomplete cache')
    const urls = (await cache.keys()).map((req) => new URL(req.url))
    result.push({ key, ...await marker.json(), entries: urls.length,
      localOnly: urls.every((url) => url.origin === location.origin && url.pathname.startsWith(location.pathname)),
      iceCached: urls.some((url) => /(^|\/)ice(\/|$)/.test(url.pathname)) })
  }
  return result.sort((a, b) => b.updated - a.updated)
})
async function offlineOpen(revision, expectedHash) {
  await context.setOffline(true)
  const page = await context.newPage()
  try {
    const nav = await page.goto(base, { waitUntil: 'domcontentloaded' })
    assert(nav?.ok() && nav.fromServiceWorker(), 'Offline navigation must come from the SW')
    const responsePromise = page.waitForResponse((response) => response.url() === base + probe)
    const body = await page.evaluate(async (path) => {
      const result = await fetch(path, { cache: 'no-store' })
      if (!result.ok) throw new Error('Same-name resource unavailable offline')
      return result.text()
    }, base + probe)
    assert((await responsePromise).fromServiceWorker())
    const sha256 = hash(body)
    assert.equal(sha256, expectedHash)
    const controller = await waitStatus(page, revision, revision, 'saved')
    const reading = await readBook(page)
    return { controller, sameNamePath: prefix + probe, sha256, fromServiceWorker: true, reading }
  } finally { await page.close() }
}

try {
  await mkdir(results, { recursive: true })
  const candidate = await step('frozen-artifact-audit', verifyFrozen)
  const work = await mkdtemp(join(results, 'fixture-'))
  report.fixture = work
  const next = join(work, 'synthetic-upgrade')
  const upgrade = await step('derive-synthetic-upgrade', () => makeUpgrade(next))
  assert.notEqual(upgrade.revision, candidate.revision)
  assert.notEqual(upgrade.probeSha256, candidate.probeSha256)
  await step('local-release-audit-faults', () => {
    const detail = JSON.parse(runNode('scripts/release/local-drill.mjs', ['--old', dist, '--new', next,
      '--work', join(work, 'local-swap'), '--evidence', join(results, 'local-swap.json')]))
    assert.equal(detail.ok, true)
    assert.equal(detail.oldRevision, candidate.revision)
    assert.equal(detail.newRevision, upgrade.revision)
    const published = detail.steps.find(({ name }) => name === 'publish-new-success')
    const faults = detail.steps.filter(({ name }) => name.endsWith('failure-preserves-live'))
    assert.equal(faults.length, 2)
    assert(faults.every((fault) => fault.rejected && fault.liveSha256 === published.sha256))
    return detail
  })

  server = await serve(dist)
  browser = await chromium.launch({ args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'] })
  report.browser = browser.version()
  context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' })
  let externalAttempts = 0, socketAttempts = 0, pageErrors = 0, httpErrors = 0
  context.on('request', (req) => { if (new URL(req.url()).origin !== origin) externalAttempts++ })
  context.on('response', (res) => { if (res.status() >= 400) httpErrors++ })
  context.on('page', (page) => {
    page.on('pageerror', () => pageErrors++)
    page.on('websocket', () => socketAttempts++)
  })
  context.setDefaultTimeout(30_000)
  context.setDefaultNavigationTimeout(60_000)
  const page = await context.newPage()
  await step('project-subpath-direct-entry-and-keyboard-focus', async () => {
    assert.equal((await fetch(origin)).status, 404)
    assert.equal((await fetch(base + 'no-app-fallback')).status, 404)
    assert.equal((await fetch(base + 'sw.js')).headers.get('service-worker-allowed'), null)
    assert.equal((await page.goto(base)).status(), 200)
    await ready(page)
    await check(panel(page)).toBeHidden()
    const iframe = await page.locator('iframe[title="山窗书屋正式场景"]').getAttribute('src')
    assert.equal(new URL(iframe, base).href, base + 'bookstore/')
    const loaded = [...server.hits.keys()]
    assert(loaded.some((path) => path.startsWith(prefix + 'assets/') && path.endsWith('.js')))
    assert(loaded.some((path) => path.startsWith(prefix + 'assets/') && path.endsWith('.css')))
    await check(sceneEntry(page)).toBeVisible()
    await check(scene(page).locator('body')).toHaveAttribute('data-mode', 'explore')
    const tabTrail = []
    for (let i = 0; i < 50; i++) {
      await page.keyboard.press('Tab')
      const focus = await page.evaluate(() => {
        const node = document.activeElement
        return node?.contentDocument?.activeElement?.id || node?.id || node?.tagName
      })
      tabTrail.push(focus)
      if (focus === 'btnStudyCompanions') break
    }
    assert.equal(tabTrail.at(-1), 'btnStudyCompanions', `Unexpected keyboard trail: ${tabTrail.join(', ')}`)
    await check(sceneEntry(page)).toBeFocused()
    await page.keyboard.press('Enter')
    await check(close(page)).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await check(button(panel(page), '本科生速通指南')).toBeFocused()
    await page.keyboard.press('Tab')
    await check(close(page)).toBeFocused()
    await page.keyboard.press('Escape')
    await check(panel(page)).toBeHidden()
    await check(sceneEntry(page)).toBeFocused()
    await page.screenshot({ path: join(results, 'direct-entry.png') })
    return { shell: prefix, iframe: new URL(iframe, base).pathname, root404: true, noFallback: true,
      localChunks: loaded.filter((path) => path.startsWith(prefix + 'assets/')), focusRestored: true }
  })
  await step('invalid-invite-and-reading-recovery', async () => {
    try { await page.goto(base + '?room=fixture-truncated') } catch { throw new Error('Synthetic invalid landing did not load') }
    const invite = page.getByRole('region', { name: '共学邀请', exact: true })
    await check(invite.getByRole('status')).toContainText('邀请链接不完整')
    await check(panel(page)).toBeHidden()
    await button(invite, '查看邀请').press('Enter')
    await check(close(page)).toBeFocused()
    await check(panel(page).locator('.room-state')).toHaveAttribute('data-state', 'failed')
    await check(panel(page).getByText(/邀请链接不完整/)).toBeVisible()
    assert.equal(new URL(page.url()).searchParams.has('room'), false)
    await page.screenshot({ path: join(results, 'invalid-invite.png') })
    await button(panel(page), '返回单机').click()
    await check(panel(page).locator('.room-state')).toHaveAttribute('data-state', 'solo')
    await close(page).click()
    return { error: '邀请链接不完整', focus: '关闭共学面板', queryRemoved: true, reading: await readBook(page) }
  })
  await step('direct-bookstore-and-pdfjs-paths', async () => {
    const direct = page
    assert.equal((await direct.goto(base + 'bookstore/', { waitUntil: 'domcontentloaded', timeout: 60_000 })).status(), 200)
    await check(direct.locator('#tocPanel .toc-item')).toHaveCount(34, { timeout: 60_000 })
    await check(direct.locator('#tocPanel .toc-item[aria-disabled="true"]')).toHaveCount(28)
    const assets = await direct.evaluate(() => ({ pages: window.__ASSETS__.pages,
      record: Boolean(window.__ASSETS__.record || document.querySelector('#default-record-data')) }))
    assert.equal(assets.pages.length, 6)
    assert.equal(assets.record, false)
    for (const url of [...assets.pages.map((path) => new URL(path, direct.url())), ...candidate.pdf.map((path) => new URL(path, base))]) {
      assert(url.href.startsWith(base + 'bookstore/'))
      const response = await fetch(url, { method: 'HEAD' })
      assert(response.ok && Number(response.headers.get('content-length')) > 0)
      if (url.pathname.endsWith('.mjs')) assert.match(response.headers.get('content-type'), /javascript/)
    }
    return { trialPages: 6, fullDirectory: 34, locked: 28, record: false, pdfPaths: candidate.pdf }
  })
  await step('save-frozen-and-check-credential-endpoint-exclusion', async () => {
    await page.goto(base)
    await ready(page)
    await button(scene(page), '共学房间').click()
    const registration = await page.evaluate(async () => {
      const worker = await navigator.serviceWorker.ready
      return { scope: worker.scope, script: worker.active.scriptURL, updateViaCache: worker.updateViaCache }
    })
    assert.deepEqual(registration, { scope: base, script: base + 'sw.js', updateViaCache: 'none' })
    await save(page, '保存离线版')
    const saved = await waitStatus(page, candidate.revision, candidate.revision, 'saved')
    const endpoint = await page.evaluate(async () => (await fetch('./ice', { cache: 'no-store' })).text())
    assert(endpoint === fakeIce, 'Synthetic ICE endpoint unavailable')
    const caches = await markers(page)
    assert.equal(caches.length, 1)
    assert(caches.every(({ localOnly, iceCached }) => localOnly && !iceCached))
    assert.equal(caches[0].bytes, candidate.packs.core.bytes)
    assert.equal(caches[0].entries, candidate.packs.core.files + 1)
    // The shell owns the offline controls. Release the software-rendered scene before opening a fresh tab.
    await page.locator('iframe[title="山窗书屋正式场景"]').evaluate((iframe) => { iframe.src = 'about:blank' })
    return { registration, saved, caches, syntheticIceResponsesCached: 0 }
  })
  await step('upgrade-worker-and-save', async () => {
    server.publish(next)
    const controllerChanged = await updateWorker(page, upgrade.revision)
    const beforeSave = await waitStatus(page, upgrade.revision, candidate.revision, 'update')
    await check(controls(page)).toContainText(`离线版可更新 · ${candidate.revision.slice(0, 6)} → ${upgrade.revision.slice(0, 6)}`)
    await save(page, '更新离线版')
    const afterSave = await waitStatus(page, upgrade.revision, upgrade.revision, 'saved')
    const caches = await markers(page)
    assert.deepEqual(caches.map(({ revision }) => revision), [upgrade.revision, candidate.revision])
    assert.equal(caches[0].bytes, upgrade.coreBytes)
    return { controllerChanged, beforeSave, afterSave, caches }
  })
  await step('new-tab-offline-on-upgrade', () => offlineOpen(upgrade.revision, upgrade.probeSha256))
  await step('rollback-to-retained-frozen-cache', async () => {
    await context.setOffline(false)
    server.publish(dist)
    const controllerChanged = await updateWorker(page, candidate.revision)
    const beforeSave = await waitStatus(page, candidate.revision, upgrade.revision, 'update')
    await check(controls(page)).toContainText(`离线版可更新 · ${upgrade.revision.slice(0, 6)} → ${candidate.revision.slice(0, 6)}`)
    await save(page, '更新离线版')
    const afterSave = await waitStatus(page, candidate.revision, candidate.revision, 'saved')
    const caches = await markers(page)
    assert.deepEqual(caches.map(({ revision }) => revision), [candidate.revision, upgrade.revision])
    assert.deepEqual([...server.hits.keys()], [prefix + 'sw.js'])
    return { controllerChanged, beforeSave, afterSave, caches, serverHits: Object.fromEntries(server.hits), coreRedownloads: 0 }
  })
  await server.close()
  server = undefined
  await step('new-tab-offline-after-rollback-with-server-stopped', () => offlineOpen(candidate.revision, candidate.probeSha256))
  await step('browser-diagnostics', async () => {
    const diagnostics = { externalAttempts, socketAttempts, pageErrors, httpErrors }
    assert.deepEqual(diagnostics, { externalAttempts: 0, socketAttempts: 0, pageErrors: 0, httpErrors: 0 })
    return diagnostics
  })
  report.ok = true
} catch (error) {
  if (server) report.serverHitsOnError = Object.fromEntries(server.hits)
  report.error = String(error.stack ?? error).replace(/([?&]room=)[^\s"'<>]+/g, '$1[redacted]')
  console.error(report.error)
  process.exitCode = 1
} finally {
  await browser?.close()
  await server?.close()
  report.elapsedMs = Math.round(performance.now() - started)
  await writeFile(join(results, 'drill.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(`localhost:${port} ${report.ok ? 'PASS' : 'FAIL'} ${report.elapsedMs} ms`)
}
