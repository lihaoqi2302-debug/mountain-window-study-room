// 同机多会话 + 隔离网络模拟（本地 nostr 中继 + 本地 TURN），不是真实跨网。
import { test, expect } from '@playwright/test'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { chatCount, check, createRoom, diag, joinRoom, joinRoomFromUI, openSession, sendChat, waitDiag } from './helpers'
import type { Note } from '../../src/studyContent'

const connected = (n: number) => (d: { roomStatus: string; peers: number }) => d.roomStatus === 'connected' && d.peers === n

for (const mode of ['500', 'bad-json', 'timeout', 'no-turn'] as const) {
  test(`凭据接口失败(${mode})后仍直连成功`, async ({ browser }) => {
    const a = await openSession(browser, mode)
    const b = await openSession(browser, mode)
    const room = await createRoom(a.page)
    await joinRoom(b.page, room)
    const d = await waitDiag(b.page, 'NETWORK', '直连建联', connected(1), 40_000)
    const expected = { '500': 'http', 'bad-json': 'bad-json', timeout: 'timeout', 'no-turn': 'no-turn-entries' }[mode]
    await check('STATE', '记录凭据失败类型', async () => expect(d.diagnostics.turnFailure).toBe(expected))
    await check('STATE', 'TURN 不可用', async () => expect(d.diagnostics.turnStatus).toBe('unavailable'))
    await check('NETWORK', '直连路径', () => expect.poll(async () => (await diag(b.page)).diagnostics.route, { timeout: 10_000 }).toBe('direct'))
    await a.context.close(); await b.context.close()
  })
}

test('退出清理：peers 清空、计数正确', async ({ browser }) => {
  const s = await Promise.all([0, 1, 2].map(() => openSession(browser)))
  const room = await createRoom(s[0].page)
  await joinRoom(s[1].page, room); await joinRoom(s[2].page, room)
  for (const x of s) await waitDiag(x.page, 'NETWORK', '三端建联', connected(2), 40_000)
  await check('UI', 'C 点击返回单机', () => s[2].page.getByRole('button', { name: '返回单机' }).click())
  await waitDiag(s[2].page, 'STATE', 'C 回 solo 且 peers=0', (d) => d.roomStatus === 'solo' && d.peers === 0 && d.roomId === null)
  for (const x of s.slice(0, 2)) await waitDiag(x.page, 'STATE', '剩余端计数=1', connected(1), 30_000)
  await check('UI', 'A 显示 2 人', () => expect(s[0].page.locator('.room-description')).toContainText('2 人'))
  for (const x of s) await x.context.close()
})

test('单端掉线后重试', async ({ browser }) => {
  const a = await openSession(browser)
  const b = await openSession(browser)
  const room = await createRoom(a.page)
  await joinRoom(b.page, room)
  await waitDiag(b.page, 'NETWORK', '初次建联', connected(1))
  await b.context.setOffline(true)
  await waitDiag(b.page, 'STATE', 'B 离线进入 failed', (d) => d.roomStatus === 'failed', 15_000)
  await waitDiag(a.page, 'STATE', 'A 侧移除 B', (d) => d.peers === 0, 45_000)
  await b.context.setOffline(false)
  await check('UI', 'B 点击重试', () => b.page.getByRole('button', { name: '重试连接' }).first().click())
  await waitDiag(b.page, 'NETWORK', 'B 重连', connected(1), 40_000)
  await waitDiag(a.page, 'NETWORK', 'A 见到 B', connected(1), 40_000)
  await a.context.close(); await b.context.close()
})

test('房主重连后权限恢复', async ({ browser }) => {
  const a = await openSession(browser)
  const b = await openSession(browser)
  const room = await createRoom(a.page)
  await joinRoom(b.page, room)
  await waitDiag(a.page, 'NETWORK', '建联', connected(1))
  await check('STATE', 'A 为房主', async () => expect((await diag(a.page)).isHost).toBe(true))
  await check('STATE', 'B 非房主', async () => expect((await diag(b.page)).isHost).toBe(false))
  await a.page.reload()
  await waitDiag(a.page, 'NETWORK', 'A 刷新后重连', connected(1), 40_000)
  await check('STATE', 'A 重连后仍为房主', () => expect.poll(async () => (await diag(a.page)).isHost, { timeout: 10_000 }).toBe(true))
  await check('STATE', 'B 仍非房主', async () => expect((await diag(b.page)).isHost).toBe(false))
  await a.context.close(); await b.context.close()
})

