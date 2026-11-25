// C 包（离线与 PDF 闭环）真实浏览器夹具的公共动作。
//
// 设计口径（务必保持）：
//   - 被测对象永远是 dist-public 生产构建 + 安全上下文 127.0.0.1，
//     离线控件只在 import.meta.env.PROD 且 window.isSecureContext 时渲染。
//   - 「彻底断网」= 三层同时断：静态服务器 close（进程级）、
//     context.setOffline(true)（浏览器网络栈）、CDP Network.emulateNetworkConditions
//     （worker 自身的取数）。只关服务器时 SW 可能仍从浏览器 HTTP 缓存里取到东西，
//     只设 offline 时浏览器里残留的连接池仍可能命中，所以三者叠加才算断干净。
//   - 全部动作都以「真实用户路径」为准：点界面按钮，不直接 postMessage 给 SW。
//     唯一例外是 cacheInventory() 这类只读取证。
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect } from '@playwright/test'
import { CORE_LIMIT, distDir, evidenceDir, isCDN, pdfFixture, previewPort, resultsDir } from './fixture-env.mjs'
import { createStaticServer } from './serve.mjs'

/**
 * 把一次检查包成带分类的错误，失败信息里保留原始原因。
 * @template T
 * @param {string} category
 * @param {string} label
 * @param {() => Promise<T> | T} fn
 * @returns {Promise<T>}
 */
export async function check(category, label, fn) {
  try {
    return await fn()
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`[${category}] ${label}: ${detail}`, { cause: error })
  }
}

/** 起 dist-public 的静态服务器（默认端口 = preview:public 5197 + 400 偏移）。 */
export function startServer(options = {}) {
  return createStaticServer({ root: resolve(options.root ?? distDir), port: options.port ?? previewPort, ...options })
}

/**
 * 挂上控制台 / 页面错误 / 网络请求三路采集。
 * 必须在第一次 goto 之前调用。
 */
export function collect(page) {
  const data = { consoleErrors: [], pageErrors: [], requests: [], failed: [], cdn: [], ice: [], swScripts: [] }
  // request 对象不能可靠地反查记录，用 URL 建索引（同 URL 并发重复请求极少，
  // 且体积统计只关心量级；真出现重复时记录会挂到第一条上，见下面 byteNote）。
  const byUrl = new Map()
  page.on('console', (message) => {
    if (message.type() === 'error') data.consoleErrors.push({ text: message.text(), location: message.location() })
    if (message.type() === 'warning' && /service ?worker/i.test(message.text())) data.swScripts.push(message.text())
  })
  page.on('pageerror', (error) => data.pageErrors.push({ text: String(error), stack: error.stack }))
  page.on('request', (request) => {
    const url = request.url()
    const record = { url, method: request.method(), resource: request.resourceType(), bytes: null, fromServiceWorker: null }
    data.requests.push(record)
    if (!byUrl.has(url)) byUrl.set(url, [])
    byUrl.get(url).push(record)
    if (isCDN(url)) data.cdn.push(record)
    // /ice 是本仓约定的 TURN 凭据端点命名；任何命中都单独记一笔，用于「凭据不进缓存」的对照。
    if (/(^|\/)ice(\/|$)/.test(new URL(url).pathname)) data.ice.push(record)
  })
  // 响应侧补两个体积统计必需的字段：实际字节数与「是否由 service worker 应答」。
  // 只读 content-length，**不**调用 body()：书页纹理动辄数 MB，逐条读 body 会拖慢整段并抬内存；
  // 拿不到就记 null 并留 note，让体积统计明确报出「有多少条不可计量」，不做估算。
  // （SW 应答时 Response 头是原样保留的，content-length 一般都在。）
  page.on('response', (response) => {
    const record = byUrl.get(response.url())?.find((item) => item.bytes === null)
    if (!record) return
    record.fromServiceWorker = Boolean(response.fromServiceWorker?.())
    const declared = Number(response.headers()['content-length'])
    if (Number.isFinite(declared) && declared >= 0) record.bytes = declared
    else record.byteNote = 'content-length 缺失，未计入体积'
  })
  page.on('requestfailed', (request) => {
    data.failed.push({ url: request.url(), reason: request.failure()?.errorText ?? 'unknown', resource: request.resourceType() })
  })
  return data
}

