// Generated builds supply revision and a byte-counted list of packs.
const scope = new URL(self.registration.scope)
const family = `mountain-window-offline:${scope.pathname}:`
const marker = new URL('.offline-ready', scope).href
const packKey = (name) => family + revision + ':' + name
const urlFor = (path) => new URL(path, scope).href
const resources = new Set(Object.values(packs).flatMap(({ files }) => files.map(({ path }) => urlFor(path))))
let saving
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
          const reusable = !path.endsWith('index.html') ? await cached(url) : undefined
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
  const keep = new Set([revision, records.find((item) => item.pack === 'core' && item.revision !== revision)?.revision])
  await Promise.all(records.filter((item) => !keep.has(item.revision)).map((item) => caches.delete(item.key)))
  inventory = undefined
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
    const names = ['core', ...['scenery', 'record'].filter((name) => event.data.packs?.includes(name))]
    saving ??= savePacks(names, notify).finally(() => { saving = undefined })
    event.waitUntil(saving.then(report).then(notify).catch(async () => {
      notify({ ...await report().catch(() => ({})), status: 'failed' })
    }))
  }
  if (event.data === 'study-offline-clear') {
    if (saving) { notify({ status: 'failed' }); return }
    event.waitUntil((async () => {
      await Promise.all((await caches.keys()).filter((name) => name.startsWith(family)).map((key) => caches.delete(key)))
      inventory = undefined
      notify(await report())
    })().catch(() => notify({ status: 'failed' })))
  }
})
self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET' || request.headers.has('range')) return
  const url = new URL(request.url)
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return
  const key = canonical(url)
  const navigation = request.mode === 'navigate'
  const staticFile = ['assets/', 'bookstore/media/', 'bookstore/pdf-'].some((prefix) => url.pathname.startsWith(scope.pathname + prefix))
  if (!resources.has(key) && !staticFile) return
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