test('6 端房间成员计数', async ({ browser }, testInfo) => {
  const soakSeconds = Number(process.env.STUDY_TEST_SOAK_SECONDS ?? '0')
  if (!Number.isInteger(soakSeconds) || soakSeconds < 0 || soakSeconds > 86400) {
    throw new Error('STUDY_TEST_SOAK_SECONDS must be an integer from 0 to 86400')
  }
  test.setTimeout(240_000 + soakSeconds * 1000)
  const s = await Promise.all(Array.from({ length: 6 }, () => openSession(browser)))
  const room = await createRoom(s[0].page)
  // Boot/render and network deadlines measure separate phases when all six tabs
  // share a software renderer. Other tests still cover the cold invitation URL.
  for (let i = 1; i < s.length; i++) await joinRoomFromUI(s[i].page, room, i + 1)
  for (const [i, x] of s.entries()) await waitDiag(x.page, 'NETWORK', `第${i + 1}端见到 5 人`, connected(5), 60_000)
  await check('UI', '显示 6 人', () => expect(s[0].page.locator('.room-description')).toContainText('6 人'))
  const samplesFile = testInfo.outputPath('soak-samples.jsonl')
  mkdirSync(dirname(samplesFile), { recursive: true })
  writeFileSync(samplesFile, '')
  const record = (kind: string, value: unknown) => {
    const line = JSON.stringify({ kind, at: new Date().toISOString(), value })
    appendFileSync(samplesFile, line + '\n')
    console.log(`SOAK ${line}`)
  }
  const startedAt = Date.now()
  const deadline = startedAt + soakSeconds * 1000
  record('start', { requestedSeconds: soakSeconds, clients: 6 })
  let samples = 0
  let anomalySamples = 0
  let recoveries = 0
  let unhealthy = new Set<string>()
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(5000, deadline - Date.now())))
    const states = await Promise.all(s.map(async ({ page }, index) => {
      const d = await diag(page)
      const runtime = await page.evaluate(() => ({ online: navigator.onLine, visibility: document.visibilityState }))
      return {
        client: String.fromCharCode(65 + index), status: d.roomStatus, peers: d.peers,
        route: d.diagnostics.route, relays: d.diagnostics.relays,
        turnStatus: d.diagnostics.turnStatus, turnFailure: d.diagnostics.turnFailure,
        message: d.roomMessage, ...runtime,
      }
    }))
    const current = new Set(states.filter((state) => !connected(5)({ roomStatus: state.status, peers: state.peers }) || !state.online).map(({ client }) => client))
    const recovered = [...unhealthy].filter((client) => !current.has(client))
    recoveries += recovered.length
    if (current.size) anomalySamples++
    record('sample', { sample: ++samples, elapsedSeconds: (Date.now() - startedAt) / 1000, recovered, states })
    unhealthy = current
  }
  const endedAt = Date.now()
  const summary = {
    requestedSeconds: soakSeconds, actualSeconds: (endedAt - startedAt) / 1000,
    startedAt: new Date(startedAt).toISOString(), endedAt: new Date(endedAt).toISOString(),
    samples, anomalySamples, recoveries, clients: 6,
  }
  writeFileSync(testInfo.outputPath('soak-summary.json'), JSON.stringify(summary, null, 2))
  record('end', summary)
  if (soakSeconds) {
    expect(summary.actualSeconds).toBeGreaterThanOrEqual(soakSeconds)
    expect(samples).toBeGreaterThan(0)
    expect(anomalySamples, '六端长测存在异常采样，详见 soak-samples.jsonl').toBe(0)
  }
  for (const x of s) await x.context.close()
})

