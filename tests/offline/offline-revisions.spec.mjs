// P-4：revision 升级 / 下载中断重试 / 同 revision 双标签 / 不同 revision 旧新标签共存。
//
// 这些用例不需要重新构建：revision-variants.mjs 按 vite.config.ts 的 offlineBundle 算法
// 从既有 dist-public 派生出 A/B/C 三份变体（core 包多一个内容不同的文件 → revision 变），
// 等价于「部署了新版本」。
//
// 四个必须写明的夹具口径：
//   1) 「部署切换」= 在同一端口上把静态服务器换成另一份变体根目录。端口不变，
//      否则 origin 变、SW 与缓存都不再属于同一个 scope。
//   2) 浏览器对 SW 脚本的软更新检查有节流（Chrome 最长 24h），直接刷新会引入非确定性。
//      所以这里显式调用 registration.update() —— 它与浏览器软更新做的是同一件事
//      （按 updateViaCache:'none' 重新取 sw.js 并逐字节比较），只是去掉了节流。
//   3) 新 worker 靠 install 里的 skipWaiting() + activate 里的 clients.claim() 接管，
//      所以「部署生效」的判据是 controllerchange。监听器必须在触发更新之前挂上，
//      否则可能错过只发生一次的事件。
//   4) 共学面板一打开就保持打开：离线控件只存在于这个 dialog 里，
//      关掉后 element 仍在 DOM 但不可见，所有可见性断言都会失败。
//
// 前置：npm run build:public
// 运行：npx playwright test -c tests/offline/playwright.config.mjs offline-revisions
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { distDir, revisionsDir } from './fixture-env.mjs'
import {
  cacheInventory, cacheTotals, check, closeCompanion, collect, enterReading, exitReading,
  openOfflineControls, openShell, readHud, readManifest, saveOffline, sceneEval, startServer, waitScene, writeEvidence,
} from './helpers.mjs'
import { makeVariant } from './revision-variants.mjs'

test.describe.configure({ mode: 'serial' })

const variantRoot = resolve(revisionsDir)

/** 已保存的核心包家族（revision / pack / bytes 全部来自各 cache 的 marker）。 */
async function savedCores(page) {
  const inventory = await cacheInventory(page)
  return inventory
    .filter((cache) => cache.marker)
    .map((cache) => {
      const meta = JSON.parse(cache.marker)
      return {
        key: cache.key, entries: cache.entries,
        revision: meta.revision, pack: meta.pack, bytes: meta.bytes, updated: meta.updated,
      }
    })
    .filter((entry) => entry.pack === 'core')
}

/**
 * 让页面感知到「已部署新版本」：挂 controllerchange 计数 → 真实 registration.update()，
 * 若真的下载了新 worker 就等它走进 activated。
 *
 * 为什么不能只等 controller 存在：导航时浏览器自己就会做软更新，controller 在调用前
 * 早就有值，等它等于没等。真正的权威判据是「新 worker 开始应答」——即离线控件里报出的
 * revision，由调用方 poll 文案断言；这里只把「worker 已 activated」这一确定性事件等掉。
 * controllerChanges 仅作旁证（可能在监听器挂上之前就已发生过）。
 */
async function applyDeployment(page) {
  await page.evaluate(() => {
    window.__offlineControllerChanges = 0
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.__offlineControllerChanges += 1
    })
  })
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration()
    if (!registration) throw new Error('页面没有 service worker 注册')
    await registration.update()
    const worker = registration.installing ?? registration.waiting
    if (!worker || worker.state === 'activated') return
    await new Promise((resolve) => {
      worker.addEventListener('statechange', () => {
        if (worker.state === 'activated' || worker.state === 'redundant') resolve()
      })
      // install 里是 skipWaiting、activate 里是 clients.claim，正常情况下必定走到 activated；
      // 万一状态已停在 waiting，也不要把整段卡死在这里（调用方的文案 poll 会给出结论）。
      setTimeout(resolve, 20_000)
    })
  })
  return page.evaluate(() => window.__offlineControllerChanges)
}

/** 打开共学面板并返回离线控件的文案。 */
async function readOfflineText(page) {
  const controls = await openOfflineControls(page)
  return controls.innerText()
}

