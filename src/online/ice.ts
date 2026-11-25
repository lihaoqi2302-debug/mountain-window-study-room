const defaults: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }]
const turn = /^turns?:/i
export type TurnStatus = 'not-configured' | 'unavailable' | 'configured'
export type IceFailure = 'timeout' | 'aborted' | 'http' | 'bad-json' | 'network' | 'no-turn-entries' | 'insecure-endpoint'

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

const hasTurnServer = (servers: RTCIceServer[]) =>
  servers.some(({ urls }) => typeof urls === 'string' ? turn.test(urls) : urls.some((url) => turn.test(url)))

export async function getIceConfiguration(signal: AbortSignal) {
  const testing = import.meta.env.MODE === 'test'
  let iceServers = testing ? [] : defaults
  let failure: IceFailure | undefined
  let httpStatus: number | undefined
  const configured = import.meta.env.VITE_STUN_SERVERS
  const turnEndpoint = import.meta.env.VITE_ICE_ENDPOINT
  if (configured) iceServers = [...iceServers, ...readServers([{ urls: configured.split(',').map((url: string) => url.trim()) }], false)]
  if (turnEndpoint) {
    const deadline = new AbortController()
    let timedOut = false
    const abort = () => deadline.abort()
    signal.addEventListener('abort', abort, { once: true })
    const timeout = window.setTimeout(() => { timedOut = true; abort() }, 3000)
    try {
      if (signal.aborted) abort()
      const endpoint = new URL(turnEndpoint, location.href)
      if (endpoint.protocol !== 'https:' && endpoint.origin !== location.origin) failure = 'insecure-endpoint'
      else {
        const response = await fetch(endpoint, { signal: deadline.signal, cache: 'no-store' })
        httpStatus = response.status
        if (!response.ok) failure = 'http'
        else {
          let body: unknown
          try { body = await response.json() } catch (error) {
            if (deadline.signal.aborted) throw error
            failure = 'bad-json'
          }
          if (!failure) {
            const list = body && typeof body === 'object' && 'iceServers' in body ? (body as { iceServers: unknown }).iceServers : body
            const servers = readServers(list, true)
            if (!hasTurnServer(servers)) failure = 'no-turn-entries'
            iceServers = [...iceServers, ...servers]
          }
        }
      }
    } catch {
      // STUN is still available when the credential endpoint is down.
      failure = timedOut ? 'timeout' : signal.aborted || deadline.signal.aborted ? 'aborted' : 'network'
    } finally {
      window.clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
    }
  }
  const hasTurn = hasTurnServer(iceServers)
  const turnStatus: TurnStatus = !turnEndpoint ? 'not-configured' : hasTurn ? 'configured' : 'unavailable'
  const testPolicy = testing && import.meta.env.VITE_TEST_ICE_POLICY === 'relay'
  return {
    config: { iceServers, ...(testPolicy ? { iceTransportPolicy: 'relay' as const } : {}) } satisfies RTCConfiguration,
    turnStatus,
    failure,
    httpStatus,
  }
}

export type CandidateCounts = { host: number; srflx: number; prflx: number; relay: number }
export type FamilyCounts = { v4: number; v6: number; mdns: number }
export type RouteKind = 'unknown' | 'direct' | 'relay' | 'mixed'
export type RouteDetail = {
  route: Exclude<RouteKind, 'mixed'>
  localType?: string
  remoteType?: string
  protocol?: string
  relayProtocol?: string
}

export type ConnectionDiagnostics = {
  relays: number
  candidates: string
  counts: CandidateCounts
  families: FamilyCounts
  route: RouteKind
  localType: string
  remoteType: string
  protocol: string
  relayProtocol: string
  turnStatus: TurnStatus
  turnFailure: IceFailure | ''
  httpStatus: number
}
export const emptyCounts: CandidateCounts = { host: 0, srflx: 0, prflx: 0, relay: 0 }
export const emptyFamilies: FamilyCounts = { v4: 0, v6: 0, mdns: 0 }
export const emptyDiagnostics: ConnectionDiagnostics = {
  relays: 0, candidates: '', counts: emptyCounts, families: emptyFamilies, route: 'unknown',
  localType: '', remoteType: '', protocol: '', relayProtocol: '',
  turnStatus: 'not-configured', turnFailure: '', httpStatus: 0,
}

export function sameDiagnostics(a: ConnectionDiagnostics, b: ConnectionDiagnostics) {
  return a.relays === b.relays && a.candidates === b.candidates && a.route === b.route
    && a.localType === b.localType && a.remoteType === b.remoteType && a.protocol === b.protocol
    && a.relayProtocol === b.relayProtocol && a.turnStatus === b.turnStatus
    && a.turnFailure === b.turnFailure && a.httpStatus === b.httpStatus
    && (Object.keys(a.counts) as Array<keyof CandidateCounts>).every((key) => a.counts[key] === b.counts[key])
    && (Object.keys(a.families) as Array<keyof FamilyCounts>).every((key) => a.families[key] === b.families[key])
}

function family(address: string | null | undefined): keyof FamilyCounts | null {
  if (!address) return null
  if (/\.local$/i.test(address)) return 'mdns'
  if (address.includes(':')) return 'v6'
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) return 'v4'
  return null
}

export function monitorIce(signal: AbortSignal) {
  const pending = new Set<RTCPeerConnection>()
  const candidates = new Set<string>()
  // Only counts are kept; candidate addresses never leave this listener.
  const counts: CandidateCounts = { ...emptyCounts }
  const families: FamilyCounts = { ...emptyFamilies }
  class Connection extends RTCPeerConnection {
    constructor(config?: RTCConfiguration) {
      super(config)
      pending.add(this)
      this.addEventListener('icecandidate', ({ candidate }) => {
        if (!candidate?.type) return
        candidates.add(candidate.type)
        if (candidate.type in counts) counts[candidate.type as keyof CandidateCounts]++
        const kind = family(candidate.address)
        if (kind) families[kind]++
      }, { signal })
      this.addEventListener('connectionstatechange', () => {
        if (['closed', 'failed', 'connected'].includes(this.connectionState)) pending.delete(this)
      }, { signal })
      this.addEventListener('iceconnectionstatechange', () => {
        if (['closed', 'failed', 'connected', 'completed'].includes(this.iceConnectionState)) pending.delete(this)
      }, { signal })
    }
  }
  signal.addEventListener('abort', () => pending.clear(), { once: true })
  return { Connection, pending, candidates, counts, families }
}

export async function selectedRoute(connection: RTCPeerConnection): Promise<RouteDetail> {
  const report = await connection.getStats()
  let pair: RTCStats | undefined
  report.forEach((stat) => {
    if (stat.type === 'transport' && stat.selectedCandidatePairId) pair = report.get(stat.selectedCandidatePairId)
  })
  if (!pair) report.forEach((stat) => {
    if (stat.type === 'candidate-pair' && (stat.selected || stat.nominated && stat.state === 'succeeded')) pair = stat
  })
  if (!pair) return { route: 'unknown' }
  const { localCandidateId, remoteCandidateId } = pair as RTCIceCandidatePairStats
  const local = report.get(localCandidateId)
  const remote = report.get(remoteCandidateId)
  const localType: string | undefined = local?.candidateType
  const remoteType: string | undefined = remote?.candidateType
  return {
    route: localType === 'relay' || remoteType === 'relay' ? 'relay' : localType && remoteType ? 'direct' : 'unknown',
    localType, remoteType,
    protocol: typeof local?.protocol === 'string' ? local.protocol : undefined,
    relayProtocol: typeof local?.relayProtocol === 'string' ? local.relayProtocol : undefined,
  }
}
