import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BookOpen, CloudRain, DoorOpen, Flame, Link2, Mountain, Users, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { startAmbientSound } from './audio/ambience'
import type { AmbientSound } from './audio/ambience'
import books from './data/books.json'
import { createRoom, joinStudyRoom, leaveRoom, parseRoomCode } from './online/roomSession'
import { exportDiagnostics } from './online/diagnostics'
import { clearMovement, keyDirections, press, release } from './scene/movement'
import FormalRoom from './scene/FormalRoom'
import { ChapterNotes, RoomEnvironmentControls } from './RoomCollaboration'
import RoomChat from './RoomChat'
import OfflineControls from './offline/OfflineControls'
import { FocusClock, FocusMembers } from './FocusClock'
import { RoomAudioHint, RoomAudioProvider } from './RoomAudio'
import { refinedScene } from './edition'
import { activities, avatarColors, useStudyRoomStore } from './store/useStudyRoomStore'

const StudyScene = lazy(() => import('./scene/StudyScene'))
const store = useStudyRoomStore
// main follows the invite after loading this module and clears invalid codes from the URL.
const openedFromInvite = new URL(window.location.href).searchParams.has('room')
const statusLabels = {
  solo: '本地独处',
  connecting: '正在连接信令',
  waiting: '等待好友加入',
  negotiating: '正在建立点对点连接',
  connected: '已连入',
  failed: '连接失败',
}

function roomFeedback(status: keyof typeof statusLabels, message: string, count: number) {
  const details = {
    solo: '可以直接单机阅读，也可以创建房间或接受好友邀请。',
    connecting: '正在尝试连接，书屋仍可使用。',
    waiting: '好友在线并加入同一房间后即可共学，也可以先读书。',
    negotiating: '正在与好友建立连接，书屋仍可使用。',
    connected: `房间里有 ${count + 1} 人`,
    failed: '当前未能连接房间，可以重试或继续单机阅读。',
  }
  return { label: statusLabels[status], detail: message || details[status] }
}
const routes = { unknown: '检测中', direct: '直连', relay: '中继', mixed: '直连及中继' }
const turnLabels = { 'not-configured': '未配置，使用 STUN', unavailable: '暂未取得中继凭据，使用 STUN', configured: '已获取中继凭据' }

function useMovementControls() {
  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      const direction = keyDirections[event.code]
      if (!direction || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return
      if ((event.target as HTMLElement).closest('input, select, textarea, dialog, [contenteditable]')) return
      event.preventDefault()
      press(event.code, direction)
    }
    const keyUp = (event: KeyboardEvent) => { release(event.code) }
    document.addEventListener('keydown', keyDown)
    document.addEventListener('keyup', keyUp)
    document.addEventListener('visibilitychange', clearMovement)
    window.addEventListener('blur', clearMovement)
    return () => {
      clearMovement()
      document.removeEventListener('keydown', keyDown)
      document.removeEventListener('keyup', keyUp)
      document.removeEventListener('visibilitychange', clearMovement)
      window.removeEventListener('blur', clearMovement)
    }
  }, [])
}

function TouchControls() {
  const buttons = [
    { direction: 'up', label: '向前移动', Icon: ArrowUp },
    { direction: 'left', label: '向左移动', Icon: ArrowLeft },
    { direction: 'down', label: '向后移动', Icon: ArrowDown },
    { direction: 'right', label: '向右移动', Icon: ArrowRight },
  ]
  return (
    <div className="touch-controls" aria-label="移动角色">
      {buttons.map(({ direction, label, Icon }) => (
        <button key={direction} className={`move-${direction}`} type="button" aria-label={label}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.currentTarget.setPointerCapture(event.pointerId)
            press(`pointer-${event.pointerId}`, direction)
          }}
          onLostPointerCapture={(event) => release(`pointer-${event.pointerId}`)}
          onKeyDown={(event) => {
            if (event.code === 'Space' || event.code === 'Enter') {
              event.preventDefault()
              press(`control-${event.code}`, direction)
            }
          }}
          onKeyUp={(event) => release(`control-${event.code}`)}
          onBlur={() => { release('control-Space'); release('control-Enter') }}>
          <Icon size={18} aria-hidden />
        </button>
      ))}
    </div>
  )
}

