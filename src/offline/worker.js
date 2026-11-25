// Generated builds supply revision and a byte-counted list of packs.
const scope = new URL(self.registration.scope)
const family = `mountain-window-offline:${scope.pathname}:`
const marker = new URL('.offline-ready', scope).href
const packKey = (name) => family + revision + ':' + name
const urlFor = (path) => new URL(path, scope).href
const resources = new Set(Object.values(packs).flatMap(({ files }) => files.map(({ path }) => urlFor(path))))
let pendingOperation
// Reuse across revisions only for build-versioned files: Vite assets/ chunks, names that
// carry a 12-hex content hash, or a versioned pdf-x.y.z/ directory. Unhashed files
// (index.html, models/study_room.glb, draco/*) are always downloaded again.
const immutable = (path) => path.startsWith('assets/') || /(^|\/)pdf-\d+\.\d+\.\d+\//.test(path)
  || /-[0-9a-f]{12}\.[a-z0-9]+$/i.test(path)
// Explicit exclusion: other origins and the /ice signalling endpoint never enter the cache.
function cacheable(url) {
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return false
  return !/(^|\/)ice(\/|$)/.test(url.pathname)
}
let inventory

function canonical(url) {
  const relative = url.pathname.slice(scope.pathname.length)
  if (relative === '') return urlFor('index.html')
  if (relative === 'bookstore' || relative === 'bookstore/') return urlFor('bookstore/index.html')
  return urlFor(relative)
}

async function inventoryNow() {
  const records = []
  for (const key of (await caches.keys()).filter((name) => name.startsWith(family))) {
    const cache = await caches.open(key)
    const saved = await cache.match(marker)
    if (!saved) continue
    const text = await saved.text()
    // Versions from before split caching wrote a plain revision marker.
    const meta = text.startsWith('{') ? JSON.parse(text)
      : { revision: text, pack: 'core', bytes: 0, updated: 0 }
    records.push({ key, cache, ...meta })
  }
  return records.sort((a,b) => b.updated - a.updated)
}

const savedPacks = () => inventory ??= inventoryNow().catch((error) => { inventory = undefined; throw error })

function queueOperation(work, notify) {
  const next = (pendingOperation ?? Promise.resolve()).catch(() => {}).then(work)
    .then(report).then(notify).catch(async () => {
      notify({ ...await report().catch(() => ({})), status: 'failed' })
    })
  pendingOperation = next
  return next.finally(() => {
    if (pendingOperation === next) pendingOperation = undefined
  })
}

async function cached(url) {
  for (const { cache } of await savedPacks()) {
    const response = await cache.match(url)
    if (response) return response
  }
}

async function report() {
  const saved = await savedPacks()
  const core = saved.find((pack) => pack.pack === 'core')
  return {
    status: core?.revision === revision ? 'saved' : core ? 'update' : 'available',
    revision,
    savedRevision: core?.revision,
    packs: Object.fromEntries(Object.entries(packs).map(([name, { bytes }]) => {
      const pack = saved.find((item) => item.pack === name && item.revision === core?.revision)
      return [name, { bytes, saved: Boolean(pack), savedBytes: pack?.bytes ?? 0 }]
    })),
  }
}

