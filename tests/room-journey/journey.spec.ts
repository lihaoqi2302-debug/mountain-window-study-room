import { devices, expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { icePath, nostrUrl } from '../online/fixture-env'

const scene = (page: Page) => page.frameLocator('iframe[title="山窗书屋正式场景"]')
const panel = (page: Page) => page.getByRole('dialog', { name: '山窗共学', exact: true })
const action = (parent: Page | Locator, name: string) => parent.getByRole('button', { name, exact: true })
const close = (page: Page) => action(panel(page), '关闭共学面板')
const sceneEntry = (page: Page) => scene(page).getByRole('button', { name: '共学房间', exact: true })
const tools = (page: Page) => scene(page).getByRole('button', { name: '书屋工具', exact: true })
const inviteInput = (page: Page) => panel(page).getByRole('textbox', { name: '邀请链接或房间码', exact: true })
const fallback = (page: Page) => panel(page).getByRole('textbox', { name: '邀请链接', exact: true })
const readHud = (page: Page) => scene(page).locator('#readPage')
const next = (page: Page) => scene(page).getByRole('button', { name: '下一页', exact: true })
const relayOrigin = new URL(nostrUrl).origin
const isLocalRelay = (url: URL) => url.origin === relayOrigin
const waitExplore = async (page: Page) => {
  await expect(scene(page).locator('body')).toHaveAttribute('data-entry', 'ready', { timeout: 60_000 })
  await expect(scene(page).locator('body')).toHaveAttribute('data-mode', 'explore')
}

async function openScene(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await waitExplore(page)
}

async function openPanel(page: Page) {
  await sceneEntry(page).click()
  await expect(panel(page)).toBeVisible()
}

const states = {
  solo: '本地独处', connecting: '正在连接信令', waiting: '等待好友加入',
  connected: '已连入', failed: '连接失败',
} as const

async function state(page: Page, value: keyof typeof states, timeout = 15_000) {
  const badge = panel(page).locator('.room-state')
  await expect(badge).toHaveAttribute('data-state', value, { timeout })
  await expect(badge).toHaveText(states[value])
  await expect(panel(page).getByRole('region', { name: '房间', exact: true }).getByRole('status')
    .filter({ hasText: states[value] })).toHaveCount(1)
}

// Never return dynamic room values via assertion output. URL navigation and input
// only receive the private data inside the browser; guarded errors omit it.
function invite(page: Page) {
  const url = new URL(page.url())
  expect(/^[\da-f]{32}~[\w-]{22}$/i.test(url.searchParams.get('room') ?? ''), 'host generated a full invite').toBe(true)
  return url.href
}

async function privateNavigate(page: Page, href: string) {
  try { await page.goto(href, { waitUntil: 'domcontentloaded' }) }
  catch { throw new Error('External invite navigation did not load') }
}

async function privateFill(field: Locator, value: string) {
  try { await field.fill(value) }
  catch { throw new Error('Could not fill the invite field') }
}

async function screenshot(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: info.outputPath(name + '.png'), animations: 'disabled',
    mask: [inviteInput(page), fallback(page)], maskColor: '#342b20' })
}

async function startReading(page: Page) {
  await expect(scene(page).locator('body')).toHaveAttribute('data-entry', 'ready', { timeout: 60_000 })
  await expect(scene(page).locator('body')).toHaveAttribute('data-mode', 'explore')
  await scene(page).getByRole('button', { name: '翻开这本书', exact: true }).click()
  await expect(scene(page).locator('body')).toHaveAttribute('data-mode', 'reading')
  await expect(readHud(page)).toHaveText(/第 .+ 页 \/ 共 6 页/)
  await expect(next(page)).toBeEnabled()
}

async function turnPage(page: Page) {
  const before = (await readHud(page).textContent())?.trim()
  await next(page).click()
  await expect(readHud(page)).not.toHaveText(before!)
  await expect(readHud(page)).toHaveText(/第 .+ 页 \/ 共 6 页/)
}

function observeNetwork(page: Page) {
  let ice = 0, relay = 0, externalSockets = 0
  page.on('request', (req) => { if (new URL(req.url()).pathname === icePath) ice++ })
  page.on('websocket', (socket) => {
    const url = new URL(socket.url())
    if (isLocalRelay(url)) relay++
    if (url.hostname !== '127.0.0.1') externalSockets++
  })
  return () => ({ ice, relay, externalSockets })
}

