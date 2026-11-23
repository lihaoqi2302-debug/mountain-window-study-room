import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BookOpen, CloudRain, DoorOpen, Flame, Link2, Mountain, Users, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { startAmbientSound } from './audio/ambience'
import type { AmbientSound } from './audio/ambience'
import books from './data/books.json'
import { createRoom, joinStudyRoom, leaveRoom, parseRoomCode } from './online/roomSession'
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
const statusLabels = {
  solo: '本地独处',
  connecting: '正在连接信令',
  waiting: '正在寻找房间好友',
  negotiating: '正在建立点对点连接',
  connected: '已连入',
  failed: '连接超时或受限',
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
  const [copyMessage, setCopyMessage] = useState('')
  const [showLink, setShowLink] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)
  const [joinValue, setJoinValue] = useState('')
  const [joinError, setJoinError] = useState('')
  const inviteField = useRef<HTMLInputElement>(null)
  const joinField = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setCopyMessage('')
    setShowLink(false)
  }, [roomId])

  useEffect(() => {
    if (showLink) inviteField.current?.select()
  }, [showLink])

  useEffect(() => {
    if (joinOpen) joinField.current?.focus()
  }, [joinOpen])

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopyMessage('邀请链接已复制')
    } catch {
      setCopyMessage('请选择下方链接并复制')
      setShowLink(true)
    }
  }

  function joinFromInput(event: FormEvent) {
    event.preventDefault()
    let id = joinValue.trim()
    try { id = new URL(id).searchParams.get('room') ?? '' } catch { /* Also accept a room code. */ }
    if (!parseRoomCode(id)) {
      setJoinError('请输入完整的邀请链接或房间码。')
      return
    }
    setJoinOpen(false)
    setJoinValue('')
    setJoinError('')
    void joinStudyRoom(id)
  }

  return (
    <section className="room-controls panel" aria-labelledby="room-heading">
      <div className="section-head">
        <h2 id="room-heading"><Users size={17} aria-hidden /> 房间</h2>
        <span className="room-state" data-state={roomStatus} role="status"><i aria-hidden />{statusLabels[roomStatus]}</span>
      </div>
      <p className="room-description">
        {roomMessage || (roomStatus === 'connected'
          ? `房间里有 ${count + 1} 人`
          : roomStatus === 'waiting' ? '当前没有其他在线成员，等好友加入后即可同步。'
            : roomStatus === 'connecting' ? '正在尝试连接，书屋仍可使用。'
              : '一个人待一会儿，或请好友进来。')}
      </p>
      {roomStatus === 'connected' && <p className="field-message">连接方式 · {routes[diagnostics.route]}</p>}
      {roomStatus !== 'solo' && <details className="network-diagnostics">
        <summary>网络诊断</summary>
        <dl>
          <div><dt>可用信令</dt><dd>{diagnostics.relays} 个公共节点</dd></div>
          <div><dt>ICE 候选</dt><dd>{diagnostics.candidates || '尚未收集'}</dd></div>
          <div><dt>TURN</dt><dd>{turnLabels[diagnostics.turnStatus]}</dd></div>
          <div><dt>选中链路</dt><dd>{roomStatus === 'connected' ? routes[diagnostics.route] : '尚未连通'}</dd></div>
        </dl>
      </details>}
      {roomId ? (
        <>
          {roomStatus === 'failed'
            ? <button className="button primary" onClick={() => void joinStudyRoom(roomId)}>重试连接</button>
            : <button className="button primary" onClick={() => void copyInvite()}><Link2 size={17} aria-hidden /> 复制邀请链接</button>}
          <button className="button subtle" onClick={leaveRoom}><DoorOpen size={17} aria-hidden /> 返回单机</button>
        </>
      ) : (
        <>
          <button className="button primary" onClick={createRoom} disabled={roomStatus === 'connecting'}><Link2 size={17} aria-hidden /> 创建房间</button>
          <button className="button subtle" aria-expanded={joinOpen} onClick={() => setJoinOpen(!joinOpen)}>
            <DoorOpen size={17} aria-hidden /> 加入房间
          </button>
          {roomStatus === 'failed' && <><button className="button" onClick={createRoom}>重试连接</button>
            <button className="button subtle" onClick={leaveRoom}>返回单机</button></>}
        </>
      )}
      {joinOpen && !roomId && (
        <form className="join-form" onSubmit={joinFromInput}>
          <label htmlFor="invite-input">邀请链接或房间码</label>
          <input id="invite-input" ref={joinField} value={joinValue} onChange={(event) => {
            setJoinValue(event.target.value)
            setJoinError('')
          }} autoComplete="off" />
          {joinError && <p className="field-message" role="alert">{joinError}</p>}
          <button className="button" type="submit">进入房间</button>
        </form>
      )}
      {copyMessage && <p className="field-message" role="status">{copyMessage}</p>}
      {showLink && <input ref={inviteField} aria-label="邀请链接" readOnly value={window.location.href} />}
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
  return <RoomAudioProvider>
    {refinedScene
      ? <FormalRoom controls={<RoomControls />} identity={<IdentityControls />} reader={<ReadingDialog />} onSceneOverlay={setSceneOverlay} />
      : <StudyRoom />}
    <FocusClock covered={sceneOverlay.covered} />
    <RoomAudioHint suppressed={sceneOverlay.covered || sceneOverlay.reading} />
  </RoomAudioProvider>
}
