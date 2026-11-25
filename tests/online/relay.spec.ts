// 同机多会话 + 隔离网络模拟；强制中继（VITE_TEST_ICE_POLICY=relay，独立 5182 服务），不是真实跨网。
import { test, expect } from '@playwright/test'
import { check, createRoom, joinRoom, openSession, waitDiag } from './helpers'

test('强制中继且 route=relay', async ({ browser, baseURL }) => {
  const a = await openSession(browser, 'turn', baseURL)
  const b = await openSession(browser, 'turn', baseURL)
  const room = await createRoom(a.page)
  await joinRoom(b.page, room)
  for (const [name, s] of [['A', a], ['B', b]] as const) {
    const d = await waitDiag(s.page, 'NETWORK', `${name} 经 TURN 建联`, (x) => x.roomStatus === 'connected' && x.diagnostics.route === 'relay', 45_000)
    await check('STATE', `${name} TURN 已配置`, async () => expect(d.diagnostics.turnStatus).toBe('configured'))
    await check('NETWORK', `${name} 收集到中继候选`, async () => expect(d.diagnostics.counts.relay).toBeGreaterThan(0))
    await check('NETWORK', `${name} 无 host 候选（relay 策略）`, async () => expect(d.diagnostics.counts.host).toBe(0))
  }
  await a.context.close(); await b.context.close()
})

for (const mode of ['500', 'no-turn'] as const) {
  test(`强制中继 + 凭据失败(${mode}) 回单机且提示正确`, async ({ browser, baseURL }) => {
    const a = await openSession(browser, mode, baseURL)
    const b = await openSession(browser, mode, baseURL)
    const room = await createRoom(a.page)
    await joinRoom(b.page, room)
    const d = await waitDiag(b.page, 'NETWORK', '中继不可用时失败', (x) => x.roomStatus === 'failed', 60_000)
    await check('STATE', '失败原因提及 TURN', async () => expect(d.roomMessage).toMatch(/TURN|中继/))
    if (mode === '500') await check('STATE', 'failure=http 500', async () => { expect(d.diagnostics.turnFailure).toBe('http'); expect(d.diagnostics.httpStatus).toBe(500) })
    await check('UI', '显示重试按钮', () => expect(b.page.getByRole('button', { name: '重试连接' })).toBeVisible())
    await a.context.close(); await b.context.close()
  })
}
