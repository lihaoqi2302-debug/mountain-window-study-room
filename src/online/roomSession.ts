import { activities, avatarColors, useStudyRoomStore } from '../store/useStudyRoomStore'
import type { Pose, Profile, RoomStatus } from '../store/useStudyRoomStore'
import books from '../data/books.json'
import { randomId } from '../studyContent'
import { attachCollaboration } from './roomCollaboration'

const formal = import.meta.env.MODE === 'formal'
const appId = formal ? 'mountain-window-study-room/formal-2' : 'mountain-window-study-room/phase-1'
const roomPattern = /^([0-9a-f]{32})(?:~([a-zA-Z0-9_-]{22}))?$/i
const store = useStudyRoomStore
const signalingTimeout = 12_000
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
    lastLeave = active()
    active = null
  }
  return lastLeave
}

export function validPose(value: unknown): value is Pose {
  if (!value || typeof value !== 'object') return false
  const { x, y, z, yaw, seat } = value as Pose
  return Number.isFinite(x) && Math.abs(x) <= (formal ? 4.2 : 32)
    && Number.isFinite(z) && Math.abs(z) <= (formal ? 3.6 : 32)
    && (y === undefined || Number.isFinite(y) && y >= -.1 && y <= 4)
    && Number.isFinite(yaw) && Math.abs(yaw) <= Math.PI * 2
    && (seat === undefined || seat === 'sofa' || seat === 'armchair' || seat === 'desk')
}

function validProfile(value: unknown): value is Profile {
  if (!value || typeof value !== 'object') return false
  const { name, color, activity, book } = value as Profile
  return typeof name === 'string' && name.length > 0 && name.length <= 16
    && avatarColors.includes(color) && activities.includes(activity)
    && (book === null || books.some(({ id }) => id === book))
}

function readProfile(): Profile {
  const { name, color, activity, openBook, sceneBook } = store.getState()
  return { name, color, activity, book: openBook ?? sceneBook }
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
    const { joinRoom, getRelaySockets, roles } = await import('trystero')
    await previousLeave
    if (!isCurrent()) return
    if (!navigator.onLine) {
      fail('当前设备离线。恢复网络后可以重试。')
      return
    }

    const room = joinRoom({
      appId,
      maxUsers: 6,
      maxReceiveBytes: 96 * 1024,
      use: [roles({ selfAsAdmin: create })],
      relayConfig: { warnOnRelayFailure: false },
    }, id)
    active = async () => {
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
        if (error.code === 'room-full' && !Object.keys(room.getPeers()).length) {
          fail('房间已满，请稍后重试或创建新房间。')
        }
        if (error.code === 'identity-failed') fail('浏览器无法建立联机身份，请重试。')
      }),
      store.subscribe((next, previous) => {
        if (next.name !== previous.name || next.color !== previous.color
          || next.activity !== previous.activity || next.openBook !== previous.openBook
          || next.sceneBook !== previous.sceneBook) {
          sendProfile(readProfile())
        }
      }),
    )

    const handleOffline = () => fail('网络已断开，可以继续单机。恢复网络后点击重试。')
    window.addEventListener('offline', handleOffline)
    listeners.push(() => window.removeEventListener('offline', handleOffline))
    let noSignalSince = performance.now()
    let lastPose: Pose | undefined
    let lastSent = 0
    interval = window.setInterval(() => {
      if (!isCurrent()) return
      const now = performance.now()
      const state = store.getState()
      if (Object.keys(room.getPeers()).length) {
        noSignalSince = now
        updateStatus('connected')
        if (lastPose !== state.pose || now - lastSent >= idleInterval) {
          lastPose = state.pose
          lastSent = now
          sendMotion(lastPose)
        }
        return
      }

      if (Object.values(getRelaySockets()).some((socket) => socket.readyState === WebSocket.OPEN)) {
        noSignalSince = now
        updateStatus('waiting')
      } else if (now - noSignalSince >= signalingTimeout) {
        fail('暂时连不上公共信令。请检查网络后重试，或继续单机。')
      } else {
        updateStatus('connecting')
      }
    }, sampleInterval)
  } catch (error) {
    console.warn('Could not join study room', error)
    fail('暂时无法加入房间，可以重试或继续单机。')
  }
}
