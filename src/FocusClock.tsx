import { useEffect, useState } from 'react'
import { Timer } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { clockLabel, localDay, presenceLabel, secondsLeft } from './focus'
import { useStudyRoomStore as store } from './store/useStudyRoomStore'
import books from './data/books.json'

function useClock(active: boolean) {
  const [time, setTime] = useState(Date.now)
  useEffect(() => {
    if (!active) return
    const tick = () => setTime(Date.now())
    tick()
    const interval = window.setInterval(tick, 1000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [active])
  return time
}

export function FocusClock({ covered }: { covered: boolean }) {
  const focus = store((state) => state.focus)
  const [open, setOpen] = useState(false)
  const clock = useClock(open || focus.endAt !== null)
  const now = Math.max(clock, Math.min(Date.now(), clock + 1000))
  useEffect(() => {
    const update = () => store.getState().settleFocus(Date.now())
    update()
    if (focus.endAt === null) return
    const timeout = window.setTimeout(update, Math.max(0, focus.endAt - Date.now()) + 25)
    document.addEventListener('visibilitychange', update)
    window.addEventListener('pageshow', update)
    return () => {
      window.clearTimeout(timeout)
      document.removeEventListener('visibilitychange', update)
      window.removeEventListener('pageshow', update)
    }
  }, [focus.endAt])
  const running = focus.endAt !== null
  const configured = running || focus.remaining !== null
  const shown = clockLabel(secondsLeft(focus, now))
  const today = focus.today.day === localDay(now) ? focus.today : { rounds: 0, minutes: 0 }
  function configure(work: number, rest: number) { store.getState().configureFocus(work, rest) }

  if (covered) return null
  return (
    <aside className="focus-dock" aria-label="个人专注">
      <button className="focus-pill" type="button" aria-controls="focus-panel" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Timer size={16} aria-hidden /> {configured ? shown : '专注'}
      </button>
      {focus.notice && <div className="quiet-notice">
        <span role="status">{focus.notice}</span>
        <button aria-label="关闭专注提示" onClick={() => store.getState().dismissFocusNotice()}>×</button>
      </div>}
      {open && <section className="focus-panel" id="focus-panel" aria-label="番茄钟"
        onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false) }}>
        <h2>{focus.phase === 'focus' ? '专注' : '小憩'}</h2>
        <output aria-label="剩余时间">{shown}</output>
        <div className="focus-actions">
          <button className="button" disabled={configured} onClick={() => configure(25,5)}>25 / 5</button>
          <button className="button" disabled={configured} onClick={() => configure(50,10)}>50 / 10</button>
        </div>
        <fieldset disabled={configured}>
          <legend>自定义分钟</legend>
          <label>专注 <input aria-label="专注分钟" type="number" min={1} max={120} key={focus.focus} defaultValue={focus.focus}
            onBlur={(event) => configure(event.currentTarget.valueAsNumber, focus.rest)} /></label>
          <label>休息 <input aria-label="休息分钟" type="number" min={1} max={60} key={focus.rest} defaultValue={focus.rest}
            onBlur={(event) => configure(focus.focus, event.currentTarget.valueAsNumber)} /></label>
        </fieldset>
        <div className="focus-actions">
          <button className="button primary" onClick={() => store.getState().toggleFocus(Date.now())}>
            {running ? '暂停' : focus.remaining !== null ? '继续' : focus.phase === 'rest' ? '开始休息' : '开始专注'}
          </button>
          <button className="button subtle" onClick={() => store.getState().resetFocus()}>重置</button>
        </div>
        <p className="field-message">今天 · {today.rounds} 次专注 / {today.minutes} 分钟</p>
      </section>}
    </aside>
  )
}

export function FocusMembers() {
  const profiles = store(useShallow((state) => Object.values(state.peers).flatMap(({ profile }) => profile ? [profile] : [])))
  const now = useClock(profiles.some(({ focus }) => Boolean(focus)))
  const lines = profiles.flatMap(({ name, book, focus }, index) => {
    const title = books.find(({ id }) => id === book)?.title
    const state = [presenceLabel(focus, now), title && `正在阅读《${title}》`].filter(Boolean).join(' · ')
    return state ? [{ key: index, name, state }] : []
  })
  if (!lines.length) return null
  return <ul className="focus-members" aria-label="同屋好友状态">
    {lines.map(({ key, name, state }) => <li key={key}><b>{name}</b><span>{state}</span></li>)}
  </ul>
}
