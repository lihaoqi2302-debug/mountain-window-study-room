/* Round 3 B — paste into the scene console or use Playwright addInitScript.
 * No app mutations, storage, telemetry, dependencies or per-frame logging. */
(() => {
  'use strict'
  if (globalThis.round3Mobile) return
  const labels = new Set(['cold', 'warm20', 'reading', 'background-return', 'offline', 'idle'])
  const maxIntervals = 16_384
  const round = (n) => Number(n.toFixed(3))
  const finite = (n) => Number.isFinite(n) ? n : null
  const summarize = (values) => {
    if (!values.length) return null
    const sorted = [...values].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return {
      medianMs: round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2),
      p95Ms: round(sorted[Math.ceil(0.95 * sorted.length) - 1]),
      maxMs: round(sorted.at(-1)),
      over33_3ms: sorted.filter((v) => v > 1000 / 30).length,
      longOver50ms: sorted.filter((v) => v > 50).length,
      severeOver100ms: sorted.filter((v) => v > 100).length,
    }
  }
  let hiddenEvents = 0
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') hiddenEvents++
  })
  const session = () => ({ timeOrigin: performance.timeOrigin, hiddenEvents, visibility: document.visibilityState })
  const snapshot = () => {
    const d = globalThis.__debug
    const r = d?.renderer
    const mem = performance.memory
    return {
      atMs: round(performance.now()),
      ...session(),
      viewport: [innerWidth, innerHeight],
      deviceDpr: devicePixelRatio,
      rendererDpr: finite(r?.getPixelRatio?.()),
      coarsePointer: matchMedia('(pointer: coarse)').matches,
      quality: ['low', 'medium', 'high'].includes(d?.app?.state?.quality) ? d.app.state.quality : null,
      mode: ['loading', 'intro', 'explore', 'reading', 'transitioning', 'shelf', 'walking'].includes(d?.app?.state?.mode) ? d.app.state.mode : null,
      webglContextLost: r ? Boolean(r.getContext().isContextLost()) : null,
      appRenderCallsCompleted: finite(d?.frameStats?.()?.frames),
      textures: finite(r?.info?.memory?.textures),
      geometries: finite(r?.info?.memory?.geometries),
      programs: finite(r?.info?.programs?.length),
      residentPages: finite(d?.book?.residentPages),
      sceneryCached: finite(d?.room?.textures?.scenery?.length),
      sceneryChanging: d?.scenery ? Boolean(d.scenery.changing) : null,
      approximateDeviceMemoryGiB: finite(navigator.deviceMemory),
      jsHeapBytes: finite(mem?.usedJSHeapSize),
      jsHeapInterface: Number.isFinite(mem?.usedJSHeapSize) ? 'performance.memory (non-standard JS heap)' : 'unavailable',
      gpuMemory: 'not observable via this tool',
      thermalState: 'not observable via this tool',
    }
  }
  let active = false
  const sample = ({ label = 'idle', durationMs = 10_000 } = {}) => {
    if (!labels.has(label) || !Number.isInteger(durationMs) || durationMs < 250 || durationMs > 60_000) {
      throw new RangeError('use a supported phase and 250–60000 integer milliseconds')
    }
    if (active) throw new Error('a sample is already running')
    const before = snapshot()
    const intervals = new Float64Array(maxIntervals)
    const requestedAt = performance.now()
    return new Promise((resolve) => {
      active = true
      let raf = 0, timer = 0, count = 0, first, previous, workMs = 0, timedCallbacks = 0
      function finish(reason) {
        cancelAnimationFrame(raf)
        clearTimeout(timer)
        document.removeEventListener('visibilitychange', onVisibility)
        active = false
        const elapsed = previous === undefined ? 0 : previous - first
        resolve({
          schema: 1, label, status: reason === 'complete' && count > 0 ? 'complete' : 'invalid', reason,
          requestedMs: durationMs, sampledMs: round(elapsed), wallMs: round(performance.now() - requestedAt),
          firstCallbackWaitMs: first === undefined ? null : round(first - requestedAt),
          intervals: count, ...summarize(intervals.subarray(0, count)),
          callbackHz: elapsed > 0 ? round(1000 * count / elapsed) : null,
          overhead: { bufferedBytes: intervals.byteLength, timedCallbacks, measuredWorkMs: round(workMs),
            meanMeasuredWorkMs: timedCallbacks ? round(workMs / timedCallbacks) : null,
            excludes: 'clock read itself in part, callback scheduling, setup, final sort/snapshots and export; zero can mean timer quantization' },
          metric: 'foreground browser requestAnimationFrame callback timing, not delivered GPU/display FPS',
          before, after: snapshot(),
        })
      }
      function onVisibility() {
        if (document.visibilityState !== 'visible') finish('hidden')
      }
      function tick(ts) {
        const start = performance.now()
        if (document.visibilityState !== 'visible') return finish('hidden')
        if (first === undefined) first = ts
        if (previous !== undefined) intervals[count++] = ts - previous
        previous = ts
        const done = ts - first >= durationMs
        if (!done && count < intervals.length) raf = requestAnimationFrame(tick)
        workMs += performance.now() - start
        timedCallbacks++
        if (done) finish('complete')
        else if (count === intervals.length) finish('capacity')
      }
      if (document.visibilityState !== 'visible') return finish('hidden')
      document.addEventListener('visibilitychange', onVisibility)
      timer = setTimeout(() => finish('watchdog'), durationMs + 5000)
      raf = requestAnimationFrame(tick)
    })
  }
  const download = (records) => {
    if (!Array.isArray(records)) throw new TypeError('pass an array of sampler reports')
    const blob = new Blob([JSON.stringify(records, null, 2) + '\n'], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'round3-mobile-samples.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
  globalThis.round3Mobile = Object.freeze({ sample, snapshot, download })
})()