function RoomControls() {
  const { roomId, roomStatus, roomMessage, count, diagnostics } = store(useShallow((state) => ({
    roomId: state.roomId,
    roomStatus: state.roomStatus,
    roomMessage: state.roomMessage,
    count: Object.keys(state.peers).length,
    diagnostics: state.diagnostics,
  })))
  const [copyResult, setCopyResult] = useState<{ link?: string; select?: boolean } | null>(null)
  const [diagMessage, setDiagMessage] = useState('')
  const [joinOpen, setJoinOpen] = useState(false)
  const [joinValue, setJoinValue] = useState('')
  const [joinError, setJoinError] = useState(false)
  const [lastAttempt, setLastAttempt] = useState<'create' | 'join' | null>(null)
  const inviteField = useRef<HTMLInputElement>(null)
  const joinField = useRef<HTMLInputElement>(null)
  const primaryButton = useRef<HTMLButtonElement>(null)
  const joinButton = useRef<HTMLButtonElement>(null)
  const exitButton = useRef<HTMLButtonElement>(null)
  const nextFocus = useRef<'primary' | 'join' | 'exit' | null>(null)
  const copyAttempt = useRef(0)
  const diagAttempt = useRef(0)
  const canCopy = Boolean(roomId) && (roomStatus === 'waiting' || roomStatus === 'connected' || roomStatus === 'negotiating')
  const pending = roomStatus === 'connecting' || roomStatus === 'negotiating' || roomStatus === 'waiting'
  const showJoin = !roomId && !pending
  const { label, detail } = roomFeedback(roomStatus, roomMessage, count)

  useLayoutEffect(() => store.subscribe((state, previous) => {
    if (state.roomId !== previous.roomId || (state.roomStatus !== previous.roomStatus &&
      ['solo', 'connecting', 'failed'].includes(state.roomStatus))) {
      // Invalidate pending clipboard operations, even if the user quickly rejoins the same room.
      copyAttempt.current += 1
      diagAttempt.current += 1
      setCopyResult(null)
      setDiagMessage('')
      if (inviteField.current && document.activeElement === inviteField.current) {
        nextFocus.current = state.roomStatus === 'connecting' ? 'exit' : 'primary'
      }
      if (primaryButton.current && document.activeElement === primaryButton.current && state.roomStatus === 'connecting') {
        nextFocus.current = 'exit'
      }
    }
  }), [])

  useLayoutEffect(() => {
    if (!copyResult?.link || !copyResult.select || !canCopy) return
    inviteField.current?.focus()
    inviteField.current?.select()
  }, [canCopy, copyResult])

  useLayoutEffect(() => {
    if (nextFocus.current === 'primary') primaryButton.current?.focus()
    if (nextFocus.current === 'join') joinButton.current?.focus()
    if (nextFocus.current === 'exit') exitButton.current?.focus()
    nextFocus.current = null
  })

  function setJoinForm(open: boolean) {
    if (!open) {
      setJoinValue('')
      setJoinError(false)
      nextFocus.current = 'join'
    }
    setJoinOpen(open)
  }

  useLayoutEffect(() => {
    if (joinOpen && showJoin) joinField.current?.focus()
  }, [joinOpen, showJoin])

  function beginCreating() {
    setJoinForm(false)
    setLastAttempt('create')
    nextFocus.current = 'exit'
    createRoom()
  }

  function returnToSolo() {
    setJoinForm(false)
    setLastAttempt(null)
    nextFocus.current = 'primary'
    leaveRoom()
  }

  async function copyInvite(button: HTMLButtonElement) {
    if (!roomId || !canCopy) return
    const attempt = ++copyAttempt.current
    const url = new URL(window.location.href)
    url.search = ''
    url.hash = ''
    url.searchParams.set('room', roomId)
    const link = url.href
    try {
      await navigator.clipboard.writeText(link)
      if (copyAttempt.current === attempt) {
        if (document.activeElement === inviteField.current) button.focus()
        setCopyResult({})
      }
    } catch {
      if (copyAttempt.current === attempt) {
        // An asynchronous denial should not steal focus after another action or a panel close.
        setCopyResult({ link, select: document.activeElement === button })
      }
    }
  }

  async function copyDiagnostics() {
    const attempt = ++diagAttempt.current
    try {
      const report: { room?: string } = JSON.parse(exportDiagnostics())
      delete report.room
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2))
      if (diagAttempt.current === attempt) setDiagMessage('诊断信息已复制（已脱敏）')
    } catch {
      if (diagAttempt.current === attempt) setDiagMessage('剪贴板不可用，请稍后重试')
    }
  }

  function beginJoining(id: string) {
    setJoinForm(false)
    setLastAttempt('join')
    nextFocus.current = 'exit'
    void joinStudyRoom(id)
  }

  function joinFromInput(event: FormEvent) {
    event.preventDefault()
    let rawCode = joinValue.trim()
    try {
      const url = new URL(rawCode)
      rawCode = ['https:', 'http:'].includes(url.protocol) ? url.searchParams.get('room') ?? '' : ''
    } catch { /* Also accept a room code. */ }
    const id = parseRoomCode(rawCode)
    if (!id) {
      setJoinError(true)
      joinField.current?.focus()
      return
    }
    beginJoining(id)
  }

  return (
    <section className="room-controls panel" aria-labelledby="room-heading">
      <div className="room-feedback">
        <h2 id="room-heading"><Users size={17} aria-hidden /> 房间</h2>
        <div role="status">
          <span className="room-state" data-state={roomStatus}><i aria-hidden />{label}</span>
          <p className="room-description">{detail}</p>
        </div>
      </div>
      {roomStatus === 'connected' && <p className="field-message">连接方式 · {routes[diagnostics.route]}</p>}
      <div className="room-actions">
        {(showJoin || canCopy || roomStatus === 'failed') && <button className="button primary" ref={primaryButton}
          onClick={canCopy ? (event) => void copyInvite(event.currentTarget)
            : roomStatus === 'failed' && roomId ? () => beginJoining(roomId) : beginCreating}>
          {roomStatus === 'failed' && roomId ? '重试连接' : <>
            <Link2 size={17} aria-hidden /> {canCopy ? '复制邀请链接' : roomStatus === 'failed' && lastAttempt === 'create' ? '重试创建房间' : '创建房间'}
          </>}
        </button>}
        {showJoin && <button className="button subtle" ref={joinButton} aria-expanded={joinOpen}
          aria-controls={joinOpen ? 'room-join-form' : undefined} onClick={() => setJoinForm(!joinOpen)}>
          <DoorOpen size={17} aria-hidden /> {roomStatus === 'failed' ? '输入邀请' : '加入房间'}
        </button>}
        {roomStatus !== 'solo' && <button className="button subtle" ref={exitButton} onClick={returnToSolo}>
          <DoorOpen size={17} aria-hidden /> {pending ? '取消连接，返回单机' : '返回单机'}
        </button>}
      </div>
      {joinOpen && showJoin && (
        <form id="room-join-form" className="join-form" onSubmit={joinFromInput}>
          <label htmlFor="invite-input">邀请链接或房间码</label>
          <input id="invite-input" ref={joinField} value={joinValue} onChange={(event) => {
            setJoinValue(event.target.value)
            setJoinError(false)
          }} autoComplete="off" spellCheck={false} aria-invalid={joinError || undefined}
          aria-describedby={joinError ? 'invite-input-error' : undefined} />
          <p id="invite-input-error" className="field-message" role="alert">{joinError ? '请输入完整的邀请链接或房间码。' : ''}</p>
          <button className="button" type="submit">进入房间</button>
          <button className="button subtle" type="button" onClick={() => setJoinForm(false)}>取消</button>
        </form>
      )}
      {canCopy && <div className="invite-fallback">
        <div role="status">{copyResult && <p className="field-message">{copyResult.link
          ? '剪贴板不可用，请复制下方完整链接。' : '邀请链接已复制'}</p>}</div>
        {copyResult?.link && <input ref={inviteField} aria-label="邀请链接" readOnly value={copyResult.link}
          onFocus={(event) => event.currentTarget.select()} />}
      </div>}
      {roomStatus !== 'solo' && <details className="network-diagnostics">
        <summary>网络诊断</summary>
        <dl>
          <div><dt>可用信令</dt><dd>{diagnostics.relays} 个公共节点</dd></div>
          <div><dt>ICE 候选</dt><dd>{diagnostics.candidates || '尚未收集'}</dd></div>
          <div><dt>TURN</dt><dd>{turnLabels[diagnostics.turnStatus]}</dd></div>
          <div><dt>候选计数</dt><dd>主机 {diagnostics.counts.host} · 反射 {diagnostics.counts.srflx + diagnostics.counts.prflx} · 中继 {diagnostics.counts.relay}</dd></div>
          <div><dt>地址族</dt><dd>IPv4 {diagnostics.families.v4} · IPv6 {diagnostics.families.v6} · mDNS {diagnostics.families.mdns}</dd></div>
          <div><dt>选中链路</dt><dd>{roomStatus === 'connected' ? routes[diagnostics.route] : '尚未连通'}{roomStatus === 'connected' && diagnostics.localType
            ? `（${diagnostics.localType}/${diagnostics.remoteType || '?'} · ${diagnostics.protocol || '?'}${diagnostics.relayProtocol ? ` · 中继 ${diagnostics.relayProtocol}` : ''}）` : ''}</dd></div>
        </dl>
        <button className="button subtle" onClick={() => void copyDiagnostics()}>复制诊断</button>
        {diagMessage && <p className="field-message" role="status">{diagMessage}</p>}
      </details>}
      <RoomEnvironmentControls />
      <FocusMembers />
      <RoomChat />
      <OfflineControls />
    </section>
  )
}

