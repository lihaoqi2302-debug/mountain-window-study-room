// P1-6：390x844 / hasTouch / isMobile 模拟下的画质、纹理生命周期与上下文丢失恢复
// 前置：npm run build:public && npm run preview:public（端口 5197）
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const EVID = path.resolve('docs/delegated/evidence/mobile');
fs.mkdirSync(EVID, { recursive: true });
const data = { env: {}, samples: [] };

const snap = async (page, label) => {
  const s = await page.evaluate(() => {
    const d = window.__debug; const r = d.renderer;
    return {
      textures: r.info.memory.textures, geometries: r.info.memory.geometries,
      programs: r.info.programs?.length ?? null,
      residentPages: d.book?.residentPages ?? null,
      sceneryCached: d.room?.textures?.scenery?.length ?? null,
      dpr: r.getPixelRatio(), quality: d.app.state.quality,
      shadowAuto: r.shadowMap.autoUpdate, mode: d.app.state.mode,
      contextLost: !!d.app.state.contextLost,
    };
  });
  data.samples.push({ label, t: Date.now(), ...s });
  return s;
};

const ready = async (page) => {
  await page.goto('bookstore/');
  await page.waitForFunction(() => window.__debug?.book && window.__debug.app.state.mode !== 'loading', null, { timeout: 90_000 });
  // 跳过引导
  for (let i = 0; i < 20; i++) {
    const mode = await page.evaluate(() => window.__debug.app.state.mode);
    if (mode === 'explore') break;
    await page.mouse.click(195, 600); await page.waitForTimeout(500);
  }
};

test.afterAll(() => {
  fs.writeFileSync(path.join(EVID, 'textures.json'), JSON.stringify(data, null, 2));
});

test('画质档位与 DPR 上限（自动档在移动端应为 low，DPR≤1.25）', async ({ page }) => {
  await ready(page);
  const s = await snap(page, 'boot');
  data.env = { ua: await page.evaluate(() => navigator.userAgent), deviceDPR: await page.evaluate(() => devicePixelRatio) };
  expect(s.quality).toBe('low');
  expect(s.dpr).toBeLessThanOrEqual(1.25);
  await page.screenshot({ path: path.join(EVID, 'boot-390x844.png') });
});

