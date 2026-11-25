// P1-6 移动端画质/纹理生命周期测试配置（独立于 tests/online，不改 package.json）
// 运行：npx playwright test -c tests/mobile/playwright.config.mjs
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.mjs$/,
  timeout: 120_000,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: '../../docs/delegated/evidence/mobile/results.json' }]],
  use: {
    baseURL: process.env.PREVIEW_URL || 'http://127.0.0.1:5197/',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
    userAgent: devices['iPhone 13'].userAgent,
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
});