/**
 * 打开 React 外壳（`/`），并等页面进入可用状态。
 * 离线控件在共学面板里，所以这里只保证外壳可用。
 *
 * 为什么全部用显式轮询而不是 waitForFunction / waitForSelector：
 * 这两个 API 的默认轮询都依赖页面侧的 requestAnimationFrame，而
 * `context.newPage()` 打开的标签在 headless Chromium 里是**后台标签**，
 * raf 会被节流甚至暂停，判定函数根本不跑 —— 表现为「等满超时，但错误日志里
 * 明写 locator resolved to visible」。实测：同一判断改成主进程驱动的
 * evaluate 轮询，169 ms 就通过。断网重开与 PDF 段的两次「莫名超时」都是这个原因。
 */
export async function openShell(page, { timeout = 60_000, interval = 200 } = {}) {
  await page.goto('./', { waitUntil: 'domcontentloaded', timeout })
  const deadline = Date.now() + timeout
  let last = { hasIframe: false, hasFocusPill: false }
  while (Date.now() < deadline) {
    last = await page.evaluate(() => ({
      hasIframe: Boolean(document.querySelector('iframe[title="山窗书屋正式场景"]')),
      hasFocusPill: Boolean(document.querySelector('button.focus-pill')),
    })).catch(() => last)
    if (last.hasIframe && last.hasFocusPill) return
    await page.waitForTimeout(interval)
  }
  throw new Error(
    `外壳未就绪：iframe=${last.hasIframe} focus-pill=${last.hasFocusPill}（限时 ${timeout} ms）`,
  )
}

/**
 * 等 iframe 里的书屋走完引导、进入 explore。
 *
 * 同样避开 waitForFunction / expect(...).toBeAttached —— 后台标签里它们的
 * 页面侧轮询会被 raf 节流压住。这里用主进程 evaluate 轮询两个真实信号：
 * body[data-entry="ready"] 与 APP.state.mode === 'explore'。
 */
export async function waitScene(page, { timeout = 75_000, interval = 250 } = {}) {
  const deadline = Date.now() + timeout
  let last = { ready: false, mode: 'absent' }
  while (Date.now() < deadline) {
    const frame = page.frames().find((item) => item.url().includes('/bookstore/'))
    if (frame) {
      last = await frame.evaluate(() => ({
        ready: document.body?.dataset?.entry === 'ready',
        mode: window.__debug?.app?.state?.mode ?? 'absent',
      })).catch(() => last)
      if (last.ready && last.mode === 'explore') return page.frameLocator('iframe[title="山窗书屋正式场景"]')
    }
    await page.waitForTimeout(interval)
  }
  throw new Error(`书屋未进入 explore：data-entry ready=${last.ready}，mode=${last.mode}（限时 ${timeout} ms）`)
}

/**
 * 打开「山窗共学」面板。离线控件就挂在里面（FormalRoom 的 controls 插槽）。
 * iframe 里的共学按钮初值是 inert，引导结束时才被清除；这里显式清一次，
 * 避免不同构建的引导时序差异把用例挂死。
 */
export async function openCompanion(page, { timeout = 20_000 } = {}) {
  const frame = page.frames().find((item) => item.url().includes('/bookstore/'))
  if (!frame) throw new Error('找不到书屋 iframe')
  await frame.waitForFunction(() => Boolean(document.querySelector('#btnStudyCompanions')), null, { timeout })
  await frame.evaluate(() => {
    const button = document.querySelector('#btnStudyCompanions')
    button.inert = false
    button.click()
  })
  const dialog = page.locator('dialog.formal-controls')
  await expect(dialog).toHaveAttribute('open', '', { timeout })
  return dialog
}

