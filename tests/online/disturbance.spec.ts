// Additional disturbance rounds against local isolated fixtures; no real device or cross-network claim.
import { test, expect } from '@playwright/test'
import { createRoom, diag, joinRoom, openSession, waitDiag } from './helpers'

const connected = (n: number) => (d: { roomStatus: string; peers: number }) => d.roomStatus === 'connected' && d.peers === n

test('后台停留与 bfcache 恢复后保持双端连接', async ({ browser }) => {
  test.setTimeout(120_000)
  const a = await openSession(browser)
  const b = await openSession(browser)
  const room = await createRoom(a.page)
  await joinRoom(b.page, room)
  await waitDiag(a.page, 'NETWORK', '双端建联', connected(1))
  await waitDiag(b.page, 'NETWORK', '双端建联', connected(1))

  const foreground = await a.context.newPage()
  await foreground.goto('about:blank')
  await foreground.bringToFront()
  await a.page.waitForTimeout(16_000)
  await b.page.bringToFront()
  await waitDiag(a.page, 'STATE', '后台后 A 未误报超时', connected(1))
  await waitDiag(b.page, 'STATE', '后台后 B 未误报超时', connected(1))

  await b.page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })))
  await waitDiag(b.page, 'STATE', 'bfcache 挂起', (state) => state.roomStatus === 'connecting')
  await b.page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
  await waitDiag(a.page, 'NETWORK', 'A 见到恢复后的 B', connected(1), 45_000)
  await waitDiag(b.page, 'NETWORK', 'B bfcache 恢复重连', connected(1), 45_000)
  expect((await diag(b.page)).roomId).toBe(room)
  await foreground.close()
  await a.context.close(); await b.context.close()
})

test('房主离线时设置保留且重连恢复权限与同步', async ({ browser }) => {
  test.setTimeout(150_000)
  const a = await openSession(browser)
  const b = await openSession(browser)
  const room = await createRoom(a.page)
  await joinRoom(b.page, room)
  await waitDiag(a.page, 'NETWORK', '双端建联', connected(1))
  await waitDiag(b.page, 'NETWORK', '双端建联', connected(1))

  await a.page.locator('#room-weather').selectOption('rain')
  await a.page.locator('#room-hearth').selectOption('off')
  await expect(b.page.locator('.environment-controls')).toContainText('雨夜')
  await expect(b.page.locator('.environment-controls')).toContainText('炉火熄灭')

  await a.context.setOffline(true)
  await waitDiag(a.page, 'STATE', '房主离线进入 failed', (state) => state.roomStatus === 'failed', 15_000)
  await waitDiag(b.page, 'STATE', '成员看到房主离开', (state) => state.peers === 0, 45_000)
  await expect(b.page.locator('.environment-controls')).toContainText('房主离线')
  await expect(b.page.locator('.environment-controls')).toContainText('雨夜')
  await expect(b.page.locator('.environment-controls')).toContainText('炉火熄灭')

  await a.context.setOffline(false)
  await a.page.getByRole('button', { name: '重试连接' }).first().click()
  await waitDiag(a.page, 'NETWORK', '房主恢复连接', connected(1), 45_000)
  await waitDiag(b.page, 'NETWORK', '成员恢复连接', connected(1), 45_000)
  await expect.poll(async () => (await diag(a.page)).isHost).toBe(true)
  await expect.poll(async () => (await diag(b.page)).isHost).toBe(false)
  await expect(b.page.locator('.environment-controls')).toContainText('房主在线')
  await expect(b.page.locator('.environment-controls')).toContainText('雨夜')
  await expect(b.page.locator('.environment-controls')).toContainText('炉火熄灭')
  await a.context.close(); await b.context.close()
})

test('乱序消息去重、退出重进及晚加入按时间补齐', async ({ browser }) => {
  test.setTimeout(150_000)
  const a = await openSession(browser)
  const b = await openSession(browser)
  const room = await createRoom(a.page)
  await joinRoom(b.page, room)
  await waitDiag(a.page, 'NETWORK', '双端建联', connected(1))
  const base = Date.now() - 10_000
  const messages = [
    { id: '00000000000000000000000000000003', author: '测试读者', body: 'third', createdAt: base + 3 },
    { id: '00000000000000000000000000000001', author: '测试读者', body: 'first', createdAt: base + 1 },
    { id: '00000000000000000000000000000002', author: '测试读者', body: 'second', createdAt: base + 2 },
    { id: '00000000000000000000000000000001', author: '测试读者', body: 'first', createdAt: base + 1 },
  ]
  expect(await a.page.evaluate(async (items) => {
    const modulePath = '/src/online/roomCollaboration.ts'
    const { postRoomChat } = await import(modulePath) as typeof import('../../src/online/roomCollaboration')
    return items.map((message) => postRoomChat(message)).every(Boolean)
  }, messages)).toBe(true)
  const ordered = (state: Awaited<ReturnType<typeof diag>>) =>
    state.chats.map(({ body }) => body).join(',') === 'first,second,third'
      && new Set(state.chats.map(({ id }) => id)).size === 3
  await waitDiag(a.page, 'STATE', 'A 本地乱序合并排序去重', ordered)
  await waitDiag(b.page, 'STATE', 'B 网络接收排序去重', ordered)

  await b.page.getByRole('button', { name: '返回单机' }).click()
  await waitDiag(b.page, 'STATE', 'B 返回单机', (state) => state.roomStatus === 'solo' && state.peers === 0)
  await joinRoom(b.page, room)
  await waitDiag(b.page, 'NETWORK', 'B 退出后重进', connected(1), 45_000)
  await waitDiag(b.page, 'STATE', '重进历史不重复', ordered)

  const c = await openSession(browser)
  await joinRoom(c.page, room)
  await waitDiag(c.page, 'NETWORK', 'C 晚加入建联', connected(2), 45_000)
  await waitDiag(c.page, 'STATE', 'C 补齐同序历史', ordered, 45_000)
  await waitDiag(a.page, 'STATE', '历史回放后 A 仍去重', ordered)
  for (const session of [a, b, c]) await session.context.close()
})