test('聊天 64 条上限、去重、晚加入恢复', async ({ browser }) => {
  test.setTimeout(150_000)
  const a = await openSession(browser)
  const b = await openSession(browser)
  const room = await createRoom(a.page)
  await joinRoom(b.page, room)
  await waitDiag(a.page, 'NETWORK', '建联', connected(1))
  // 每次 UI 操作约 2.6s；前 3 条走真实 UI，其余 67 条通过测试钩子发送同样经过 postRoomChat 校验与广播。
  for (let i = 0; i < 3; i++) await sendChat(a.page, `m${i}`)
  await check('STATE', '钩子批量发送 m3..m69', async () => expect(await a.page.evaluate(
    (bodies) => (window as unknown as { __studyRoomTestChat: (b: string[]) => Promise<boolean> }).__studyRoomTestChat(bodies),
    Array.from({ length: 67 }, (_, i) => `m${i + 3}`),
  )).toBe(true))
  await waitDiag(b.page, 'STATE', 'B 收到并截断为 64', (d) => d.chats.length === 64 && d.chats.at(-1)?.body === 'm69', 30_000)
  const st = await diag(a.page)
  await check('STATE', 'A 截断为 64 且无重复', async () => { expect(st.chats.length).toBe(64); expect(new Set(st.chats.map((c) => c.id)).size).toBe(64) })
  await check('UI', 'DOM 渲染 64 条', () => expect.poll(() => chatCount(b.page)).toBe(64))
  const c = await openSession(browser)
  await joinRoom(c.page, room)
  await waitDiag(c.page, 'STATE', '晚加入者恢复 64 条历史', (d) => d.chats.length === 64 && d.chats[0].body === 'm6', 40_000)
  await check('STATE', 'B 未因历史回放重复', async () => expect(new Set((await diag(b.page)).chats.map((x) => x.id)).size).toBe(64))
  for (const x of [a, b, c]) await x.context.close()
})

test('快速切换房间不串数据', async ({ browser }) => {
  const a = await openSession(browser)
  const b = await openSession(browser)
  const r1 = await createRoom(a.page)
  await joinRoom(b.page, r1)
  await waitDiag(b.page, 'NETWORK', 'r1 建联', connected(1))
  await sendChat(a.page, 'only-in-r1')
  await waitDiag(b.page, 'STATE', 'B 收到 r1 消息', (d) => d.chats.some((c) => c.body === 'only-in-r1'))
  await b.page.getByRole('button', { name: '返回单机' }).click()
  await b.page.getByRole('button', { name: '创建房间' }).click()
  await b.page.getByRole('button', { name: '返回单机' }).click()
  await b.page.getByRole('button', { name: '创建房间' }).click()
  const d = await waitDiag(b.page, 'STATE', 'B 新房间就绪', (x) => x.roomStatus === 'waiting' && Boolean(x.roomId?.includes('~')), 30_000)
  await check('STATE', '新房间 id 不同', async () => expect(d.roomId?.split('~')[0]).not.toBe(r1.split('~')[0]))
  await check('STATE', '新房间无旧消息', async () => expect(d.chats).toEqual([]))
  await check('STATE', '新房间无旧 peer', async () => expect(d.peers).toBe(0))
  await check('UI', '聊天区为空', () => expect(b.page.locator('.chat-log article')).toHaveCount(0))
  await a.context.close(); await b.context.close()
})

test('共享便签 72 条上限、重复投递去重、晚加入恢复', async ({ browser }) => {
  const a = await openSession(browser)
  const b = await openSession(browser)
  const room = await createRoom(a.page)
  await joinRoom(b.page, room)
  await waitDiag(a.page, 'NETWORK', '建联', connected(1))
  const createdAt = Date.now()
  const notes: Note[] = Array.from({ length: 80 }, (_, i) => ({
    id: (i + 1).toString(16).padStart(32, '0'),
    author: '测试读者',
    body: `便签 ${i + 1}`,
    book: 'earth-online',
    chapter: 'sample',
    createdAt: createdAt + i,
  }))
  expect(await a.page.evaluate((items) =>
    (window as unknown as { __studyRoomTestNotes: (notes: Note[]) => Promise<boolean> }).__studyRoomTestNotes(items),
  [...notes, notes.at(-1)!])).toBe(true)
  const received = (state: Awaited<ReturnType<typeof diag>>) => {
    const { notes: shared } = state
    return shared.length === 72 && new Set(shared.map(({ id }) => id)).size === 72
      && shared[0].body === '便签 9' && shared.at(-1)?.body === '便签 80'
  }
  await waitDiag(b.page, 'STATE', 'B 只接收去重后的最近 72 条', received)
  const c = await openSession(browser)
  await joinRoom(c.page, room)
  await waitDiag(c.page, 'STATE', '晚加入者恢复同一批 72 条', received, 40_000)
  await waitDiag(b.page, 'STATE', '回放后 B 保持 72 条', received)
  for (const x of [a, b, c]) await x.context.close()
})