/** 关闭共学面板（<form method="dialog"> 里的关闭按钮）。 */
export async function closeCompanion(page) {
  const dialog = page.locator('dialog.formal-controls')
  if (await dialog.count()) await dialog.locator('button[aria-label="关闭共学面板"]').click()
}

/** 点开共学面板并等到离线控件渲染完成（status 报告回来之后才显示核心体积）。 */
export async function openOfflineControls(page) {
  const dialog = await openCompanion(page)
  const controls = dialog.locator('.offline-controls')
  await expect(controls).toBeVisible({ timeout: 20_000 })
  return controls
}

/** 从一个元素读出体积文本框里的核心字节数（`核心 12.8 MB …` → 12800000）。 */
export async function readCoreBytes(controls) {
  const text = await controls.locator('p.field-message', { hasText: '核心' }).first().innerText()
  const match = /核心\s*([\d.]+)\s*MB/.exec(text)
  if (!match) throw new Error(`核心体积文案无法解析：${text}`)
  return Math.round(Number(match[1]) * 1_000_000)
}

/**
 * 走真实路径保存离线版：点「保存离线版」，等状态文案出现。
 *
 * timeout 默认 75 s 而不是 150 s：Playwright 配置的整段上限是 90 s，
 * 若这里等到 150 s，超时永远由外层 timeout 先触发，报出的是「段超时」而不是
 * 「保存失败」——把根因埋掉。所有保存类等待都遵守这条：**短于段限**。
 * @returns {Promise<{ bytes: number, text: string }>}
 */
export async function saveOffline(page, { timeout = 75_000 } = {}) {
  const controls = await openOfflineControls(page)
  const button = controls.locator('button', { hasText: /保存离线版|更新离线版|保存所选扩展/ }).first()
  await expect(button).toBeEnabled({ timeout })
  await button.click()
  // 完成信号是核心已保存的提示；进度条与「正在准备…」在保存期间会出现。
  await expect(controls.locator('p.field-message', { hasText: '已保存离线版' })).toBeVisible({ timeout })
  const text = await controls.innerText()
  return { bytes: await readCoreBytes(controls), text }
}

/** 等离线控件报告为「已保存」（只读文案，不点按钮）。timeout 同样短于 90 s 段限。 */
export async function expectSaved(page, { timeout = 75_000 } = {}) {
  const controls = await openOfflineControls(page)
  await expect(controls.locator('p.field-message', { hasText: '已保存离线版' })).toBeVisible({ timeout })
  return controls
}

/**
 * 彻底断网：先关服务器（进程级），再叠浏览器离线（网络栈）与 CDP 离线（worker 取数）。
 * @returns {Promise<() => Promise<object>>} 恢复函数：恢复网络并以同端口重启服务器，返回新服务器
 */
export async function disconnect(page, server, { root } = {}) {
  await server.close()
  await page.context().setOffline(true)
  const session = await page.context().newCDPSession(page)
  await session.send('Network.enable')
  await session.send('Network.emulateNetworkConditions', {
    offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
  })
  return async () => {
    await session.send('Network.emulateNetworkConditions', {
      offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
    }).catch(() => {})
    await session.detach().catch(() => {})
    await page.context().setOffline(false)
    return startServer({ root })
  }
}

/** 等 service worker 接管当前页面（controllerchange 之后才可能无网应答）。 */
export async function waitControlled(page, { timeout = 30_000 } = {}) {
  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), null, { timeout })
}

/**
 * 只读取证：列出本页 origin 下所有 cache 家族、键、条目数与体积。
 * 体积优先用 content-length，缺失时回退到 blob().size（离线缓存命中时常见）。
 */
