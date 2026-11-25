// P-1：真实浏览器路径下的「保存离线版 → 彻底断网 → 新标签重开 → 翻内置书」闭环。
//
// 口径要点：
//   - 断网是三层叠加（服务器关闭 + context.setOffline + CDP emulateNetworkConditions），
//     只关服务器时 SW 仍可能从浏览器 HTTP 缓存取到东西，不算断干净。
//   - 重开用「新标签页」而不是 reload：用户关掉浏览器再打开就是新标签，
//     这样才能证明缓存落在 CacheStorage 而不是页面内存。
//   - 零 CDN 是硬指标：外域被 --host-resolver-rules 一律解析失败，
//     任何一条外域请求都会以 requestfailed 出现，必须为空。
//
// 为什么要拆成 3 个 test（serial，同 context 共享 CacheStorage / SW）：
//   整段配置 timeout 是 90 s，而「冷启动 ~43 s + 保存 12.8 MB ~10 s +
//   联网读书 + 断网重开 + 离线翻页」串成一个用例稳定超时。超时会把真实根因
//   （早前是「保存没点按钮」）埋在「段超时」里。拆开后每段都远短于段限。
//   serial 模式让后一段继承前一段留下的 SW 与缓存，闭环语义不变。
//
// 前置：dist-public 已存在（优先复用，见 docs §0.1 校验口径）
// 运行：npx playwright test -c tests/offline/playwright.config.mjs offline-core
import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import {
  cacheTotals, check, collect, disconnect, enterReading, exitReading, expectSaved,
  openShell, pressInScene, readHud, saveOffline, sceneEval, startServer, waitControlled,
  waitScene, writeEvidence,
} from './helpers.mjs'
import { evidenceDir, fromRoot, isCDN } from './fixture-env.mjs'

// serial：本文件内的用例按声明顺序执行，且共享同一个 page/context，
// 因此「保存 → 断网 → 重开」的先后关系由测试引擎保证，而不是靠单个大用例串起来。
test.describe.configure({ mode: 'serial' })

const foreignRequests = (records) => records.filter(({ url }) => {
  if (url.startsWith('data:') || url.startsWith('blob:')) return false
  try { return new URL(url).hostname !== '127.0.0.1' } catch { return true }
})

/**
 * 第 1 段：联网冷启动 + 走界面保存 + 联网读一遍内置书建立基线。
 *
 * 显式放宽到 150 s：本段要做「冷启动（~43 s）+ 保存 12.8 MB（~10 s）+
 * 联网进阅读模式并翻页（书屋首帧 + 书页纹理，~15 s）」，配置默认 90 s 太紧，
 * 实测约 72 s 但余量不足，抖动就会超时。放宽只作用于本用例。
 */
