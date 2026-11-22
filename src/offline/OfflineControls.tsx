import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'

type PackName = 'core' | 'scenery' | 'record'
type Status = 'available' | 'saving' | 'saved' | 'update' | 'failed' | 'unavailable'
type Report = {
  status: Status
  revision?: string
  savedRevision?: string
  done?: number
  total?: number
  packs?: Partial<Record<PackName, { bytes: number; saved: boolean; savedBytes: number }>>
}
let registration: Promise<ServiceWorkerRegistration> | undefined

const packLabels = { scenery: '其余三套窗景', record: '默认唱片' } as const
const mb = (bytes: number) => (bytes / 1000000).toFixed(1) + ' MB'

async function request(command: 'status' | 'save' | 'clear', packs: PackName[],
  onProgress?: (report: Report) => void): Promise<Report> {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext) return { status: 'unavailable' }
  const url = new URL('sw.js', document.baseURI)
  let worker = navigator.serviceWorker.controller
  if (worker?.scriptURL !== url.href) {
    registration ??= navigator.serviceWorker.register(url, { updateViaCache: 'none' })
      .catch((error) => { registration = undefined; throw error })
    worker = (await registration).active ?? (await navigator.serviceWorker.ready).active
  }
  if (!worker || worker.scriptURL !== url.href) return { status: 'unavailable' }
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    const finish = (report: Report) => {
      clearTimeout(timer)
      channel.port1.close()
      resolve(report)
    }
    const timer = window.setTimeout(() => finish({ status: 'failed' }), command === 'save' ? 180000 : 6000)
    channel.port1.onmessage = (event: MessageEvent<Report | Status>) => {
      const value = typeof event.data === 'string' ? { status: event.data } : event.data
      if (value.status === 'saving') onProgress?.(value)
      else finish(value)
    }
    worker.postMessage(command === 'save' ? { type: 'study-offline-save', packs } : `study-offline-${command}`, [channel.port2])
  })
}

export default function OfflineControls() {
  const [report, setReport] = useState<Report>({ status: 'unavailable' })
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [selected, setSelected] = useState<PackName[]>([])
  const [online, setOnline] = useState(navigator.onLine)

  useEffect(() => {
    let mounted = true
    function checkStatus() {
      void request('status', []).then((value) => {
        if (mounted) setReport(value)
      }).catch(() => {})
    }
    function updateOnline() { setOnline(navigator.onLine); checkStatus() }
    checkStatus()
    navigator.serviceWorker?.addEventListener('controllerchange', checkStatus)
    window.addEventListener('online', updateOnline)
    window.addEventListener('offline', updateOnline)
    return () => {
      mounted = false
      navigator.serviceWorker?.removeEventListener('controllerchange', checkStatus)
      window.removeEventListener('online', updateOnline)
      window.removeEventListener('offline', updateOnline)
    }
  }, [])

  async function change(command: 'save' | 'clear') {
    setBusy(true)
    setProgress({ done: 0, total: 0 })
    try {
      const result = await request(command, selected, ({ done = 0, total = 0 }) => setProgress({ done, total }))
      setReport((previous) => result.packs ? result : { ...previous, status: result.status })
      if (result.status !== 'failed') setSelected([])
    } catch {
      setReport((previous) => ({ ...previous, status: 'failed' }))
    } finally {
      setBusy(false)
    }
  }

  const { status, packs, savedRevision, revision } = report
  if (status === 'unavailable') return null
  const coreSaved = Boolean(packs?.core?.saved || status === 'saved')
  const extra = (['scenery', 'record'] as const).filter((name) => packs?.[name])
  const savedBytes = Object.values(packs ?? {}).reduce((sum, pack) => sum + pack.savedBytes, 0)
  return (
    <div className="offline-controls">
      {coreSaved && <p className="field-message" role="status">已保存离线版。断网时也可用同一网址打开书屋。</p>}
      {packs?.core && <p className="field-message">
        核心 {mb(packs.core.bytes)}{savedBytes > 0 && ` · 已缓存 ${mb(savedBytes)}`}
      </p>}
      {status === 'update' && <p className="field-message">离线版可更新 · {savedRevision?.slice(0, 6)} → {revision?.slice(0, 6)}</p>}
      {extra.map((name) => (
        <label className="cache-pack" key={name}>
          <input type="checkbox" checked={selected.includes(name) || Boolean(packs?.[name]?.saved && status !== 'update')}
            disabled={busy || Boolean(packs?.[name]?.saved && status !== 'update')}
            onChange={(event) => setSelected((previous) => event.target.checked ? [...previous, name] : previous.filter((item) => item !== name))} />
          {packLabels[name]} · {mb(packs?.[name]?.bytes ?? 0)}
        </label>
      ))}
      {busy && <div className="cache-progress">
        <progress aria-label="离线保存进度" max={progress.total || 1} value={progress.done} />
        <span role="status">{progress.total ? `${mb(progress.done)} / ${mb(progress.total)}` : '正在准备…'}</span>
      </div>}
      {(!coreSaved || status === 'update' || selected.length > 0) && (
        <button className="button subtle" type="button" onClick={() => void change('save')} disabled={busy || !online}>
          <Download size={16} aria-hidden />
          {status === 'update' ? '更新离线版' : coreSaved ? '保存所选扩展' : '保存离线版'}
        </button>
      )}
      {coreSaved && <button className="button subtle" type="button" onClick={() => void change('clear')} disabled={busy}>清理离线缓存</button>}
      {status === 'failed' && <p className="field-message" role="status">操作未完成。恢复连接或腾出空间后可重试。</p>}
    </div>
  )
}
