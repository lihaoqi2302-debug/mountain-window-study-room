// Local public-scene release gate. No network deployment; publication below means local dist-public only.
import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { lstat, open, readFile, readdir, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { createInterface } from 'node:readline'
import { pathToFileURL, fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const sceneFiles = {
  artworks: { 'starry-night': 'display/starry-night.webp', 'water-lilies': 'display/water-lilies.webp' },
  scenery: { mountain: 'display/mountain.webp', forest: 'display/forest.webp', snow: 'display/snow.webp', aurora: 'scenery/aurora.webp' },
}
const hex = (value, length) => typeof value === 'string' && value.length === length && !/[^a-f0-9]/.test(value)
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const ensure = (ok, message) => { if (!ok) throw new Error(message) }
const samePath = (a, b) => relative(a, b) === ''

// A native relative check works across drives, UNC shares and case rules. Portable
// input segments also reject Windows aliases and backslashes on Linux.
export function portablePath(base, name) {
  const segments = typeof name === 'string' ? name.split('/') : []
  ensure(segments.length && segments.every((s) => s && !/[^a-z0-9_. -]/i.test(s) && !/[. ]$/.test(s) &&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s)), 'invalid portable scene path')
  const target = resolve(base, ...segments)
  const rel = relative(base, target)
  ensure(rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`), 'scene path outside root')
  return target
}

async function checked(base, name, directory = false, optional = false) {
  let parent = base
  const parts = name.split('/')
  for (const [i, part] of parts.entries()) {
    const file = portablePath(parent, part)
    const last = i === parts.length - 1
    try {
      const stat = await lstat(file)
      ensure(!stat.isSymbolicLink() && samePath(await realpath(file), file), `linked/redirected path: ${file}`)
      if (!last || directory) ensure(stat.isDirectory(), `not a directory: ${file}`)
      else {
        ensure(stat.isFile() && stat.size > 0, `not a non-empty regular file: ${file}`)
        // Opening with read access tests real access (not just a mode bit).
        const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
        await handle.close()
      }
    } catch (error) {
      if (optional && last && error.code === 'ENOENT') return undefined
      if (error.code) throw new Error(`cannot access ${file} (${error.code})`, { cause: error })
      throw error
    }
    parent = file
  }
  return parent
}

async function json(file) {
  try { return JSON.parse(await readFile(file, 'utf8')) }
  catch (error) { throw new Error(`cannot read JSON ${file} (${error.code ?? 'invalid JSON'})`, { cause: error }) }
}

function fields(value, allowed) {
  return record(value) && Object.keys(value).every((key) => allowed.includes(key))
}

function webUrl(value) {
  if (typeof value !== 'string' || !/^https:\/\//.test(value) || /[\\\s]/.test(value)) return false
  const url = URL.parse(value)
  return !!url && !url.username && !url.password
}

async function provenance(source, name, entries, kind) {
  const file = await checked(source, name)
  const info = await json(file)
  const artwork = kind === 'artworks'
  const id = artwork ? 'key' : 'mode'
  ensure(Array.isArray(info) && info.length === Object.keys(entries).length, `invalid provenance entries: ${file}`)
  const seen = new Set()
  for (const [index, value] of info.entries()) {
    const where = `${file} entry ${index + 1}`
    const allowed = artwork ? ['key', 'title', 'artist', 'source', 'download', 'metadata', 'rights', 'is_public_domain', 'sha256']
      : ['mode', 'source', 'asset', 'authors', 'license', 'rights', 'original_md5_verified', 'embedded_sha256']
    ensure(fields(value, allowed) && typeof value[id] === 'string' && Object.hasOwn(entries, value[id]) && !seen.has(value[id]),
      `unknown or duplicate provenance ID/field: ${where}`)
    seen.add(value[id])
    ensure(webUrl(value.source), `invalid provenance source URL: ${where}`)
    const text = (v) => typeof v === 'string' && v.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(v)
    if (artwork) {
      ensure(text(value.title) && text(value.artist) && text(value.rights) && hex(value.sha256, 64) &&
        (!Object.hasOwn(value, 'is_public_domain') || value.is_public_domain === true) &&
        ['download', 'metadata'].every((key) => !Object.hasOwn(value, key) || webUrl(value[key])), `invalid artwork provenance: ${where}`)
    } else {
      ensure(hex(value.embedded_sha256, 64) && (value.license === 'CC0' || value.rights === 'CC0') &&
        (!Object.hasOwn(value, 'license') || value.license === 'CC0') && (!Object.hasOwn(value, 'rights') || value.rights === 'CC0') &&
        (!Object.hasOwn(value, 'original_md5_verified') || hex(value.original_md5_verified, 32)) &&
        (!Object.hasOwn(value, 'asset') || text(value.asset)) &&
        (!Object.hasOwn(value, 'authors') || (record(value.authors) && Object.entries(value.authors).every(([k, v]) => text(k) && text(v)))),
      `invalid scenery provenance: ${where}`)
    }
  }
}

async function webp(file) {
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const header = Buffer.alloc(12)
    const { bytesRead } = await handle.read(header)
    ensure(bytesRead === 12 && header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP', `invalid WebP header: ${file}`)
  } finally { await handle.close() }
}

export async function validateScene(worktree, requestedSource) {
  const base = await realpath(worktree)
  const embedded = resolve(base, 'bookstore-source')
  // Check before opening any candidate. Do not honor BOOKSTORE_ALLOW_EXTERNAL in this gate.
  const sourceOption = requestedSource ?? 'bookstore-source'
  ensure(typeof sourceOption === 'string' && sourceOption.length && !/[\u0000-\u001f\u007f]/.test(sourceOption), 'invalid public scene source path')
  ensure(samePath(resolve(base, sourceOption), embedded), 'public scene source must be the embedded bookstore-source')
  const source = await checked(base, 'bookstore-source', true)
  const profileFile = await checked(base, 'content.profile.json')
  const { public: profile } = (await json(profileFile)) ?? {}
  // Keep the currently published six-page contract. The shared checker, not this
  // inventory, remains authoritative for actual public build contents and size.
  ensure(fields(profile, ['edition', 'scene', 'manuscript', 'trialPages', 'audio']) && profile.edition === 'public' &&
    profile.scene === 'refined' && profile.manuscript === 'trial' && profile.trialPages === 6 && profile.audio === 'ambience',
  `invalid public scene profile (refined, six-page trial, ambience): ${profileFile}`)

  for (const name of ['build.mjs', 'index.template.html', 'package.json', 'package-lock.json', 'src/main.js']) await checked(source, name)
  const pkg = await json(resolve(source, 'package.json'))
  ensure(typeof pkg?.version === 'string' && pkg.version.trim(), 'bookstore-source/package.json: missing version')
  const src = await checked(source, 'src', true)
  for (const entry of await readdir(src)) await checked(source, `src/${entry}`)

  // Source inventory, not an output filter. New inputs need review here and in the
  // existing builder; generated asset rules remain in check-public-release.mjs.
  const images = ['cover.webp', 'spine.webp', ...Object.values(sceneFiles.artworks), ...Object.values(sceneFiles.scenery),
    ...Array.from({ length: profile.trialPages }, (_, i) => `page_${String(i + 1).padStart(2, '0')}.webp`)]
  const manifests = ['artworks/provenance.json', 'scenery/current-provenance.json']
  const assets = await checked(source, 'assets', true)
  const expected = new Set([...images, ...manifests])
  const folders = [...new Set([...expected].filter((name) => name.includes('/')).map((name) => name.split('/')[0]))]
  for (const name of await readdir(assets)) {
    if (folders.includes(name)) {
      const dir = await checked(assets, name, true)
      for (const entry of await readdir(dir)) ensure(expected.has(`${name}/${entry}`), `unexpected source asset in ${name}/: ${JSON.stringify(entry)}`)
    } else ensure(expected.has(name), `unexpected source asset: ${JSON.stringify(name)}`)
  }
  for (const name of images) await webp(await checked(assets, name))
  await provenance(assets, manifests[0], sceneFiles.artworks, 'artworks')
  await provenance(assets, manifests[1], sceneFiles.scenery, 'scenery')
  return { source: 'bookstore-source', sourceVersion: pkg.version, trialPages: profile.trialPages, imageCount: images.length }
}

function run(command, args, { cwd, env, onLine } = {}) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { cwd, env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    if (onLine) {
      createInterface({ input: child.stdout }).on('line', onLine)
      child.stderr.pipe(process.stderr, { end: false })
    } else {
      child.stdout.setEncoding('utf8').on('data', (text) => { output += text })
      child.stderr.pipe(process.stderr, { end: false })
    }
    child.once('error', reject)
    child.once('close', (status, signal) => {
      if (status === 0) accept(output.trim())
      else reject(new Error(`${command === process.execPath ? args[0] : command} failed (${signal ?? `exit ${status}`})`))
    })
  })
}

function options(args) {
  const result = Object.create(null)
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]
    ensure(['--check-only', '--source', '--expect-commit'].includes(flag) && !Object.hasOwn(result, flag), `unknown or repeated option: ${JSON.stringify(flag)}`)
    if (flag === '--check-only') result[flag] = true
    else {
      const value = args[++i]
      ensure(value && !value.startsWith('--'), `${flag} requires a value`)
      result[flag] = value
    }
  }
  ensure(!result['--expect-commit'] || hex(result['--expect-commit'], 40), '--expect-commit must be a 40-character lowercase SHA')
  return result
}

async function main() {
  const started = performance.now()
  const report = { ok: false, commit: null, revision: null, packs: null, steps: [] }
  async function step(name, fn) {
    const start = performance.now()
    let ok = false
    try { const value = await fn(); ok = true; return value }
    finally { report.steps.push({ name, ok, ms: Math.round(performance.now() - start) }) }
  }
  try {
    const args = options(process.argv.slice(2))
    const base = await realpath(root)
    const git = (...params) => run('git', ['-C', base, ...params], { cwd: base })
    await step('git', async () => {
      ensure(samePath(await realpath(await git('rev-parse', '--show-toplevel')), base), 'script is not at the worktree root')
      report.commit = await git('rev-parse', '--verify', 'HEAD^{commit}')
      ensure(hex(report.commit, 40), 'invalid Git commit')
      ensure(!args['--expect-commit'] || args['--expect-commit'] === report.commit, 'Git HEAD does not match --expect-commit')
      report.dirty = (await git('status', '--porcelain')).split(/\r?\n/).filter(Boolean).length
    })
    report.scene = await step('source-validation', () => validateScene(base, args['--source'] ?? process.env.BOOKSTORE_SOURCE))
    if (!args['--check-only']) {
      await step('build-readiness', async () => {
        await checked(base, 'node_modules/typescript/bin/tsc')
        await checked(base, 'node_modules/vite/bin/vite.js')
        await checked(base, 'bookstore-source/node_modules', true)
        for (const name of ['dist-public', 'dist-public.next', 'dist-public.prev', '.public-room', '.public-room.old']) {
          await checked(base, name, true, true)
        }
      })
      // Prevent caller overrides from weakening the audit or changing source. The
      // CLI never passes arbitrary arguments/scripts to the build process.
      const omitted = ['BOOKSTORE_SOURCE', 'BOOKSTORE_ALLOW_EXTERNAL', 'PUBLIC_OUT', 'PUBLIC_PROFILE_FILE', 'PUBLIC_CORE_LIMIT']
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !omitted.includes(key.toUpperCase())))
      await step('prerelease', async () => {
        report.prereleasePhases = []
        let phase
        let start
        const finish = () => {
          if (phase) report.prereleasePhases.push({ name: phase, ms: Math.round(performance.now() - start) })
        }
        try {
          await run(process.execPath, ['scripts/prerelease.mjs'], { cwd: base, env, onLine: (line) => {
            const marker = /^\[prerelease\] ▶ (.+)$/.exec(line)
            if (marker) { finish(); phase = marker[1]; start = performance.now() }
            console.log(line)
          } })
        } finally { finish() }
      })
      await step('release-locate', async () => {
        const located = JSON.parse(await run(process.execPath,
          ['scripts/release-locate.mjs', 'dist-public', '--json', '--no-api'], { cwd: base, env }))
        ensure(located.consistent && located.revision === located.releaseInfo?.revision && located.commit === report.commit,
          'published revision/commit mismatch; do not promote this local build')
        report.revision = located.revision
        report.packs = { core: located.packs.core.bytes, scenery: located.packs.scenery.bytes }
        report.totalBytes = located.totalBytes
      })
    }
    report.ok = true
  } catch (error) {
    report.error = error.message
    process.exitCode = 1
  } finally {
    report.elapsedMs = Math.round(performance.now() - started)
    console.log(`[scene-preflight] ${JSON.stringify(report)}`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(`[scene-preflight] ${error.message}`); process.exitCode = 1 })
}
