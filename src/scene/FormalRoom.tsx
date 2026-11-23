import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { BookOpen, X } from 'lucide-react'
import { ChapterNotes } from '../RoomCollaboration'
import { chapterLabel } from '../studyContent'
import { validPose } from '../online/roomSession'
import { useStudyRoomStore } from '../store/useStudyRoomStore'

const protocol = 'mountain-window/scene-2'
const store = useStudyRoomStore

export type SceneOverlay = { covered: boolean; reading: boolean }

export default function FormalRoom({ controls, identity, reader, onSceneOverlay }: {
  controls: ReactNode; identity: ReactNode; reader: ReactNode; onSceneOverlay: (overlay: SceneOverlay) => void
}) {
  const frame = useRef<HTMLIFrameElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const notes = useRef<HTMLDialogElement>(null)
  const [chapter, setChapter] = useState<string | null>(null)
  const url = new URL('bookstore/', document.baseURI).href

  function send(type: string, details: Record<string, unknown> = {}) {
    frame.current?.contentWindow?.postMessage({ protocol, type, ...details }, location.origin)
  }

  useEffect(() => {
    function sendPeers() {
      const peers = Object.entries(store.getState().peers).map(([id, peer]) => ({ id, ...peer }))
      send('peers', { peers })
    }
    function sendEnvironment() {
      const { roomId, environment, roomStatus } = store.getState()
      const inRoom = roomId?.includes('~') && roomStatus !== 'connecting'
      send('environment', { value: inRoom ? environment : null })
    }
    function receive(event: MessageEvent) {
      if (event.source !== frame.current?.contentWindow || event.origin !== location.origin
        || event.data?.protocol !== protocol) return
      const { type, pose, id } = event.data
      if (type === 'ready') { sendPeers(); sendEnvironment() }
      if (type === 'scene-panel' && typeof event.data.covered === 'boolean') {
        onSceneOverlay({ covered: event.data.covered, reading: event.data.reading === true })
      }
      if (type === 'panel' && !dialog.current?.open) dialog.current?.showModal()
      if (type === 'pose' && validPose(pose)) store.getState().setPose(pose)
      if (type === 'reading' && (id === 'earth-online' || id === null)) store.getState().setSceneBook(id)
      if (type === 'read-guide') store.getState().setOpenBook('undergrad-guide')
      if (type === 'notes' && typeof event.data.chapter === 'string' && chapterLabel('earth-online', event.data.chapter)) {
        setChapter(event.data.chapter)
        if (!notes.current?.open) notes.current?.showModal()
      }
    }
    window.addEventListener('message', receive)
    send('ready-check')
    const unsubscribe = store.subscribe((next, previous) => {
      if (next.peers !== previous.peers) sendPeers()
      if (next.environment !== previous.environment || next.roomId !== previous.roomId
        || next.roomStatus !== previous.roomStatus) sendEnvironment()
    })
    return () => {
      window.removeEventListener('message', receive)
      unsubscribe()
    }
  }, [onSceneOverlay])

  const openBook = (id: string) => {
    dialog.current?.close()
    send('open-book', { id })
  }

  return (
    <main className="formal-shell">
      <iframe ref={frame} src={url} title="山窗书屋正式场景" allow="fullscreen" allowFullScreen
        onLoad={() => send('ready-check')} />
      <dialog className="formal-controls" ref={dialog} aria-labelledby="companion-heading">
        <header>
          <h1 id="companion-heading">山窗共学</h1>
          <form method="dialog"><button type="submit" aria-label="关闭共学面板" autoFocus><X size={20} aria-hidden /></button></form>
        </header>
        {controls}
        {identity}
        <section className="panel book-controls" aria-label="桌上的书">
          <h2>桌上的书</h2>
          <button className="book-button" onClick={() => openBook('earth-online')}><BookOpen size={16} aria-hidden /> 地球 Online</button>
          <button className="book-button" onClick={() => openBook('undergrad-guide')}><BookOpen size={16} aria-hidden /> 本科生速通指南</button>
        </section>
      </dialog>
      <dialog className="reader formal-notes" ref={notes} aria-label="《地球 Online》章节便签"
        onClose={() => setChapter(null)}>
        <div className="reader-head">
          <p>地球 Online</p>
          <form method="dialog"><button type="submit" aria-label="关闭章节便签" autoFocus><X size={20} aria-hidden /></button></form>
        </div>
        {chapter && <ChapterNotes key={chapter} book="earth-online" chapter={chapter} />}
      </dialog>
      {reader}
    </main>
  )
}
