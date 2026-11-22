import { useState } from 'react'
import type { FormEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useRoomAudio } from './RoomAudio'
import { postRoomNote, setRoomEnvironment } from './online/roomCollaboration'
import { chapterLabel, noteLength, randomId, soundLabels, weatherLabels } from './studyContent'
import type { Note, RoomEnvironment } from './studyContent'
import { useStudyRoomStore } from './store/useStudyRoomStore'

const store = useStudyRoomStore
const emptyNotes: Note[] = []

export function RoomEnvironmentControls() {
  const { environment, roomId, isHost, hostOnline, volume, status } = store(useShallow((state) => ({
    environment: state.environment, roomId: state.roomId, isHost: state.isHost, hostOnline: state.hostOnline,
    volume: state.volume, status: state.roomStatus,
  })))
  const { listening, pending, message, listen } = useRoomAudio()
  const [feedback, setFeedback] = useState('')

  async function change(patch: Partial<RoomEnvironment>) {
    if (!await setRoomEnvironment({ ...store.getState().environment, ...patch })) {
      setFeedback('当前无法同步环境，请稍后再试。')
    } else {
      setFeedback('')
    }
  }

  if (!roomId?.includes('~') || status === 'failed' || status === 'connecting') return null
  return (
    <div className="environment-controls">
      <h3>房间环境</h3>
      {isHost ? (
        <div className="environment-fields">
          <label htmlFor="room-weather">窗外</label>
          <select id="room-weather" value={environment.weather} onChange={(event) => {
            void change({ weather: event.target.value as RoomEnvironment['weather'] })
          }}>
            {Object.entries(weatherLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <label htmlFor="room-hearth">壁炉</label>
          <select id="room-hearth" value={environment.hearth ? 'on' : 'off'} onChange={(event) => void change({ hearth: event.target.value === 'on' })}>
            <option value="on">点燃</option><option value="off">熄灭</option>
          </select>
          <label htmlFor="room-sound">共学环境音</label>
          <select id="room-sound" value={environment.sound} onChange={(event) => {
            void change({ sound: event.target.value as RoomEnvironment['sound'] })
          }}>
            {Object.entries(soundLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
      ) : (
        <p className="field-message" role="status">房主{hostOnline ? '在线' : '离线'} · {weatherLabels[environment.weather]} · {environment.hearth ? '炉火点燃' : '炉火熄灭'} · {soundLabels[environment.sound]}</p>
      )}
      <button className="button" type="button" aria-pressed={listening} disabled={pending}
        onClick={() => void listen()}>{listening ? '关闭共学环境音' : '允许播放共学环境音'}</button>
      {listening && <input aria-label="共学环境音量" type="range" min="0" max="1" step=".01" value={volume}
        onChange={(event) => store.getState().setVolume(Number(event.target.value))} />}
      {(feedback || message) && <p role="status" className="field-message">{feedback || message}</p>}
    </div>
  )
}

export function ChapterNotes({ book, chapter }: { book: string; chapter: string }) {
  const [body, setBody] = useState('')
  const [message, setMessage] = useState('')
  const { roomId, canShare, local, shared } = store(useShallow((state) => ({
    roomId: state.roomId,
    canShare: Boolean(state.roomId && ['waiting','connected'].includes(state.roomStatus)),
    local: state.localNotes,
    shared: state.roomId ? state.roomNotes[state.roomId] ?? emptyNotes : emptyNotes,
  })))
  const inChapter = (note: Note) => note.book === book && note.chapter === chapter
  const sharedHere = shared.filter(inChapter)
  const localHere = local.filter((note) => inChapter(note) && !sharedHere.some((entry) => entry.id === note.id))

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = body.trim()
    if (!value) return
    store.getState().saveLocalNote({ id:randomId(),book,chapter,author:store.getState().name,body:value,createdAt:Date.now() })
    setBody('')
    setMessage('已保存到本机。')
  }

  function share(note: Note) {
    setMessage(postRoomNote(note) ? '已分享至房间。' : '当前无法发送，便签已保存在本机。')
  }

  return (
    <section className="chapter-notes" aria-label="章节便签">
      <h3>章节便签</h3>
      <p className="note-context">{chapterLabel(book, chapter)} · {roomId ? '本机与当前房间' : '保存在本机'}</p>
      {sharedHere.length > 0 && <ul aria-label="房间便签">
        {sharedHere.map((note) => <li key={note.id}><b>{note.author}</b><p>{note.body}</p></li>)}
      </ul>}
      {localHere.length > 0 && <ul aria-label="本机便签">
        {localHere.map((note) => <li key={note.id}>
          <b>本机便签</b><p>{note.body}</p>
          {canShare && <button type="button" onClick={() => share(note)}>分享到房间</button>}
        </li>)}
      </ul>}
      <form onSubmit={save}>
        <label htmlFor="note-body">写一张便签</label>
        <textarea id="note-body" rows={3} maxLength={noteLength} value={body}
          onChange={(event) => { setBody(event.target.value); setMessage('') }} />
        <button type="submit" disabled={!body.trim()}>保存本机</button>
      </form>
      {message && <p role="status" className="note-context">{message}</p>}
    </section>
  )
}
