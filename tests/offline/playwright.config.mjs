// C 包（离线与 PDF 闭环）真实浏览器夹具配置。
//
// 与 tests/online 的三个关键差异：
//   1. 不配 webServer。断网场景必须能在用例中途把服务器整个关掉再原样起回来，
//      所以静态服务器由每个用例用 helpers.startServer() 自建自停（见 serve.mjs）。
//      Playwright 托管的 webServer 在用例内无法确定地 kill。
//   2. 被验收的是 dist-public 生产构建。离线控件只在 import.meta.env.PROD 且
//      安全上下文下渲染（OfflineControls.tsx:21），dev server 上根本不存在；
//      127.0.0.1 属于安全上下文，service worker 可注册。
//   3. 单 Chromium 串行 + 90 秒段限。C 包既往事故源于并发 headless 抢内存，
//      workers 硬性锁 1，每段结束立即 close。
//
// 端口 = preview:public 5197 + 400 偏移 = 5597，避开在线套件占用的 5181/5182/7447/3478。
// 运行（需先 npm run build:public 产出 dist-public）：
//   npx playwright test -c tests/offline/playwright.config.mjs
import { defineConfig, devices } from '@playwright/test'
import { baseURL } from './fixture-env.mjs'

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.mjs$/,
  // 每段 ≤90 秒：离线保存 + 断网重开留足余量，卡顿时也能被掐断而不拖住整机。
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: true,
  outputDir: '../../test-results/round2-c',
  reporter: [
    ['list'],
    ['json', { outputFile: '../../test-results/round2-c/report.json' }],
  ],
  use: {
    headless: true,
    baseURL,
    trace: 'off',
    video: 'off',
    screenshot: 'only-on-failure',
    launchOptions: {
      args: [
        // 外域一律解析失败、只放行 127.0.0.1：「零 CDN」不必只靠断网证明。
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
        // 无 GPU 验收机上让 WebGL 走 SwiftShader，与 tests/mobile、perf 基线同口径。
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
        // 环境音只断言 AudioContext 与 amb 状态，不依赖真实声卡输出。
        '--mute-audio',
        '--autoplay-policy=no-user-gesture-required',
        // 后台标签页的计时与 service worker 不能被节流干扰。
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
      ],
    },
  },
  projects: [
    {
      name: 'desktop',
      testIgnore: /touch-offline\.spec\.mjs$/,
      use: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
    },
    {
      // 触屏口径只是 Playwright 模拟，不是真机；结论必须标注为夹具。
      name: 'touch',
      testMatch: /touch-offline\.spec\.mjs$/,
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        hasTouch: true,
        isMobile: true,
        userAgent: devices['iPhone 13'].userAgent,
      },
    },
  ],
})
