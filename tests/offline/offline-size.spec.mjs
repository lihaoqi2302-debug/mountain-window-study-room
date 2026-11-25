// P-6：核心包体积与冷/暖/首次离线三种加载状态的口径。
//
// 任务要求的「以 15 MB 为目标」在代码里的权威定义是 scripts/check-public-release.mjs 的
// PUBLIC_CORE_LIMIT = 15_000_000，且它约束的是 packs.core.bytes（核心包），
// **不是** total（总量含 scenery + record 扩展包）。两者差着 7 MB 以上，
// 混用会把一个合格的构建报成超限，所以这里把两套数都记进证据、只对 core 断言。
//
// 三个体积口径必须分开写，不能笼统说「首屏多大」：
//   - cold（冷启动）：全新 profile、无 SW、无缓存，从空白到书屋可交互的传输量；
//   - warm（暖缓存）：已有 SW 且已保存离线包的第二次启动， theoret 上只该有 SW 应答；
//   - 首次离线（first-offline）：在 cold 之后立刻保存离线包，这一次额外下载的量。
// 三种状态用的是同一份 dist-public，差异只来自缓存状态，这样对比才有意义。
//
// 为什么要拆成 4 个 test：整段配置的 timeout 是 90 s（单 Chromium 串行的硬约束），
// 而「冷启动 + 保存离线包 + 暖缓存重开」串在一起稳定超过 90 s —— 早前跑出过
// 90 s 段超时，报出的却是「暖缓存开面板失败」，根因被埋掉。拆开之后每段都远短于
// 段限，任一段失败都能报出真实原因。
//
// 前置：dist-public 已存在（优先复用，见 docs 的 §0.1 校验口径）
// 运行：npx playwright test -c tests/offline/playwright.config.mjs offline-size
import { expect, test } from '@playwright/test'
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { CORE_LIMIT, distDir, evidenceDir, fromRoot } from './fixture-env.mjs'
import {
  cacheTotals, check, closeCompanion, collect, openShell, saveOffline,
  startServer, waitControlled, waitScene, writeEvidence,
} from './helpers.mjs'
import { readBundle } from './revision-variants.mjs'

// serial 保证同一文件内的用例共享既定的执行顺序与浏览器状态（同 context）。
test.describe.configure({ mode: 'serial' })

const cacheable = (url) => {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * 递归列出目录下所有文件的相对路径与字节数（POSIX 分隔符，便于与 manifest 对齐）。
 *
 * 关键：root 要在递归里保持不变。早前一版把「当前目录」当 root 传下去，
 * 于是 assets/x.js 会被切成 x.js，路径匹配全落空、core 字节数只对上根目录下那两个文件。
 */
async function walk(root, dir = root) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await walk(root, full))
    else out.push({ path: relative(root, full).replace(/\\/g, '/'), bytes: (await stat(full)).size })
  }
  return out
}

/**
 * 把一条请求记录折算成「实际进了多少字节」。
 * content-length 缺失的条目不估算，单独计数，让证据里能看出统计覆盖率。
 */
function sumBytes(records) {
  return records.reduce((sum, record) => sum + (record.bytes ?? 0), 0)
}
const unmeasured = (records) => records.filter((record) => record.bytes === null).length

