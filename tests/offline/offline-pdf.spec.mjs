// P-2：离线态下的中文 PDF 闭环——导入自制横竖混排多页书稿、缩放、翻页、回到内置书。
//
// 夹具说明：
//   tests/offline/fixtures/cn-mixed-6p.pdf 由 tests/offline/make-pdf-fixture.py 生成，
//   6 页、3 竖 3 横、嵌入 SimHei 子集，正文全部是本次验收自撰的说明文字，
//   不含任何完整书稿或第三方受版权保护的正文，可随仓库分发。
//
// 口径要点：
//   - 导入走隐藏的 #pdfInput（用户点「导入本地 PDF」后就是这条路径）；
//     change 处理器末尾会清空 value，所以每次导入都必须重新 setInputFiles。
//   - PDF 书稿不会被存进离线包（只有 core/scenery/record 三类），
//     断网重开后必须回到《地球 Online》；这里把这件事作为断言写死。
//   - 缩放读数是 #readZoomValue 的百分比文案，与 APP.state.zoom 互为倒数。
//
// 前置：npm run build:public
// 运行：npx playwright test -c tests/offline/playwright.config.mjs offline-pdf
import { expect, test } from '@playwright/test'
import {
  cacheTotals, check, closeCompanion, collect, disconnect, enterReading, importPdf,
  openShell, pdfPath, pressInScene, readHud, readPdfMeta, readToast, saveOffline,
  sceneEval, startServer, waitControlled, waitExplore, waitScene, writeEvidence,
} from './helpers.mjs'

test.describe.configure({ mode: 'serial' })

/** 读缩放百分比文案并换算成 APP.state.zoom（百分比 = 100/zoom，四舍五入）。 */
async function zoomState(page) {
  return sceneEval(page, () => ({
    text: document.querySelector('#readZoomValue')?.textContent?.trim() ?? null,
    zoom: window.__debug?.app?.state?.zoom ?? null,
    pan: { x: window.__debug?.app?.state?.pan?.x ?? null, y: window.__debug?.app?.state?.pan?.y ?? null },
  }))
}

/** 台机默认双页：页码文案是 `第 01–02 页 / 共 6 页`，所以按 left 页核对而不是写死单页格式。 */
const leftLabel = (hud) => `第 ${String(hud.pages.left + 1).padStart(2, '0')}`