test('触控压力 + 书页/窗景纹理生命周期', async ({ page }) => {
  await ready(page);
  const base = await snap(page, 'explore');
  // 拖动视角 30 次
  for (let i = 0; i < 30; i++) {
    await page.touchscreen.tap(195, 500);
    await page.evaluate(i => {
      const c = document.querySelector('#scene');
      const mk = (type, x) => c.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', clientX: x, clientY: 420, bubbles: true, isPrimary: true }));
      mk('pointerdown', 120); mk('pointermove', 180 + (i % 5) * 20); mk('pointerup', 200);
    }, i);
  }
  await snap(page, 'after-drag-30');
  // 一键入座阅读
  // 拖动后可能残留过渡/行走状态；先等回到 explore，再走 #btnRead（直接 enterReading，绕开 sitDown 走位动画）
  await page.waitForFunction(() => window.__debug.app.state.mode === 'explore' && !window.__debug.app.state.importing, null, { timeout: 20_000 });
  await page.evaluate(() => { const b = document.querySelector('#btnRead'); if (b) { b.inert = false; b.click(); } else document.querySelector('#quickViews [data-view="read"]')?.click(); });
  await page.waitForFunction(() => window.__debug.app.state.mode === 'reading', null, { timeout: 30_000 }).catch(async (e) => {
    const st = await page.evaluate(() => ({ mode: window.__debug.app.state.mode, loco: window.__debug.app.state.locomotion }));
    throw new Error('未进入阅读模式: ' + JSON.stringify(st) + ' ' + e.message);
  });
  await snap(page, 'reading-open');
  // tap() 未设 action 超时，按钮处于 inert/动画中时会一直等到用例超时；改为直接派发 click 并限时
  const press = (sel) => page.evaluate(s => document.querySelector(s)?.click(), sel);
  test.setTimeout(240_000);
  for (let i = 0; i < 10; i++) { await press('#btnNext'); await page.waitForTimeout(900); }
  const turned = await snap(page, 'after-10-turns');
  expect(turned.residentPages ?? 0).toBeLessThanOrEqual(6); // low 档页缓存上限 6
  for (let i = 0; i < 10; i++) { await press('#btnPrev'); await page.waitForTimeout(900); }
  await snap(page, 'after-10-back');
  await page.screenshot({ path: path.join(EVID, 'reading-390x844.png') });
  await page.evaluate(() => document.querySelector('#btnCloseBook').click());
  await page.waitForFunction(() => window.__debug.app.state.mode === 'explore', null, { timeout: 20_000 });
  await page.waitForTimeout(1500);
  await snap(page, 'reading-closed');
  // 窗景切换四次再回到初始
  for (const key of ['aurora', 'forest', 'snow', 'mountain']) {
    await page.evaluate(k => window.__debug.scenery?.set?.(k) ?? document.querySelector(`[data-scenery="${k}"]`)?.click(), key);
    // 设计上过渡期合法驻留 current + pending + queued 共 3 张；需等过渡结束（prune 后）再按 ≤2 断言
    await page.waitForFunction(() => { const sc = window.__debug.scenery; return sc ? !sc.changing : true; }, null, { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(3500);
    const s = await snap(page, 'scenery-' + key);
    const settled = await page.evaluate(() => !(window.__debug.scenery?.changing));
    expect(s.sceneryCached ?? 0).toBeLessThanOrEqual(settled ? 2 : 3);
  }
  const end = await snap(page, 'end');
  // 释放判定：结束时纹理数不应比基线多出 >4（页缓存 + 一张窗景过渡余量）
  expect(end.textures - base.textures).toBeLessThanOrEqual(4);
});

test('WEBGL_lose_context 丢失与恢复', async ({ page }) => {
  await ready(page);
  await snap(page, 'pre-lose');
  await page.evaluate(() => { window.__lc = window.__debug.renderer.getContext().getExtension('WEBGL_lose_context'); window.__lc.loseContext(); });
  await page.waitForFunction(() => window.__debug.app.state.contextLost === true, null, { timeout: 10_000 });
  await expect(page.locator('#graphicStatus')).toBeVisible();
  await snap(page, 'lost');
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.__lc.restoreContext());
  await page.waitForFunction(() => window.__debug.app.state.contextLost === false, null, { timeout: 15_000 });
  await page.waitForTimeout(2000);
  const s = await snap(page, 'restored');
  expect(s.contextLost).toBe(false);
  await expect(page.locator('#graphicStatus')).toBeHidden();
  await page.screenshot({ path: path.join(EVID, 'restored-390x844.png') });
  // 恢复后切一次视图（进入阅读再退出），确认恢复后纹理数偏低是否为懒重建
  test.setTimeout(240_000);
  for (let i = 0; i < 20; i++) {
    const mode = await page.evaluate(() => window.__debug.app.state.mode);
    if (mode === 'explore') break;
    await page.mouse.click(195, 600); await page.waitForTimeout(500);
  }
  await page.waitForFunction(() => window.__debug.app.state.mode === 'explore' && !window.__debug.app.state.importing, null, { timeout: 20_000 });
  await page.evaluate(() => { const b = document.querySelector('#btnRead'); if (b) { b.inert = false; b.click(); } else document.querySelector('#quickViews [data-view="read"]')?.click(); });
  await page.waitForFunction(() => window.__debug.app.state.mode === 'reading', null, { timeout: 30_000 });
  await page.waitForTimeout(2000);
  const inRead = await snap(page, 'restored-reading');
  await page.evaluate(() => document.querySelector('#btnCloseBook').click());
  await page.waitForFunction(() => window.__debug.app.state.mode === 'explore', null, { timeout: 20_000 });
  await page.waitForTimeout(2000);
  const after = await snap(page, 'restored-after-view-switch');
  const pre = data.samples.find(x => x.label === 'pre-lose');
  data.contextRestore = {
    preLoseTextures: pre?.textures ?? null,
    restoredTextures: s.textures,
    restoredReadingTextures: inRead.textures,
    afterViewSwitchTextures: after.textures,
    lazyRebuild: after.textures > s.textures,
  };
  expect(after.contextLost).toBe(false);
  expect(after.textures).toBeGreaterThan(s.textures); // 切视图后应按需重建纹理
});
