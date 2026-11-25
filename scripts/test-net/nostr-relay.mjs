// Minimal Nostr relay for isolated online tests (same-machine multi-session + simulated isolated network).
// Supports EVENT -> OK + fan-out to matching REQ subscriptions, REQ -> EOSE, CLOSE.
// Ephemeral kinds (20000-29999, used by trystero) are not stored, matching NIP-16 semantics.
// Usage: node scripts/test-net/nostr-relay.mjs [--port 7447] [--host 127.0.0.1]
import { WebSocketServer } from 'ws'
import { fileURLToPath } from 'node:url'

function matches(filter, event) {
  if (!filter || typeof filter !== 'object') return false
  if (Array.isArray(filter.ids) && !filter.ids.includes(event.id)) return false
  if (Array.isArray(filter.authors) && !filter.authors.includes(event.pubkey)) return false
  if (Array.isArray(filter.kinds) && !filter.kinds.includes(event.kind)) return false
  if (typeof filter.since === 'number' && event.created_at < filter.since) return false
  if (typeof filter.until === 'number' && event.created_at > filter.until) return false
  for (const [key, values] of Object.entries(filter)) {
    if (!key.startsWith('#') || !Array.isArray(values)) continue
    const name = key.slice(1)
    const tags = Array.isArray(event.tags) ? event.tags : []
    if (!tags.some((tag) => Array.isArray(tag) && tag[0] === name && values.includes(tag[1]))) return false
  }
  return true
}

export function startRelay({ port = 0, host = '127.0.0.1', log = () => {} } = {}) {
  const stats = { connections: 0, events: 0, delivered: 0, rejected: 0 }
  const wss = new WebSocketServer({ port, host, maxPayload: 512 * 1024 })
  const clients = new Map() // socket -> Map<subId, filters[]>
  const stored = [] // non-ephemeral events, bounded
  wss.on('connection', (socket) => {
    stats.connections++
    const subs = new Map()
    clients.set(socket, subs)
    socket.on('close', () => clients.delete(socket))
    socket.on('error', () => {})
    socket.on('message', (raw) => {
      let msg
      try { msg = JSON.parse(String(raw)) } catch { return socket.send(JSON.stringify(['NOTICE', 'invalid: bad json'])) }
      if (!Array.isArray(msg)) return
      const [type, ...rest] = msg
      if (type === 'EVENT') {
        const event = rest[0]
        if (!event || typeof event.id !== 'string' || typeof event.kind !== 'number') {
          stats.rejected++
          return socket.send(JSON.stringify(['OK', event?.id ?? '', false, 'invalid: malformed event']))
        }
        stats.events++
        socket.send(JSON.stringify(['OK', event.id, true, '']))
        if (!(event.kind >= 20000 && event.kind < 30000)) {
          stored.push(event)
          if (stored.length > 2000) stored.shift()
        }
        for (const [peer, peerSubs] of clients) {
          if (peer.readyState !== 1) continue
          for (const [subId, filters] of peerSubs) {
            if (filters.some((f) => matches(f, event))) {
              peer.send(JSON.stringify(['EVENT', subId, event]))
              stats.delivered++
            }
          }
        }
      } else if (type === 'REQ') {
        const [subId, ...filters] = rest
        if (typeof subId !== 'string') return
        subs.set(subId, filters)
        for (const event of stored) if (filters.some((f) => matches(f, event))) socket.send(JSON.stringify(['EVENT', subId, event]))
        socket.send(JSON.stringify(['EOSE', subId]))
      } else if (type === 'CLOSE') {
        subs.delete(rest[0])
        socket.send(JSON.stringify(['CLOSED', rest[0], '']))
      }
    })
  })
  return new Promise((resolve, reject) => {
    wss.once('error', reject)
    wss.once('listening', () => {
      const address = wss.address()
      const url = `ws://${host}:${address.port}`
      log(`nostr relay listening on ${url}`)
      resolve({ url, port: address.port, stats, close: () => new Promise((done) => {
        for (const socket of clients.keys()) socket.terminate()
        wss.close(() => done())
      }) })
    })
  })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (name, fallback) => {
    const i = process.argv.indexOf(name)
    return i > 0 ? process.argv[i + 1] : fallback
  }
  const relay = await startRelay({ port: Number(arg('--port', 7447)), host: arg('--host', '127.0.0.1'), log: console.log })
  const stop = () => relay.close().then(() => process.exit(0))
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}
