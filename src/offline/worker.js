// The build adds the immutable asset list and revision before this code.
const scope = new URL(self.registration.scope)
const family = `mountain-window-offline:${scope.pathname}:`
const cacheName = family + revision
const marker = new URL('.offline-ready', scope).href
const urls = files.map((file) => new URL(file, scope).href)
const resources = new Set(urls)
let saving

const sameScope = (url) => url.origin === scope.origin && url.pathname.startsWith(scope.pathname)

function canonical(url) {
  const relative = url.pathname.slice(scope.pathname.length)
  if (relative === '' || relative === 'index.html') return new URL('index.html', scope).href
  if (relative === 'bookstore' || relative === 'bookstore/' || relative === 'bookstore/index.html') {
    return new URL('bookstore/index.html', scope).href
  }
  return new URL(relative, scope).href
}

async function savedVersions() {
  const names = (await caches.keys()).filter((name) => name.startsWith(family)).reverse()
  const result = []
  for (const name of names) {
    if (await (await caches.open(name)).match(marker)) result.push(name)
  }
  return result
}

async function cached(url) {
  for (const name of await savedVersions()) {
    const response = await (await caches.open(name)).match(url)
    if (response) return response
  }
}

async function save() {
  const cache = await caches.open(cacheName)
  await cache.addAll(urls.map((url) => new Request(url, { cache: 'reload' })))
  await cache.put(marker, new Response(revision))
  const previous = (await savedVersions()).filter((name) => name !== cacheName)
  await Promise.all(previous.slice(1).map((name) => caches.delete(name)))
}

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('message', (event) => {
  const port = event.ports[0]
  if (!port) return
  if (event.data === 'study-offline-status') {
    event.waitUntil(savedVersions().then((versions) => {
      port.postMessage(versions.includes(cacheName) ? 'saved' : versions.length ? 'update' : 'available')
    }).catch(() => port.postMessage('unavailable')))
  }
  if (event.data === 'study-offline-save') {
    saving ??= save().finally(() => { saving = undefined })
    event.waitUntil(saving.then(() => port.postMessage('saved')).catch(() => port.postMessage('failed')))
  }
})
self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET' || request.headers.has('range')) return
  const url = new URL(request.url)
  if (!sameScope(url)) return
  const key = canonical(url)
  const navigation = request.mode === 'navigate'
  const asset = url.pathname.startsWith(scope.pathname + 'assets/')
  if (!resources.has(key) && !asset) return

  event.respondWith((async () => {
    if (!navigation && asset) return await cached(key) ?? fetch(request)
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
