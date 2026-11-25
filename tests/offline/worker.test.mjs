import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const source = readFileSync(new URL('../../src/offline/worker.js', import.meta.url), 'utf8')
const scope = 'https://example.test/study/'
const scenery = 'bookstore/media/scenery.webp'
const packs = {
  core: { bytes: 4, files: [{ path: 'index.html', bytes: 4 }] },
  scenery: { bytes: 4, files: [{ path: scenery, bytes: 4 }] },
}

function createCacheStorage() {
  const records = new Map()
  return {
    keys: async () => [...records.keys()],
    delete: async (key) => records.delete(key),
    async open(key) {
      if (!records.has(key)) records.set(key, new Map())
      const entries = records.get(key)
      return {
        match: async (url) => entries.get(url)?.clone(),
        put: async (url, response) => entries.set(url, response.clone()),
      }
    },
  }
}

function createWorker(revision, caches, fetch) {
  let message
  const self = { registration: { scope }, addEventListener: (type, listener) => {
    if (type === 'message') message = listener
  } }
  runInNewContext(source, { URL, Response, revision, packs, self, caches, fetch })
  return async (data, onReport = () => {}) => {
    let completion
    let report
    message({
      data,
      ports: [{ postMessage: (value) => { report = value; onReport(value) } }],
      waitUntil: (value) => { completion = value },
    })
    await completion
    return report
  }
}

test('retries a saved extension after partial upgrade and carries it to the following revision', async () => {
  const caches = createCacheStorage()
  const downloads = []
  let failScenery = false
  const fetch = async (url) => {
    const path = url.slice(scope.length)
    downloads.push(path)
    if (failScenery && path === scenery) return new Response('', { status: 503 })
    return new Response('data')
  }
  const save = { type: 'study-offline-save', packs: [] }
  const original = createWorker('A', caches, fetch)
  const originalStatus = await original({ ...save, packs: ['scenery'] })
  assert.equal(originalStatus.packs.scenery.saved, true)

  downloads.length = 0
  failScenery = true
  const interrupted = await createWorker('B', caches, fetch)(save)
  assert.equal(interrupted.status, 'failed')
  assert.equal(interrupted.savedRevision, 'B')
  assert.equal(interrupted.packs.scenery.saved, false)
  assert.deepEqual(downloads, ['index.html', scenery])

  downloads.length = 0
  failScenery = false
  // Recreating the worker also covers retry after reloading the browser tab.
  const resumed = await createWorker('B', caches, fetch)(save)
  assert.equal(resumed.status, 'saved')
  assert.equal(resumed.packs.scenery.saved, true)
  assert.deepEqual(downloads, [scenery])

  downloads.length = 0
  const next = await createWorker('C', caches, fetch)(save)
  assert.equal(next.savedRevision, 'C')
  assert.equal(next.packs.scenery.saved, true)
  assert.deepEqual(downloads, ['index.html', scenery])
  assert.equal((await caches.keys()).some((key) => key.includes(':A:')), false)
})

const saveCore = { type: 'study-offline-save', packs: [] }
const saveScenery = { ...saveCore, packs: ['scenery'] }

for (const failFirst of [false, true]) {
  test(`concurrent tabs preserve both save requests, first fails: ${failFirst}`, async () => {
    const caches = createCacheStorage()
    const firstStarted = Promise.withResolvers()
    const firstBody = Promise.withResolvers()
    const downloads = []
    const worker = createWorker('A', caches, async (url) => {
      const path = url.slice(scope.length)
      downloads.push(path)
      if (downloads.length === 1) {
        firstStarted.resolve()
        return firstBody.promise
      }
      return new Response('data')
    })

    const first = worker(saveCore)
    await firstStarted.promise
    const progress = []
    const second = worker(saveScenery, ({ status, done, total }) => {
      if (status === 'saving') progress.push([done, total])
    })
    assert.equal((await worker('study-offline-clear')).status, 'failed')
    firstBody.resolve(failFirst ? new Response('', { status: 503 }) : new Response('data'))
    const [core, coreAndScenery] = await Promise.all([first, second])
    assert.equal(core.status, failFirst ? 'failed' : 'saved')
    assert.equal(core.packs.scenery.saved, false)
    assert.equal(coreAndScenery.status, 'saved')
    assert.equal(coreAndScenery.packs.scenery.saved, true)
    assert.deepEqual(downloads, failFirst ? ['index.html', 'index.html', scenery] : ['index.html', scenery])
    assert.deepEqual(progress, failFirst ? [[0, 8], [4, 8], [8, 8]] : [[0, 4], [4, 4]])
  })
}

test('a save arriving during clear waits for cache removal', async () => {
  const caches = createCacheStorage()
  const deleteCache = caches.delete
  const clearStarted = Promise.withResolvers()
  const releaseClear = Promise.withResolvers()
  const downloads = []
  const worker = createWorker('A', caches, async (url) => {
    downloads.push(url.slice(scope.length))
    return new Response('data')
  })
  await worker(saveCore)
  downloads.length = 0
  caches.delete = async (key) => {
    clearStarted.resolve()
    await releaseClear.promise
    return deleteCache(key)
  }
  const clear = worker('study-offline-clear')
  await clearStarted.promise
  const save = worker(saveScenery)
  assert.deepEqual(downloads, [])
  releaseClear.resolve()
  assert.equal((await clear).status, 'available')
  const saved = await save
  assert.equal(saved.status, 'saved')
  assert.equal(saved.packs.scenery.saved, true)
  assert.deepEqual(downloads, ['index.html', scenery])
})
