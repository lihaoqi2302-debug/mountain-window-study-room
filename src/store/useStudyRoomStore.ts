import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { chatLimit, defaultEnvironment, mergeRecent, noteLimit, rememberRoom } from '../studyContent'
import type { Note, RoomEnvironment, RoomMessage } from '../studyContent'
import { emptyDiagnostics } from '../online/ice'
import type { ConnectionDiagnostics } from '../online/ice'
import { initialFocus, localDay } from '../focus'
import type { FocusPresence, FocusTimer } from '../focus'

export type Seat = 'sofa' | 'armchair' | 'desk'
export type Pose = { x: number; y?: number; z: number; yaw: number; seat?: Seat }
export const avatarColors = ['#b57a55', '#809384', '#788fa9', '#a67e91', '#c3a36b']
export const activities = ['随意逛逛', '专注刷题中', '摸鱼发呆']
export type Profile = { name: string; color: string; activity: string; book: string | null; focus?: FocusPresence }
export type Peer = { pose: Pose | null; profile: Profile | null }
export type RoomStatus = 'solo' | 'connecting' | 'waiting' | 'negotiating' | 'connected' | 'failed'

interface StudyRoomState {
  focus: FocusTimer
  configureFocus: (focus: number, rest: number) => void
  toggleFocus: (now: number) => void
  resetFocus: () => void
  settleFocus: (now: number) => void
  dismissFocusNotice: () => void
  pose: Pose
  setPose: (pose: Pose) => void
  name: string
  color: string
  setIdentity: (identity: { name: string; color: string }) => void
  activity: string
  setActivity: (activity: string) => void
  openBook: string | null
  setOpenBook: (id: string | null) => void
  sceneBook: string | null
  setSceneBook: (id: string | null) => void
  bookmarks: Record<string, string>
  markChapter: (book: string, chapter: string) => void
  volume: number
  setVolume: (volume: number) => void
  roomId: string | null
  roomStatus: RoomStatus
  roomMessage: string
  diagnostics: ConnectionDiagnostics
  setDiagnostics: (value: ConnectionDiagnostics) => void
  isHost: boolean
  hostOnline: boolean
  environment: RoomEnvironment
  savedEnvironments: Record<string, RoomEnvironment>
  setAuthority: (isHost: boolean, hostOnline: boolean) => void
  applyEnvironment: (environment: RoomEnvironment) => void
  localNotes: Note[]
  roomNotes: Record<string, Note[]>
  chats: Record<string, RoomMessage[]>
  saveLocalNote: (note: Note) => void
  mergeRoomNotes: (id: string, notes: Note[]) => void
  mergeChat: (id: string, messages: RoomMessage[]) => void
  peers: Record<string, Peer>
  resetRoom: (id: string | null, status: RoomStatus, message?: string) => void
  setRoomStatus: (status: RoomStatus, message?: string) => void
  addPeer: (id: string) => void
  updatePeer: (id: string, data: Partial<Peer>) => void
  removePeer: (id: string) => void
}

type Preferences = Pick<StudyRoomState, 'name' | 'color' | 'bookmarks' | 'volume'
  | 'localNotes' | 'roomNotes' | 'savedEnvironments' | 'chats' | 'focus'>

