export type FocusPhase = 'focus' | 'rest'
export type FocusPresence = { phase: FocusPhase; endAt: number }
export type FocusTimer = {
  phase: FocusPhase
  focus: number
  rest: number
  endAt: number | null
  remaining: number | null
  notice: string
  today: { day: string; rounds: number; minutes: number }
}

export const localDay = (time: number) => {
  const date = new Date(time)
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].join('-')
}
export const initialFocus: FocusTimer = {
  phase: 'focus', focus: 25, rest: 5, endAt: null, remaining: null, notice: '',
  today: { day: '', rounds: 0, minutes: 0 },
}
export function secondsLeft(timer: FocusTimer, now: number) {
  return Math.ceil((timer.endAt === null ? timer.remaining ?? timer[timer.phase] * 60_000
    : Math.max(0, timer.endAt - now)) / 1000)
}
export const clockLabel = (seconds: number) => Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0')
export function presenceLabel(value: FocusPresence | undefined, now: number) {
  if (!value || value.endAt <= now) return ''
  return value.phase === 'rest' ? '小憩中' : '专注中 ' + clockLabel(Math.ceil((value.endAt - now) / 1000))
}
export function validFocus(value: unknown): value is FocusPresence {
  if (!value || typeof value !== 'object') return false
  const { phase, endAt } = value as FocusPresence
  return (phase === 'focus' || phase === 'rest') && Number.isFinite(endAt)
    && endAt > 0 && endAt < Date.now() + 180 * 60_000
}