export async function cacheInventory(page) {
  return page.evaluate(async () => {
    const keys = await caches.keys()
    const caches_ = []
    for (const key of keys) {
      const cache = await caches.open(key)
      const requests = await cache.keys()
      let bytes = 0
      const urls = []
      let marker = null
      for (const request of requests) {
        urls.push(request.url)
        const response = await cache.match(request)
        if (!response) continue
        if (request.url.endsWith('/.offline-ready')) marker = await response.clone().text()
        const declared = Number(response.headers.get('content-length'))
        bytes += Number.isFinite(declared) && declared > 0
          ? declared
          : (await response.clone().blob()).size
      }
      caches_.push({ key, entries: requests.length, bytes, urls, marker })
    }
    return caches_
  })
}

/** 读构建自带的 offline-manifest.json（体积与包结构的原始口径）。 */
export async function readManifest(root = distDir) {
  return JSON.parse(await readFile(join(resolve(root), 'offline-manifest.json'), 'utf8'))
}

/** 体积是否合格（VISION 的 15 MB 地板只约束 core 包，不是总量）。 */
export const withinCoreLimit = (bytes) => bytes <= CORE_LIMIT

/** 验收目录与证据目录（test-results 已被 gitignore，证据落到 evidence）。 */
export async function prepareDirs() {
  await mkdir(resolve(resultsDir), { recursive: true })
  await mkdir(resolve(evidenceDir), { recursive: true })
}

