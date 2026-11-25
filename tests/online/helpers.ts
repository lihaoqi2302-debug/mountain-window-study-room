// Shared helpers. Scope: same-machine multi-session + simulated isolated network, NOT real cross-network.
import { expect } from '@playwright/test'
import type { Browser, BrowserContext, Page } from '@playwright/test'
import { directPort, icePath, nostrUrl } from './fixture-env'

export type Category = 'UI' | 'STATE' | 'NETWORK'
export type DiagState = {
  roomStatus: string
  roomMessage: string
  roomId: string | null
  isHost: boolean
  peers: number
  chats: Array<{ id: string; body: string }>
  notes: Array<{ id: string; body: string }>
  diagnostics: { relays: number; route: string; turnStatus: string; turnFailure: string; httpStatus: number; counts: Record<string, number> }
}

/** Wraps an assertion so the failure message carries its category. */
export async function check<T>(category: Category, label: string, fn: () => Promise<T>): Promise<T> {
  try { return await fn() } catch (error) {
    const err = new Error(`[${category}] ${label}: ${(error as Error).message}`)
    err.stack = (error as Error).stack
    throw err
  }
}

export async function diag(page: Page): Promise<DiagState> {
  return page.evaluate(() => (window as unknown as { __studyRoomDiag: { state: DiagState } }).__studyRoomDiag.state)
}

export async function waitDiag(page: Page, category: Category, label: string, predicate: (s: DiagState) => boolean, timeout = 30_000) {
  let last: DiagState | undefined
  await check(category, label, () => expect.poll(async () => { last = await diag(page); return predicate(last) }, { timeout, intervals: [200, 500] }).toBe(true))
    .catch((error) => { throw new Error(`${(error as Error).message}\nlast state: ${JSON.stringify(last)}`) })
  return last!
}

export async function openSession(browser: Browser, iceMode = 'turn', baseURL?: string): Promise<{ context: BrowserContext; page: Page }> {
  const address = baseURL ?? `http://127.0.0.1:${directPort}`
  const context = await browser.newContext({ baseURL: address })
  const origin = new URL(address)
  await context.addCookies([{ name: 'ice-mode', value: iceMode, domain: origin.hostname, path: '/' }])
  const page = await context.newPage()
  return { context, page }
}

async function runOnline(page: Page, action: () => Promise<unknown>) {
  const sockets = new Set<string>()
  const record = (socket: { url: () => string }) => sockets.add(socket.url())
  page.on('websocket', record)
  try {
    const [request] = await Promise.all([
      page.waitForRequest((entry) => new URL(entry.url()).pathname === icePath, { timeout: 20_000 }),
      // Install the listener before navigation. Loading Vite modules and fetching ICE
      // can delay opening the socket, especially for the first test in a clean tree.
      page.waitForEvent('websocket', {
        predicate: (socket) => new URL(socket.url()).origin === nostrUrl,
        timeout: 20_000,
      }),
      action(),
    ])
    expect(request.method()).toBe('GET')
    expect(new URL(request.url()).origin).toBe(new URL(page.url()).origin)
    expect([...sockets].every((url) => new URL(url).hostname === '127.0.0.1')).toBe(true)
  } finally {
    page.off('websocket', record)
  }
}

export async function createRoom(page: Page) {
  await page.goto('/')
  const create = page.getByRole('button', { name: '创建房间', exact: true })
  await check('UI', '创建房间入口已渲染', () => expect(create).toBeEnabled({ timeout: 40_000 }))
  await check('NETWORK', '创建房间请求本地 ICE 和 Nostr', () =>
    runOnline(page, () => create.click()))
  await check('STATE', '房间链接生成', () => expect.poll(() => new URL(page.url()).searchParams.get('room') ?? '', { timeout: 20_000 }).toMatch(/~/))
  return new URL(page.url()).searchParams.get('room')!
}

export async function joinRoomFromUI(page: Page, room: string, client: number) {
  await check('UI', `第 ${client} 端独立加载应用并填入房间码`, async () => {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 45_000 })
    const open = page.getByRole('button', { name: '加入房间', exact: true })
    await expect(open).toBeEnabled({ timeout: 40_000 })
    await open.click()
    await page.getByRole('textbox', { name: '邀请链接或房间码' }).fill(room)
  })
  await check('NETWORK', `第 ${client} 端提交后请求本地 ICE 和 Nostr`, () =>
    runOnline(page, () => page.getByRole('button', { name: '进入房间', exact: true }).click()))
}

export async function joinRoom(page: Page, room: string) {
  await check('NETWORK', '加入房间请求本地 ICE 和 Nostr', () =>
    runOnline(page, () => page.goto('/?room=' + encodeURIComponent(room))))
}

export async function sendChat(page: Page, body: string) {
  await page.locator('#chat-draft').fill(body)
  await page.locator('.room-chat form button[type=submit]').click({ timeout: 5_000 })
  try {
    await expect(page.locator('#chat-draft')).toHaveValue('', { timeout: 5_000 })
  } catch (error) {
    const d = await diag(page)
    console.log('[sendChat 失败]', body, JSON.stringify({ roomStatus: d.roomStatus, peers: d.peers, roomId: d.roomId, chats: d.chats.length }),
      await page.locator('.room-chat').innerText())
    throw error
  }
}

export const chatCount = (page: Page) => page.locator('.chat-log article').count()