test('离线态导入中文 PDF：横竖页、缩放、翻页、回内置书', async ({ page }) => {
  // 显式放宽：本段要做「冷启动 + 保存 12.8 MB + 导入解析 + 6 页逐页渲染 + 缩放翻页 + 回书」，
  // 配置默认 90 s 装不下；实测约 75~95 s，抖动会越过。放宽只作用于本用例。
  test.setTimeout(180_000)
  const evidence = { fixture: {}, import: {}, zoom: {}, paging: {}, restore: {}, offline: {}, caches: {}, console: {} }
  const logs = collect(page)
  const server = await check('NETWORK', '起 dist-public 静态服务器', () => startServer())

  try {
    await check('UI', '打开外壳', () => openShell(page))
    await check('UI', '书屋进入 explore', () => waitScene(page))
    await check('NETWORK', 'service worker 接管页面', () => waitControlled(page))
    // saveOffline 会真的点「保存离线版」并等完成；expectSaved 只等文案、不点按钮，
    // 用错就会干等 75 s 然后报「保存失败」——这是本包踩过的坑，注释留在原地避免复发。
    await check('STATE', '保存离线版', () => saveOffline(page))
    await check('UI', '关闭共学面板', () => closeCompanion(page))

    // ---- 1. 导入自制中文 PDF ----
    // toast 只活 4.2 s，导入 6 页书稿时它会先于渲染完成消失，
    // 所以 toast 由 importPdf 在导入过程中顺手采集，不要事后读 DOM。
    const imported = await check('PDF', '导入 6 页横竖混排中文 PDF', () => importPdf(page, pdfPath))
    const toast = await check('PDF', '读取导入提示', async () => {
      const picked = imported.toast ?? (await readToast(page))
      evidence.import.toast = picked
      return picked
    })
    expect(toast.text, '导入完成的提示应说明是本地书稿').toContain('已打开本地书稿')
    expect(toast.text, '导入完成的提示应报告 6 页').toMatch(/6\s*页/)

    const meta = await check('PDF', '读夹具页数与横竖方向', () => readPdfMeta(page))
    evidence.fixture = { path: pdfPath, count: meta.count, aspect: meta.aspect, pages: meta.pages }
    expect(meta.count, '夹具应为 6 页').toBe(6)
    expect(meta.pages.filter((item) => item.portrait).length, '夹具应有 3 页竖版').toBe(3)
    expect(meta.pages.filter((item) => !item.portrait).length, '夹具应有 3 页横版').toBe(3)
    // 中文字体子集是否真的嵌进去了：书页标签必须带中文而不是空串。
    expect(meta.labels[0]).toContain('第 1 页')
    expect(meta.labels[0]).toMatch(/[\u4e00-\u9fa5]/)

    const importedHud = await check('PDF', '读取导入后的阅读 HUD', () => readHud(page))
    evidence.import.hud = importedHud
    expect(importedHud.pdfMode, '导入后应进入 PDF 模式').toBe(true)
    expect(importedHud.page).toContain(`共 6 页`)
    expect(importedHud.chapterNavHidden, 'PDF 模式下应隐藏章节导航').toBe(true)
    expect(importedHud.pdfToolsHidden, 'PDF 模式下应显示 PDF 工具条').toBe(false)
    // PDF 模式没有章节概念，HUD 标题落成 `文件名 · 第 N 页` 的书页标签。
    // 注意台机是双页展开：标题是 `… 第 1 页 ／ … 第 2 页`，而 label 只是左页那一半，
    // 所以这里断言「包含左页标签」而不是「等于左页标签」。
    expect(importedHud.chapter, 'PDF 模式的书页标题应包含当前左页标签').toContain(importedHud.label)
    expect(importedHud.chapter, 'PDF 标题应带文件名').toContain('cn-mixed-6p')
    expect(importedHud.chapter).toMatch(/[\u4e00-\u9fa5]/)

    // ---- 2. 缩放：放大 → 缩小 → 适应页面 ----
    const base = await zoomState(page)
    evidence.zoom.base = base
    expect(base.text).toBe('100%')
    await check('PDF', '点击放大', async () => {
      await pressInScene(page, '#btnZoomIn')
      await expect.poll(async () => (await zoomState(page)).zoom).toBeLessThan(base.zoom)
    })
    const zoomed = await zoomState(page)
    evidence.zoom.zoomedIn = zoomed
    expect(zoomed.text).not.toBe('100%')
    await check('PDF', '点击缩小', async () => {
      await pressInScene(page, '#btnZoomOut')
      await expect.poll(async () => (await zoomState(page)).zoom).toBeGreaterThan(zoomed.zoom)
    })
    evidence.zoom.zoomedOut = await zoomState(page)
    await check('PDF', '连续放大四次', async () => {
      for (let index = 0; index < 4; index += 1) {
        await pressInScene(page, '#btnZoomIn')
        await page.waitForTimeout(120)
      }
      const state = await zoomState(page)
      // 每次放大 zoom ×0.8，倍率文案是 100/zoom 的倒数：4 次后 0.4096 → 244%。
      expect(state.zoom, '放大四次后 zoom 应约为 0.41').toBeLessThan(0.5)
      expect(Number.parseInt(state.text, 10), '倍率文案应超过 200%').toBeGreaterThanOrEqual(200)
      // 平移被 constrainReadingPan 钳在 ±0.48 / ±0.4 内，不能跑飞。
      expect(Math.abs(state.pan.x), '放大后平移不应越界').toBeLessThanOrEqual(0.48)
      expect(Math.abs(state.pan.y), '放大后平移不应越界').toBeLessThanOrEqual(0.4)
    })
    evidence.zoom.deep = await zoomState(page)
    await check('PDF', '点击适应页面复位', async () => {
      await pressInScene(page, '#btnFit')
      await expect.poll(async () => (await zoomState(page)).zoom).toBe(1)
      await expect.poll(async () => (await zoomState(page)).text).toBe('100%')
    })
    evidence.zoom.fitted = await zoomState(page)

    // ---- 3. 翻页：6 页走到头再回来，页码指示必须跟着书页同步 ----
    // 桌面视口默认双页，一次翻两页；所以这里不写死步数，而是「一直按到按钮禁用」，
    // 每一步都核对 HUD 的页码文案与 active 页一致。
    //
    // 关键口径（实测得出）：PDF 页贴图是**按需渲染**的，第一张目标页要约 5.8 s 才上传完
    // （见 evidence p2 的 paging.latencyMs）。在此期间 book.startTurn() 会把 pendingTurn
    // 挂起并返回 false，按钮也不会变灰 —— 也就是说「点了没反应」是设计内的等待，不是丢事件。
    // 因此这里**不能**用固定 sleep，必须等到 active 真的变了；同时把每次耗时记进证据，
    // 让「PDF 翻页延迟」这件事有量化口径，而不是靠感觉。
    const seen = []
    await check('PDF', '按「下一页」翻到末页', async () => {
      for (let step = 0; step < 8; step += 1) {
        const hud = await readHud(page)
        seen.push({ step, active: hud.pages.active, page: hud.page, label: hud.label })
        expect(hud.pages.count, '总页数应恒为 6').toBe(6)
        expect(hud.page, '页码文案应包含当前左页').toContain(leftLabel(hud))
        const disabled = await sceneEval(page, () => document.querySelector('#btnNext')?.disabled ?? null)
        if (disabled) break

        const from = hud.pages.active
        const started = Date.now()
        await pressInScene(page, '#btnNext')
        // 等到 active 前进（或按钮变灰，表示已到末页）。20 s 上限足够覆盖首张页纹理。
        // 这里用裸轮询而不是 expect.poll：Playwright 的 poll 没有 toSatisfy，
        // 而「前进或变灰」是个复合条件，写成显式循环更清楚。
        let advanced = false
        while (Date.now() - started < 20_000) {
          const now = await readHud(page)
          const off = await sceneEval(page, () => document.querySelector('#btnNext')?.disabled ?? null)
          if (off === true || now.pages.active !== from) { advanced = true; break }
          await page.waitForTimeout(250)
        }
        seen.at(-1).latencyMs = Date.now() - started
        seen.at(-1).advanced = advanced
        if (!advanced) break
      }
      seen.push({ last: true, ...(await readHud(page)) })
    })
    evidence.paging.forward = seen
    evidence.paging.latencyMs = seen.map((item) => item.latencyMs).filter((value) => typeof value === 'number')
    const lastHud = await readHud(page)
    evidence.paging.last = lastHud
    expect(lastHud.pdfToolsHidden, '末页之后仍处于 PDF 模式').toBe(false)
    expect(lastHud.pages.active, '末页应落在最后一页或倒数第二页').toBeGreaterThanOrEqual(4)
    expect(await sceneEval(page, () => document.querySelector('#btnNext')?.disabled ?? null),
      '末页时下一页按钮应禁用').toBe(true)

    await check('PDF', '按「上一页」翻回首页', async () => {
      for (let step = 0; step < 8; step += 1) {
        const disabled = await sceneEval(page, () => document.querySelector('#btnPrev')?.disabled ?? null)
        if (disabled) break
        const from = await sceneEval(page, () => window.__debug.book.getPages().active)
        await pressInScene(page, '#btnPrev')
        // 同上：等 active 真的回退，不用固定 sleep。
        const started = Date.now()
        while (Date.now() - started < 20_000) {
          const now = await sceneEval(page, () => window.__debug.book.getPages().active)
          if (now !== from) break
          await page.waitForTimeout(250)
        }
      }
    })
    evidence.paging.back = await readHud(page)
    expect(evidence.paging.back.pages.left, '应回到第 1 页').toBe(0)
    expect(evidence.paging.back.page, '首页页码文案').toContain('第 01')
    expect(await sceneEval(page, () => document.querySelector('#btnPrev')?.disabled ?? null),
      '首页时上一页按钮应禁用').toBe(true)

    // 页码输入框走 submit：跳到第 4 页（横版），验证跳转后 HUD 与方向都跟着变。
    await check('PDF', '用页码输入跳到第 4 页', async () => {
      await sceneEval(page, () => {
        const form = document.querySelector('#pdfReadingTools')
        const input = document.querySelector('#pdfPageInput')
        input.value = '4'
        form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))
      })
      await expect.poll(() => sceneEval(page, () => window.__debug.book.getPages().active)).toBeGreaterThan(2)
    })
    evidence.paging.jumped = await readHud(page)

    // ---- 4. 回到内置书 ----
    // 注意：restoreBuiltinBook() 只换书、不退出阅读模式 —— 实测点完 0.5 s 内
    // pdfMode=false、chapterNavHidden=false、mode 仍为 'reading'。
    // 所以这里**不能**等 explore（那是进阅读前的模式），要等 pdfMode 关掉且导入归零。
    await check('PDF', '点「回到《地球 Online》」并读到提示', async () => {
      await pressInScene(page, '#btnBuiltinBook')
      // toast 只亮 4.2 秒，必须在同一个检查里抢读，不能等 HUD 再回头看。
      await expect.poll(async () => (await readToast(page)).text, { timeout: 15_000 })
        .toBe('已回到《地球 Online》')
      await expect.poll(() => sceneEval(page, () => window.__debug.app.state.pdfMode)).toBe(false)
      await expect.poll(() => sceneEval(page, () => window.__debug.app.state.importing)).toBe(false)
    })
    const restored = await readHud(page)
    evidence.restore.hud = restored
    expect(restored.pdfMode).toBe(false)
    expect(restored.chapterNavHidden, '内置书要恢复章节导航').toBe(false)
    expect(restored.pdfToolsHidden, '内置书要隐藏 PDF 工具条').toBe(true)

    await check('PDF', '再次导入（input.value 已被清空）', async () => {
      await importPdf(page, pdfPath)
      const hud = await readHud(page)
      expect(hud.pdfMode, '第二次导入也要成功').toBe(true)
      expect(hud.pages.count).toBe(6)
    })
    evidence.import.reimport = await readHud(page)

    const beforeOffline = await check('STATE', '读断网前的缓存清点', () => cacheTotals(page))
    evidence.caches.before = beforeOffline

    // ---- 5. 断网：PDF 不进离线包，重开必须回到内置书 ----
    const restoreNet = await check('NETWORK', '三层断网', () => disconnect(page, server))
    try {
      const reopened = await page.context().newPage()
      const reopenedLogs = collect(reopened)
      await check('NETWORK', '断网重开外壳', () => openShell(reopened, { timeout: 45_000 }))
      await check('UI', '断网重开书屋', () => waitScene(reopened, { timeout: 60_000 }))
      await check('NETWORK', '断网重开由 SW 接管', () => waitControlled(reopened, { timeout: 20_000 }))

      const freshHud = await check('PDF', '断网重开后阅读内置书', async () => {
        await enterReading(reopened, { timeout: 60_000 })
        return readHud(reopened)
      })
      evidence.offline.hud = freshHud
      expect(freshHud.pdfMode, 'PDF 书稿不随离线包保存，重开必须是内置书').toBe(false)
      expect(freshHud.pages.count).toBeGreaterThan(0)
      expect(freshHud.chapterNavHidden).toBe(false)

      // 断网后仍然可以再导入 PDF：解析全在本地 worker 里跑，不需要网络。
      const offlineMeta = await check('PDF', '断网后再导入同一份 PDF', async () => {
        await importPdf(reopened, pdfPath, { timeout: 120_000 })
        return readHud(reopened)
      })
      evidence.offline.reimportHud = offlineMeta
      expect(offlineMeta.pdfMode, '断网状态下也应能导入本地 PDF').toBe(true)
      expect(offlineMeta.pages.count).toBe(6)

      const offlineCaches = await check('STATE', '读断网后的缓存清点', () => cacheTotals(reopened))
      evidence.caches.offline = offlineCaches
      expect(offlineCaches.total, '导入 PDF 不应往离线缓存里塞东西').toBe(beforeOffline.total)

      const foreign = reopenedLogs.requests.filter(({ url }) => {
        if (url.startsWith('data:') || url.startsWith('blob:')) return false
        try { return new URL(url).hostname !== '127.0.0.1' } catch { return true }
      })
      evidence.offline.foreign = foreign
      evidence.offline.cdn = reopenedLogs.cdn
      evidence.offline.pageErrors = reopenedLogs.pageErrors
      expect(foreign, '断网期间不应有外域请求').toEqual([])
      expect(reopenedLogs.cdn, '断网期间不应有 CDN 请求').toEqual([])
      expect(reopenedLogs.pageErrors, '断网导入 PDF 不应抛未捕获异常').toEqual([])

      await reopened.close()
    } finally {
      const revived = await restoreNet()
      evidence.offline.restored = revived.url
      await revived.close()
    }

    evidence.console.onlinePageErrors = logs.pageErrors
    evidence.console.onlineErrors = logs.consoleErrors
    expect(logs.pageErrors, '联网阶段不应有未捕获异常').toEqual([])
  } finally {
    await server.close().catch(() => {})
    await writeEvidence('p2-offline-pdf.json', evidence)
  }
})
