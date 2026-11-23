import { activities, avatarColors, useStudyRoomStore } from '../store/useStudyRoomStore'
import type { Pose, Profile, RoomStatus } from '../store/useStudyRoomStore'
import books from '../data/books.json'
import { randomId } from '../studyContent'
import { attachCollaboration } from './roomCollaboration'
import { getIceConfiguration, monitorIce, selectedRoute } from './ice'
import { validFocus } from '../focus'
import { networkRoomId, refinedScene } from '../edition'

const roomPattern = /^([0-9a-f]{32})(?:~([a-zA-Z0-9_-]{22}))?$/i
const store = useStudyRoomStore
const signalingTimeout = 14_000
const negotiationTimeout = 14_000
const sampleInterval = 100
const idleInterval = 2_000

let generation = 0
let active: (() => Promise<void>) | null = null
let lastLeave = Promise.resolve()

export function parseRoomCode(value: string) {
  const match = roomPattern.exec(value.trim())
  return match ? match[1].toLowerCase() + (match[2] ? `~${match[2]}` : '') : null
}

function setInvite(id: string | null) {
  const url = new URL(window.location.href)
  if (id) url.searchParams.set('room', id)
  else url.searchParams.delete('room')
  if (url.href !== location.href) window.history.replaceState(window.history.state, '', url)
}

function closeSession() {
  generation++
  if (active) {
    const leaving = active()
    lastLeave = Promise.all([lastLeave, leaving]).then(() => undefined)
    active = null
  }
  return lastLeave
}

export function validPose(value: unknown): value is Pose {
  if (!value || typeof value !== 'object') return false
  const { x, y, z, yaw, seat } = value as Pose
  return Number.isFinite(x) && Math.abs(x) <= (refinedScene ? 4.2 : 32)
    && Number.isFinite(z) && Math.abs(z) <= (refinedScene ? 3.6 : 32)
    && (y === undefined || Number.isFinite(y) && y >= -.1 && y <= 4)
    && Number.isFinite(yaw) && Math.abs(yaw) <= Math.PI * 2
    && (seat === undefined || seat === 'sofa' || seat === 'armchair' || seat === 'desk')
}

function validProfile(value: unknown): value is Profile {
  if (!value || typeof value !== 'object') return false
  const { name, color, activity, book, focus } = value as Profile
  return typeof name === 'string' && name.length > 0 && name.length <= 16
    && avatarColors.includes(color) && activities.includes(activity)
    && (book === null || books.some(({ id }) => id === book))
    && (focus === undefined || validFocus(focus))
}

function readProfile(): Profile {
  const { name, color, activity, openBook, sceneBook, focus } = store.getState()
  const presence = focus.endAt && focus.endAt > Date.now() ? { phase: focus.phase, endAt: focus.endAt } : undefined
  return { name, color, activity, book: openBook ?? sceneBook, ...(presence ? { focus: presence } : {}) }
}

export function leaveRoom() {
  void closeSession()
  setInvite(null)
  store.getState().resetRoom(null, 'solo')
}

export function suspendRoom() {
  void closeSession()
}

export function createRoom() {
  void joinStudyRoom(randomId(), true)
}