/** 写一份证据 JSON。 */
export async function writeEvidence(name, data) {
  await prepareDirs()
  const file = join(resolve(evidenceDir), name)
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`)
  return file
}

/** 清掉派生构建（revision 变体），避免污染下次运行。 */
export async function cleanDerived(...dirs) {
  for (const dir of dirs) await rm(resolve(dir), { recursive: true, force: true })
}

/** 自带中文夹具 PDF 的绝对路径。 */
export const pdfPath = resolve(pdfFixture)

/** 把 iframe 里的一个按钮点掉（绕开 inert / 动画造成的 action 超时）。 */
export async function pressInScene(page, selector) {
  const frame = page.frames().find((item) => item.url().includes('/bookstore/'))
  if (!frame) throw new Error('找不到书屋 iframe')
  await frame.evaluate((sel) => {
    const element = document.querySelector(sel)
    if (!element) throw new Error(`缺少元素 ${sel}`)
    element.inert = false
    element.click()
  }, selector)
}

/** 在 iframe 里读一个元素的状态（供断言与证据）。 */
export async function sceneEval(page, fn, arg) {
  const frame = page.frames().find((item) => item.url().includes('/bookstore/'))
  if (!frame) throw new Error('找不到书屋 iframe')
  return frame.evaluate(fn, arg)
}

/** 等书屋回到 explore 且没有正在进行的导入。 */
export async function waitExplore(page, { timeout = 30_000 } = {}) {
  const frame = page.frames().find((item) => item.url().includes('/bookstore/'))
  if (!frame) throw new Error('找不到书屋 iframe')
  await frame.waitForFunction(
    () => window.__debug?.app?.state?.mode === 'explore' && !window.__debug.app.state.importing,
    null, { timeout },
  )
  return frame
}

/**
 * 走进阅读模式。走 #btnRead（直接 enterReading，绕开入座的走位动画），
 * 但按钮在引导结束前是 inert，所以先清掉再点。
 */
export async function enterReading(page, { timeout = 40_000 } = {}) {
  await waitExplore(page)
  await pressInScene(page, '#btnRead')
  const frame = page.frames().find((item) => item.url().includes('/bookstore/'))
  await frame.waitForFunction(() => window.__debug?.app?.state?.mode === 'reading', null, { timeout })
  // 首屏书页纹理是懒加载的，等 active 页与总数可读再继续。
  await frame.waitForFunction(() => {
    const pages = window.__debug?.book?.getPages?.()
    return Boolean(pages && pages.count > 0)
  }, null, { timeout })
  return frame
}

/** 退出阅读，回到 explore。 */
export async function exitReading(page, { timeout = 30_000 } = {}) {
  await pressInScene(page, '#btnCloseBook')
  return waitExplore(page, { timeout })
}

/** 当前阅读 HUD 的原始文案与页码状态（供断言与证据）。 */
export function readHud(page) {
  return sceneEval(page, () => {
    const text = (selector) => document.querySelector(selector)?.textContent?.trim() ?? null
    // #pageNow / #pageTotal 翻页时是「旧值上滑 + 新值入场」两个 span 短暂共存，
    // textContent 会拼成 "0203"，所以只取最后一个子元素。
    const counter = (selector) => {
      const node = document.querySelector(selector)
      if (!node) return null
      return (node.lastElementChild?.textContent ?? node.textContent ?? '').trim() || null
    }
    const track = document.querySelector('#readProgressTrack')
    return {
      chapter: text('#readChapter'),
      page: text('#readPage'),
      pageNow: counter('#pageNow'),
      pageTotal: counter('#pageTotal'),
      zoom: text('#readZoomValue'),
      progress: {
        now: Number(track?.getAttribute('aria-valuenow')),
        max: Number(track?.getAttribute('aria-valuemax')),
      },
      pages: window.__debug?.book?.getPages?.() ?? null,
      pdfMode: Boolean(window.__debug?.app?.state?.pdfMode),
      chapterNavHidden: document.querySelector('#chapterNav')?.hidden ?? null,
      pdfToolsHidden: document.querySelector('#pdfReadingTools')?.hidden ?? null,
      label: window.__debug?.book?.labels?.[window.__debug?.book?.getPages?.().left] ?? null,
    }
  })
}

/** 环境音实际状态（AudioContext 开关与三个按钮），不依赖听感。 */
export function readAmbience(page) {
  return sceneEval(page, () => {
    const pressed = (selector) => document.querySelector(selector)?.getAttribute('aria-pressed') ?? null
    const amb = window.__debug?.amb
    // createAmbience 只公开 isEnabled/isRainEnabled/isNoiseEnabled，不暴露 ctx；
    // 是否需要真实声卡由 enabled 与三个开关共同体现，--mute-audio 下也成立。
    let stored = null
    try { stored = JSON.parse(localStorage.getItem('cozy-bookstore-audio') ?? 'null') } catch { stored = 'unreadable' }
    return {
      enabled: amb?.isEnabled?.() ?? null,
      volume: amb?.getVolume?.() ?? null,
      fire: pressed('#btnSound'),
      rain: pressed('#btnRain'),
      noise: pressed('#btnNoise'),
      stored,
      appSoundOn: window.__debug?.app?.state?.soundOn ?? null,
      appRainOn: window.__debug?.app?.state?.rainOn ?? null,
      appNoiseOn: window.__debug?.app?.state?.noiseOn ?? null,
    }
  })
}

/** 页面里所有 cache 存储占用的总字节数与家族键（体积口径的现场读数）。 */
export async function cacheTotals(page) {
  const list = await cacheInventory(page)
  return {
    total: list.reduce((sum, item) => sum + item.bytes, 0),
    families: [...new Set(list.map((item) => item.key.split(':').slice(0, 2).join(':')))],
    keys: list.map((item) => item.key),
    entries: list.reduce((sum, item) => sum + item.entries, 0),
  }
}

/**
 * 设置 range / number 输入框的值并触发 React 的 onChange。
 *
 * 为什么不用 locator.fill()：range 类型在 fill() 里走的是「设值 + 派发 input」的特例，
 * 不同 Playwright 版本行为不一致；而直接 `element.value = x` 会被 React 的 value tracker
 * 判成「没变」而不触发 onChange。这里用原型上的原生 setter 绕过 tracker，再派发冒泡的
 * input / change，React 18 的 onChange 一定会收到。
 */
export async function setRange(locator, value) {
  const handle = await locator.elementHandle()
  if (!handle) throw new Error('找不到输入元素')
  await handle.evaluate((element, next) => {
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    setter?.call(element, String(next))
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
  await handle.dispose()
}

/** 读 #toast 的当前文案（书屋里所有导入/缩放反馈都走这里）。 */
export function readToast(page) {
  return sceneEval(page, () => {
    const toast = document.querySelector('#toast')
    return { text: toast?.textContent?.trim() ?? '', shown: Boolean(toast?.classList.contains('is-show')) }
  })
}

/**
 * 走真实用户路径导入本地 PDF：把文件塞进隐藏的 #pdfInput，触发 change。
 * 等价于点「导入本地 PDF」后在文件对话框里选中文件——#btnPdf 只是转发到这个 input。
 * 注意 main.js 的 change 处理器末尾会清空 input.value，所以每次导入都要重新 setInputFiles。
 *
 * toast 只有 4.2 s 寿命，而导入大 PDF 时它会在渲染完成前就消失。
 * 所以这里在**导入过程中**就开始采 toast 文案，随返回值一起给出，
 * 调用方直接读 `result.toast` 即可，不要等导入结束再去读 DOM（那时已经空了）。
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} file 绝对路径
 * @returns {Promise<{ frame: import('@playwright/test').Frame, toast: { text: string, shown: boolean } | null }>}
 */
export async function importPdf(page, file, { timeout = 120_000 } = {}) {
  const frame = page.frames().find((item) => item.url().includes('/bookstore/'))
  if (!frame) throw new Error('找不到书屋 iframe')
  // canReplaceBook() 的等价前提：不在导入中、不在翻书/入座动画里、模式为 explore 或 reading。
  await frame.waitForFunction(
    () => !window.__debug?.app?.state?.importing
      && ['explore', 'reading'].includes(window.__debug?.app?.state?.mode),
    null, { timeout },
  )
  await frame.setInputFiles('#pdfInput', file)

  // 边等边抓 toast：抓到第一条非空文案就停，别等它淡出。
  let toast = null
  const grabToast = async () => {
    if (toast) return
    const picked = await frame.evaluate(() => {
      const node = document.querySelector('#toast')
      return { text: node?.textContent?.trim() ?? '', shown: Boolean(node?.classList.contains('is-show')) }
    }).catch(() => null)
    if (picked?.text) toast = picked
  }
  const pollToast = (async () => {
    for (let index = 0; index < 80 && !toast; index += 1) {
      await grabToast()
      if (!toast) await new Promise((resolve) => setTimeout(resolve, 100))
    }
  })()

  // 导入期间 #loading 亮起（aria-busy=true）；结束时 pdfMode 打开且 importing 归零。
  await frame.waitForFunction(
    () => window.__debug?.app?.state?.pdfMode === true && window.__debug?.app?.state?.importing === false,
    null, { timeout },
  )
  await frame.waitForFunction(
    () => window.__debug?.app?.state?.mode === 'reading' && window.__debug?.book?.pageCount > 0,
    null, { timeout },
  )
  await pollToast
  // 若上面整段都没抓到（例如 toast 在 setInputFiles 之前就已出现），这里补最后一次尝试。
  await grabToast()
  return { frame, toast }
}

/** 读导入后的 PDF 元信息：页数、书名、逐页原始方向与尺寸。 */
export async function readPdfMeta(page, { scale = 0.4 } = {}) {
  return sceneEval(page, async (renderScale) => {
    const importer = window.__debug?.importer
    if (!importer) return null
    const count = importer.getPageCount?.() ?? 0
    const pages = []
    for (let index = 0; index < count; index += 1) {
      const canvas = await importer.renderPage(index, renderScale)
      pages.push({
        index,
        width: canvas.width,
        height: canvas.height,
        portrait: canvas.height >= canvas.width,
        aspect: Number((canvas.width / canvas.height).toFixed(4)),
      })
      // 立刻释放：每页画布即使缩过也占内存，6 页连着留会顶到 1 GB 以上。
      canvas.width = 1
      canvas.height = 1
    }
    return { count, aspect: importer.getAspect?.() ?? null, labels: window.__debug?.book?.labels ?? [], pages }
  }, scale)
}