/** 点离线控件里的按钮，返回控件容器。 */
async function clickOffline(page, pattern, { timeout = 75_000 } = {}) {
  const controls = await openOfflineControls(page)
  const button = controls.locator('button', { hasText: pattern }).first()
  await expect(button).toBeEnabled({ timeout })
  await button.click()
  return controls
}

test('A→B→C：revision 升级只保留当前与上一版核心包', async ({ page }) => {
  const evidence = { console: {}, variants: {}, steps: [] }
  const logs = collect(page)
  let server = await check('NETWORK', '起 A 变体的静态服务器', async () => {
    await rm(variantRoot, { recursive: true, force: true })
    const a = await makeVariant({
      from: distDir, to: resolve(variantRoot, 'A'), label: 'A',
      extra: [{ path: 'acceptance/revision-a.txt', content: 'revision A marker\n' }],
    })
    const b = await makeVariant({
      from: distDir, to: resolve(variantRoot, 'B'), label: 'B',
      extra: [{ path: 'acceptance/revision-b.txt', content: 'revision B marker with a different byte length\n' }],
    })
    const c = await makeVariant({
      from: distDir, to: resolve(variantRoot, 'C'), label: 'C',
      extra: [{ path: 'acceptance/revision-c.txt', content: 'revision C marker with a third size\n' }],
    })
    evidence.variants = {
      revisions: { A: a.revision, B: b.revision, C: c.revision },
      coreBytes: { A: a.coreBytes, B: b.coreBytes, C: c.coreBytes },
    }
    // 三份变体的 revision 必须互不相同，否则这个用例没有意义。
    expect(new Set([a.revision, b.revision, c.revision]).size, 'A/B/C 的 revision 必须不同').toBe(3)
    return startServer({ root: a.dir })
  })

  try {
    await check('UI', '打开外壳', () => openShell(page))
    await check('UI', '书屋进入 explore', () => waitScene(page))

    // ---- A：保存 ----
    await check('STATE', '保存 A 版离线包', async () => {
      await saveOffline(page)
      const text = await readOfflineText(page)
      expect(text, 'A 版应报告已保存').toContain('已保存离线版')
    })
    const afterA = await check('STATE', '读 A 版缓存家族', () => savedCores(page))
    evidence.steps.push({ step: 'A', saved: afterA })
    expect(afterA.length, '应只有 A 一个核心家族').toBe(1)
    expect(afterA[0].revision, '缓存里的 revision 应等于 A').toBe(evidence.variants.revisions.A)
    expect(afterA[0].bytes, 'marker 字节数应等于 A 的 core 体积').toBe(evidence.variants.coreBytes.A)

    // ---- B：部署切换 → 提示可更新 → 保存 ----
    await check('NETWORK', '切换到 B 变体', async () => {
      await server.close()
      server = await startServer({ root: resolve(variantRoot, 'B') })
    })
    const firstChange = await check('STATE', 'B 部署后应接管并提示可更新', async () => {
      const changes = await applyDeployment(page)
      await expect
        .poll(() => readOfflineText(page), { timeout: 30_000 })
        .toContain(`离线版可更新 · ${evidence.variants.revisions.A.slice(0, 6)} → ${evidence.variants.revisions.B.slice(0, 6)}`)
      return changes
    })
    evidence.steps.push({ step: 'B', controllerChanges: firstChange })
    await check('STATE', '保存 B 版离线包', async () => {
      const controls = await clickOffline(page, '更新离线版')
      await expect(controls.locator('progress')).toBeHidden({ timeout: 75_000 })
      await expect(controls.locator('p.field-message', { hasText: '已保存离线版' })).toBeVisible({ timeout: 75_000 })
    })
    const afterB = await check('STATE', '读 A→B 之后的缓存家族', () => savedCores(page))
    evidence.steps.push({ step: 'B-saved', saved: afterB })
    // savePacks 的保留策略：当前 revision + 一个更旧的 core。
    expect(afterB.map((entry) => entry.revision).sort(), '应同时保留 A 与 B')
      .toEqual([evidence.variants.revisions.A, evidence.variants.revisions.B].sort())

    // ---- C：再升一版，A 必须被清掉 ----
    await check('NETWORK', '切换到 C 变体', async () => {
      await server.close()
      server = await startServer({ root: resolve(variantRoot, 'C') })
    })
    await check('STATE', 'C 部署后接管并保存', async () => {
      await applyDeployment(page)
      await expect
        .poll(() => readOfflineText(page), { timeout: 30_000 })
        .toContain(`离线版可更新 · ${evidence.variants.revisions.B.slice(0, 6)} → ${evidence.variants.revisions.C.slice(0, 6)}`)
      const controls = await clickOffline(page, '更新离线版')
      await expect(controls.locator('progress')).toBeHidden({ timeout: 75_000 })
      await expect(controls.locator('p.field-message', { hasText: '已保存离线版' })).toBeVisible({ timeout: 75_000 })
    })
    const afterC = await check('STATE', '读 A→B→C 之后的缓存家族', () => savedCores(page))
    evidence.steps.push({ step: 'C-saved', saved: afterC })
    expect(afterC.map((entry) => entry.revision).sort(), '应只保留 B 与 C')
      .toEqual([evidence.variants.revisions.B, evidence.variants.revisions.C].sort())
    expect(afterC.some((entry) => entry.revision === evidence.variants.revisions.A), 'A 应被清理').toBe(false)
    expect(afterC.find((entry) => entry.revision === evidence.variants.revisions.C)?.bytes, 'C 的字节数应为 C 版 core')
      .toBe(evidence.variants.coreBytes.C)

    // 每个变体目录自带的 offline-manifest.json 也应是同一 revision（构建自洽性核对）。
    evidence.manifests = {
      A: (await readManifest(resolve(variantRoot, 'A'))).revision,
      B: (await readManifest(resolve(variantRoot, 'B'))).revision,
      C: (await readManifest(resolve(variantRoot, 'C'))).revision,
    }
    expect(evidence.manifests, '变体目录的 manifest 应与 sw.js 的 revision 一致').toEqual(evidence.variants.revisions)

    // 三份变体的 core 体积互不相同，说明「字节数变化」确实由新增文件带来。
    expect(new Set(Object.values(evidence.variants.coreBytes)).size, 'A/B/C 的 core 体积应互不相同').toBe(3)

    evidence.console.pageErrors = logs.pageErrors
    expect(logs.pageErrors, 'revision 升级不应产生未捕获异常').toEqual([])
  } finally {
    await server.close().catch(() => {})
    await writeEvidence('p4-revisions.json', evidence)
  }
})

