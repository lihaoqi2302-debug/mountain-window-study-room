import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const name = process.argv[2] ?? 'full'
if (name !== 'full' && name !== 'public') throw new Error('Choose the full or public content profile')
const manifest = JSON.parse(readFileSync(resolve(root, 'content.profile.json'), 'utf8'))
const profile = manifest[name]
const target = resolve(root, name === 'full' ? '.formal' : '.public-room')
const sibling = resolve(root, '../cozy-bookstore')
const embedded = resolve(root, 'bookstore-source')
// Public builds never pick up a neighbouring private source implicitly: the same commit
// must produce the same artifact locally and on GitHub Actions.
const source = process.env.BOOKSTORE_SOURCE ? resolve(process.env.BOOKSTORE_SOURCE)
  : name === 'full' && existsSync(resolve(sibling, 'build.mjs')) ? sibling : embedded
if (!existsSync(resolve(source, 'build.mjs'))) throw new Error('Bookstore source unavailable')
if (name === 'public' && source !== embedded && process.env.BOOKSTORE_ALLOW_EXTERNAL !== '1') {
  throw new Error(`Public build must use ${embedded} (set BOOKSTORE_ALLOW_EXTERNAL=1 to override)`)
}
if (source === embedded && !existsSync(resolve(embedded, 'node_modules'))) {
  throw new Error('bookstore-source dependencies are missing. Run: npm --prefix bookstore-source ci')
}
const rev = spawnSync('git', ['-C', source, 'describe', '--always', '--dirty'], { encoding: 'utf8' }).stdout?.trim()
console.log(`[prepare] profile=${name} source=${source} rev=${rev || 'n/a'}`)

const staging = mkdtempSync(resolve(root, '.bookstore-build-'))
try {
  const result = spawnSync(process.execPath, [resolve(source, 'build.mjs'), '--companion'], {
    env: { ...process.env, BOOKSTORE_OUTPUT: resolve(staging, 'bookstore/index.html'), BOOKSTORE_TOOLCHAIN: root,
      BOOKSTORE_PROFILE: JSON.stringify(profile) },
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error('Bookstore build failed')
  // Keep the previous output until the new one is in place.
  const old = `${target}.old`
  rmSync(old, { recursive: true, force: true })
  if (existsSync(target)) renameSync(target, old)
  try { renameSync(staging, target) } catch (error) {
    if (existsSync(old)) renameSync(old, target)
    throw error
  }
  rmSync(old, { recursive: true, force: true })
} finally {
  rmSync(staging, { recursive: true, force: true })
}
