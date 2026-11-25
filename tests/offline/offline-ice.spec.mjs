// P-5：ICE 凭据绝不进缓存。
//
// 这一条必须把「能测的」和「测不到的」分开写，否则很容易写出一个永远绿的假用例：
//
//   测得到的（本文件覆盖）：
//     - worker.js 的 cacheable() 明确排除 /(^|\/)ice(\/|$)/，fetch 处理器在入口就 return，
//       所以 /ice 请求既不进 cache 也不被 SW 应答。用同源 /__unused/ice 端点真实请求一次，
//       同时核对：服务器确实收到请求（说明不是被别处拦掉）、caches 里没有任何 ice 条目。
//     - 保存离线包之后，全部 cache 家族的所有请求 URL 里不含 ice（逐条扫描，不只看键名）。
//     - 离线态下请求 /ice 会真实失败（断网），且仍然不进缓存。
//
//   测不到的（明确标注未测）：
//     - dist-public 构建时没有设置 VITE_ICE_ENDPOINT，src/online/ice.ts 里 turnEndpoint 为
//       undefined，应用**根本不会**发起凭据请求。因此「真实凭据端点 → getIceConfiguration →
//       /ice 不进缓存」这条完整链路在 public 构建里没有可达路径，本轮记为未测。
//       要覆盖它需要带 VITE_ICE_ENDPOINT 另行构建（属于构建配置，按分工归 E）。
//
// 前置：npm run build:public
// 运行：npx playwright test -c tests/offline/playwright.config.mjs offline-ice
import { expect, test } from '@playwright/test'
import {
  cacheInventory, check, closeCompanion, collect, disconnect, saveOffline,
  openShell, startServer, waitControlled, waitScene, writeEvidence,
} from './helpers.mjs'

test.describe.configure({ mode: 'serial' })

// 故意用 /__acceptance/ice 这种同源深层路径：worker 的排除正则是 /(^|\/)ice(\/|$)/，
// 只有路径段恰好是 ice 才命中；写成 /icecream 或 /ices 就测不到真正想测的那条分支。
const ICE_PATHS = ['/ice', '/__acceptance/ice', '/__acceptance/ice/credentials']

/** 每个端点都返回一份「看起来像凭据」的 JSON，便于失败时肉眼确认请求真的发出去了。 */
const extras = new Map(ICE_PATHS.map((path) => [path, {
  status: 200,
  type: 'application/json; charset=utf-8',
  body: JSON.stringify({ iceServers: [{ urls: ['turn:127.0.0.1:3478?transport=udp'], username: 'fixture-user', credential: 'fixture-credential' }] }),
}]))

/** 扫描所有 cache 家族的全部请求 URL，返回任何命中 ice 路径段的条目。 */
async function iceCacheHits(page) {
  const inventory = await cacheInventory(page)
  const hits = []
  for (const cache of inventory) {
    for (const url of cache.urls) {
      if (/(^|\/)ice(\/|$)/.test(new URL(url).pathname)) hits.push({ cache: cache.key, url })
    }
  }
  return hits
}

