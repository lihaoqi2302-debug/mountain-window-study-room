import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'

type Status = 'available' | 'saving' | 'saved' | 'update' | 'failed' | 'unavailable'
let registration: Promise<ServiceWorkerRegistration> | undefined

async function request(command: 'status' | 'save'): Promise<Status> {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext) return 'unavailable'
  const url = new URL('sw.js', document.baseURI)
  let worker = navigator.serviceWorker.controller
  if (worker?.scriptURL !== url.href) {
    registration ??= navigator.serviceWorker.register(url, { updateViaCache: 'none' })
      .catch((error) => { registration = undefined; throw error })
    const registered = await registration
    worker = registered.active ?? (await navigator.serviceWorker.ready).active
  }
  if (!worker) return 'unavailable'

  return new Promise((resolve) => {
    const channel = new MessageChannel()
    const finish = (status: Status) => {
      clearTimeout(timer)
      channel.port1.close()
      resolve(status)
    }
    const timer = window.setTimeout(() => finish('failed'), command === 'save' ? 180000 : 4500)
    channel.port1.onmessage = (event) => finish(event.data)
    worker.postMessage(`study-offline-${command}`, [channel.port2])
  })
}

export default function OfflineControls() {
  const [status, setStatus] = useState<Status>('unavailable')
  const [online, setOnline] = useState(navigator.onLine)

  useEffect(() => {
    let mounted = true
    function checkStatus() {
      void request('status').then((state) => {
        if (mounted) setStatus((current) => current === 'saving' ? current : state)
      }).catch(() => {})
    }
    function updateOnline() { setOnline(navigator.onLine) }
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

  async function save() {
    setStatus('saving')
    try { setStatus(await request('save')) } catch { setStatus('failed') }
  }

  if (status === 'unavailable') return null
  return (
    <div className="offline-controls">
      {status === 'saved' ? (
        <p className="field-message" role="status">已保存离线版。断网时也可用同一网址打开书屋。</p>
      ) : (
        <button className="button subtle" type="button" onClick={() => void save()} disabled={status === 'saving' || !online}>
          <Download size={16} aria-hidden />
          {status === 'saving' ? '正在保存离线版…' : status === 'update' ? '更新离线版' : '保存离线版'}
        </button>
      )}
      {status === 'failed' && <p className="field-message" role="status">离线副本保存未完成。恢复连接或腾出空间后可重试。</p>}
      {status === 'update' && <p className="field-message">本机已有离线版，可以保存当前更新。</p>}
    </div>
  )
}
