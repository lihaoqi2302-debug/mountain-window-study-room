// Timing diagnostics use only local fixtures and redacted phases; no room codes or addresses are recorded.
import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { createRoom, openSession, waitDiag } from './helpers'
import { icePath, nostrUrl } from './fixture-env'

type TraceEvent = { kind: string; at: number }

async function instrumentSignaling(page: Awaited<ReturnType<typeof openSession>>['page']) {
  await page.addInitScript((relay) => {
    const events: TraceEvent[] = []
    Object.defineProperty(window, '__studyRoomNetworkTrace', { value: events })
    const NativeWebSocket = window.WebSocket
    window.WebSocket = new Proxy(NativeWebSocket, {
      construct(target, args) {
        const socket = Reflect.construct(target, args) as WebSocket
        if (new URL(String(args[0])).origin === relay) {
          events.push({ kind: 'signaling-created', at: performance.now() })
          socket.addEventListener('open', () => events.push({ kind: 'signaling-open', at: performance.now() }))
          socket.addEventListener('error', () => events.push({ kind: 'signaling-error', at: performance.now() }))
          socket.addEventListener('close', () => events.push({ kind: 'signaling-close', at: performance.now() }))
        }
        return socket
      },
    })
  }, nostrUrl)
}

async function phaseSnapshot(page: Awaited<ReturnType<typeof openSession>>['page']) {
  return page.evaluate((path) => {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    const ice = performance.getEntriesByType('resource').find((entry) => new URL(entry.name).pathname === path) as PerformanceResourceTiming | undefined
    const trace = (window as unknown as { __studyRoomNetworkTrace: TraceEvent[] }).__studyRoomNetworkTrace
    return {
      now: performance.now(),
      navigation: navigation ? {
        domContentLoaded: navigation.domContentLoadedEventEnd,
        load: navigation.loadEventEnd,
      } : null,
      firstPaint: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
      ice: ice ? { start: ice.startTime, responseEnd: ice.responseEnd, duration: ice.duration } : null,
      signaling: trace,
    }
  }, icePath)
}

test('首屏、ICE 取凭据、信令建联分别记录时间点', async ({ browser }, testInfo) => {
  const { context, page } = await openSession(browser)
  await instrumentSignaling(page)
  const wallStartedAt = new Date().toISOString()
  await page.goto('/')
  const create = page.getByRole('button', { name: '创建房间', exact: true })
  await expect(create).toBeEnabled({ timeout: 40_000 })
  const firstScreenMs = await page.evaluate(() => performance.now())
  await Promise.all([
    page.waitForRequest((request) => new URL(request.url()).pathname === icePath),
    page.waitForEvent('websocket', { predicate: (socket) => new URL(socket.url()).origin === nostrUrl }),
    create.click(),
  ])
  await waitDiag(page, 'NETWORK', '信令打开且房间身份就绪', (state) =>
    Boolean(state.roomId?.includes('~')) && state.diagnostics.relays > 0, 30_000)
  const runtime = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    browserTime: new Date().toISOString(),
    language: navigator.language,
    online: navigator.onLine,
  }))
  const phases = await phaseSnapshot(page)
  const report = { wallStartedAt, wallEndedAt: new Date().toISOString(), runtime, firstScreenMs, ...phases }
  writeFileSync(testInfo.outputPath('phase-timings.json'), JSON.stringify(report, null, 2))
  console.log(`PHASE_TIMINGS ${JSON.stringify(report)}`)
  expect(report.ice).not.toBeNull()
  expect(report.signaling.some(({ kind }) => kind === 'signaling-created')).toBe(true)
  expect(report.signaling.some(({ kind }) => kind === 'signaling-open')).toBe(true)
  await context.close()
})

test('复现 20 秒事件等待超时并区分产品后续恢复', async ({ browser }, testInfo) => {
  test.setTimeout(100_000)
  const { context, page } = await openSession(browser)
  await instrumentSignaling(page)
  const delayed: string[] = []
  await page.route(/trystero/, async (route) => {
    delayed.push(route.request().url().split('?')[0].split('/').at(-1) ?? 'trystero')
    await new Promise((resolve) => setTimeout(resolve, 21_000))
    await route.continue()
  })
  const startedAt = Date.now()
  let eventError = ''
  try {
    await createRoom(page)
  } catch (error) {
    eventError = (error as Error).message.split('\n').slice(0, 4).join('\n')
  }
  const eventTimeoutMs = Date.now() - startedAt
  expect(eventError).toMatch(/Timeout 20000ms exceeded/)
  // The application itself has no 20-second dynamic-import deadline and can finish afterwards.
  await waitDiag(page, 'NETWORK', '超时后应用仍完成信令建联', (state) =>
    Boolean(state.roomId?.includes('~')) && state.diagnostics.relays > 0, 45_000)
  const recoveredMs = Date.now() - startedAt
  const phases = await phaseSnapshot(page)
  const report = {
    startedAt: new Date(startedAt).toISOString(), endedAt: new Date().toISOString(),
    injectedDelayMs: 21_000, eventTimeoutMs, recoveredMs, eventError, delayedModules: delayed,
    ...phases,
  }
  writeFileSync(testInfo.outputPath('event-timeout.json'), JSON.stringify(report, null, 2))
  console.log(`EVENT_TIMEOUT ${JSON.stringify(report)}`)
  expect(recoveredMs).toBeGreaterThanOrEqual(21_000)
  await context.close()
})
