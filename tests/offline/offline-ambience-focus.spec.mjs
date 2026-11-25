// P-3：离线态下的程序环境音与番茄钟。
//
// 口径先说清楚，避免测错对象：
//   - 书屋内环境音是 WebAudio 程序合成（bookstore-source/src/audio.js），**不含任何音频文件**，
//     按钮在阅读工具条的 #readUI 里：#btnSound 壁炉 / #btnRain 夜雨 / #btnNoise 白噪。
//     本轮只测它——它才是 VISION 里「断网也有环境音」的那套。
//   - src/App.tsx 里的 AmbientControl（雨声 / 炉火 + 环境音量滑杆）属于 StudyRoom 分支，
//     而 dist-public 的 refinedScene===true 走 FormalRoom，那套控件**不渲染**，
//     所以这里不拿它做断言（避免为了一个不存在的控件写假用例）。
//   - 音量持久化走 bookstore 自己的 localStorage['cozy-bookstore-audio']（{volume,rain,noise}），
//     外壳侧的音量走 zustand persist ['mountain-window-study-room-v1'].state.volume；
//     后者只在番茄钟用例里做「不被默认值覆写」的回归断言。
//
// 番茄钟（FocusClock）只在 React 外壳里。「专注结束」不等真实 25 分钟：
// 往持久化里写一个已过期的 endAt，刷新后 settleFocus 会走真实结算路径，产出提示与今日计数。
//
// 前置：npm run build:public
// 运行：npx playwright test -c tests/offline/playwright.config.mjs offline-ambience
import { expect, test } from '@playwright/test'
import {
  check, closeCompanion, collect, disconnect, enterReading, exitReading, saveOffline,
  openShell, readAmbience, sceneEval, startServer, waitControlled, waitScene, writeEvidence,
} from './helpers.mjs'

test.describe.configure({ mode: 'serial' })

const STORE_KEY = 'mountain-window-study-room-v1'

/** 读 React 外壳持久化（zustand persist 的 `{state, version}` 结构）。 */
async function readPreferences(page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return {
      focus: parsed?.state?.focus ?? null,
      volume: parsed?.state?.volume ?? null,
      version: parsed?.version ?? null,
    }
  }, STORE_KEY)
}

/** 番茄钟面板的原始读数（全部取自 DOM，不碰内部状态）。 */
async function readFocusPanel(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('#focus-panel')
    const pill = document.querySelector('button.focus-pill')
    const text = (node) => node?.textContent?.trim() ?? null
    const buttons = [...(panel?.querySelectorAll('button') ?? [])]
    return {
      open: Boolean(panel),
      expanded: pill?.getAttribute('aria-expanded') ?? null,
      pillLabel: text(pill),
      heading: text(panel?.querySelector('h2')),
      output: text(panel?.querySelector('output')),
      outputLabel: panel?.querySelector('output')?.getAttribute('aria-label') ?? null,
      primary: text(buttons.find((b) => /开始专注|开始休息|暂停|继续/.test(b.textContent ?? ''))),
      preset25Disabled: buttons.find((b) => /25\s*\/\s*5/.test(b.textContent ?? ''))?.disabled ?? null,
      fieldsetDisabled: panel?.querySelector('fieldset')?.disabled ?? null,
      today: text(panel?.querySelector('p.field-message')),
      notice: text(document.querySelector('.quiet-notice [role="status"]')),
    }
  })
}

const pressed = (page, selector) => sceneEval(page, (sel) => document.querySelector(sel)?.getAttribute('aria-pressed') ?? null, selector)

