// Public prerelease: build into dist-public.next, audit it, then atomically swap into dist-public.
// Usage: npm run prerelease [-- --dry-run]
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dryRun = process.argv.includes('--dry-run')
const out = resolve(root, 'dist-public')
const next = `${out}.next`
const prev = `${out}.prev`

const git = (...args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' }).stdout?.trim() ?? ''
const commit = git('rev-parse', 'HEAD')
const dirty = git('status', '--porcelain').split(/\r?\n/).filter(Boolean).length
const source = resolve(root, process.env.BOOKSTORE_SOURCE ?? 'bookstore-source')
const sourceVersion = (() => {
  try { return JSON.parse(readFileSync(resolve(source, 'package.json'), 'utf8')).version } catch { return 'n/a' }
})()
const sourceRev = source === resolve(root, 'bookstore-source')
  ? git('rev-parse', 'HEAD:bookstore-source')
  : spawnSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout?.trim() || 'n/a'

console.log(`[prerelease] HEAD=${commit.slice(0, 12) || 'n/a'} 未提交文件=${dirty}`)
console.log(`[prerelease] bookstore source=${source} version=${sourceVersion} rev=${sourceRev}` +
  (process.env.BOOKSTORE_SOURCE ? ' (BOOKSTORE_SOURCE 覆盖；公开档仍受 prepare-bookstore 保护)' : ''))

const node = (script, ...args) => ({ cmd: process.execPath, args: [resolve(root, script), ...args] })
const steps = [
  { name: 'prepare-bookstore public', ...node('scripts/prepare-bookstore.mjs', 'public') },
  { name: 'typecheck', ...node('node_modules/typescript/bin/tsc', '--noEmit') },
  { name: 'vite build (public → dist-public.next)',
    ...node('node_modules/vite/bin/vite.js', 'build', '--mode', 'public', '--outDir', 'dist-public.next', '--emptyOutDir') },
]

if (dryRun) {
  console.log('[prerelease] --dry-run，将依次执行：')
  steps.forEach((step, i) => console.log(`  ${i + 1}. ${step.name}: ${[step.cmd, ...step.args].map((a) => relative(root, a) || a).join(' ')}`))
  console.log('  4. 写入 release-info.json 并审核完整暂存目录')
  console.log('  5. 交换 dist-public.next → dist-public')
  process.exit(0)
}

const sizeOf = (dir) => readdirSync(dir, { recursive: true }).reduce((sum, file) => {
  const info = statSync(resolve(dir, file)); return info.isFile() ? sum + info.size : sum
}, 0)
const readJson = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return undefined } }

function run({ name, cmd, args, env }) {
  console.log(`\n[prerelease] ▶ ${name}`)
  const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } })
  if (result.error || result.status !== 0) {
    throw new Error(`${name} 失败 (${result.error?.message ?? `exit ${result.status}`})`)
  }
}

let info
rmSync(next, { recursive: true, force: true })
try {
  for (const step of steps) run(step)
  const manifest = JSON.parse(readFileSync(resolve(next, 'offline-manifest.json'), 'utf8'))
  const packs = Object.fromEntries(Object.entries(manifest.packs).map(([k, v]) => [k, v.bytes]))
  info = { commit, dirty, builtAt: new Date().toISOString(),
    source: { path: relative(root, source).replaceAll('\\', '/') || '.', version: sourceVersion, rev: sourceRev },
    revision: manifest.revision, packs, totalBytes: sizeOf(next) }
  writeFileSync(resolve(next, 'release-info.json'), JSON.stringify(info, null, 2) + '\n')
  run({ name: 'check-public-release', ...node('scripts/check-public-release.mjs'), env: { PUBLIC_OUT: 'dist-public.next' } })
} catch (error) {
  rmSync(next, { recursive: true, force: true })
  console.error(`[prerelease] ✖ ${error.message}；已删除 dist-public.next，dist-public 保持不变`)
  process.exit(1)
}

const old = existsSync(out) ? readJson(resolve(out, 'release-info.json')) ?? {
  revision: readJson(resolve(out, 'offline-manifest.json'))?.revision,
  packs: Object.fromEntries(Object.entries(readJson(resolve(out, 'offline-manifest.json'))?.packs ?? {}).map(([k, v]) => [k, v.bytes])),
  totalBytes: sizeOf(out) } : undefined

rmSync(prev, { recursive: true, force: true })
if (existsSync(out)) renameSync(out, prev)
try { renameSync(next, out) } catch (error) {
  if (existsSync(prev)) renameSync(prev, out)
  throw error
}
rmSync(prev, { recursive: true, force: true })

const diff = (a, b) => (a === undefined ? `${b} B (新)` : `${a} → ${b} B (${b - a >= 0 ? '+' : ''}${b - a})`)
console.log(`\n[prerelease] ✔ 已发布 dist-public  revision ${old?.revision ?? 'n/a'} → ${info.revision}`)
for (const [name, bytes] of Object.entries(info.packs)) console.log(`  ${name}: ${diff(old?.packs?.[name], bytes)}`)
console.log(`  total: ${diff(old?.totalBytes, info.totalBytes)}`)