test('下载中断后重试：失败要清干净，重试要能补齐', async ({ page }) => {
  const evidence = { console: {}, attempts: [] }
  const logs = collect(page)
  // 开始保存后持续切断根 index 的下载，让浏览器自动重发也无法绕过故障。
  let blockIndex = false
  let aborted = 0
  const faults = (pathname) => {
    if (blockIndex && pathname === '/index.html') {
      aborted += 1
      return 'abort'
    }
  }
  const server = await check('NETWORK', '起带故障注入的服务器', () => startServer({ faults }))
  try {
    await check('UI', '打开外壳', () => openShell(page))
    await check('UI', '书屋进入 explore', () => waitScene(page))

    blockIndex = true
    await check('STATE', '首次保存应因断连失败', async () => {
      const controls = await clickOffline(page, '保存离线版')
      await expect(controls.locator('p.field-message', { hasText: '操作未完成' })).toBeVisible({ timeout: 120_000 })
      evidence.attempts.push({ attempt: 1, text: await controls.innerText(), aborted })
    })
    blockIndex = false
    expect(aborted, '应拦截至少一次实际下载').toBeGreaterThan(0)
    const failedCores = await check('STATE', '失败后不应留下半成品家族', () => savedCores(page))
    evidence.afterFailure = failedCores
    expect(failedCores, '失败的包必须整份删掉，不能留 marker').toEqual([])
    const failedTotals = await cacheTotals(page)
    evidence.afterFailureTotals = failedTotals
    expect(failedTotals.total, '失败后缓存占用应为 0').toBe(0)

    await check('STATE', '重试应补齐', async () => {
      const controls = await clickOffline(page, '保存离线版', { timeout: 30_000 })
      await expect(controls.locator('progress')).toBeHidden({ timeout: 75_000 })
      await expect(controls.locator('p.field-message', { hasText: '已保存离线版' })).toBeVisible({ timeout: 75_000 })
      evidence.attempts.push({ attempt: 2, text: await controls.innerText() })
    })
    const retried = await check('STATE', '重试后的缓存家族', () => savedCores(page))
    evidence.afterRetry = retried
    expect(retried.length, '重试成功后应恰好一个核心家族').toBe(1)
    expect(retried[0].entries, '家族里应有 marker 与全部资源').toBeGreaterThan(1)
    const manifest = await readManifest()
    expect(retried[0].revision, '重试后的 revision 应等于构建 revision').toBe(manifest.revision)
    expect(retried[0].bytes, 'marker 字节数应等于 core 体积').toBe(manifest.packs.core.bytes)

    evidence.console.pageErrors = logs.pageErrors
    expect(logs.pageErrors, '断连重试不应产生未捕获异常').toEqual([])
  } finally {
    await server.close().catch(() => {})
    await writeEvidence('p4-interrupted-retry.json', evidence)
  }
})

