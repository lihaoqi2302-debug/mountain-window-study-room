import { useStudyRoomStore } from '../store/useStudyRoomStore'

/**
 * Redacted connection report for support. Contains states, reasons, counts and route types only:
 * no credentials, IP addresses, room token after "~", chat or note text.
 */
export function exportDiagnostics() {
  const { roomId, roomStatus, roomMessage, diagnostics: d, peers } = useStudyRoomStore.getState()
  const report = {
    generatedAt: new Date().toISOString(),
    room: roomId ? roomId.split('~')[0].slice(0, 8) : null,
    status: roomStatus,
    reason: roomMessage,
    peers: Object.keys(peers).length,
    signaling: { openRelays: d.relays },
    turn: { status: d.turnStatus, failure: d.turnFailure || null, httpStatus: d.httpStatus || null },
    candidates: { types: d.counts, families: d.families },
    route: {
      kind: d.route,
      localType: d.localType || null,
      remoteType: d.remoteType || null,
      protocol: d.protocol || null,
      relayProtocol: d.relayProtocol || null,
    },
    online: navigator.onLine,
    secureContext: window.isSecureContext,
  }
  return JSON.stringify(report, null, 2)
}
