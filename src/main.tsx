import { createRoot } from 'react-dom/client'
import App from './App'
import { joinStudyRoom, leaveRoom, suspendRoom } from './online/roomSession'
import { useStudyRoomStore } from './store/useStudyRoomStore'
import { exportDiagnostics } from './online/diagnostics'
import type { Note } from './studyContent'
import './styles.css'

function followInvite() {
  const invite = new URL(location.href).searchParams.get('room')
  if (invite !== null) void joinStudyRoom(invite)
  return invite !== null
}

createRoot(document.getElementById('root')!).render(<App />)
followInvite()

// Only pages entering the back/forward cache are suspended; an unloading page releases everything anyway.
window.addEventListener('pagehide', (event) => {
  if (event.persisted) suspendRoom()
})
window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return
  if (!followInvite() && useStudyRoomStore.getState().roomStatus !== 'solo') leaveRoom()
})

if (import.meta.env.MODE === 'test') {
  Object.defineProperty(window, '__studyRoomTestChat', {
    configurable: true,
    value: async (bodies: string[]) => {
      const { postRoomChat } = await import('./online/roomCollaboration')
      const { randomId } = await import('./studyContent')
      const author = useStudyRoomStore.getState().name
      return bodies.map((body, i) => postRoomChat({ id: randomId(), author, body, createdAt: Date.now() + i })).every(Boolean)
    },
  })
  Object.defineProperty(window, '__studyRoomDiag', {
    configurable: true,
    value: {
      get state() {
        const { roomStatus, roomMessage, diagnostics, peers, roomId, isHost, chats, roomNotes } = useStudyRoomStore.getState()
        const key = roomId ?? ''
        return {
          roomStatus, roomMessage, diagnostics, peers: Object.keys(peers).length, roomId, isHost,
          chats: (chats[key] ?? []).map(({ id, body }) => ({ id, body })),
          notes: (roomNotes[key] ?? []).map(({ id, body }) => ({ id, body })),
        }
      },
      export: exportDiagnostics,
    },
  })
  Object.defineProperty(window, '__studyRoomTestNotes', {
    configurable: true,
    value: async (notes: Note[]) => {
      const { postRoomNote } = await import('./online/roomCollaboration')
      return notes.map(postRoomNote).every(Boolean)
    },
  })
}