test('同一 revision 双标签同时保存与清理', async ({ page, context }) => {
  const evidence = { console: {}, tabs: [] }
  const logs = collect(page)
  const server = await check('NETWORK', '起静态服务器', () => startServer())
  let second
  try {
    await check('UI', '标签一打开外壳', () => openShell(page))
    await check('UI', '标签一进入 explore', () => waitScene(page))
    await check('UI', '标签一展开离线控件', () => openOfflineControls(page))

    second = await context.newPage()
    const secondLogs = collect(second)
    await check('UI', '标签二打开外壳', () => openShell(second))
    await check('UI', '标签二进入 explore', () => waitScene(second))
    await check('UI', '标签二展开离线控件', () => openOfflineControls(second))

    // 两个标签同时点保存：worker 侧靠 pendingOperation 串行，结果必须是「一份家族」。
    await check('STATE', '双标签同时保存', async () => {
      const pick = async (target) => {
        const handle = await target
          .locator('dialog.formal-controls .offline-controls button', { hasText: /保存离线版|更新离线版/ })
          .first().elementHandle()
        if (!handle) throw new Error('离线控件里没有保存按钮')
        return handle
      }
      const [first, other] = await Promise.all([pick(page), pick(second)])
      // 用 DOM click 而不是 Playwright click：两次点击要真正并发，不能被 action 串行化。
      await Promise.all([
        first.evaluate((button) => button.click()),
        other.evaluate((button) => button.click()),
      ])
    })
    await check('STATE', '两个标签都报告已保存', async () => {
      await expect.poll(() => readOfflineText(page), { timeout: 75_000 }).toContain('已保存离线版')
      await expect.poll(() => readOfflineText(second), { timeout: 75_000 }).toContain('已保存离线版')
    })
    const cores = await check('STATE', '读双标签保存后的家族', () => savedCores(page))
    evidence.tabs.push({ note: '同时保存后', cores })
    expect(cores.length, '并发保存不应产生重复家族').toBe(1)

    // 两个标签读到的 cache 键集合应完全一致（同一个 SW 管同一个 scope）。
    const fromFirst = await page.evaluate(() => caches.keys())
    const fromSecond = await second.evaluate(() => caches.keys())
    evidence.keys = { first: fromFirst.sort(), second: fromSecond.sort() }
    expect(fromSecond.sort(), '两个标签看到的 cache 键应一致').toEqual(fromFirst.sort())

    await check('STATE', '标签一清理离线缓存', async () => {
      const controls = await clickOffline(page, '清理离线缓存')
      await expect(controls.locator('p.field-message', { hasText: '已保存离线版' })).toHaveCount(0, { timeout: 60_000 })
    })
    const cleared = await check('STATE', '清理后两个标签的缓存视图', async () => ({
      first: await page.evaluate(() => caches.keys()),
      second: await second.evaluate(() => caches.keys()),
    }))
    evidence.afterClear = cleared
    expect(cleared.first, '清理后标签一不应再有缓存').toEqual([])
    expect(cleared.second, '清理后标签二不应再有缓存').toEqual([])
    // 标签二的 UI 只在 controllerchange / online / offline 时重查状态，所以它的按钮文案
    // 会短暂滞后——这是设计上的重查时机，不是缺陷；这里只记录，不做断言。
    evidence.secondStaleUi = await readOfflineText(second)

    evidence.console.pageErrors = [...logs.pageErrors, ...secondLogs.pageErrors]
    expect(evidence.console.pageErrors, '双标签操作不应产生未捕获异常').toEqual([])
  } finally {
    await second?.close().catch(() => {})
    await server.close().catch(() => {})
    await writeEvidence('p4-dual-tab.json', evidence)
  }
})

