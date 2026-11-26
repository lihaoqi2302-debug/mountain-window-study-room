import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const script = readFileSync(new URL('./sampler.js', import.meta.url), 'utf8')
function browser() {
  let clock = 0, ticks = 0, callback, timer
  const visibility = new Set()
  const doc = {
    visibilityState: 'visible',
    addEventListener: (_, fn) => visibility.add(fn),
    removeEventListener: (_, fn) => visibility.delete(fn),
  }
  const env = {
    document: doc, performance: { now: () => clock + ++ticks / 100 }, navigator: {},
    innerWidth: 390, innerHeight: 844, devicePixelRatio: 3, matchMedia: () => ({ matches: true }),
    setTimeout: (fn) => { timer = fn; return 1 }, clearTimeout: () => { timer = undefined },
    requestAnimationFrame: (fn) => { callback = fn; return 2 }, cancelAnimationFrame: () => { callback = undefined },
  }
  runInNewContext(script, env)
  return { api: env.round3Mobile, frame(n) { clock = n; ticks = 0; callback(n) },
    hide() { doc.visibilityState = 'hidden'; for (const fn of visibility) fn() }, stall() { timer() },
    clean: () => callback === undefined && timer === undefined && visibility.size === 1 }
}

test('nearest-rank P95, true median and strict long-frame thresholds exclude first callback', async () => {
  const b = browser(), sample = b.api.sample({ label: 'cold', durationMs: 250 })
  assert.throws(() => b.api.sample(), /already running/)
  for (const ts of [10, 20, 40, 90, 191, 271]) b.frame(ts)
  const s = await sample
  assert.equal(s.status, 'complete')
  assert.deepEqual([s.intervals, s.sampledMs, s.medianMs, s.p95Ms], [5, 261, 50, 101])
  assert.deepEqual([s.over33_3ms, s.longOver50ms, s.severeOver100ms], [3, 2, 1])
  assert(s.overhead.measuredWorkMs > 0)
  assert.equal(s.before.jsHeapBytes, null)
  assert.equal(s.before.jsHeapInterface, 'unavailable')
  assert(b.clean())
})

test('hidden mid-window invalidates partial data; timeout and hidden start clean up', async () => {
  const b = browser(), sample = b.api.sample()
  b.frame(20); b.frame(40); b.hide()
  const s = await sample
  assert.deepEqual([s.status, s.reason, s.intervals], ['invalid', 'hidden', 1])
  assert(b.clean())
  assert.equal((await b.api.sample()).intervals, 0)
  assert(b.clean())
  const other = browser(), overdue = other.api.sample()
  other.stall()
  assert.equal((await overdue).reason, 'watchdog')
  assert(other.clean())
})

test('invalid input and capped interval buffer', async () => {
  const b = browser()
  assert.throws(() => b.api.sample({ label: 'arbitrary value' }), /supported phase/)
  assert.throws(() => b.api.sample({ durationMs: 61_000 }), /250–60000/)
  const sample = b.api.sample({ durationMs: 60_000 })
  for (let i = 0; i <= 16_384; i++) b.frame(i)
  const s = await sample
  assert.deepEqual([s.status, s.reason, s.intervals], ['invalid', 'capacity', 16_384])
  assert(b.clean())
})
