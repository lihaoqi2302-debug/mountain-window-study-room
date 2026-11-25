// Local TURN (UDP, long-term credentials test/test) for isolated online tests.
// Usage: node scripts/test-net/turn-server.mjs [--port 3478]
import Turn from 'node-turn'
import { fileURLToPath } from 'node:url'

export function startTurn({ port = 3478, host = '127.0.0.1' } = {}) {
  const server = new Turn({
    listeningPort: port,
    listeningIps: [host],
    relayIps: [host],
    authMech: 'long-term',
    credentials: { test: 'test' },
    realm: 'study-room.test',
    minPort: 49160,
    maxPort: 49460,
    debugLevel: 'ERROR',
  })
  server.start()
  return { url: `turn:${host}:${port}?transport=udp`, username: 'test', credential: 'test', close: () => server.stop() }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const i = process.argv.indexOf('--port')
  const turn = startTurn({ port: i > 0 ? Number(process.argv[i + 1]) : 3478 })
  console.log(`turn server listening on ${turn.url}`)
  const stop = () => { turn.close(); process.exit(0) }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}
