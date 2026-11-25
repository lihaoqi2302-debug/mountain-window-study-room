// 同机多会话 + 隔离网络模拟（本地 nostr 中继 + 本地 TURN），不是真实跨网。
import { test, expect } from '@playwright/test'
import { check, createRoom, diag, joinRoom, openSession, waitDiag } from './helpers'

test('默认单机不连网', async ({ browser }) => {
  const { context, page } = await openSession(browser)
  const sockets: string[] = []
  page.on('websocket', (ws) => sockets.push(ws.url()))
  const requests: string[] = []
  page.on('request', (r) => { if (r.url().includes('/__test/ice')) requests.push(r.url()) })
  await page.goto('/')
  await page.waitForTimeout(2500)
  const s = await diag(page)
  await check('STATE', '初始状态为 solo', async () => expect(s.roomStatus).toBe('solo'))
  await check('STATE', 'peers 为 0', async () => expect(s.peers).toBe(0))
  const appSocketOrigin = new URL(page.url()).origin.replace(/^http/, 'ws')
  await check('NETWORK', '未打开信令 WebSocket', async () =>
    expect(sockets.filter((url) => new URL(url).origin !== appSocketOrigin)).toEqual([]))
  await check('NETWORK', '未请求 ICE 凭据', async () => expect(requests).toEqual([]))
  await check('UI', '显示创建房间', () => expect(page.getByRole('button', { name: '创建房间' })).toBeVisible())
  await context.close()
})

test('双端建联', async ({ browser }) => {
  const a = await openSession(browser)
  const b = await openSession(browser)
  const room = await createRoom(a.page)
  await joinRoom(b.page, room)
  for (const [name, s] of [['A', a], ['B', b]] as const) {
    await waitDiag(s.page, 'NETWORK', `${name} 建联`, (d) => d.roomStatus === 'connected' && d.peers === 1)
    await check('UI', `${name} 状态显示已连接`, () => expect(s.page.locator('.room-state')).toHaveAttribute('data-state', 'connected'))
  }
  await a.context.close(); await b.context.close()
})