export async function joinStudyRoom(rawId: string, create = false) {
  const previousLeave = closeSession()
  const current = generation
  const id = parseRoomCode(rawId)
  if (!id) {
    setInvite(null)
    store.getState().resetRoom(null, 'failed', '邀请链接不完整，可以继续单机或创建新房间。')
    return
  }

  let shareCode = create ? null : id
  setInvite(shareCode)
  store.getState().resetRoom(shareCode, 'connecting')
  const isCurrent = () => generation === current
  let interval: number | undefined
  const listeners: Array<() => void> = []
  const controller = new AbortController()
  active = async () => controller.abort()
  const updateStatus = (status: RoomStatus, message?: string) => {
    if (isCurrent()) store.getState().setRoomStatus(status, message)
  }
  const fail = (message: string) => {
    if (!isCurrent()) return
    void closeSession()
    store.getState().resetRoom(shareCode, 'failed', message)
  }

  if (!window.isSecureContext || typeof RTCPeerConnection === 'undefined') {
    fail('联机需要支持 WebRTC 的浏览器和 HTTPS 页面。本机可用 localhost 启动。')
    return
  }

  try {
    // Load the network stack only after an explicit invitation or room creation.
    const [{ joinRoom, getRelaySockets, roles }, ice] = await Promise.all([
      import('trystero'),
      navigator.onLine ? getIceConfiguration(controller.signal) : undefined,
    ])
    await previousLeave
    if (!isCurrent()) return
    if (!navigator.onLine || !ice) {
      fail('当前设备离线。恢复网络后可以重试。')
      return
    }

    const monitor = monitorIce(controller.signal)
    const room = joinRoom({
      appId: networkRoomId,
      maxUsers: 6,
      maxReceiveBytes: 96 * 1024,
      use: [roles({ selfAsAdmin: create })],
      relayConfig: { warnOnRelayFailure: false },
      rtcConfig: ice.config,
      rtcPolyfill: monitor.Connection,
    }, id)
    active = async () => {
      controller.abort()
      window.clearInterval(interval)
      for (const remove of listeners) remove()
      try { await room.leave() } catch (error) { console.warn('Room cleanup failed', error) }
    }
    const identityInfo = await room.getSelf()
    if (!isCurrent()) return
    shareCode = identityInfo.roomId
    setInvite(shareCode)
    store.getState().resetRoom(shareCode, 'connecting')
    listeners.push(attachCollaboration(room, shareCode, identityInfo.isAdmin, shareCode.split('~')[1]))
    const motion = room.makeAction<Pose>('motion')
    const identity = room.makeAction<Profile>('profile')
    let noSignalSince = performance.now()
    let negotiatingSince = 0
    let handshakeFailed = false
    let nextStats = 0
    let route: Awaited<ReturnType<typeof selectedRoute>> | 'mixed' = 'unknown'
    const restricted = () => {
      if (handshakeFailed) {
        fail('已找到好友，但房间握手未完成。请双方刷新页面后用同一邀请链接重试。')
        return
      }
      const turnMessage = ice.turnStatus === 'not-configured' ? '当前站点未配置 TURN 中继。'
        : ice.turnStatus === 'unavailable' ? '暂时未能取得 TURN 中继凭据。' : ''
      fail(`已找到好友，但点对点连接受限。${turnMessage}可以先单机阅读，或切换网络后重试。`)
    }

    // A peer can leave between checking presence and sending. The next join resends a snapshot.
    const sendMotion = (pose: Pose, target?: string) => void motion.send(pose, { target }).catch(() => {})
    const sendProfile = (profile: Profile, target?: string) => void identity.send(profile, { target }).catch(() => {})
    listeners.push(
      motion.onMessage((pose, { peerId }) => {
        if (isCurrent() && validPose(pose)) store.getState().updatePeer(peerId, { pose })
      }),
      identity.onMessage((profile, { peerId }) => {
        if (isCurrent() && validProfile(profile)) store.getState().updatePeer(peerId, { profile })
      }),
      room.onPeerJoin(({ peerId }) => {
        if (!isCurrent()) return
        store.getState().addPeer(peerId)
        sendProfile(readProfile(), peerId)
        sendMotion(store.getState().pose, peerId)
        updateStatus('connected')
      }, { replay: true }),
      room.onPeerLeave(({ peerId }) => {
        if (isCurrent()) store.getState().removePeer(peerId)
      }),
      room.onError((error) => {
        if (!isCurrent()) return
        if (error.code === 'room-full' && !Object.keys(room.getPeers()).length) {
          fail('房间已满，请稍后重试或创建新房间。')
        }
        if (error.code === 'identity-failed') fail('浏览器无法建立联机身份，请重试。')
        if ((error.code === 'peer-connect-failed' || error.code === 'handshake-failed') && !Object.keys(room.getPeers()).length) {
          // One peer attempt can fail while another attempt is still negotiating.
          negotiatingSince ||= performance.now()
          handshakeFailed ||= error.code === 'handshake-failed'
        }
      }),
      store.subscribe((next, previous) => {
        if (next.name !== previous.name || next.color !== previous.color
          || next.activity !== previous.activity || next.openBook !== previous.openBook
          || next.sceneBook !== previous.sceneBook || next.focus.endAt !== previous.focus.endAt) {
          sendProfile(readProfile())
        }
      }),
    )

    const handleOffline = () => fail('网络已断开，可以继续单机。恢复网络后点击重试。')
    window.addEventListener('offline', handleOffline)
    listeners.push(() => window.removeEventListener('offline', handleOffline))
    let lastPose: Pose | undefined
    let lastSent = 0
    interval = window.setInterval(() => {
      if (!isCurrent()) return
      const now = performance.now()
      const state = store.getState()
      const peers = Object.values(room.getPeers())
      const relays = Object.values(getRelaySockets()).filter((socket) => socket.readyState === WebSocket.OPEN).length
      store.getState().setDiagnostics({
        relays, route, candidates: [...monitor.candidates].sort().join(', '), turnStatus: ice.turnStatus,
      })
      if (peers.length) {
        negotiatingSince = 0
        handshakeFailed = false
        noSignalSince = now
        updateStatus('connected')
        if (now >= nextStats) {
          nextStats = now + 2000
          void Promise.all(peers.map(({ connection }) => connection
            ? selectedRoute(connection).catch(() => 'unknown' as const)
            : Promise.resolve('unknown' as const))).then((values) => {
            const known = values.filter((value) => value !== 'unknown')
            route = known.includes('direct') && known.includes('relay') ? 'mixed' : known[0] ?? 'unknown'
          })
        }
        if (lastPose !== state.pose || now - lastSent >= idleInterval) {
          lastPose = state.pose
          lastSent = now
          sendMotion(lastPose)
        }
        return
      }

      route = 'unknown'
      if (monitor.pending.size || negotiatingSince) {
        negotiatingSince ||= now
        if (now - negotiatingSince >= negotiationTimeout) restricted()
        else updateStatus('negotiating', ice.turnStatus === 'configured' ? '正在尝试直连或 TURN 中继。' : '正在尝试直连，书屋仍可使用。')
      } else if (relays) {
        noSignalSince = now
        updateStatus('waiting')
      } else if (now - noSignalSince >= signalingTimeout) {
        fail('公共信令连接超时。可以先单机阅读，或切换网络后重试。')
      } else {
        updateStatus('connecting')
      }
    }, sampleInterval)
  } catch (error) {
    console.warn('Could not join study room', error)
    fail('暂时无法加入房间，可以重试或继续单机。')
  }
}