test('联网：冷启动、保存离线版、内置书基线', async ({ page }) => {
  test.setTimeout(150_000)
  const evidence = { stage: {}, caches: {}, network: {}, console: {} }
  const logs = collect(page)
  const server = await check('NETWORK', '起 dist-public 静态服务器', () => startServer())

  try {
    // ---- 1. 联网冷启动：外壳 + 书屋 + 控制器就位 ----
    await check('UI', '打开外壳', () => openShell(page))
    await check('UI', '书屋进入 explore', () => waitScene(page))
    await check('NETWORK', 'service worker 接管页面', () => waitControlled(page))
    evidence.stage.online = {
      url: page.url(),
      controller: await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null),
      hits: server.hits.size,
    }

    // ---- 2. 走界面保存离线版（saveOffline 会真的点按钮并等「已保存」） ----
    const saved = await check('STATE', '点击保存离线版并等到已保存', () => saveOffline(page))
    evidence.stage.saved = { text: saved.text, reportedBytes: saved.bytes }
    await page.locator('dialog.formal-controls button[aria-label="关闭共学面板"]').click()

    // ---- 3. 联网状态下读一遍内置书，确认基线可用 ----
    await check('UI', '联网进入阅读模式', () => enterReading(page))
    const onlineHud = await check('UI', '读取联网时的阅读 HUD', () => readHud(page))
    expect(onlineHud.pdfMode, '内置书不应处于 PDF 模式').toBe(false)
    expect(onlineHud.pages.count).toBeGreaterThan(0)
    expect(onlineHud.page).toContain(`共 ${onlineHud.pages.count} 页`)
    expect(onlineHud.chapterNavHidden, '内置书要显示章节导航').toBe(false)
    await check('UI', '联网翻到下一页', async () => {
      await pressInScene(page, '#btnNext')
      await expect.poll(() => sceneEval(page, () => window.__debug.book.getPages().active))
        .toBeGreaterThan(onlineHud.pages.active)
    })
    evidence.reading = { online: await readHud(page), onlineBaseline: onlineHud }
    await check('UI', '退出阅读', () => exitReading(page))

    // 读完一遍再记缓存读数，避免把「还没下载的书页」算进基线。
    await page.waitForTimeout(1_000)
    const warmCaches = await check('STATE', '读联网后的缓存清点', () => cacheTotals(page))
    evidence.caches.online = warmCaches
    expect(warmCaches.total).toBeGreaterThan(0)
    expect(server.hits.size).toBeGreaterThan(0)

    // ---- 4. 联网阶段同样不允许外域与 CDN ----
    evidence.console.onlinePageErrors = logs.pageErrors
    evidence.console.onlineErrors = logs.consoleErrors
    evidence.network.onlineCdn = logs.cdn
    evidence.network.onlineFailed = logs.failed
    expect(logs.cdn.filter(({ url }) => isCDN(url)), '联网阶段不应依赖 CDN').toEqual([])
    expect(logs.pageErrors, '联网阶段不应有未捕获异常').toEqual([])
  } finally {
    await server.close().catch(() => {})
    await writeEvidence('p1a-online-save.json', evidence)
  }
})

/**
 * 断网态打开外壳。
 *
 * 这里**不能**用 `page.waitForFunction` 等 iframe：它默认用 requestAnimationFrame 轮询，
 * 而 `context.newPage()` 打开的标签在 headless Chromium 里是后台标签，raf 会被浏览器
 * 节流/暂停，检查函数因此永远不执行 —— 表现为「等 20 s 超时，但快照里 iframe 明明在」。
 * 实测：同一路径用 evaluate 轮询时 iframe 在 1.3 s 内就出现。
 * 所以这里用 Playwright 主进程驱动的 evaluate 轮询（不受 raf 节流影响）。
 *
 * @returns {Promise<{ attempts: number, iframeAt: number, bodyText: string | null }>}
 */
async function openShellOffline(page, { perAttempt = 20_000, interval = 250 } = {}) {
  const started = Date.now()
  let lastBody = null
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await page.goto('./', { waitUntil: 'domcontentloaded', timeout: perAttempt })
    const deadline = Date.now() + perAttempt
    while (Date.now() < deadline) {
      const probe = await page.evaluate(() => ({
        hasIframe: Boolean(document.querySelector('iframe[title="山窗书屋正式场景"]')),
        bodyText: document.body?.innerText?.slice(0, 120) ?? null,
      })).catch(() => ({ hasIframe: false, bodyText: null }))
      lastBody = probe.bodyText
      if (probe.hasIframe) return { attempts: attempt, iframeAt: Date.now() - started, bodyText: probe.bodyText }
      await page.waitForTimeout(interval)
    }
    // 第一次没起来：留在原页重载，让已激活的 SW 接管这一次导航。
  }
  throw new Error(`断网态外壳重载两次仍未渲染 iframe（每次限时 ${perAttempt} ms，最后 body="${lastBody ?? ''}"）`)
}

/**
 * 第 2 段：彻底断网 → 新标签重开 → 断网翻内置书 → 零外域零 CDN。
 *
 * === 归因（已由探测定性，见 docs §3.1 与 p1c-main-thread-stall.json）===
 *
 * 早前这一段反复超时，先后误判为「后台标签 raf 节流」与「渲染进程死锁」，**都不对**。
 * 真因是这台无 GPU 验收机上 SwiftShader 软渲染的性能抖动：断网重开后对渲染进程做
 * 存活探测（evaluate(() => 1+1)），单次往返在 7 ms ~ 128,715 ms 之间波动，但**每次都成功**，
 * 且 failed=[] 、pageErrors=[]。即：进程活着、逻辑没错、请求没丢，只是慢得没谱。
 *
 * 因此本段的超时按实测抖动上限给到 300 s，而不是靠继续调小等待或加重载兜底。
 * 短超时下的表现会像「元素明明可见却等不到」—— 那不是判定写错，是主线程还没答复。
 *
 * 未测：真机 / 真实 GPU 下是否同样抖动（本包无 GPU 机器，无法定性）。
 */
