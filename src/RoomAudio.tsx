import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Volume2 } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { makeAmbientPlayer } from './audio/ambience'
import { soundLabels, weatherLabels } from './studyContent'
import { useStudyRoomStore as store } from './store/useStudyRoomStore'

function useListening() {
  const { roomId, sound, status, volume } = store(useShallow((state) => ({
    roomId: state.roomId, sound: state.environment.sound, status: state.roomStatus, volume: state.volume,
  })))
  const player = useRef<Awaited<ReturnType<typeof makeAmbientPlayer>> | null>(null)
  const [listening, setListening] = useState(false)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    player.current?.stop()
    player.current = null
    setListening(false)
    setMessage('')
    return () => { player.current?.stop(); player.current = null }
  }, [roomId, status === 'failed'])
  useEffect(() => { player.current?.setSound(sound) }, [sound])
  useEffect(() => { player.current?.setVolume(volume) }, [volume])

  async function listen() {
    if (pending) return
    if (player.current) {
      player.current.stop()
      player.current = null
      setListening(false)
      return
    }
    setPending(true)
    try {
      const audio = await makeAmbientPlayer(store.getState().volume)
      const current = store.getState()
      if (current.roomId !== roomId || current.roomStatus === 'failed') { audio.stop(); return }
      player.current = audio
      audio.setSound(current.environment.sound)
      setListening(true)
      setMessage('')
    } catch {
      setMessage('环境音暂时无法播放，请重试。')
    } finally {
      setPending(false)
    }
  }
  return { listening, pending, message, listen }
}

const Context = createContext<ReturnType<typeof useListening> | null>(null)
export function RoomAudioProvider({ children }: { children: ReactNode }) {
  return <Context.Provider value={useListening()}>{children}</Context.Provider>
}
export function useRoomAudio() {
  const audio = useContext(Context)
  if (!audio) throw new Error('Room audio is unavailable outside the provider')
  return audio
}

export function RoomAudioHint() {
  const { environment, roomId, status, isHost, hostOnline } = store(useShallow((state) => ({
    environment: state.environment, roomId: state.roomId, status: state.roomStatus,
    isHost: state.isHost, hostOnline: state.hostOnline,
  })))
  const { listening, pending, message, listen } = useRoomAudio()
  const [dismissed, setDismissed] = useState('')
  const key = roomId + ':' + environment.sound
  if (status !== 'connected' || isHost || !hostOnline || listening || environment.sound === 'quiet' || dismissed === key) return null
  return <aside className="room-audio-hint" aria-label="共学声音邀请">
    <Volume2 size={17} aria-hidden />
    <div><p>{weatherLabels[environment.weather]} · 房主开启了{soundLabels[environment.sound]}</p>
      <button disabled={pending} onClick={() => void listen()}>{pending ? '正在开启…' : '点击同步开启'}</button>
      {message && <p role="status">{message}</p>}
    </div>
    <button className="audio-dismiss" onClick={() => setDismissed(key)} aria-label="忽略声音邀请">×</button>
  </aside>
}