test('不同 revision 旧新标签共存：旧标签状态不被接管破坏，回滚零下载', async ({ page, context }) => {
  const evidence = { console: {}, oldTab: {}, rollback: {} }
  const logs = collect(page)
  let server = await check('NETWORK', '起 A 变体服务器', async () => {
    const a = await makeVariant({
      from: distDir, to: resolve(variantRoot, 'coexist-A'), label: 'coexist-A',
      extra: [{ path: 'acceptance/coexist-a.txt', content: 'coexist A\n' }],
    })
    const b = await makeVariant({
      from: distDir, to: resolve(variantRoot, 'coexist-B'), label: 'coexist-B',
      extra: [{ path: 'acceptance/coexist-b.txt', content: 'coexist B has a different byte length\n' }],
    })
    evidence.revisions = { A: a.revision, B: b.revision }
    expect(a.revision, 'A/B 必须不同').not.toBe(b.revision)
    return startServer({ root: a.dir })
  })
  let fresh

  try {
    await check('UI', '旧标签打开外壳', () => openShell(page))
    await check('UI', '旧标签进入 explore', () => waitScene(page))
    await check('STATE', '旧标签保存 A 版', async () => {
      await saveOffline(page)
    })
    // 保存完就收起共学面板：后面的步骤要真实操作书屋 iframe，
    // 而 showModal 的 dialog 会把同级的 iframe 变成 inert，真实用户也是先关面板再翻书。
    await check('UI', '旧标签收起共学面板', () => closeCompanion(page))

    // 旧标签里造出头绪：阅读进度 + 一张本机便签 + 一个自定义音量。
    const progress = await check('STATE', '旧标签翻页并留下进度', async () => {
      await enterReading(page)
      const before = await readHud(page)
      await sceneEval(page, () => document.querySelector('#btnNext').click())
      await expect.poll(async () => (await readHud(page)).pages.left).toBeGreaterThan(before.pages.left)
      return readHud(page)
    })
    evidence.oldTab.progress = { left: progress.pages.left, page: progress.page, chapter: progress.chapter }

    await check('STATE', '旧标签写一张本机便签', async () => {
      // 便签按钮平时 hidden，点击后由 iframe 发 'notes' 给外壳，弹出章节便签对话框。
      await sceneEval(page, () => {
        const button = document.querySelector('#btnStudyNotes')
        button.hidden = false
        button.inert = false
        button.click()
      })
      const dialog = page.locator('dialog.formal-notes')
      await expect(dialog).toHaveAttribute('open', '', { timeout: 20_000 })
      await dialog.locator('#note-body').fill('旧标签的本机便签 · C 包共存验收')
      await dialog.locator('button[type="submit"]', { hasText: '保存本机' }).click()
      await expect(dialog.locator('ul[aria-label="本机便签"]')).toContainText('C 包共存验收')
      await dialog.locator('button[aria-label="关闭章节便签"]').click()
    })

    // 音量滑块在 public 构建里没有可达 UI（StudyRoom 分支的 AmbientControl 不渲染），
    // 所以这里以「夹具预置 + 断言不被覆写」的方式覆盖持久化，口径写进证据。
    await check('STATE', '预置自定义音量', async () => {
      await page.evaluate(() => {
        const key = 'mountain-window-study-room-v1'
        const parsed = JSON.parse(localStorage.getItem(key) ?? '{"state":{},"version":0}')
        parsed.state.volume = 0.62
        localStorage.setItem(key, JSON.stringify(parsed))
      })
    })
    const persistedBefore = await page.evaluate(() => {
      const parsed = JSON.parse(localStorage.getItem('mountain-window-study-room-v1') ?? '{"state":{}}')
      return { notes: (parsed.state.localNotes ?? []).length, volume: parsed.state.volume ?? null }
    })
    evidence.oldTab.persistedBefore = persistedBefore
    expect(persistedBefore.notes, '便签应已持久化').toBe(1)
    expect(persistedBefore.volume, '音量应已持久化').toBeCloseTo(0.62, 2)

    // ---- 部署 B，新标签接管并保存；旧标签保持原状 ----
    await check('NETWORK', '切换到共存 B 变体', async () => {
      await server.close()
      server = await startServer({ root: resolve(variantRoot, 'coexist-B') })
    })
    await check('STATE', '新标签感知新 revision 并保存', async () => {
      fresh = await context.newPage()
      collect(fresh)
      await openShell(fresh)
      await waitScene(fresh)
      await applyDeployment(fresh)
      await expect
        .poll(() => readOfflineText(fresh), { timeout: 30_000 })
        .toContain(`离线版可更新 · ${evidence.revisions.A.slice(0, 6)} → ${evidence.revisions.B.slice(0, 6)}`)
      const controls = await clickOffline(fresh, '更新离线版')
      await expect(controls.locator('progress')).toBeHidden({ timeout: 75_000 })
      await expect(controls.locator('p.field-message', { hasText: '已保存离线版' })).toBeVisible({ timeout: 75_000 })
    })
    const cores = await check('STATE', '新旧 revision 家族并存', () => savedCores(fresh))
    evidence.coexist = cores
    expect(cores.map((entry) => entry.revision).sort(), 'A 与 B 的核心包应同时存在')
      .toEqual([evidence.revisions.A, evidence.revisions.B].sort())

    // 旧标签：页面仍是 A 版资源装出来的 DOM，进度 / 便签 / 音量都不该被新 worker 影响。
    const oldTab = await check('STATE', '旧标签状态保持不变', async () => {
      const hud = await readHud(page)
      const prefs = await page.evaluate(() => {
        const parsed = JSON.parse(localStorage.getItem('mountain-window-study-room-v1') ?? '{"state":{}}')
        return { volume: parsed.state.volume ?? null, notes: (parsed.state.localNotes ?? []).length }
      })
      return { hud, prefs }
    })
    evidence.oldTab.after = oldTab
    expect(oldTab.hud.pages.left, '旧标签阅读进度不应被重置').toBe(evidence.oldTab.progress.left)
    expect(oldTab.hud.pdfMode, '旧标签仍在读内置书').toBe(false)
    expect(oldTab.prefs.notes, '旧标签便签不应丢失').toBe(1)
    expect(oldTab.prefs.volume, '音量不应被新 revision 覆写').toBeCloseTo(0.62, 2)

    await check('STATE', '旧标签仍可翻页', async () => {
      await sceneEval(page, () => document.querySelector('#btnNext').click())
      await expect.poll(async () => (await readHud(page)).pages.left).toBeGreaterThan(evidence.oldTab.progress.left)
    })
    await check('UI', '旧标签退出阅读', () => exitReading(page))

    // ---- 回滚：把部署切回 A。A 的核心包还在，所以恢复应是零下载的瞬时动作 ----
    await check('NETWORK', '回滚到 A 变体', async () => {
      await server.close()
      server = await startServer({ root: resolve(variantRoot, 'coexist-A') })
    })
    await check('STATE', '回滚后旧标签的控制器换成 A 版 worker', async () => {
      const changes = await applyDeployment(page)
      evidence.rollback.controllerChanges = changes
      const script = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null)
      evidence.rollback.controller = script
      expect(script, 'controller 应仍指向本站的 sw.js').toContain('/sw.js')
    })
    const text = await check('STATE', '回滚后的离线控件文案', () => readOfflineText(page))
    evidence.rollback.text = text
    // 控制器换成 A 的 sw.js，而已保存的核心包是 B，所以先显示「B → A」的可更新提示。
    expect(text, '回滚后应提示可回到 A').toContain('离线版可更新')
    expect(text, '提示里应出现 A 的 revision 前缀').toContain(evidence.revisions.A.slice(0, 6))

    await check('STATE', '点更新后应采用旧缓存并退出可更新状态', async () => {
      const controls = await clickOffline(page, '更新离线版', { timeout: 30_000 })
      await expect(controls.getByRole('button', { name: '更新离线版' })).toHaveCount(0)
      await expect(controls.locator('p.field-message', { hasText: '已保存离线版' })).toBeVisible()
      evidence.rollback.afterClick = await readOfflineText(page)
    })

    // 回滚期间新服务器被访问到的全部路径（这台服务器是回滚时才起的，所以都是回滚之后）。
    const served = [...server.hits].map(([path, count]) => ({ path, count }))
    evidence.rollback.served = served
    const refetchedCore = served.filter(({ path }) => path.startsWith('/assets/'))
    expect(refetchedCore, '回滚不应重新下载 assets/ 里的核心资源').toEqual([])

    const afterRollback = await check('STATE', '回滚后的家族', () => savedCores(page))
    evidence.afterRollback = afterRollback
    expect(afterRollback.map((entry) => entry.revision).sort(), '回滚后 A、B 都应在')
      .toEqual([evidence.revisions.A, evidence.revisions.B].sort())

    evidence.console.pageErrors = logs.pageErrors
    expect(logs.pageErrors, '共存场景不应产生未捕获异常').toEqual([])
  } finally {
    await fresh?.close().catch(() => {})
    await server.close().catch(() => {})
    await writeEvidence('p4-coexist-rollback.json', evidence)
  }
})