test('断网：新标签重开并翻内置书', async ({ page, context }) => {
  // 300 s 的依据是实测抖动上限，不是拍脑袋：断网重开后对渲染进程做存活探测
  // （evaluate(() => 1+1)）得到 37 ms / 54,684 ms / 2,695 ms / 128,715 ms / 19,893 ms / 7 ms，
  // 单次往返最高约 129 秒。所以本段必须给到 300 s 才有稳定余量。
  // 详见 docs/delegated/round2/c-p1-offline-reopen-unresolved.md §3.1 与
  // evidence/round2/c-offline/p1c-main-thread-stall.json。
  test.setTimeout(300_000)
  const evidence = { network: {}, console: {}, reading: {}, caches: {} }
  const server = await check('NETWORK', '起 dist-public 静态服务器', () => startServer())
  let reopened

  try {
    // ---- 预置：冷启动 + 保存 ----
    // 必须先 waitScene：保存要打开共学面板，而 #btnStudyCompanions 在书屋引导结束
    // （body[data-entry=ready] 且 mode=explore）之后才可点。省掉这一步会让 openCompanion
    // 干等 20 s 然后报「找不到共学按钮」—— 这也是早前「保存失败」的真实原因之一。
    await check('UI', '打开外壳', () => openShell(page))
    await check('UI', '书屋进入 explore', () => waitScene(page))
    await check('NETWORK', 'service worker 接管页面', () => waitControlled(page))
    const saved = await check('STATE', '保存离线版', () => saveOffline(page))
    evidence.preSaved = { text: saved.text, reportedBytes: saved.bytes }
    await page.locator('dialog.formal-controls button[aria-label="关闭共学面板"]').click()

    const warmCaches = await check('STATE', '断网前缓存清点', () => cacheTotals(page))
    evidence.caches.beforeOffline = warmCaches
    expect(warmCaches.entries, '保存后应有大量缓存条目').toBeGreaterThan(10)

    // ---- 联网基线：**复用第 1 段的实测基线**，本段不再重跑 ----
    // enterReading 在本夹具上要 ~30 s（书屋首帧 + 书页纹理），本段预算已经很紧，
    // 联网基线本来也不需要在本段重测 —— 它和第 1 段测的是同一个联网态。
    // 这里读第 1 段落盘的证据；缺失时如实记「未取到基线」并跳过跨态对比，
    // 不静默编一个基线出来。
    evidence.reading.onlineBaseline = await check('STATE', '读第 1 段的联网基线', async () => {
      try {
        const raw = await readFile(fromRoot(`${evidenceDir}/p1a-online-save.json`), 'utf8')
        const parsed = JSON.parse(raw)
        return { source: 'p1a-online-save.json', hud: parsed.reading?.onlineBaseline ?? null }
      } catch (error) {
        return { source: 'missing', hud: null, note: `未取到第 1 段基线：${String(error).slice(0, 120)}` }
      }
    })
    const onlineHud = evidence.reading.onlineBaseline.hud
    if (!onlineHud) console.warn('[P-1] 缺第 1 段联网基线，跨态页数对比将跳过')

    const restore = await check('NETWORK', '三层断网', () => disconnect(page, server))

    try {
      // ---- 断网后开新标签重开 ----
      reopened = await context.newPage()
      const reopenedLogs = collect(reopened)
      const opened = await check('NETWORK', '断网重开外壳', () => openShellOffline(reopened))
      evidence.reopen = opened
      await check('UI', '断网重开书屋进入 explore', () => waitScene(reopened, { timeout: 35_000 }))
      await check('NETWORK', '断网重开仍由 SW 接管', () => waitControlled(reopened, { timeout: 15_000 }))

      // 离线控件报告「已保存」是缓存真的在 CacheStorage 里的直接证据。
      const reopenedSaved = await check('STATE', '断网后离线控件报告已保存', () => expectSaved(reopened, { timeout: 20_000 }))
      expect(await reopenedSaved.innerText()).toContain('已保存离线版')
      await reopened.locator('dialog.formal-controls button[aria-label="关闭共学面板"]').click()

      // ---- 断网后翻内置书 ----
      await check('UI', '断网进入阅读模式', () => enterReading(reopened, { timeout: 45_000 }))
      const offlineHud = await check('UI', '断网读取阅读 HUD', () => readHud(reopened))
      expect(offlineHud.pdfMode, '内置书不应进入 PDF 模式').toBe(false)
      expect(offlineHud.pages.count, '断网后总页数应为 6（与联网一致）').toBe(6)
      expect(offlineHud.page, '断网后页码文案应为第 01–02 页 / 共 6 页').toContain('共 6 页')
      if (onlineHud) {
        // 跨态对比：有第 1 段基线时才做，缺失时上面两条本段自足断言已经兜底。
        expect(offlineHud.pages.count, '断网后总页数应与联网基线一致').toBe(onlineHud.pages.count)
        expect(offlineHud.page, '断网后页码文案应与联网基线一致').toBe(onlineHud.page)
      }
      evidence.reading.offlineBaseline = offlineHud

      const reader = reopened.frameLocator('iframe[title="山窗书屋正式场景"]')
      const settledPage = () => sceneEval(reopened, () => ({
        active: window.__debug.book.getPages().active,
        turning: window.__debug.book.isTurning(),
      }))
      await expect.poll(settledPage, { timeout: 15_000 }).toEqual({ active: 0, turning: false })
      evidence.reading.pageSequence = [0]
      for (const [selector, active] of [['#btnNext', 2], ['#btnNext', 4], ['#btnPrev', 2]]) {
        await check('UI', `断网翻至页组 ${active}`, async () => {
          await reader.locator(selector).click()
          await expect.poll(settledPage, { timeout: 15_000 }).toEqual({ active, turning: false })
          evidence.reading.pageSequence.push(active)
        })
      }
      const turned = await readHud(reopened)
      evidence.reading.offlineTurned = turned
      // 页码指示必须跟着书页走，否则「能翻页但 HUD 不同步」也是缺陷。
      expect(turned.pageNow, '翻页后页码指示应随之变化').not.toBe(offlineHud.pageNow)
      expect(turned.page).toContain(`共 ${offlineHud.pages.count} 页`)

      // ---- 断网期间零外域、零 CDN ----
      const foreign = foreignRequests(reopenedLogs.requests)
      evidence.network.offlineForeign = foreign
      evidence.network.offlineCdn = reopenedLogs.cdn
      evidence.network.offlineFailed = reopenedLogs.failed
      evidence.console.offlinePageErrors = reopenedLogs.pageErrors
      evidence.console.offlineErrors = reopenedLogs.consoleErrors
      expect(reopenedLogs.cdn, '断网期间不应出现任何 CDN 请求').toEqual([])
      expect(foreign, '断网期间不应出现任何外域请求').toEqual([])
      expect(reopenedLogs.pageErrors, '断网期间不应有未捕获异常').toEqual([])

      const offlineCaches = await check('STATE', '读断网后的缓存清点', () => cacheTotals(reopened))
      evidence.caches.offline = offlineCaches
      // 断网期间不应新建或丢失缓存家族：键集合与断网前完全一致。
      expect([...offlineCaches.keys].sort(), '断网前后的缓存家族键应完全一致')
        .toEqual([...warmCaches.keys].sort())
    } finally {
      // 超时后 context 可能已被 Playwright 关掉，恢复步骤要能在这种情况下走完，
      // 否则 finally 抛出的次级错误会盖掉真正的失败原因。
      const revived = await restore().catch((error) => ({ url: null, hits: new Map(), close: async () => {}, restoreError: String(error).slice(0, 200) }))
      evidence.network.restored = { url: revived.url, hits: revived.hits.size, error: revived.restoreError ?? null }
      await revived.close().catch(() => {})
    }
  } finally {
    await reopened?.close().catch(() => {})
    await server.close().catch(() => {})
    await writeEvidence('p1b-offline-reopen.json', evidence)
  }
})
