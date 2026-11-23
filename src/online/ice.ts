const defaults: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }]
const turn = /^turns?:/i
export type TurnStatus = 'not-configured' | 'unavailable' | 'configured'

function readServers(value: unknown, allowCredentials: boolean): RTCIceServer[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 12).flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const urls = (Array.isArray(item.urls) ? item.urls : [item.urls]).filter(
      (url: unknown): url is string => typeof url === 'string'
        && (allowCredentials ? /^(?:stun|turns?):/i : /^stun:/i).test(url),
    )
    if (!urls.length) return []
    if (allowCredentials && urls.some((url: string) => turn.test(url))) {
      if (typeof item.username !== 'string' || typeof item.credential !== 'string') return []
      return [{ urls, username: item.username, credential: item.credential }]
    }
    return [{ urls }]
  })
}

export async function getIceConfiguration(signal: AbortSignal) {
  let iceServers = defaults
  const configured = import.meta.env.VITE_STUN_SERVERS
  const turnEndpoint = import.meta.env.VITE_ICE_ENDPOINT
  if (configured) iceServers = [...iceServers, ...readServers([{ urls: configured.split(',').map((url: string) => url.trim()) }], false)]
  if (turnEndpoint) {
    const deadline = new AbortController()
    const abort = () => deadline.abort()
    signal.addEventListener('abort', abort, { once: true })
    const timeout = window.setTimeout(abort, 3000)
    try {
      if (signal.aborted) abort()
      const endpoint = new URL(turnEndpoint, location.href)
      if (endpoint.protocol !== 'https:' && endpoint.origin !== location.origin) throw new Error('HTTPS required')
      const response = await fetch(endpoint, { signal: deadline.signal, cache: 'no-store' })
      if (!response.ok) throw new Error('ICE configuration unavailable')
      const body = await response.json()
      iceServers = [...iceServers, ...readServers(body.iceServers ?? body, true)]
    } catch { /* STUN is still available when the credential endpoint is down. */ }
    finally {
      window.clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
    }
  }
  const hasTurn = iceServers.some(({ urls }) => typeof urls === 'string' ? turn.test(urls) : urls.some((url) => turn.test(url)))
  const turnStatus: TurnStatus = !turnEndpoint ? 'not-configured' : hasTurn ? 'configured' : 'unavailable'
  return {
    config: { iceServers } satisfies RTCConfiguration,
    turnStatus,
  }
}

export type ConnectionDiagnostics = {
  relays: number
  candidates: string
  route: 'unknown' | 'direct' | 'relay' | 'mixed'
  turnStatus: TurnStatus
}
export const emptyDiagnostics: ConnectionDiagnostics = {
  relays: 0, candidates: '', route: 'unknown', turnStatus: 'not-configured',
}

export function monitorIce(signal: AbortSignal) {
  const pending = new Set<RTCPeerConnection>()
  const candidates = new Set<string>()
  class Connection extends RTCPeerConnection {
    constructor(config?: RTCConfiguration) {
      super(config)
      this.addEventListener('icecandidate', ({ candidate }) => {
        if (candidate?.type) candidates.add(candidate.type)
      }, { signal })
      this.addEventListener('iceconnectionstatechange', () => {
        if (this.iceConnectionState === 'checking') pending.add(this)
        else pending.delete(this)
      }, { signal })
      this.addEventListener('connectionstatechange', () => {
        if (['closed', 'failed', 'connected'].includes(this.connectionState)) pending.delete(this)
      }, { signal })
    }
  }
  return {
    Connection,
    pending,
    candidates,
  }
}

export async function selectedRoute(connection: RTCPeerConnection) {
  const report = await connection.getStats()
  let pair: RTCStats | undefined
  report.forEach((stat) => {
    if (stat.type === 'transport' && stat.selectedCandidatePairId) pair = report.get(stat.selectedCandidatePairId)
  })
  if (!pair) report.forEach((stat) => {
    if (stat.type === 'candidate-pair' && (stat.selected || stat.nominated && stat.state === 'succeeded')) pair = stat
  })
  if (!pair) return 'unknown'
  const { localCandidateId, remoteCandidateId } = pair as RTCIceCandidatePairStats
  const local = report.get(localCandidateId)?.candidateType
  const remote = report.get(remoteCandidateId)?.candidateType
  return local === 'relay' || remote === 'relay' ? 'relay' : local && remote ? 'direct' : 'unknown'
}