test('ICE 凭据端点不进缓存，离线保存也不带上', async ({ page }) => {
  // 时序：外壳 + 书屋 + SW + 三次 ICE 探测 + 保存 12.8 MB + 两次全 cache 扫描。
  // 实测净耗时会越过 90 s 段限，故显式放宽；放宽只作用于本用例。
  test.setTimeout(300_000)
  const evidence = { fetches: [], devBuildIceRequest: null, console: {} }
  const logs = collect(page)
  const server = await check('NETWORK', '起带 ICE 端点的静态服务器', () => startServer({ extras }))
  let restore

  try {
    await check('UI', '打开外壳', () => openShell(page))
    await check('UI', '书屋进入 explore', () => waitScene(page))
    await check('NETWORK', 'service worker 接管页面', () => waitControlled(page))

    // 先记录构建事实：dist-public 里如果没有 VITE_ICE_ENDPOINT，应用不会请求凭据端点。
    const configured = await check('STATE', '读构建期是否配置了 ICE 端点', async () => {
      const script = await page.evaluate(async () => {
        const entry = [...document.querySelectorAll('script[src]')].map((node) => node.src).find((src) => /\/assets\/index-/.test(src))
        if (!entry) return null
        const response = await fetch(entry, { cache: 'no-store' })
        return response.text()
      })
      if (!script) return { readable: false }
      // 打包后 VITE_ICE_ENDPOINT 会被内联成字符串字面量；没有配置时该分支会被摇树。
      return {
        readable: true,
        mentionsIceEndpoint: script.includes('VITE_ICE_ENDPOINT'),
        mentionsTestIcePath: script.includes('/__test/ice'),
        bytes: script.length,
      }
    })
    evidence.build = configured
    evidence.devBuildIceRequest = logs.ice

    // 真实请求：页面被 SW 接管后，从页面里 fetch 三个 ice 路径。
    // 这些请求会经过 SW 的 fetch 处理器（同源、GET），正好走到 cacheable() 的排除分支。
    const results = await check('NETWORK', '经 SW 请求三个 ICE 路径', async () => {
      return page.evaluate(async (paths) => {
        const output = []
        for (const path of paths) {
          try {
            const response = await fetch(path, { cache: 'no-store' })
            output.push({ path, status: response.status, ok: response.ok, body: (await response.text()).slice(0, 200) })
          } catch (error) {
            output.push({ path, error: String(error) })
          }
        }
        return output
      }, ICE_PATHS)
    })
    evidence.fetches = results
    for (const item of results) {
      expect(item.error, `${item.path} 应能拿到应答（说明走的是网络而不是被 SW 应答）`).toBeUndefined()
      expect(item.status, `${item.path} 应返回 200`).toBe(200)
      expect(item.ok, `${item.path} 应 ok`).toBe(true)
    }

    // 服务器必须真的被访问到：否则「没进缓存」可能只是因为请求压根没发出去。
    const servedPaths = ICE_PATHS.filter((path) => (server.hits.get(path) ?? 0) > 0)
    evidence.serverHits = { all: Object.fromEntries(server.hits), servedPaths }
    expect(servedPaths.sort(), '三个 ICE 端点都应真实打到服务器').toEqual([...ICE_PATHS].sort())

    // 核心断言：没有任何 cache 收录 ice 路径。
    const hitsAfterFetch = await check('STATE', 'fetch 之后扫描 cache', () => iceCacheHits(page))
    evidence.hitsAfterFetch = hitsAfterFetch
    expect(hitsAfterFetch, 'ICE 请求不应进入任何 cache 家族').toEqual([])

    // 保存离线包之后再扫一次——保存过程会新建大量 cache 条目，是最容易漏掉的时点。
    // 用 saveOffline 而非 expectSaved：后者只等文案、不点按钮。
    await check('STATE', '保存离线版', () => saveOffline(page))
    const hitsAfterSave = await check('STATE', '保存之后扫描 cache', () => iceCacheHits(page))
    evidence.hitsAfterSave = hitsAfterSave
    expect(hitsAfterSave, '保存离线包不应把 ICE 凭据带进缓存').toEqual([])

    const inventory = await check('STATE', '读全部 cache 族的键名', () => cacheInventory(page))
    evidence.keys = inventory.map((cache) => ({ key: cache.key, entries: cache.entries, bytes: cache.bytes }))
    expect(inventory.length, '应至少有一个已保存的家族').toBeGreaterThan(0)
    expect(inventory.every((cache) => !/ice/i.test(cache.key)), '家族键里不应出现 ice').toBe(true)

    // 页面自身的请求日志里，除了上面三次主动 fetch，不应有其他 ice 流量——
    // 这条同时把「构建期未配置端点」这一事实钉在证据里。
    evidence.requestLogIce = logs.ice

    // 断网后再请求一次：必须失败，且仍然不进缓存。
    await closeCompanion(page)
    restore = await disconnect(page, server)
    const offlineResults = await check('NETWORK', '离线态请求 ICE 路径', async () => {
      return page.evaluate(async (paths) => {
        const output = []
        for (const path of paths) {
          try {
            const response = await fetch(path, { cache: 'no-store' })
            output.push({ path, status: response.status })
          } catch (error) {
            output.push({ path, failed: true, error: String(error).slice(0, 160) })
          }
        }
        return output
      }, ICE_PATHS)
    })
    evidence.offline = offlineResults
    for (const item of offlineResults) {
      // 允许两种结局：请求报错（网络彻底断）或拿到非 2xx。绝不能是 200 + 缓存命中。
      const rejected = item.failed === true || item.status >= 400
      expect(rejected, `${item.path} 离线态不应成功返回`).toBe(true)
    }
    const hitsOffline = await check('STATE', '离线请求之后扫描 cache', () => iceCacheHits(page))
    evidence.hitsOffline = hitsOffline
    expect(hitsOffline, '离线态的 ICE 请求同样不应进入缓存').toEqual([])

    evidence.console.pageErrors = logs.pageErrors
    evidence.pageErrorsNote = '离线态 fetch 失败会记一条 requestfailed，但不应产生未捕获异常'
    expect(logs.pageErrors, '不应产生未捕获异常').toEqual([])
  } finally {
    await restore?.().catch(() => {})
    await server.close().catch(() => {})
    await writeEvidence('p5-ice-not-cached.json', evidence)
  }
})