async function clipboard(page: Page, blocked: boolean) {
  await page.addInitScript((deny) => {
    let contents = ''
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (text: string) => {
        if (deny) throw new DOMException('Fixture denied clipboard', 'NotAllowedError')
        contents = text
      },
      readText: async () => contents,
    } })
  }, blocked)
}

test('1280 · ordinary visit starts solo, no signaling, built-in book turns', async ({ page }, info) => {
  const network = observeNetwork(page)
  await openScene(page)
  await expect(panel(page)).toBeHidden()
  await expect(sceneEntry(page)).toBeVisible()
  await screenshot(page, info, '01-solo-entry-1280')
  await openPanel(page)
  await state(page, 'solo')
  await expect(action(panel(page), '创建房间')).toBeEnabled()
  await close(page).click()
  await startReading(page)
  await turnPage(page)
  expect(network()).toEqual({ ice: 0, relay: 0, externalSockets: 0 })
})

test('1280 · keyboard crosses iframe, traps Tab both ways, and restores focus', async ({ page }) => {
  await openScene(page)
  // Traverse with actual Tab presses from the default page focus, not locator.focus/press.
  const reached = async (element: Locator) => element.evaluate((node) => node === node.ownerDocument.activeElement)
  for (let i = 0; i < 50 && !(await reached(sceneEntry(page))); i++) await page.keyboard.press('Tab')
  await expect(sceneEntry(page)).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(close(page)).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(action(panel(page), '本科生速通指南')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(close(page)).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(action(panel(page), '创建房间')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(panel(page)).toBeHidden()
  await expect(sceneEntry(page)).toBeFocused()
  await expect(scene(page).locator('body')).toHaveAttribute('data-mode', 'explore')
  await page.keyboard.press('Space')
  await expect(close(page)).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(panel(page)).toBeHidden()
  await expect(sceneEntry(page)).toBeFocused()
})

test('1280 · invalid external invite is visible and recoverable to reading', async ({ page }, info) => {
  const network = observeNetwork(page)
  await privateNavigate(page, '/?room=fixture-truncated')
  const entry = page.getByRole('region', { name: '共学邀请', exact: true })
  await expect(entry.getByRole('status')).toContainText('邀请链接不完整')
  await expect(panel(page)).toBeHidden()
  await screenshot(page, info, '03a-invalid-landing-1280')
  await action(entry, '查看邀请').click()
  await expect(panel(page)).toBeVisible()
  await state(page, 'failed')
  await expect(panel(page).getByText(/邀请链接不完整/)).toBeVisible()
  await screenshot(page, info, '03-invalid-invite-1280')
  expect(new URL(page.url()).searchParams.has('room')).toBe(false)
  await action(panel(page), '返回单机').click()
  await state(page, 'solo')
  await close(page).click()
  await startReading(page)
  await turnPage(page)
  expect(network()).toEqual({ ice: 0, relay: 0, externalSockets: 0 })
})

test('1280 · two isolated sessions join externally, leave to reading, then rejoin manually', async ({ page, browser, baseURL }, info) => {
  await clipboard(page, false)
  const hostNetwork = observeNetwork(page)
  await test.step('host opens real scene and waits for one friend', async () => {
    await openScene(page)
    await openPanel(page)
    await action(panel(page), '创建房间').click()
    await state(page, 'waiting')
    await screenshot(page, info, '02-waiting-for-friend-1280')
  })
  await test.step('host copies the full link', async () => {
    await action(panel(page), '复制邀请链接').click({ timeout: 15_000 })
    await expect(panel(page).getByRole('status').filter({ hasText: '邀请链接已复制' })).toBeVisible()
    expect(await page.evaluate(async () => await navigator.clipboard.readText() === location.href), 'clipboard contains full invite').toBe(true)
  }, { timeout: 25_000 })
  const href = invite(page)
  await test.step('copy diagnostics and verify redaction', async () => {
    await panel(page).getByText('网络诊断', { exact: true }).click()
    await action(panel(page), '复制诊断').click()
    await expect(panel(page).getByRole('status').filter({ hasText: '诊断信息已复制（已脱敏）' })).toBeVisible()
    expect(await page.evaluate(async () => {
      const room = new URL(location.href).searchParams.get('room')!
      const raw = await navigator.clipboard.readText()
      try { return !Object.hasOwn(JSON.parse(raw), 'room') && !room.split('~').some((privatePart) => raw.includes(privatePart)) }
      catch { return false }
    }), 'diagnostic clipboard excludes both room id and invitation secret').toBe(true)
  }, { timeout: 25_000 })
  await test.step('unload host scenery while host remains in room', async () => {
    // Host already used the real scene entrance; its top-level app owns the connection.
    await page.locator('iframe[title="山窗书屋正式场景"]').evaluate((el) => {
      (el as HTMLIFrameElement).src = 'about:blank'
    }, undefined, { timeout: 10_000 })
  }, { timeout: 20_000 })
  const guest = await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' })
  try {
    const friend = await guest.newPage()
    const guestNetwork = observeNetwork(friend)
    await test.step('guest follows external link and both sessions connect', async () => {
      await privateNavigate(friend, href)
      const externalEntry = action(friend, '查看邀请')
      await expect(externalEntry).toBeVisible()
      await externalEntry.press('Enter', { timeout: 20_000 })
      await expect(panel(friend)).toBeVisible()
      await state(friend, 'connected', 40_000)
      await state(page, 'connected', 40_000)
    }, { timeout: 90_000 })
    for (const member of [page, friend]) await expect(panel(member).getByText('房间里有 2 人', { exact: true })).toBeVisible()
    for (const network of [hostNetwork, guestNetwork]) {
      const { ice, relay, externalSockets } = network()
      expect(ice).toBeGreaterThan(0)
      expect(relay).toBeGreaterThan(0)
      expect(externalSockets).toBe(0)
    }
    await screenshot(friend, info, '04-connected-1280')
    await expect(panel(page).getByRole('combobox', { name: '窗外', exact: true })).toBeEnabled()
    await expect(panel(friend).locator('#chat-draft')).toBeEditable()
    const nickname = panel(friend).getByRole('textbox', { name: '昵称', exact: true })
    await nickname.fill('回归读者')
    await nickname.press('Tab')
    await action(panel(friend), '返回单机').click()
    await state(friend, 'solo')
    expect(new URL(friend.url()).searchParams.has('room')).toBe(false)
    await expect(nickname).toHaveValue('回归读者')
    await close(friend).click()
    await startReading(friend)
    await turnPage(friend)
    const savedPage = (await readHud(friend).textContent())?.trim()
    await scene(friend).getByRole('button', { name: '章节便签', exact: true }).click()
    const notes = friend.getByRole('dialog', { name: '《地球 Online》章节便签' })
    await expect(notes.getByRole('textbox', { name: '写一张便签' })).toBeVisible()
    await friend.keyboard.press('Escape')
    await expect(notes).toBeHidden()
    const readerEntry = action(friend, '共学房间')
    await readerEntry.click()
    await action(panel(friend), '加入房间').click()
    await privateFill(inviteInput(friend), `  ${href}  `)
    await action(panel(friend), '进入房间').click()
    await state(friend, 'connected', 30_000)
    await action(panel(friend), '返回单机').click()
    await state(friend, 'solo')
    await friend.keyboard.press('Escape')
    await expect(readerEntry).toBeFocused()
    await expect(scene(friend).locator('body')).toHaveAttribute('data-mode', 'reading')
    await expect(readHud(friend)).toHaveText(savedPage!)
    await turnPage(friend)
  } finally { await guest.close().catch(() => {}) }
})

test('1280 · stalls only local signaling; times out, retries same room, cancels and reads', async ({ page }) => {
  let blocked = true
  let attempts = 0
  await page.routeWebSocket(isLocalRelay, (socket) => {
    attempts++
    if (!blocked) socket.connectToServer()
    // Holding the intercepted socket (rather than shortening application timers)
    // is verified below with the real timeout feedback.
    else void socket.close({ code: 1013, reason: 'fixture only' })
  })
  let releaseIce!: () => void
  const iceGate = new Promise<void>((resolve) => { releaseIce = resolve })
  await page.route(`**${icePath}`, async (route) => {
    await iceGate
    await route.continue().catch(() => {}) // the user's cancel can abort this held request
  }, { times: 1 })
  await openScene(page)
  await openPanel(page)
  await Promise.all([
    page.waitForRequest((req) => new URL(req.url()).pathname === icePath),
    action(panel(page), '创建房间').click(),
  ])
  try {
    await state(page, 'connecting')
    await action(panel(page), '取消连接，返回单机').click()
    await state(page, 'solo')
    expect(new URL(page.url()).searchParams.has('room'), 'cancellation removes any room parameter').toBe(false)
  } finally { releaseIce() }
  await action(panel(page), '创建房间').click()
  await state(page, 'connecting')
  await state(page, 'failed', 35_000)
  await expect(panel(page).getByText(/公共信令连接超时/)).toBeVisible()
  expect(attempts).toBeGreaterThan(0)
  const original = invite(page)
  blocked = false
  await action(panel(page), '重试连接').click()
  await state(page, 'waiting', 30_000)
  expect(page.url() === original, 'retry preserves room').toBe(true)
  await action(panel(page), '取消连接，返回单机').click()
  await state(page, 'solo')
  expect(new URL(page.url()).searchParams.has('room')).toBe(false)
  await close(page).click()
  await startReading(page)
  await turnPage(page)
})

for (const width of [360, 390]) {
  test(`${width} · touch tools, invalid/cancel, clipboard denied, and long layout`, async ({ browser, baseURL }, info) => {
    const context = await browser.newContext({ ...devices['iPhone 13'], baseURL, reducedMotion: 'reduce',
      viewport: { width, height: 760 }, deviceScaleFactor: 1 })
    try {
      const page = await context.newPage()
      await clipboard(page, true)
      const network = observeNetwork(page)
      await openScene(page)
      expect(await page.evaluate(() => innerWidth)).toBe(width)
      await tools(page).tap()
      await sceneEntry(page).tap()
      await expect(close(page)).toBeFocused()
      await action(panel(page), '加入房间').tap()
      const field = inviteInput(page)
      await expect(field).toBeFocused()
      for (const malformed of ['x'.repeat(240), 'a'.repeat(32) + '~missing-tail']) {
        await privateFill(field, malformed)
        await action(panel(page), '进入房间').tap()
        await expect(panel(page).getByRole('alert')).toHaveText('请输入完整的邀请链接或房间码。')
        await expect(field).toHaveAttribute('aria-invalid', 'true')
        await state(page, 'solo')
        await expectNoHorizontalScroll(page, width)
      }
      expect(network()).toEqual({ ice: 0, relay: 0, externalSockets: 0 })
      await action(panel(page), '取消').tap()
      await expect(field).toBeHidden()
      await expect(action(panel(page), '加入房间')).toBeFocused()
      await close(page).tap()
      await expect(panel(page)).toBeHidden()
      await expect(tools(page)).toBeFocused()
      await tools(page).tap()
      await sceneEntry(page).tap()
      const nickname = panel(page).getByRole('textbox', { name: '昵称', exact: true })
      await nickname.fill('WWWWWWWWWWWWWWWW')
      await nickname.press('Tab')
      await expect(nickname).toHaveValue('WWWWWWWWWWWWWWWW')
      await action(panel(page), '创建房间').tap()
      await state(page, 'waiting')
      await action(panel(page), '复制邀请链接').tap()
      await expect(panel(page).getByRole('status').filter({ hasText: /剪贴板不可用/ })).toBeVisible()
      const link = fallback(page)
      await expect(link).toBeFocused()
      await expect(link).toHaveAttribute('readonly', '')
      expect(await link.evaluate((el: HTMLInputElement) => el.value === location.href
        && el.selectionStart === 0 && el.selectionEnd === el.value.length), 'fallback selects the full invite').toBe(true)
      await expectNoHorizontalScroll(page, width)
      await screenshot(page, info, `05-masked-long-link-${width}`)
      const bottom = action(panel(page), '本科生速通指南')
      await bottom.scrollIntoViewIfNeeded()
      await expect(bottom).toBeInViewport()
      expect(await panel(page).evaluate((el) => {
        const scrollables = [el, ...el.querySelectorAll('*')].filter((node) => /auto|scroll/.test(getComputedStyle(node).overflowY))
        return scrollables.some((node) => node.scrollTop > 0)
      }), 'panel scrolls down to book actions').toBe(true)
      await action(panel(page), '取消连接，返回单机').tap()
      await state(page, 'solo')
      await expect(link).toBeHidden()
    } finally { await context.close() }
  })
}

async function expectNoHorizontalScroll(page: Page, width: number) {
  const metrics = await panel(page).evaluate((el) => {
    const box = el.getBoundingClientRect()
    const room = el.querySelector('.room-controls')!
    return { viewport: document.documentElement.scrollWidth, within: box.left >= 0 && box.right <= innerWidth,
      exceeds: Math.max(el.scrollWidth - el.clientWidth, room.scrollWidth - room.clientWidth) }
  })
  expect(metrics).toEqual({ viewport: width, within: true, exceeds: 0 })
}
