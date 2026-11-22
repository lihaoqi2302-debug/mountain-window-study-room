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
const source = process.env.BOOKSTORE_SOURCE ? resolve(process.env.BOOKSTORE_SOURCE)
  : existsSync(resolve(sibling, 'build.mjs')) ? sibling : embedded
if (!existsSync(resolve(source, 'build.mjs'))) throw new Error('Bookstore source unavailable')

const staging = mkdtempSync(resolve(root, '.bookstore-build-'))
try {
  const result = spawnSync(process.execPath, [resolve(source, 'build.mjs'), '--companion'], {
    env: { ...process.env, BOOKSTORE_OUTPUT: resolve(staging, 'bookstore/index.html'), BOOKSTORE_TOOLCHAIN: root,
      BOOKSTORE_PROFILE: JSON.stringify(profile) },
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error('Bookstore build failed')
  rmSync(target, { recursive: true, force: true })
  renameSync(staging, target)
} finally {
  rmSync(staging, { recursive: true, force: true })
}
