import { defineConfig } from '@playwright/test'

// Set before loading the shared offset calculations, including in workers.
if (process.env.STUDY_TEST_PORT_OFFSET && process.env.STUDY_TEST_PORT_OFFSET !== '340') {
  throw new Error('Room Journey exclusively uses STUDY_TEST_PORT_OFFSET=340')
}
process.env.STUDY_TEST_PORT_OFFSET = '340'
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1' // no automatic browser/ARIA snapshots containing private inputs

const { directPort, nostrPort, turnPort, nostrUrl, icePath } = await import('../online/fixture-env')
const address = `http://127.0.0.1:${directPort}`
const output = process.env.STUDY_ROOM_JOURNEY_TARGETED === '1'
  ? '../../test-results/room-journey/run-targeted' : '../../test-results/room-journey/run'

export default defineConfig({
  testDir: '.',
  testMatch: /journey\.spec\.ts$/,
  timeout: 240_000, // SwiftShader can be slow in cold or multiple simultaneous scene contexts
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  forbidOnly: true,
  outputDir: output,
  reporter: [['list', { printSteps: true }], ['json', { outputFile: `${output}/report.json` }]],
  use: {
    headless: true,
    baseURL: address,
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce',
    trace: 'off', video: 'off', screenshot: 'off',
    launchOptions: { args: [
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
      '--disable-features=WebRtcHideLocalIpsWithMdns',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio',
      '--disable-background-timer-throttling', // retain session timers, allow background renderer throttling
    ] },
  },
  webServer: [
    { command: 'node scripts/test-net/start.mjs', cwd: '../..', port: nostrPort,
      env: { TEST_RELAY_PORT: String(nostrPort), TEST_TURN_PORT: String(turnPort) }, reuseExistingServer: false },
    { command: `node node_modules/vite/bin/vite.js --config tests/room-journey/vite-fixture.config.ts --mode public --host 127.0.0.1 --port ${directPort} --strictPort`,
      cwd: '../..', url: address, reuseExistingServer: false,
      env: { VITE_TEST_RELAYS: nostrUrl, VITE_ICE_ENDPOINT: icePath,
        VITE_STUN_SERVERS: `stun:127.0.0.1:${turnPort}`, TEST_TURN_PORT: String(turnPort), TEST_ICE_MODE: 'turn' },
    },
  ],
})
