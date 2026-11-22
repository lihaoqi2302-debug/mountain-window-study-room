import type { Room } from 'trystero'
import { useStudyRoomStore } from '../store/useStudyRoomStore'
import { defaultEnvironment, noteLimit, validEnvironment, validNote } from '../studyContent'
import type { Note, RoomEnvironment } from '../studyContent'

const store = useStudyRoomStore
let active: { post: (note: Note) => void; change: (environment: RoomEnvironment) => Promise<void> } | null = null

export function postRoomNote(note: Note) {
  if (!active || !validNote(note)) return false
  active.post(note)
  return true
}

export async function setRoomEnvironment(environment: RoomEnvironment) {
  if (!active || !store.getState().isHost || !validEnvironment(environment)) return false
  try {
    await active.change(environment)
    return true
  } catch {
    return false
  }
}

export function attachCollaboration(room: Room, id: string, host: boolean, owner?: string) {
  const abort = new AbortController()
  const signal = abort.signal
  const environment = room.makeState<RoomEnvironment>('environment', defaultEnvironment, {
    roles: ['admin'],
    validate: validEnvironment,
  })
  const snapshots = room.makeAction<null, Note[]>('note-history', { kind: 'request' })
  const comments = room.makeAction<Note>('note')
  const ownNotes = () => store.getState().roomNotes[id] ?? []
  const scope = { signal }
  const refreshHost = () => store.getState().setAuthority(host, host || Boolean(owner && room.getUsers()[owner]))
  const accept = (history: unknown) => {
    if (!signal.aborted && Array.isArray(history) && history.length <= noteLimit) {
      store.getState().mergeRoomNotes(id, history.filter(validNote))
    }
  }

  environment.onChange((value) => {
    if (validEnvironment(value)) store.getState().applyEnvironment(value)
  }, { ...scope, replay: true })
  comments.onMessage((note) => {
    if (validNote(note)) store.getState().mergeRoomNotes(id, [note])
  }, scope)
  snapshots.onRequest(() => ownNotes(), scope)
  room.onPeerJoin(({ peerId }) => {
    refreshHost()
    const readHistory = () => snapshots.request(null, { target: peerId, timeoutMs: 3500, signal })
    void readHistory().catch(() => {
      if (!signal.aborted && room.getPeers()[peerId]) return readHistory()
    }).then(accept).catch(() => { /* The next connection will synchronize again. */ })
  }, { ...scope, replay: true })
  room.onUserJoin(refreshHost, { ...scope, replay: true })
  room.onUserLeave(refreshHost, scope)
  refreshHost()
  if (host && !environment.getMeta()) {
    void environment.set(store.getState().savedEnvironments[id] ?? defaultEnvironment).catch(() => {})
  }

  const controls = {
    post(note: Note) {
      store.getState().mergeRoomNotes(id, [note])
      void comments.send(note, { signal }).catch(() => {})
    },
    change(value: RoomEnvironment) { return environment.set(value) },
  }
  active = controls
  return () => {
    abort.abort()
    if (active === controls) active = null
  }
}