function IdentityControls() {
  const { name, color, activity, setIdentity, setActivity } = store(useShallow((state) => ({
    name: state.name, color: state.color, activity: state.activity,
    setIdentity: state.setIdentity, setActivity: state.setActivity,
  })))
  const [nameDraft, setNameDraft] = useState(name)

  function saveName() {
    setIdentity({ name: nameDraft, color })
    setNameDraft(store.getState().name)
  }

  return (
    <section className="identity-controls panel" aria-labelledby="identity-heading">
      <h2 id="identity-heading">我的角色</h2>
      <div className="identity-fields">
        <label htmlFor="reader-name">昵称</label>
        <input id="reader-name" maxLength={16} value={nameDraft} onChange={(event) => setNameDraft(event.target.value)}
          onBlur={saveName} onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.currentTarget.blur()
          }} />
        <label htmlFor="activity">状态</label>
        <select id="activity" value={activity} onChange={(event) => setActivity(event.target.value)}>
          {activities.map((item) => <option key={item}>{item}</option>)}
        </select>
      </div>
      <div className="swatches" aria-label="角色颜色">
        {avatarColors.map((value, index) => (
          <button key={value} type="button" aria-label={['陶土', '苔绿', '烟蓝', '灰紫', '旧金'][index]} aria-pressed={color === value}
            onClick={() => setIdentity({ name: nameDraft, color: value })}>
            <span style={{ backgroundColor: value }} />
          </button>
        ))}
      </div>
    </section>
  )
}