/** 构建口径：manifest 自报数 + sw.js 文件列表 + 磁盘实测三方对账。纯 Node，不开浏览器。 */
test('构建体积口径：manifest / sw.js / 磁盘三方对账', async () => {
  const evidence = {
    limit: {
      coreBytes: CORE_LIMIT,
      rule: 'scripts/check-public-release.mjs PUBLIC_CORE_LIMIT',
    },
  }

  const manifest = await check('STATE', '读构建清单', async () => {
    return JSON.parse(await readFile(fromRoot(`${distDir}/offline-manifest.json`), 'utf8'))
  })
  const packs = manifest.packs ?? {}
  evidence.build = {
    revision: manifest.revision,
    // 注意：offline-manifest.json 里 packs.<name>.files 是**文件数量**（数字），
    // 只有 sw.js 里的 packs 才带 {path,bytes} 列表。别把两者混用。
    packs: Object.fromEntries(Object.entries(packs).map(([name, pack]) => [name, { bytes: pack.bytes, files: pack.files }])),
  }
  const coreBytes = packs.core?.bytes ?? 0
  evidence.build.coreAndSceneryBytes = Object.values(packs).reduce((sum, pack) => sum + (pack.bytes ?? 0), 0)
  evidence.build.marginBytes = CORE_LIMIT - coreBytes
  evidence.build.limitNote = '15 MB 目标只约束 core；core+scenery 与 dist 全量均不受此约束，此处只留痕'

  // 核心断言：15 MB 地板只压在 core 上（严格小于，与发布脚本一致）。
  expect(coreBytes, `核心包 ${coreBytes} B 应严格小于 15 MB 地板`).toBeLessThan(CORE_LIMIT)

  const onDisk = await check('STATE', '磁盘实测体积', () => walk(resolve(fromRoot(distDir))))
  const bundle = await check('STATE', '从 sw.js 读包内文件列表', async () => {
    return readBundle(await readFile(fromRoot(`${distDir}/sw.js`), 'utf8'))
  })
  const coreFiles = new Set((bundle.packs.core?.files ?? []).map((file) => file.path))
  evidence.disk = {
    files: onDisk.length,
    totalBytes: onDisk.reduce((sum, file) => sum + file.bytes, 0),
    coreListedBytes: onDisk.filter((file) => coreFiles.has(file.path)).reduce((sum, file) => sum + file.bytes, 0),
    coreListedCount: onDisk.filter((file) => coreFiles.has(file.path)).length,
    coreDeclaredCount: coreFiles.size,
    coreFilesFrom: 'sw.js packs.core.files[].path',
  }
  expect(coreFiles.size, 'sw.js 里的 core 文件数应与 manifest 声明的数量一致').toBe(packs.core?.files)
  expect(evidence.disk.coreListedBytes, 'manifest 的 core 字节数应与磁盘实测一致').toBe(coreBytes)
  expect(evidence.disk.coreListedCount, 'sw.js 列出的 core 文件都应能在磁盘上落位').toBe(evidence.disk.coreDeclaredCount)

  // 与发布脚本对账：两处 15 MB 口径不得漂移。
  // 实际写法是 `const limit = Number(process.env.PUBLIC_CORE_LIMIT ?? 15_000_000)`，
  // 默认值可被环境变量覆盖，且脚本用严格 `<` 断言。两处都必须照抄这个语义，
  // 否则会出现「脚本判超限、夹具判合格」的分歧。
  const scriptSource = await readFile(fromRoot('scripts/check-public-release.mjs'), 'utf8')
  const declared = /PUBLIC_CORE_LIMIT\s*\?\?\s*([\d_]+)/.exec(scriptSource)?.[1]
  evidence.limit.scriptDeclared = declared ? Number(declared.replace(/_/g, '')) : null
  evidence.limit.fixtureCORE_LIMIT = CORE_LIMIT
  evidence.limit.strictlyLessThan = true
  expect(evidence.limit.scriptDeclared, '应从发布脚本解析出默认上限').not.toBeNull()
  expect(evidence.limit.fixtureCORE_LIMIT, '夹具的 15 MB 口径必须与发布脚本一致').toBe(evidence.limit.scriptDeclared)
  // 发布脚本用严格小于：等于上限也算不合格，这里保持一致。
  expect(coreBytes, `核心包 ${coreBytes} B 必须严格小于 ${CORE_LIMIT} B`).toBeLessThan(CORE_LIMIT)

  await writeEvidence('p6a-build-size.json', evidence)
})