async function savePacks(names, notify) {
  const saved = await savedPacks()
  const pending = names.filter((name) => packs[name] && !saved.some(({key}) => key === packKey(name)))
  let done = 0
  const total = pending.reduce((sum, name) => sum + packs[name].bytes, 0)
  notify({ status: 'saving', done, total })
  for (const name of pending) {
    const key = packKey(name)
    const cache = await caches.open(key)
    try {
      const { files, bytes } = packs[name]
      for (let i = 0; i < files.length; i += 6) {
        const results = await Promise.allSettled(files.slice(i,i+6).map(async ({path, bytes}) => {
          const url = urlFor(path)
          if (!cacheable(new URL(url))) throw new Error('Not cacheable')
          const reusable = immutable(path) ? await cached(url) : undefined
          const response = reusable ?? await fetch(url, { cache: 'reload' })
          if (!response.ok || response.redirected) throw new Error('Offline file unavailable')
          await cache.put(url, response)
          done += bytes
          notify({ status: 'saving', done, total })
        }))
        if (results.some((result) => result.status === 'rejected')) throw new Error('Pack incomplete')
      }
      await cache.put(marker, new Response(JSON.stringify({ revision, pack: name, bytes, updated: Date.now() })))
      inventory = undefined
    } catch (error) {
      await caches.delete(key)
      inventory = undefined
      throw error
    }
  }
  // Keep one older version while existing tabs finish using it.
  const records = await savedPacks()
  // Explicitly updating to an already cached rollback must promote that core.
  const currentCore = records.find((item) => item.pack === 'core' && item.revision === revision)
  const latestCore = records.find((item) => item.pack === 'core')
  if (currentCore && latestCore && currentCore !== latestCore) {
    const { pack, bytes } = currentCore
    const updated = Math.max(Date.now(), records[0].updated + 1)
    await currentCore.cache.put(marker, new Response(JSON.stringify({ revision, pack, bytes, updated })))
  }
  const keep = new Set([revision, records.find((item) => item.pack === 'core' && item.revision !== revision)?.revision])
  await Promise.all(records.filter((item) => !keep.has(item.revision)).map((item) => caches.delete(item.key)))
  inventory = undefined
}

async function slice(full, header) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || (!match[1] && !match[2])) return undefined
  const body = await full.arrayBuffer()
  const size = body.byteLength
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]))
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
  }
  const headers = new Headers(full.headers)
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
  headers.set('Content-Length', String(end - start + 1))
  headers.set('Accept-Ranges', 'bytes')
  return new Response(body.slice(start, end + 1), { status: 206, statusText: 'Partial Content', headers })
}

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('message', (event) => {
  const port = event.ports[0]
  if (!port) return
  const notify = (data) => port.postMessage(data)
  if (event.data === 'study-offline-status') {
    event.waitUntil(report().then(notify).catch(() => notify({ status: 'unavailable' })))
  }
  if (event.data?.type === 'study-offline-save') {
    const requested = Array.isArray(event.data.packs) ? event.data.packs : []
    event.waitUntil(queueOperation(async () => {
      const saved = await savedPacks()
      // A failed upgrade can leave the current core and a previous revision's extension.
      // Keep migrating that saved extension until the current revision is complete.
      const names = ['core', ...['scenery', 'record'].filter((name) =>
        requested.includes(name) || saved.some((pack) => pack.pack === name))]
      await savePacks(names, notify)
    }, notify))
  }
  if (event.data === 'study-offline-clear') {
    if (pendingOperation) { notify({ status: 'failed' }); return }
    event.waitUntil(queueOperation(async () => {
      await Promise.all((await caches.keys()).filter((name) => name.startsWith(family)).map((key) => caches.delete(key)))
      inventory = undefined
    }, notify))
  }
})
self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  // Guard: external origins and /ice pass straight to the network and are never cached.
  if (!cacheable(url)) return
  const key = canonical(url)
  const navigation = request.mode === 'navigate'
  const staticFile = ['assets/', 'bookstore/media/', 'bookstore/pdf-'].some((prefix) => url.pathname.startsWith(scope.pathname + prefix))
  if (!resources.has(key) && !staticFile) return
  const range = request.headers.get('range')
  if (range) {
    // Serve a 206 slice only from a complete cached 200; otherwise let the request through.
    const partial = async () => {
      const full = await cached(key)
      return full?.status === 200 ? await slice(full, range) : undefined
    }
    event.respondWith(fetch(request).catch(async (error) => {
      const response = await partial()
      if (response) return response
      throw error
    }))
    return
  }
  event.respondWith((async () => {
    if (!navigation && staticFile) return await cached(key) ?? fetch(request)
    try {
      const response = await fetch(request)
      return !response.ok ? await cached(key) ?? response : response
    } catch (error) {
      const response = await cached(key)
      if (response) return response
      throw error
    }
  })())
})