export const useStudyRoomStore = create<StudyRoomState>()(
  persist<StudyRoomState, [], [], Preferences>(
    (set) => ({
      focus: initialFocus,
      configureFocus: (focus, rest) => set((state) => {
        if (state.focus.endAt !== null || state.focus.remaining !== null) return state
        const minutes = (value: number, max: number) => Math.min(max, Math.max(1, Math.round(value)))
        if (!Number.isFinite(focus) || !Number.isFinite(rest)) return state
        return { focus: { ...state.focus, focus: minutes(focus, 120), rest: minutes(rest, 60) } }
      }),
      toggleFocus: (now) => set(({ focus }) => ({
        focus: focus.endAt === null
          ? { ...focus, endAt: now + (focus.remaining ?? focus[focus.phase] * 60_000), remaining: null, notice: '' }
          : { ...focus, endAt: null, remaining: Math.max(1, focus.endAt - now) },
      })),
      resetFocus: () => set(({ focus }) => ({ focus: { ...focus, phase: 'focus', endAt: null, remaining: null, notice: '' } })),
      settleFocus: (now) => set((state) => {
        const { focus } = state
        if (focus.endAt === null || focus.endAt > now) return state
        const day = localDay(focus.endAt)
        const today = focus.today.day === day ? focus.today : { day, rounds: 0, minutes: 0 }
        return focus.phase === 'focus' ? { focus: {
          ...focus, endAt: null, remaining: null, phase: 'rest', notice: '专注完成。休息一会儿吧。',
          today: { day, rounds: today.rounds + 1, minutes: today.minutes + focus.focus },
        } } : { focus: { ...focus, endAt: null, remaining: null, phase: 'focus', notice: '休息结束。准备好再继续。' } }
      }),
      dismissFocusNotice: () => set(({ focus }) => ({ focus: { ...focus, notice: '' } })),
      pose: { x: 0.28, z: 1.22, yaw: Math.PI / 4 },
      setPose: (pose) => set({ pose }),
      name: '读者',
      color: avatarColors[0],
      setIdentity: ({ name, color }) => set({ name: name.trim().slice(0, 16) || '读者', color }),
      activity: activities[0],
      setActivity: (activity) => set({ activity }),
      openBook: null,
      setOpenBook: (openBook) => set({ openBook }),
      sceneBook: null,
      setSceneBook: (sceneBook) => set({ sceneBook }),
      bookmarks: {},
      markChapter: (book, chapter) => set((state) => ({
        bookmarks: { ...state.bookmarks, [book]: chapter },
      })),
      volume: 0.28,
      setVolume: (volume) => set({ volume }),
      roomId: null,
      roomStatus: 'solo',
      roomMessage: '',
      diagnostics: emptyDiagnostics,
      setDiagnostics: (diagnostics) => set((state) => {
        const current = state.diagnostics
        return current.relays === diagnostics.relays && current.route === diagnostics.route
          && current.candidates === diagnostics.candidates && current.turnStatus === diagnostics.turnStatus
          ? state : { diagnostics }
      }),
      isHost: false,
      hostOnline: false,
      environment: defaultEnvironment,
      savedEnvironments: {},
      localNotes: [],
      roomNotes: {},
      chats: {},
      setAuthority: (isHost, hostOnline) => set((state) =>
        state.isHost === isHost && state.hostOnline === hostOnline ? state : { isHost, hostOnline }),
      applyEnvironment: (environment) => set((state) => {
        if (!state.roomId) return state
        const saved = state.savedEnvironments[state.roomId]
        if (saved && saved.weather === environment.weather && saved.hearth === environment.hearth
          && saved.sound === environment.sound) return state
        return { environment, savedEnvironments: rememberRoom(state.savedEnvironments, state.roomId, environment) }
      }),
      saveLocalNote: (note) => set((state) => ({ localNotes: [...state.localNotes, note] })),
      mergeRoomNotes: (room, notes) => set((state) => {
        const previous = state.roomNotes[room] ?? []
        const merged = mergeRecent(previous, notes, noteLimit)
        return merged === previous ? state : { roomNotes: rememberRoom(state.roomNotes, room, merged) }
      }),
      mergeChat: (room, messages) => set((state) => {
        const previous = state.chats[room] ?? []
        const merged = mergeRecent(previous, messages, chatLimit)
        return merged === previous ? state : { chats: rememberRoom(state.chats, room, merged) }
      }),
      peers: {},
      resetRoom: (roomId, roomStatus, roomMessage = '') => set((state) => ({
        roomId, roomStatus, roomMessage, peers: {},
        diagnostics: roomStatus === 'failed' ? state.diagnostics : emptyDiagnostics,
        isHost: false, hostOnline: false,
        environment: roomId ? state.savedEnvironments[roomId] ?? defaultEnvironment : defaultEnvironment,
      })),
      setRoomStatus: (roomStatus, roomMessage = '') => set((state) => (
        state.roomStatus === roomStatus && state.roomMessage === roomMessage
          ? state
          : { roomStatus, roomMessage }
      )),
      addPeer: (id) => set((state) => state.peers[id] ? state : {
        peers: { ...state.peers, [id]: { pose: null, profile: null } },
      }),
      updatePeer: (id, data) => set((state) => state.peers[id] ? {
        peers: { ...state.peers, [id]: { ...state.peers[id], ...data } },
      } : state),
      removePeer: (id) => set((state) => {
        const peers = { ...state.peers }
        delete peers[id]
        return { peers }
      }),
    }),
    {
      name: 'mountain-window-study-room-v1',
      partialize: ({ name, color, bookmarks, volume, localNotes, roomNotes, savedEnvironments, chats, focus }) =>
        ({ name, color, bookmarks, volume, localNotes, roomNotes, savedEnvironments, chats, focus }),
      // Pass only durable changes to storage. Pose updates run at render speed.
      storage: {
        getItem: (name) => {
          try {
            const value = localStorage.getItem(name)
            return value ? JSON.parse(value) : null
          } catch {
            return null
          }
        },
        setItem: (() => {
          let last: Preferences | undefined
          return (name, value) => {
            const { state } = value
            if (last && state.name === last.name && state.color === last.color && state.volume === last.volume
              && state.bookmarks === last.bookmarks && state.localNotes === last.localNotes
              && state.roomNotes === last.roomNotes && state.savedEnvironments === last.savedEnvironments
              && state.chats === last.chats && state.focus === last.focus) return
            try {
              localStorage.setItem(name, JSON.stringify(value))
              last = state
            } catch {
              // Private browsing may make storage unavailable.
            }
          }
        })(),
        removeItem: (name) => {
          try { localStorage.removeItem(name) } catch { /* Storage unavailable. */ }
        },
      },
    },
  ),
)
