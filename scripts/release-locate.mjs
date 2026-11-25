// Locate which build a dist directory or public site is serving.
// Usage:
//   node scripts/release-locate.mjs [dist-dir | https://site/] [--json] [--no-api]
// Default target: the Pages URL linked in README.md (falls back to git remote → <owner>.github.io/<repo>/).
// Reads offline-manifest.json, release-info.json (optional) and the revision inside sw.js.
// For public sites it also asks the public GitHub API (no token) which commits the github-pages
// environment was deployed from, so a revision can be tied to a commit even without release-info.json.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const args = process.argv.slice(2)
const asJson = args.includes('--json')
const useApi = !args.includes('--no-api')
const git = (...a) => spawnSync('git', ['-C', root, ...a], { encoding: 'utf8' }).stdout?.trim() ?? ''

function remoteRepo() {
  const url = git('remote', 'get-url', 'origin')
  const m = /github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/.exec(url)
  return m ? { owner: m[1], repo: m[2] } : undefined
}

function defaultTarget() {
  try {
    const m = /https:\/\/[\w.-]+\.github\.io\/[\w.-]+\/?/.exec(readFileSync(resolve(root, 'README.md'), 'utf8'))
    if (m) return m[0].endsWith('/') ? m[0] : m[0] + '/'
  } catch {}
  const r = remoteRepo()
  return r ? `https://${r.owner.toLowerCase()}.github.io/${r.repo}/` : resolve(root, 'dist-public')
}

const target = args.find((a) => !a.startsWith('--')) ?? defaultTarget()
const isUrl = /^https?:\/\//.test(target)

async function read(name) {
  if (isUrl) {
    const res = await fetch(new URL(name, target.endsWith('/') ? target : target + '/'), { cache: 'no-store' })
    return res.ok ? { text: await res.text(), headers: res.headers } : { status: res.status }
  }
  const file = resolve(target, name)
  return existsSync(file) ? { text: readFileSync(file, 'utf8') } : { status: 404 }
}
const json = (r) => { try { return r.text ? JSON.parse(r.text) : undefined } catch { return undefined } }

const [manifestRes, infoRes, swRes] = await Promise.all(['offline-manifest.json', 'release-info.json', 'sw.js'].map(read))
const manifest = json(manifestRes)
const info = json(infoRes)
const swRevision = /const revision = "([0-9a-f]+)"/.exec(swRes.text ?? '')?.[1]

const report = {
  target,
  kind: isUrl ? 'url' : 'dir',
  revision: manifest?.revision ?? null,
  swRevision: swRevision ?? null,
  consistent: Boolean(manifest?.revision && manifest.revision === swRevision),
  packs: manifest ? Object.fromEntries(Object.entries(manifest.packs).map(([k, v]) => [k, { bytes: v.bytes, files: v.files }])) : null,
  releaseInfo: info ?? null,
  commit: info?.commit ?? null,
  source: info?.source ?? null,
  lastModified: swRes.headers?.get?.('last-modified') ?? null,
  deployments: null,
  notes: [],
}
if (!manifest) report.notes.push(`offline-manifest.json 不可读 (${manifestRes.status ?? 'parse error'})`)
if (!info) report.notes.push('无 release-info.json：旧产物可能没有记录提交 SHA，可交叉核对部署记录与离线 revision')
if (manifest && !report.consistent) report.notes.push('sw.js 与 offline-manifest.json revision 不一致，可能是 CDN 缓存未同步或产物被手工改动')

if (!isUrl) {
  report.totalBytes = readdirSync(target, { recursive: true })
    .reduce((s, f) => { const st = statSync(resolve(target, f)); return st.isFile() ? s + st.size : s }, 0)
}

// Public, unauthenticated GitHub API: recent github-pages deployments → commit sha.
if (isUrl && useApi) {
  const r = remoteRepo()
  if (r) {
    try {
      const api = `https://api.github.com/repos/${r.owner}/${r.repo}/deployments?environment=github-pages&per_page=5`
      const res = await fetch(api, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'release-locate' } })
      if (res.ok) {
        report.deployments = (await res.json()).map((d) => ({ sha: d.sha, ref: d.ref, created: d.created_at }))
        if (!report.commit && report.deployments[0]) {
          report.commit = report.deployments[0].sha
          report.notes.push('commit 取自最近一次 github-pages 部署（API 推断，非产物内记录）；可用本地构建该提交比对 revision 确认')
        }
      } else report.notes.push(`GitHub API ${res.status}（可能限流），跳过部署记录`)
    } catch (error) { report.notes.push(`GitHub API 不可达: ${error.message}`) }
  }
}

if (report.commit) {
  const local = git('log', '-1', '--format=%h %ci %s', report.commit)
  report.localCommit = local || '本地无此提交（先 git fetch）'
}

if (asJson) console.log(JSON.stringify(report, null, 2))
else {
  console.log(`[release-locate] ${report.kind} ${target}`)
  console.log(`  revision: ${report.revision ?? 'n/a'}  (sw.js ${report.swRevision ?? 'n/a'}${report.consistent ? ', 一致' : ', 不一致'})`)
  console.log(`  commit:   ${report.commit ?? 'n/a'}${report.localCommit ? `  → ${report.localCommit}` : ''}`)
  if (report.source) console.log(`  source:   ${report.source.path} v${report.source.version} rev ${report.source.rev}`)
  if (report.releaseInfo?.builtAt) console.log(`  builtAt:  ${report.releaseInfo.builtAt}  dirty=${report.releaseInfo.dirty}`)
  if (report.lastModified) console.log(`  sw.js Last-Modified: ${report.lastModified}`)
  for (const [k, v] of Object.entries(report.packs ?? {})) console.log(`  pack ${k}: ${v.bytes} B / ${v.files} files`)
  if (report.totalBytes !== undefined) console.log(`  total:    ${report.totalBytes} B`)
  for (const d of report.deployments ?? []) console.log(`  deploy:   ${d.sha.slice(0, 7)} ${d.ref} ${d.created}`)
  for (const n of report.notes) console.log(`  note: ${n}`)
}
process.exit(manifest ? 0 : 1)