/** cold：全新上下文，从零到可交互。独立 server + 独立 page，不与其它段共享缓存。 */
test('冷启动口径：从零加载到书屋可交互', async ({ page }) => {
  const evidence = {}
  const logs = collect(page)
  const server = await check('NETWORK', '起静态服务器', () => startServer())

  try {
    const cold = await check('NETWORK', '冷启动：统计从零加载到可交互', async () => {
      await openShell(page)
      await waitScene(page)
      // 等一拍再收数：书屋的懒加载纹理在 explore 之后还会继续进。
      await page.waitForTimeout(2_000)
      const picked = logs.requests.filter((record) => cacheable(record.url))
      return {
        requests: picked.length,
        bytes: sumBytes(picked),
        unmeasured: unmeasured(picked),
        cdn: logs.cdn.length,
        byResource: picked.reduce((acc, record) => {
          acc[record.resource] = (acc[record.resource] ?? 0) + 1
          return acc
        }, {}),
      }
    })
    evidence.cold = cold
    expect(cold.bytes, '冷启动应确实产生网络传输').toBeGreaterThan(0)
    expect(cold.cdn, '冷启动不应访问 CDN').toBe(0)
    expect(cold.unmeasured, '冷启动的请求都应可计量（content-length 齐全）').toBe(0)
    evidence.pageErrors = logs.pageErrors
    expect(logs.pageErrors, '冷启动不应产生未捕获异常').toEqual([])
    evidence.conditions = {
      viewport: page.viewportSize(),
      deviceScaleFactor: await page.evaluate(() => window.devicePixelRatio),
      networkThrottle: 'none（不注入节流；节流口径见 docs 的书面条件）',
      realDevice: '未测（Desktop Chromium 夹具，非真机）',
      touch: '未测（触屏口径见 touch-offline.spec.mjs，同为模拟）',
    }
  } finally {
    await server.close().catch(() => {})
    await writeEvidence('p6b-cold-load.json', evidence)
  }
})

/** 首次离线：在已知冷启动的状态下保存核心包，量出这一次额外写进 CacheStorage 的体积。 */
test('首次离线：保存核心包的体积与条目', async ({ page }) => {
  const evidence = {}
  const logs = collect(page)
  const server = await check('NETWORK', '起静态服务器', () => startServer())

  try {
    await check('UI', '打开外壳', () => openShell(page))
    await check('UI', '书屋进入 explore', () => waitScene(page))

    const firstOffline = await check('STATE', '首次离线：保存核心包', async () => {
      const before = await cacheTotals(page)
      // 用 saveOffline（真的要点击保存按钮）；expectSaved 只等文案、不点按钮。
      const saved = await saveOffline(page)
      await closeCompanion(page)
      const after = await cacheTotals(page)
      return {
        text: saved.text,
        reportedCoreBytes: saved.bytes,
        cacheBefore: { total: before.total, entries: before.entries },
        cacheAfter: { total: after.total, entries: after.entries, keys: after.keys },
        cacheDelta: after.total - before.total,
      }
    })
    evidence.firstOffline = firstOffline

    const manifest = JSON.parse(await readFile(fromRoot(`${distDir}/offline-manifest.json`), 'utf8'))
    const coreBytes = manifest.packs.core.bytes
    evidence.manifestCore = coreBytes
    // 现场读数应覆盖核心包（CacheStorage 里多出的是 marker 与响应头开销，故允许略大于构建值）。
    expect(firstOffline.cacheAfter.total, '保存后 CacheStorage 占用应至少覆盖核心包').toBeGreaterThanOrEqual(Math.floor(coreBytes * 0.9))
    expect(firstOffline.cacheAfter.entries, '保存后条目数应远大于 1').toBeGreaterThan(10)
    // UI 自报的核心体积应与构建值一致（差 1 位小数的舍入）。
    expect(Math.abs(firstOffline.reportedCoreBytes - coreBytes), 'UI 自报核心体积应与构建值一致').toBeLessThan(100_000)
    expect(logs.pageErrors, '保存过程不应产生未捕获异常').toEqual([])
  } finally {
    await server.close().catch(() => {})
    await writeEvidence('p6c-first-offline.json', evidence)
  }
})