test('离线态打开程序环境音：壁炉 / 夜雨 / 白噪（无音频文件依赖）', async ({ page }) => {
  // 本用例前半段（联网环境音全部断言）实测约 60 s，后半段含断网重开。
  // 断网重开在本机 SwiftShader 下有 7 ms ~ 129 s 的单次往返抖动（见
  // docs/delegated/round2/c-p1-offline-reopen-unresolved.md §3.1），
  // 90 s 段限必然不够，故显式放宽到 300 s。放宽只作用于本用例。
  test.setTimeout(300_000)
  const evidence = { online: {}, offline: {}, console: {} }
  const logs = collect(page)
  const server = await check('NETWORK', '起 dist-public 静态服务器', () => startServer())

  try {
    await check('UI', '打开外壳', () => openShell(page))
    await check('UI', '书屋进入 explore', () => waitScene(page))
    await check('NETWORK', 'service worker 接管页面', () => waitControlled(page))
    // saveOffline 会真点「保存离线版」并等完成；expectSaved 只等文案、不点按钮。
    await check('STATE', '保存离线版', () => saveOffline(page))
    await check('UI', '关闭共学面板', () => closeCompanion(page))

    // 环境音按钮在 #readUI 里，非阅读模式下 #readUI 是 inert + visibility:hidden，
    // 所以必须先真实走进阅读模式（真实用户路径也是先翻开书）。
    await check('UI', '进入阅读模式', () => enterReading(page))
    const frame = page.frames().find((item) => item.url().includes('/bookstore/'))
    expect(frame, '找不到书屋 iframe').toBeTruthy()

    const base = await check('AUDIO', '读环境音初始状态', () => readAmbience(page))
    evidence.online.base = base
    expect(base.enabled, '未交互前不应拥有 AudioContext').toBe(false)
    expect(base.fire, '壁炉初始应关闭').toBe('false')
    expect(base.rain, '夜雨初始应关闭').toBe('false')
    expect(base.noise, '白噪初始应关闭').toBe('false')
    expect(base.volume, '默认主音量应为 0.55').toBeCloseTo(0.55, 2)

    // 真实点击：带 user activation，AudioContext 才能在自动播放策略下 resume。
    await check('AUDIO', '点击壁炉', async () => {
      await frame.locator('#btnSound').click()
      await expect.poll(() => pressed(page, '#btnSound')).toBe('true')
    })
    const fireOn = await readAmbience(page)
    evidence.online.fireOn = fireOn
    expect(fireOn.enabled, '点火后 AudioContext 应可用').toBe(true)
    expect(fireOn.appSoundOn, 'APP.state.soundOn 应跟随').toBe(true)

    await check('AUDIO', '点击夜雨', async () => {
      await frame.locator('#btnRain').click()
      await expect.poll(() => pressed(page, '#btnRain')).toBe('true')
    })
    await check('AUDIO', '点击白噪', async () => {
      await frame.locator('#btnNoise').click()
      await expect.poll(() => pressed(page, '#btnNoise')).toBe('true')
    })
    const allOn = await readAmbience(page)
    evidence.online.allOn = allOn
    expect(allOn.appRainOn, 'APP.state.rainOn 应跟随').toBe(true)
    expect(allOn.appNoiseOn, 'APP.state.noiseOn 应跟随').toBe(true)
    // 只有 rain / noise 会持久化（fire 每次都要新手势），所以这里只断言这两项。
    expect(allOn.stored, '夜雨与白噪偏好应写入 cozy-bookstore-audio').toMatchObject({ rain: true, noise: true })

    await check('AUDIO', '关闭壁炉但保留其他两层', async () => {
      await frame.locator('#btnSound').click()
      await expect.poll(() => pressed(page, '#btnSound')).toBe('false')
      const state = await readAmbience(page)
      expect(state.rain, '关壁炉不应影响夜雨').toBe('true')
      expect(state.noise, '关壁炉不应影响白噪').toBe('true')
      expect(state.enabled, '仍有其他层在放，AudioContext 应保持可用').toBe(true)
    })
    evidence.online.afterToggle = await readAmbience(page)

    // 环境音是程序合成的：整个过程不应产生任何音频文件请求。
    const audioRequests = logs.requests.filter(({ url }) => /\.(mp3|wav|ogg|m4a|flac|aac|opus|webm)(\?|$)/i.test(url))
    evidence.online.audioRequests = audioRequests
    expect(audioRequests, '环境音不应拉取音频文件').toEqual([])

    await check('UI', '退出阅读', () => exitReading(page))
    evidence.online.beforeOffline = await readAmbience(page)

    // ---- 断网：合成器不需要任何网络与文件，环境音必须仍能开 ----
    const restore = await check('NETWORK', '三层断网', () => disconnect(page, server))
    try {
      const reopened = await page.context().newPage()
      const reopenedLogs = collect(reopened)
      await check('NETWORK', '断网重开外壳', () => openShell(reopened, { timeout: 90_000 }))
      // 200 s：waitScene 内部要等书屋脚本执行到初始化，软渲染抖动上限约 129 s。
      await check('UI', '断网重开书屋', () => waitScene(reopened, { timeout: 200_000 }))
      await check('NETWORK', '断网重开由 SW 接管', () => waitControlled(reopened, { timeout: 60_000 }))

      // rain/noise 是「偏好」，随 localStorage 复原为开；但 AudioContext 仍要等手势。
      const restored = await check('AUDIO', '读断网重开后的环境音偏好', () => readAmbience(reopened))
      evidence.offline.restored = restored
      expect(restored.rain, '夜雨偏好应复原为开').toBe('true')
      expect(restored.noise, '白噪偏好应复原为开').toBe('true')
      expect(restored.enabled, '无手势时不应凭空启动 AudioContext').toBe(false)

      await check('AUDIO', '断网后进入阅读并开壁炉', async () => {
        await enterReading(reopened, { timeout: 60_000 })
        const offlineFrame = reopened.frames().find((item) => item.url().includes('/bookstore/'))
        if (!offlineFrame) throw new Error('找不到书屋 iframe')
        await offlineFrame.locator('#btnSound').click()
        await expect.poll(() => pressed(reopened, '#btnSound')).toBe('true')
      })
      const offlineAudio = await readAmbience(reopened)
      evidence.offline.audio = offlineAudio
      expect(offlineAudio.enabled, '断网状态下程序环境音应能启用').toBe(true)
      expect(offlineAudio.appSoundOn, '断网下 APP.state 同样应跟随').toBe(true)

      const foreign = reopenedLogs.requests.filter(({ url }) => {
        if (url.startsWith('data:') || url.startsWith('blob:')) return false
        try { return new URL(url).hostname !== '127.0.0.1' } catch { return true }
      })
      evidence.offline.foreign = foreign
      evidence.offline.cdn = reopenedLogs.cdn
      evidence.offline.failed = reopenedLogs.failed
      evidence.offline.pageErrors = reopenedLogs.pageErrors
      expect(foreign, '环境音不应触达任何外部主机').toEqual([])
      expect(reopenedLogs.cdn, '环境音不应依赖 CDN').toEqual([])
      expect(reopenedLogs.pageErrors, '断网开环境音不应抛未捕获异常').toEqual([])

      await reopened.close()
    } finally {
      const revived = await restore()
      evidence.offline.restoredServer = revived.url
      await revived.close()
    }

    evidence.console.pageErrors = logs.pageErrors
    expect(logs.pageErrors, '联网阶段不应有未捕获异常').toEqual([])
  } finally {
    await server.close().catch(() => {})
    await writeEvidence('p3-ambience.json', evidence)
  }
})

