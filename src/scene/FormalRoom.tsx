import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { BookOpen, Users, X } from 'lucide-react'
import { ChapterNotes } from '../RoomCollaboration'
import { chapterLabel } from '../studyContent'
import { validPose } from '../online/roomSession'
import { useStudyRoomStore } from '../store/useStudyRoomStore'

const protocol = 'mountain-window/scene-2'
const store = useStudyRoomStore

export type SceneOverlay = { covered: boolean; reading: boolean }

type ReturnFocus = { element: HTMLElement | null; document?: Document }

function isAvailable(element: HTMLElement | null): element is HTMLElement {
  return !!element?.isConnected && !element.closest('[hidden], [inert]')
    && !element.matches(':disabled') && element.getClientRects().length > 0
    && element.ownerDocument.defaultView?.getComputedStyle(element).visibility === 'visible'
}

function focusWithoutScroll(element: HTMLElement | null) {
  if (!isAvailable(element)) return false
  element.focus({ preventScroll: true })
  return element.ownerDocument.activeElement === element
}

function handleDialogKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
  // Keep focus in the parent document until Escape is released. A held key must
  // not close the dialog and then repeat in the scene (where Escape exits reading).
  if (event.key === 'Escape') {
    event.preventDefault()
    return
  }
  if (event.key !== 'Tab' || event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return
  const panel = event.currentTarget
  const stops = Array.from(panel.querySelectorAll<HTMLElement>('button, input, select, textarea, summary, a[href], [tabindex]'))
    .filter((element) => {
      const collapsed = element.closest('details:not([open])')
      return element.tabIndex >= 0 && isAvailable(element)
        && (!collapsed || collapsed.querySelector(':scope > summary')?.contains(element))
    })
  const first = stops[0]
  const last = stops.at(-1)
  const active = panel.ownerDocument.activeElement
  const boundary = event.shiftKey ? first : last
  const wrapTo = event.shiftKey ? last : first
  if (!wrapTo || (active && stops.some((stop) => stop === active) && active !== boundary)) return
  event.preventDefault()
  wrapTo.focus()
}

function handleDialogKeyUp(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.currentTarget.close()
  }
}

export default function FormalRoom({ controls, identity, reader, onSceneOverlay, inviteEntry }: {
  controls: ReactNode; identity: ReactNode; reader: ReactNode; onSceneOverlay: (overlay: SceneOverlay) => void
  inviteEntry?: { label: string; detail: string }
}) {
  const frame = useRef<HTMLIFrameElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const notes = useRef<HTMLDialogElement>(null)
  const panelReturn = useRef<ReturnFocus | null>(null)
  const [chapter, setChapter] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [sceneOverlay, setSceneOverlay] = useState<SceneOverlay>({ covered: false, reading: false })
  const url = new URL('bookstore/', document.baseURI).href

  function send(type: string, details: Record<string, unknown> = {}) {
    frame.current?.contentWindow?.postMessage({ protocol, type, ...details }, location.origin)
  }

  function sceneReturn(selector: string): ReturnFocus | null {
    const child = frame.current?.contentDocument
    if (!child) return null
    // On narrow screens the iframe collapses its tools menu on click before
    // postMessage reaches us, so the visible return point is the menu button.
    const active = child.activeElement?.closest<HTMLElement>(`${selector}, #roomMenu`) ?? null
    return { element: active ?? child.querySelector<HTMLElement>(selector), document: child }
  }

  function restoreFocus(target: ReturnFocus | null) {
    if (!target || document.querySelector('dialog:modal')) return
    if (target.document && target.document !== frame.current?.contentDocument) return
    if (focusWithoutScroll(target.element)) return
    const child = frame.current?.contentDocument
    const alternatives = child?.body.dataset.mode === 'reading'
      ? ['#btnCloseBook', '#btnToc'] : ['#roomMenu', '#btnStudyCompanions', '#btnRead']
    for (const selector of alternatives) {
      if (focusWithoutScroll(child?.querySelector<HTMLElement>(selector) ?? null)) return
    }
    focusWithoutScroll(frame.current)
  }

  function openPanel(target: ReturnFocus | null) {
    const panel = dialog.current
    if (!panel || panel.open || notes.current?.open || panel.ownerDocument.querySelector('dialog:modal')) return
    panelReturn.current = target
    panel.showModal()
    panel.scrollTop = 0
    setPanelOpen(true)
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
        const overlay = { covered: event.data.covered, reading: event.data.reading === true }
        setSceneOverlay(overlay)
        onSceneOverlay(overlay)
      }
      if (type === 'panel') openPanel(sceneReturn('#btnStudyCompanions'))
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
    // A newly opened book owns its focus; do not compete with its entry handling.
    panelReturn.current = null
    dialog.current?.close()
    send('open-book', { id })
  }

  return (
    <main className="formal-shell">
      {inviteEntry && <section className="formal-invite-entry" aria-label="共学邀请">
        <div role="status">{!panelOpen && <><strong>{inviteEntry.label}</strong><p>{inviteEntry.detail}</p></>}</div>
        <button type="button" aria-haspopup="dialog" aria-controls="companion-panel"
          onClick={(event) => openPanel({ element: event.currentTarget })}>查看邀请</button>
      </section>}
      {sceneOverlay.reading && !sceneOverlay.covered && <button type="button" className="formal-reading-entry"
        aria-label="共学房间" aria-haspopup="dialog" aria-controls="companion-panel"
        onClick={(event) => openPanel({ element: event.currentTarget })}>
        <Users size={16} aria-hidden /> 共学
      </button>}
      <iframe ref={frame} src={url} title="山窗书屋正式场景" allow="fullscreen" allowFullScreen
        onLoad={() => send('ready-check')} />
      <dialog className="formal-controls" ref={dialog} id="companion-panel" aria-labelledby="companion-heading"
        onKeyDown={handleDialogKeyDown} onKeyUp={handleDialogKeyUp} onClose={() => {
          if (dialog.current?.open) return
          setPanelOpen(false)
          const target = panelReturn.current
          panelReturn.current = null
          restoreFocus(target)
        }}>
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
