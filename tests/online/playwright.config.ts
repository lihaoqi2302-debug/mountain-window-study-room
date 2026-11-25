// Isolated online tests: same-machine multi-context sessions + simulated isolated network (local nostr relay + local TURN).
// NOT a real cross-network test.
import { defineConfig } from '@playwright/test'
import { directPort, forcedRelayPort, icePath, nostrPort, nostrUrl, turnPort } from './fixture-env'

const vite = (port: number, policy: 'all' | 'relay') => ({
  command: `node node_modules/vite/bin/vite.js --mode test --host 127.0.0.1 --port ${port} --strictPort`,
  cwd: '../..',
  url: `http://127.0.0.1:${port}`,
  env: {
    VITE_TEST_RELAYS: nostrUrl,
    VITE_ICE_ENDPOINT: icePath,
    VITE_STUN_SERVERS: `stun:127.0.0.1:${turnPort}`,
    VITE_TEST_ICE_POLICY: policy,
    TEST_RELAY_PORT: String(nostrPort),
    TEST_TURN_PORT: String(turnPort),
    TEST_ICE_MODE: 'turn',
  },
  reuseExistingServer: false,
  timeout: 120_000,
})

const outputDir = process.env.STUDY_TEST_OUTPUT_DIR ?? '../../test-results/online'
const reportFile = process.env.STUDY_TEST_REPORT_FILE ?? '../../test-results/online-report.json'

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  timeout: 90_000,
  workers: 1,
  retries: 0,
  outputDir,
  reporter: [['list'], ['json', { outputFile: reportFile }]],
  use: {
    headless: true,
    launchOptions: { args: [
      '--disable-features=WebRtcHideLocalIpsWithMdns',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
    ] },
  },
  projects: [
    { name: 'default', testIgnore: /relay\.spec\.ts$/, use: { baseURL: `http://127.0.0.1:${directPort}` } },
    { name: 'forced-relay', testMatch: /relay\.spec\.ts$/, use: { baseURL: `http://127.0.0.1:${forcedRelayPort}` } },
  ],
  webServer: [
    {
      command: 'node scripts/test-net/start.mjs',
      cwd: '../..',
      port: nostrPort,
      env: { TEST_RELAY_PORT: String(nostrPort), TEST_TURN_PORT: String(turnPort) },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    vite(directPort, 'all'),
    vite(forcedRelayPort, 'relay'),
  ],
})