test('番茄钟：预设 / 自定义 / 开始暂停继续重置 / 结算与持久化', async ({ page }) => {
  // 本用例实测约 90~110 s（末日端有一次 reload 回归），90 s 段限不够；
  // 且 reload 后 click 要做 visible/enabled/stable 三判，本机软渲染下位置抖动会拖长。
  // 故显式放宽，并给 click 单独的超时。
  test.setTimeout(300_000)
  const evidence = { configure: {}, run: {}, settle: {}, persisted: {}, console: {} }
  const logs = collect(page)
  const server = await check('NETWORK', '起 dist-public 静态服务器', () => startServer())

  try {
    await check('UI', '打开外壳', () => openShell(page))
    await check('UI', '书屋进入 explore', () => waitScene(page))

    // 没有面板打开时 covered=false，FocusClock 一定渲染。
    const pill = page.locator('button.focus-pill')
    await check('UI', '番茄钟按钮可见', () => expect(pill).toBeVisible())
    await expect(pill).toHaveAttribute('aria-controls', 'focus-panel')
    await expect(pill).toHaveAttribute('aria-expanded', 'false')

    await check('UI', '展开番茄钟面板', async () => {
      await pill.click()
      await expect(pill).toHaveAttribute('aria-expanded', 'true')
      await expect(page.locator('#focus-panel')).toBeVisible()
    })

    const initial = await check('STATE', '读番茄钟初始状态', () => readFocusPanel(page))
    evidence.configure.initial = initial
    expect(initial.heading, '初始阶段应为专注').toBe('专注')
    expect(initial.outputLabel, '剩余时间应有 aria-label').toBe('剩余时间')
    expect(initial.output, '默认 25 分钟').toBe('25:00')
    expect(initial.primary, '未开始时按钮文案').toBe('开始专注')
    expect(initial.preset25Disabled, '未运行时预设可选').toBe(false)
    expect(initial.fieldsetDisabled, '未运行时自定义可改').toBe(false)

    // configured 的语义是「运行中或暂停中」（running || remaining !== null），
    // 不是「已选过时长」——未开始前预设与自定义都允许反复改。
    await check('STATE', '预设切换时长', async () => {
      await page.locator('#focus-panel button', { hasText: '50 / 10' }).click()
      await expect.poll(async () => (await readFocusPanel(page)).output).toBe('50:00')
      const state = await readFocusPanel(page)
      expect(state.preset25Disabled, '未运行时仍可改预设').toBe(false)
      expect(state.fieldsetDisabled, '未运行时仍可改自定义').toBe(false)
      expect(state.primary, '改时长不应自动开始').toBe('开始专注')
      await page.locator('#focus-panel button', { hasText: '25 / 5' }).click()
      await expect.poll(async () => (await readFocusPanel(page)).output).toBe('25:00')
    })

    // 自定义分钟靠 onBlur 提交（configureFocus），用真实键盘输入 + 点别处触发 blur。
    await check('STATE', '改自定义分钟', async () => {
      const focusMinutes = page.locator('input[aria-label="专注分钟"]')
      await focusMinutes.fill('2')
      await page.locator('input[aria-label="休息分钟"]').click() // 触发 blur 提交
      await expect.poll(async () => (await readFocusPanel(page)).output).toBe('2:00')
      await page.locator('input[aria-label="休息分钟"]').fill('1')
      await page.locator('#focus-panel h2').click()
      const state = await readFocusPanel(page)
      evidence.configure.custom = state
      expect(state.output, '自定义 2 分钟应显示 2:00').toBe('2:00')
      expect(state.primary, '仅配置不应自动开始').toBe('开始专注')
      expect(state.fieldsetDisabled, '未运行时可继续改').toBe(false)
    })

    await check('STATE', '开始专注并确认计时在走', async () => {
      await page.locator('#focus-panel button', { hasText: '开始专注' }).click()
      await expect.poll(async () => (await readFocusPanel(page)).primary).toBe('暂停')
      const started = await readFocusPanel(page)
      expect(started.preset25Disabled, '运行中预设应禁用').toBe(true)
      expect(started.fieldsetDisabled, '运行中自定义应禁用').toBe(true)
      await page.waitForTimeout(2_200)
      const later = await readFocusPanel(page)
      expect(later.output, '计时器应在倒计时').not.toBe(started.output)
      expect(later.pillLabel, '折叠按钮应显示剩余时间').toMatch(/^\d+:\d{2}$/)
    })
    evidence.run.running = await readFocusPanel(page)

    await check('STATE', '暂停后时间冻结', async () => {
      await page.locator('#focus-panel button', { hasText: '暂停' }).click()
      await expect.poll(async () => (await readFocusPanel(page)).primary).toBe('继续')
      const paused = await readFocusPanel(page)
      await page.waitForTimeout(1_200)
      const still = await readFocusPanel(page)
      expect(still.output, '暂停后剩余时间不应继续减少').toBe(paused.output)
      evidence.run.paused = paused
    })

    await check('STATE', '继续后恢复倒计时', async () => {
      await page.locator('#focus-panel button', { hasText: '继续' }).click()
      await expect.poll(async () => (await readFocusPanel(page)).primary).toBe('暂停')
      await page.waitForTimeout(1_200)
      const running = await readFocusPanel(page)
      expect(running.output).not.toBe(evidence.run.paused.output)
    })

    await check('STATE', '重置回未开始', async () => {
      await page.locator('#focus-panel button', { hasText: '重置' }).click()
      await expect.poll(async () => (await readFocusPanel(page)).primary).toBe('开始专注')
      await expect.poll(async () => (await readFocusPanel(page)).pillLabel).toBe('专注')
      const state = await readFocusPanel(page)
      expect(state.fieldsetDisabled, '重置后应可重新配置').toBe(false)
      evidence.run.reset = state
    })

    // 面板的 Escape 处理器挂在 section 的 onKeyDown 上，事件要能从焦点元素冒泡上来。
    // 上一步点的是面板里的「重置」按钮，焦点仍在面板内，所以直接敲键盘即可。
    await check('UI', 'Escape 收起面板', async () => {
      await expect(page.locator('#focus-panel button', { hasText: '重置' })).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(pill).toHaveAttribute('aria-expanded', 'false')
      await expect(page.locator('#focus-panel')).toHaveCount(0)
    })

    // ---- 结算：写一个已过期的 endAt，刷新后走真实 settleFocus 路径 ----
    await check('STATE', '写入已到期的专注并刷新', async () => {
      await page.evaluate((key) => {
        const parsed = JSON.parse(localStorage.getItem(key) ?? '{"state":{},"version":0}')
        parsed.state.focus = {
          phase: 'focus', focus: 25, rest: 5,
          endAt: Date.now() - 1_000, remaining: null, notice: '',
          today: { day: '', rounds: 0, minutes: 0 },
        }
        localStorage.setItem(key, JSON.stringify(parsed))
      }, STORE_KEY)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector('button.focus-pill', { timeout: 45_000 })
    })

    const settled = await check('STATE', '读结算后的提示与今日计数', async () => {
      await expect.poll(async () => (await readFocusPanel(page)).notice, { timeout: 20_000 })
        .toBe('专注完成。休息一会儿吧。')
      await page.locator('button.focus-pill').click()
      return readFocusPanel(page)
    })
    evidence.settle.after = settled
    expect(settled.heading, '专注结束后阶段应切到小憩').toBe('小憩')
    expect(settled.notice, '应给出休息提示').toBe('专注完成。休息一会儿吧。')
    expect(settled.today, '今日计数应 +1 次').toContain('1 次专注')
    expect(settled.today, '今日累计应 +25 分钟').toContain('25 分钟')
    expect(settled.primary, '小憩阶段的按钮文案').toBe('开始休息')

    await check('STATE', '关闭专注提示', async () => {
      await page.locator('button[aria-label="关闭专注提示"]').click()
      await expect(page.locator('.quiet-notice')).toHaveCount(0)
    })

    const persisted = await check('STATE', '读持久化后的 focus', () => readPreferences(page))
    evidence.persisted = persisted
    expect(persisted.focus.phase, '结算结果应写回持久化').toBe('rest')
    expect(persisted.focus.endAt, '结算后不应残留运行中的 endAt').toBe(null)
    expect(persisted.focus.today.rounds, '今日次数应持久化为 1').toBe(1)

    // 回归：结算写入后，volume 不能被 partialize 的默认值 0.28 覆写。
    await check('STATE', 'volume 不被 focus 写入覆盖', async () => {
      await page.evaluate((key) => {
        const parsed = JSON.parse(localStorage.getItem(key) ?? '{"state":{},"version":0}')
        parsed.state.volume = 0.62
        localStorage.setItem(key, JSON.stringify(parsed))
      }, STORE_KEY)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector('button.focus-pill', { timeout: 45_000 })
      // 触发一次 store 写入（配置番茄钟），确认重写后 volume 仍是 0.62。
      // 显式给 click 超时：reload 后 3D 场景仍在初始化，元素位置持续变化会让
      // Playwright 的 "stable" 判定反复重试，默认超时会被外层段限先掐断。
      await page.locator('button.focus-pill').click({ timeout: 60_000 })
      await page.locator('#focus-panel button', { hasText: '重置' }).click({ timeout: 30_000 })
      await page.locator('#focus-panel button', { hasText: '50 / 10' }).click({ timeout: 30_000 })
      const prefs = await readPreferences(page)
      expect(prefs.volume, 'volume 应保持 0.62 而非回到默认 0.28').toBeCloseTo(0.62, 2)
      evidence.persisted.afterWrite = prefs
    })

    evidence.console.pageErrors = logs.pageErrors
    expect(logs.pageErrors, '番茄钟不应抛未捕获异常').toEqual([])
  } finally {
    await server.close().catch(() => {})
    await writeEvidence('p3-focus.json', evidence)
  }
})