/**
 * 暖缓存：先保存离线包，再在**同一标签**里重载，量第二次启动的传输量与 SW 应答占比。
 *
 * 预算上必须省：整段上限 90 s，而一次完整冷启动就要 ~43 s、保存 12.8 MB 要 ~10 s。
 * 所以预置阶段**不跑 waitScene**（保存离线包不依赖书屋进入 explore，只需要 iframe 与
 * 共学按钮就位），把省下的时间留给重载后的统计。
 *
 * 为什么用 reload 而不是新开标签：新开标签要重走一遍完整启动，同样顶破 90 s；
 * 重载也真实反映「已有缓存后再启动」，跨标签共享缓存的场景由 p4-dual-tab 专门覆盖。
 */
test('暖缓存口径：已保存后重载的传输量', async ({ page }) => {
  const evidence = { measure: 'same-tab reload（跨标签共享缓存见 p4-dual-tab）' }
  const server = await check('NETWORK', '起静态服务器', () => startServer())

  try {
    // 预置：只要 iframe 就位即可保存，不等书屋 explore。
    await check('UI', '预置：打开外壳', () => openShell(page))
    await check('STATE', '预置：保存离线版', () => saveOffline(page))
    await closeCompanion(page)
    await check('NETWORK', '预置：确认 SW 已接管', () => waitControlled(page))

    // 从这里开始才计入暖启动流量：重新挂一份采集器，保存阶段的大量请求不进这份账。
    const warmLogs = collect(page)
    const warm = await check('NETWORK', '暖缓存：重载并统计', async () => {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => Boolean(document.querySelector('iframe[title="山窗书屋正式场景"]')), null, { timeout: 25_000 })
      await page.waitForSelector('button.focus-pill', { timeout: 25_000 })
      await waitControlled(page, { timeout: 25_000 })
      await page.waitForTimeout(1_500)
      const picked = warmLogs.requests.filter((record) => cacheable(record.url))
      return {
        requests: picked.length,
        bytes: sumBytes(picked),
        unmeasured: unmeasured(picked),
        fromServiceWorker: picked.filter((record) => record.fromServiceWorker).length,
        cdn: warmLogs.cdn.length,
        foreign: picked.filter((record) => {
          try { return new URL(record.url).hostname !== '127.0.0.1' } catch { return true }
        }).length,
        pageErrors: warmLogs.pageErrors,
      }
    })
    evidence.warm = warm
    evidence.warm.swRatio = warm.requests > 0 ? Number((warm.fromServiceWorker / warm.requests).toFixed(3)) : null
    expect(warm.foreign, '暖缓存启动不应有外域请求').toBe(0)
    expect(warm.cdn, '暖缓存启动不应有 CDN 请求').toBe(0)
    expect(warm.pageErrors, '暖缓存启动不应有未捕获异常').toEqual([])
    // 判据不是「零请求」（导航与 SW 自检仍会发请求），而是「有资源由 SW 应答」。
    expect(warm.fromServiceWorker, '暖缓存下应有资源由 service worker 应答').toBeGreaterThan(0)
  } finally {
    await server.close().catch(() => {})
    await writeEvidence('p6d-warm-load.json', evidence)
    // 纯文本摘要，便于直接贴进文档；未测项写「未测」而不是猜数字。
    await mkdir(fromRoot(evidenceDir), { recursive: true }).catch(() => {})
    await writeFile(
      fromRoot(`${evidenceDir}/p6-size-summary.txt`),
      [
        'P-6 体积与加载口径摘要（每段独立用例，见同目录 p6a..p6d）',
        `core limit: ${CORE_LIMIT} B（只压 packs.core.bytes，且严格小于）`,
        'cold:       见 p6b-cold-load.json',
        'first-offline: 见 p6c-first-offline.json',
        'warm:       见 p6d-warm-load.json（同标签重载口径）',
        'throttle:   未注入（本机 loopback 无节流口径）',
        'real device: 未测',
        '',
      ].join('\n'),
      'utf8',
    )
  }
})
