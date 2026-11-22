import books from './data/books.json'

export const weatherLabels = { dusk: '暮蓝山窗', day: '白昼松林', rain: '雨夜', snow: '冬日雪林' }
export const soundLabels = { quiet: '静音', rain: '雨声', fire: '炉火' }
export type RoomEnvironment = { weather: keyof typeof weatherLabels; hearth: boolean; sound: keyof typeof soundLabels }
export const defaultEnvironment: RoomEnvironment = { weather: 'dusk', hearth: true, sound: 'quiet' }

export function validEnvironment(value: unknown): value is RoomEnvironment {
  if (!value || typeof value !== 'object') return false
  const { weather, hearth, sound } = value as RoomEnvironment
  return typeof weather === 'string' && Object.hasOwn(weatherLabels, weather)
    && typeof sound === 'string' && Object.hasOwn(soundLabels, sound) && typeof hearth === 'boolean'
}

export type RoomMessage = { id: string; author: string; body: string; createdAt: number }
export type Note = RoomMessage & { book: string; chapter: string }
export const noteLimit = 72
export const noteLength = 180
export const chatLimit = 64
export const chatLength = 220
export const formalEarthChapters: Record<string, string> = {
  cover: '封面', intro: '登录说明', vol1: '第一卷 · 内在秩序', vol2: '第二卷 · 公共场域',
  vol3: '第三卷 · 现实建造', appendix: '附录 · 延伸阅读与练习册',
}

export function chapterLabel(book: string, chapter: string) {
  if (book === 'earth-online' && Object.hasOwn(formalEarthChapters, chapter)) return formalEarthChapters[chapter]
  return books.find(({ id }) => id === book)?.chapters.find(({ id }) => id === chapter)?.title
}

function validMessage(value: unknown, length: number): value is RoomMessage {
  if (!value || typeof value !== 'object') return false
  const { id, author, body, createdAt } = value as RoomMessage
  return typeof id === 'string' && /^[0-9a-f]{32}$/.test(id)
    && typeof author === 'string' && author.trim().length > 0 && author.length <= 16
    && typeof body === 'string' && body.trim().length > 0 && body.length <= length
    && Number.isFinite(createdAt) && createdAt > 0 && createdAt <= Date.now() + 86400000
}

export function validNote(value: unknown): value is Note {
  if (!validMessage(value, noteLength)) return false
  const { book, chapter } = value as Note
  return typeof book === 'string' && typeof chapter === 'string' && Boolean(chapterLabel(book, chapter))
}

export function validChat(value: unknown): value is RoomMessage {
  return validMessage(value, chatLength)
}

export function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function mergeRecent<T extends RoomMessage>(previous: T[], next: T[], limit: number) {
  const records = new Map(previous.map((item) => [item.id, item]))
  for (const item of next) if (!records.has(item.id)) records.set(item.id, item)
  if (records.size === previous.length) return previous
  return Array.from(records.values())
    .sort((a,b) => a.createdAt-b.createdAt || a.id.localeCompare(b.id))
    .slice(-limit)
}

export function rememberRoom<T>(previous: Record<string, T>, room: string, value: T) {
  const latest = Object.entries(previous).filter(([key]) => key !== room).slice(-11)
  return Object.fromEntries([...latest, [room, value]]) as Record<string, T>
}
