// P-7：触屏口径的离线闭环（Playwright 模拟移动端，**不是真机**）。
//
// 口径声明（会原样写进证据，别在文档里改口）：
//   - 这是 Chromium 的移动端模拟：viewport 390×844、dSF 3、hasTouch、iPhone 13 UA。
//   - 它验证的是「触屏事件路径与窄视口布局下功能是否仍然可达」，
//     **不**验证 iOS Safari / Android Chrome 的真实实现差异，也不验证真实触屏精度、
//     软键盘遮挡、系统「减少动态效果」等真机条件。真机一律记为未测。
//   - 触屏 project 只跑本文件（playwright.config.mjs 的 testMatch）。
//
// 前置：npm run build:public
// 运行：npx playwright test -c tests/offline/playwright.config.mjs touch-offline
import { expect, test } from '@playwright/test'
import {
  cacheTotals, check, closeCompanion, collect, disconnect, enterReading, exitReading,
  expectSaved, importPdf, openShell, pdfPath, pressInScene, readHud, saveOffline, sceneEval, startServer,
  waitControlled, waitScene, writeEvidence,
} from './helpers.mjs'

test.describe.configure({ mode: 'serial' })

test('触屏模拟：离线保存、断网重开、导入中文 PDF、缩放翻页', async ({ page, context }) => {
  const evidence = {
    console: {},
    condition: {
      kind: 'Chromium 移动端模拟（非真机）',
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      hasTouch: true,
      isMobile: true,
      userAgent: 'iPhone 13（Playwright devices 表）',
      realDevice: '未测',
      note: '只覆盖触屏事件路径与窄视口可达性，不代表 iOS Safari / Android Chrome 的真机行为',
    },
  }
  const logs = collect(page)
  const server = await check('NETWORK', '起静态服务器', () => startServer())
  let restore

  try {
    await check('UI', '触屏打开外壳', () => openShell(page))
    await check('UI', '书屋进入 explore', () => waitScene(page))
    await check('NETWORK', 'service worker 接管', () => waitControlled(page))

    // 窄视口下离线控件仍必须可达：共学按钮在 #roomTools 里，
    // 触屏布局可能把它收进折叠菜单，所以这里走的是和桌面完全相同的真实点击路径。
    const saved = await check('STATE', '触屏保存离线版', async () => {
      const offline = await saveOffline(page)
      evidence.savedText = offline.text
      await closeCompanion(page)
      return cacheTotals(page)
    })
    evidence.caches = saved
    expect(saved.total, '触屏保存后应有缓存占用').toBeGreaterThan(0)
    expect(saved.entries, '触屏保存后条目数应远大于 1').toBeGreaterThan(10)

    // 触屏下翻内置书：先走一次真实的 tap（覆盖触屏事件路径），失败再退回 DOM click。
    // 窄视口下按钮可能被浮层挡住，所以这里不把 tap 成功当成硬断言，功能可达才是判据。
    const onlineHud = await check('UI', '触屏进入阅读并翻页', async () => {
      await enterReading(page)
      const before = await readHud(page)
      const frame = page.frames().find((item) => item.url().includes('/bookstore/'))
      const tapped = await frame.locator('#btnNext').tap({ force: true }).then(() => true).catch(() => false)
      if (!tapped) await pressInScene(page, '#btnNext')
      await expect.poll(async () => (await readHud(page)).pages.active).toBeGreaterThan(before.pages.active)
      return { hud: await readHud(page), tapped }
    })
    evidence.reading = { online: onlineHud.hud, tapWorked: onlineHud.tapped }
    expect(onlineHud.hud.pdfMode, '触屏下内置书不应处于 PDF 模式').toBe(false)

    // 触屏导入中文夹具 PDF（横竖混排 6 页），并核对页数与方向。
    const pdf = await check('UI', '触屏导入中文 PDF', async () => {
      const { frame } = await importPdf(page, pdfPath)
      const meta = await sceneEval(page, () => window.__debug.book.getPages())
      return { pages: meta, bodyEntry: await frame.evaluate(() => document.body.dataset.entry ?? null) }
    })
    evidence.reading.pdf = pdf
    expect(pdf.pages.count, '夹具 PDF 应为 6 页').toBe(6)

    // 缩放与翻页：窄视口最容易出现的缺陷是按钮被挤出可视区，
    // 所以这里先确认按钮在视口内再点。
    const zoomed = await check('UI', '触屏缩放', async () => {
      const before = await readHud(page)
      await pressInScene(page, '#btnZoomIn')
      await expect.poll(async () => (await readHud(page)).zoom).not.toBe(before.zoom)
      const afterIn = await readHud(page)
      await pressInScene(page, '#btnZoomOut')
      await expect.poll(async () => (await readHud(page)).zoom).not.toBe(afterIn.zoom)
      return { before: before.zoom, zoomIn: afterIn.zoom, back: (await readHud(page)).zoom }
    })
    evidence.zoom = zoomed

    const paged = await check('UI', '触屏翻页', async () => {
      const before = await readHud(page)
      await pressInScene(page, '#btnNext')
      await expect.poll(async () => (await readHud(page)).pages.left).toBeGreaterThan(before.pages.left)
      const after = await readHud(page)
      await pressInScene(page, '#btnPrev')
      await expect.poll(async () => (await readHud(page)).pages.left).toBe(before.pages.left)
      return { before: before.pages.left, after: after.pages.left }
    })
    evidence.paging = paged

    await check('UI', '触屏退出阅读', () => exitReading(page))

    // ---- 彻底断网 + 新标签重开 ----
    restore = await check('NETWORK', '三层断网', () => disconnect(page, server))
    try {
      const reopened = await context.newPage()
      const reopenedLogs = collect(reopened)
      await check('NETWORK', '触屏断网重开外壳', () => openShell(reopened, { timeout: 45_000 }))
      await check('UI', '触屏断网进入 explore', () => waitScene(reopened, { timeout: 60_000 }))
      await check('NETWORK', '触屏断网仍由 SW 接管', () => waitControlled(reopened, { timeout: 20_000 }))
      const offlineSaved = await check('STATE', '触屏断网后离线控件报告已保存', () => expectSaved(reopened))
      expect(await offlineSaved.innerText()).toContain('已保存离线版')
      await closeCompanion(reopened)

      await check('UI', '触屏断网翻内置书', async () => {
        await enterReading(reopened, { timeout: 60_000 })
        const hud = await readHud(reopened)
        expect(hud.pdfMode, '重开后应回到内置书').toBe(false)
        await pressInScene(reopened, '#btnNext')
        await expect.poll(async () => (await readHud(reopened)).pages.left).toBeGreaterThan(hud.pages.left)
        await exitReading(reopened, { timeout: 40_000 })
      })

      const offlinePdf = await check('PDF', '触屏断网导入中文 PDF 并翻页', async () => {
        await importPdf(reopened, pdfPath)
        const before = await readHud(reopened)
        expect(before.pages.count).toBe(6)
        const frame = reopened.frames().find((item) => item.url().includes('/bookstore/'))
        await frame.locator('#btnNext').tap()
        await expect.poll(async () => (await readHud(reopened)).pages.active).toBeGreaterThan(before.pages.active)
        return { count: before.pages.count, before: before.pages.active, after: (await readHud(reopened)).pages.active }
      })

      const foreign = reopenedLogs.requests.filter(({ url }) => {
        if (url.startsWith('data:') || url.startsWith('blob:')) return false
        try { return new URL(url).hostname !== '127.0.0.1' } catch { return true }
      })
      evidence.offline = {
        pdf: offlinePdf,
        foreign,
        cdn: reopenedLogs.cdn,
        pageErrors: reopenedLogs.pageErrors,
        consoleErrors: reopenedLogs.consoleErrors,
      }
      expect(reopenedLogs.cdn, '触屏断网期间不应有 CDN 请求').toEqual([])
      expect(foreign, '触屏断网期间不应有外域请求').toEqual([])
      expect(reopenedLogs.pageErrors, '触屏断网期间不应有未捕获异常').toEqual([])

      const offlineCaches = await cacheTotals(reopened)
      evidence.cachesOffline = offlineCaches
      expect([...offlineCaches.keys].sort()).toEqual([...saved.keys].sort())
      await reopened.close()
    } finally {
      const revived = await restore()
      await revived.close()
    }

    evidence.console.pageErrors = logs.pageErrors
    expect(logs.pageErrors, '触屏联网阶段不应有未捕获异常').toEqual([])
  } finally {
    await server.close().catch(() => {})
    await writeEvidence('p7-touch-simulated.json', evidence)
  }
})