function openBook(id: string) {
  const book = books.find((item) => item.id === id)
  if (!book) return
  clearMovement()
  store.getState().setOpenBook(id)
}

function ReadingDialog() {
  const dialog = useRef<HTMLDialogElement>(null)
  const bookId = store((state) => state.openBook)
  const bookmark = store((state) => bookId ? state.bookmarks[bookId] : undefined)
  const book = books.find(({ id }) => id === bookId)
  const chapter = book?.chapters.find((item) => item.id === bookmark) ?? book?.chapters[0]
  const chapterId = chapter?.id

  useEffect(() => {
    const element = dialog.current
    if (bookId && element && !element.open) element.showModal()
  }, [bookId])

  useEffect(() => {
    if (bookId && chapterId) store.getState().markChapter(bookId, chapterId)
  }, [bookId, chapterId])

  if (!book || !chapter) return null
  return (
    <dialog ref={dialog} className="reader" aria-labelledby="reader-heading" onClose={() => store.getState().setOpenBook(null)}>
      <div className="reader-head">
        <p>书屋试读</p>
        <form method="dialog"><button type="submit" aria-label="合上书" autoFocus><X size={21} aria-hidden /></button></form>
      </div>
      <h2 id="reader-heading">{book.title}</h2>
      {book.chapters.length > 1 && (
        <select aria-label="章节选择" value={chapter.id} onChange={(event) => store.getState().markChapter(book.id, event.target.value)}>
          {book.chapters.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
      )}
      <h3>{chapter.title}</h3>
      {chapter.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
      <ChapterNotes key={`${book.id}/${chapter.id}`} book={book.id} chapter={chapter.id} />
    </dialog>
  )
}

function AmbientControl({ kind }: { kind: AmbientSound }) {
  const [enabled, setEnabled] = useState(false)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const sound = useRef<Awaited<ReturnType<typeof startAmbientSound>> | null>(null)
  const volume = store((state) => state.volume)
  const label = kind === 'rain' ? '雨声' : '炉火'
  const Icon = kind === 'rain' ? CloudRain : Flame

  async function toggle() {
    if (sound.current) {
      sound.current.stop()
      sound.current = null
      setEnabled(false)
      return
    }
    setPending(true)
    setFailed(false)
    try {
      sound.current = await startAmbientSound(kind, store.getState().volume)
      setEnabled(true)
    } catch {
      setFailed(true)
    } finally {
      setPending(false)
    }
  }

  useEffect(() => { sound.current?.setVolume(volume) }, [volume])
  useEffect(() => () => { sound.current?.stop() }, [])

  return (
    <div className="ambient-control">
      <button className="sound-button" aria-pressed={enabled} disabled={pending} onClick={() => void toggle()}>
        <Icon size={17} aria-hidden /> <span>{failed ? '重试'+label : label}</span>
      </button>
      {enabled && kind === 'rain' && <input type="range" min="0" max="1" step="0.01" aria-label="环境音量" value={volume}
        onChange={(event) => store.getState().setVolume(Number(event.target.value))} />}
    </div>
  )
}

function StudyRoom() {
  useMovementControls()

  return (
    <main className="shell mx-auto">
      <header className="site-heading">
        <Mountain size={26} strokeWidth={1.25} aria-hidden />
        <h1>山窗书屋</h1>
        <div className="ambient-controls"><AmbientControl kind="rain" /><AmbientControl kind="fire" /></div>
      </header>
      <div className="workspace grid min-w-0">
        <section className="stage" aria-label="书屋场景">
          <div className="scene">
            <Suspense fallback={<p className="scene-unavailable" role="status">正在点亮书屋…</p>}>
              <StudyScene openBook={openBook} />
            </Suspense>
          </div>
          <footer className="stage-footer">
            <div className="key-hint"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><span>移动</span></div>
            <TouchControls />
            <span className="scene-caption">暮色下的书屋</span>
          </footer>
        </section>
        <aside className="sidebar grid content-start">
          <RoomControls />
          <IdentityControls />
          <section className="panel book-controls" aria-labelledby="books-heading">
            <h2 id="books-heading">桌上的书</h2>
            {books.map((book) => (
              <button key={book.id} className="book-button" onClick={() => openBook(book.id)}>
                <BookOpen size={16} aria-hidden /> {book.title}
              </button>
            ))}
          </section>
        </aside>
      </div>
      <ReadingDialog />
    </main>
  )
}

export default function App() {
  const [sceneOverlay, setSceneOverlay] = useState({ covered: false, reading: false })
  const { status, message, peerCount } = store(useShallow((state) => ({
    status: state.roomStatus,
    message: state.roomMessage,
    peerCount: Object.keys(state.peers).length,
  })))
  // Once dismissed, later manual room activity should not revive the original invite banner.
  const [inviteEntryActive, setInviteEntryActive] = useState(openedFromInvite)
  useEffect(() => store.subscribe((state) => {
    if (state.roomStatus === 'solo') setInviteEntryActive(false)
  }), [])
  const inviteEntry = inviteEntryActive && status !== 'solo' ? roomFeedback(status, message, peerCount) : undefined
  return <RoomAudioProvider>
    {refinedScene
      ? <FormalRoom controls={<RoomControls />} identity={<IdentityControls />} reader={<ReadingDialog />}
          onSceneOverlay={setSceneOverlay} inviteEntry={inviteEntry} />
      : <StudyRoom />}
    <FocusClock covered={sceneOverlay.covered} />
    <RoomAudioHint suppressed={sceneOverlay.covered || sceneOverlay.reading} />
  </RoomAudioProvider>
}
