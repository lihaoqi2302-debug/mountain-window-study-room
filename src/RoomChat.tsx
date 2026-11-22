import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { MessageCircle, Send } from 'lucide-react'
import { postRoomChat } from './online/roomCollaboration'
import { chatLength, randomId } from './studyContent'
import type { RoomMessage } from './studyContent'
import { useStudyRoomStore } from './store/useStudyRoomStore'

const empty: RoomMessage[] = []
const time = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' })

export default function RoomChat() {
  const roomId = useStudyRoomStore((state) => state.roomId)
  const status = useStudyRoomStore((state) => state.roomStatus)
  const messages = useStudyRoomStore((state) => roomId ? state.chats[roomId] ?? empty : empty)
  const [draft, setDraft] = useState('')
  const [failed, setFailed] = useState(false)
  const list = useRef<HTMLDivElement>(null)
  const followLatest = useRef(true)
  const canSend = status === 'connected' || status === 'waiting'

  useEffect(() => {
    setDraft('')
    setFailed(false)
    followLatest.current = true
  }, [roomId])
  useEffect(() => {
    const current = list.current
    if (current && followLatest.current) current.scrollTop = current.scrollHeight
  }, [messages])

  function send(event: FormEvent) {
    event.preventDefault()
    const body = draft.trim()
    if (!body || !canSend) return
    const message = { id: randomId(), author: useStudyRoomStore.getState().name, body, createdAt: Date.now() }
    if (!postRoomChat(message)) {
      setFailed(true)
      return
    }
    followLatest.current = true
    setFailed(false)
    setDraft('')
  }

  if (!roomId) return null
  return (
    <section className="room-chat" aria-labelledby="room-chat-heading">
      <h3 id="room-chat-heading"><MessageCircle size={15} aria-hidden /> 房间聊天</h3>
      <div className="chat-log" role="log" aria-label="房间聊天记录" ref={list} onScroll={(event) => {
        const target = event.currentTarget
        if (target.clientHeight) followLatest.current = target.scrollHeight - target.scrollTop - target.clientHeight < 30
      }}>
        {messages.length ? messages.map((message) => (
          <article key={message.id}>
            <header><b>{message.author}</b><time dateTime={new Date(message.createdAt).toISOString()}>{time.format(message.createdAt)}</time></header>
            <p>{message.body}</p>
          </article>
        )) : <p className="chat-empty">留一句问候，或安静坐一会儿。</p>}
      </div>
      {canSend ? (
        <form onSubmit={send}>
          <label className="visually-hidden" htmlFor="chat-draft">聊天消息</label>
          <textarea id="chat-draft" value={draft} rows={2} maxLength={chatLength} placeholder="写给房间里的朋友"
            onChange={(event) => { setDraft(event.target.value); setFailed(false) }} />
          <button className="button" type="submit" disabled={!draft.trim()}><Send size={14} aria-hidden /> 发送</button>
        </form>
      ) : <p className="field-message">{status === 'failed' ? '当前离线，可以查看本机的消息记录。' : '连接成功后可以发送消息。'}</p>}
      {failed && <p className="field-message" role="status">消息还没发出，恢复连接后可重试。</p>}
    </section>
  )
}
