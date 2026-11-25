// Starts the isolated test network: nostr relay (127.0.0.1:7447) + TURN (UDP 127.0.0.1:3478, test/test).
// Used by Playwright webServer and the soak script. Not a real cross-network setup.
import { startRelay } from './nostr-relay.mjs'
import { startTurn } from './turn-server.mjs'

const relayPort = Number(process.env.TEST_RELAY_PORT ?? 7447)
const turnPort = Number(process.env.TEST_TURN_PORT ?? 3478)
const relay = await startRelay({ port: relayPort, log: console.log })
const turn = startTurn({ port: turnPort })
console.log(`turn server listening on ${turn.url}`)
const stop = async () => { turn.close(); await relay.close(); process.exit(0) }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
process.stdin.resume()