test('回滚到已缓存的旧 revision 后离线读取正确版本', async ({ page, context }) => {
  const evidence = { console: {} }
  const logs = collect(page)
  let server = await check('NETWORK', '起 A 变体服务器', async () => {
    const a = await makeVariant({
      from: distDir, to: resolve(variantRoot, 'dk1-A'), label: 'dk1-A',
      extra: [{ path: 'acceptance/dk1.txt', content: 'dk1 A\n' }],
    })
    const b = await makeVariant({
      from: distDir, to: resolve(variantRoot, 'dk1-B'), label: 'dk1-B',
      extra: [{ path: 'acceptance/dk1.txt', content: 'dk1 B longer content\n' }],
    })
    evidence.revisions = { A: a.revision, B: b.revision }
    expect(a.revision, 'A/B 必须不同').not.toBe(b.revision)
    return startServer({ root: a.dir })
  })

  try {
    await check('UI', '打开外壳', () => openShell(page))
    await check('UI', '书屋进入 explore', () => waitScene(page))
    await check('STATE', '保存 A 版', () => saveOffline(page))

    await check('NETWORK', '升级到 B 并保存', async () => {
      await server.close()
      server = await startServer({ root: resolve(variantRoot, 'dk1-B') })
      await applyDeployment(page)
      await expect.poll(() => readOfflineText(page), { timeout: 30_000 })
        .toContain(`离线版可更新 · ${evidence.revisions.A.slice(0, 6)} → ${evidence.revisions.B.slice(0, 6)}`)
      const controls = await clickOffline(page, '更新离线版')
      await expect(controls.locator('progress')).toBeHidden({ timeout: 75_000 })
      await expect(controls.locator('p.field-message', { hasText: '已保存离线版' })).toBeVisible({ timeout: 75_000 })
    })
    const beforeRollback = await check('STATE', '升级后家族', () => savedCores(page))
    evidence.beforeRollback = beforeRollback
    expect(beforeRollback.map((entry) => entry.revision).sort(), '升级后应保留 A 与 B')
      .toEqual([evidence.revisions.A, evidence.revisions.B].sort())

    await check('NETWORK', '回滚到 A', async () => {
      await server.close()
      server = await startServer({ root: resolve(variantRoot, 'dk1-A') })
      await applyDeployment(page)
    })
    await check('STATE', '回滚后点更新并确认回到已保存', async () => {
      const controls = await clickOffline(page, '更新离线版', { timeout: 30_000 })
      await expect(controls.getByRole('button', { name: '更新离线版' })).toHaveCount(0)
      await expect(controls.locator('p.field-message', { hasText: '已保存离线版' })).toBeVisible()
      evidence.rollbackText = await controls.innerText()
    })
    const after = await check('STATE', '回滚后家族', () => savedCores(page))
    evidence.afterRollback = after
    expect(after.map((entry) => entry.revision).sort()).toEqual([evidence.revisions.A, evidence.revisions.B].sort())
    evidence.served = [...server.hits.keys()]
    expect(evidence.served.filter((path) => path !== '/sw.js')).toEqual([])
    await server.close()
    await context.setOffline(true)
    const offlineText = await page.evaluate(async () => {
      const response = await fetch('./acceptance/dk1.txt')
      if (!response.ok) throw new Error('回滚后的缓存资源不可用')
      return response.text()
    })
    evidence.offlineText = offlineText
    expect(offlineText).toBe('dk1 A\n')
    evidence.console.pageErrors = logs.pageErrors
    expect(logs.pageErrors, '取证过程不应产生未捕获异常').toEqual([])
  } finally {
    await server.close().catch(() => {})
    await writeEvidence('p4-dk1-rollback.json', evidence)
  }
})
