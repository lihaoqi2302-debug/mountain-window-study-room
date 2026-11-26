import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeRevision, makeVariant, readBundle } from '../../offline/revision-variants.mjs'

export const root = fileURLToPath(new URL('../../../', import.meta.url))
export const dist = join(root, 'dist-public')
export const frozenCommit = 'd5f7d584521645ade0f16cc46632f1d1836015bf'
const frozenRevision = '77272930232c9345'
const frozenSource = '188c3df57cdfa5ec4d22930ea19c572b26110ab6'
export const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
export const probe = 'index.html' // existing unhashed, same URL in both versions
export const fakeIce = JSON.stringify({ iceServers: [{
  urls: 'turn:127.0.0.1:1', username: 'round3-e-fixture', credential: 'synthetic-not-a-secret',
}] })

export function runNode(script, args = [], publicOut = dist) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PUBLIC_/i.test(key)))
  return execFileSync(process.execPath, [join(root, script), ...args], {
    cwd: root, encoding: 'utf8', timeout: 60_000, env: { ...env, PUBLIC_OUT: publicOut },
    // Child diagnostics may contain paths or data; do not echo them to the evidence on error.
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

export async function verifyFrozen() {
  const audit = runNode('scripts/check-public-release.mjs').trim()
  const located = JSON.parse(runNode('scripts/release-locate.mjs', ['dist-public', '--json']))
  const read = (file) => readFile(join(dist, file))
  const sw = await read('sw.js')
  const bundle = readBundle(sw.toString('utf8'))
  assert.equal(located.commit, frozenCommit)
  assert.equal(located.releaseInfo.dirty, 0)
  assert.equal(located.source.path, 'bookstore-source')
  assert.equal(located.source.rev, frozenSource)
  assert.equal(located.consistent, true)
  assert.equal(located.releaseInfo.revision, bundle.revision)
  assert.equal(await computeRevision(bundle.code, bundle.packs, read), bundle.revision)
  // Exact revision is the observed Windows baseline. The build includes raw worker line endings.
  if (process.platform === 'win32' && bundle.code.includes('\r\n')) {
    assert.equal(bundle.revision, frozenRevision)
    assert.equal(bundle.packs.core.bytes, 12_802_338)
    assert.equal(bundle.packs.scenery.bytes, 7_383_040)
  }
  assert.equal(located.releaseInfo.totalBytes + (await stat(join(dist, 'release-info.json'))).size, located.totalBytes)
  assert.deepEqual(Object.keys(bundle.packs), ['core', 'scenery'])
  for (const [name, pack] of Object.entries(bundle.packs)) {
    const files = await Promise.all(pack.files.map(async ({ path, bytes }) => {
      assert(!/(^|\/)ice(\/|$)/i.test(path), 'ICE endpoint listed in SW packs')
      const actual = (await stat(join(dist, path))).size
      assert.equal(actual, bytes)
      return actual
    }))
    assert.equal(files.reduce((sum, size) => sum + size, 0), pack.bytes)
    assert.deepEqual(located.packs[name], { bytes: pack.bytes, files: files.length })
  }
  assert(bundle.packs.core.bytes < 15_000_000)

  const paths = (await readdir(dist, { recursive: true })).map((path) => path.replaceAll('\\', '/'))
  assert(!paths.some((path) => /(?:^|\/)(?:\.env(?:\.|$)|[^/]+\.(?:pem|key|p12|pfx|map)$|ice(?:[./]|$)|credentials?\.(?:json|txt)$)/i.test(path)),
    'Unexpected env/key/credential file or source map in public artifact')
  const rootChunks = paths.filter((path) => /^assets\/.+\.js$/.test(path))
  assert(rootChunks.length > 0)
  for (const path of rootChunks) {
    const text = (await read(path)).toString('utf8')
    // Targeted check for static TURN URLs and secret-shaped text, never emit a matched value.
    // The string 'turn:' alone legitimately occurs in protocol handlers.
    assert(!/\bturns?:[\w.\-[\]:]+:(?:\d{2,5})\b|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:ghp_|github_pat_|AKIA)[A-Za-z0-9_]{16,}/i.test(text),
      'Unexpected static relay address or key-shaped text in a public app chunk')
  }
  const core = bundle.packs.core.files.map(({ path }) => path)
  const pdf = ['pdf.min.mjs', 'pdf.worker.min.mjs', 'cmaps/', 'standard_fonts/'].map((part) => {
    const path = core.find((name) => /^bookstore\/pdf-[\d.]+\//.test(name)
      && (name.endsWith('/' + part) || name.includes('/' + part)))
    assert(path, `PDF.js core asset missing: ${part}`)
    return path
  })
  return { ...located, audit, swSha256: hash(sw), probeSha256: hash(await read(probe)), pdf,
    credentialChecks: { rootChunks: rootChunks.length, icePathsInPack: 0, sensitiveFilenames: 0, staticRelayOrKeyMatches: 0 } }
}

export async function makeUpgrade(to) {
  const content = (await readFile(join(dist, probe), 'utf8')) + '\n<!-- synthetic Round 3 E upgrade -->\n'
  const fixture = await makeVariant({ from: dist, to, label: 'round3-e-local-only', extra: [{ path: probe, content }] })
  const infoPath = join(to, 'release-info.json')
  const info = JSON.parse(await readFile(infoPath, 'utf8'))
  const paths = await readdir(to, { recursive: true, withFileTypes: true })
  let totalBytes = 0
  for (const entry of paths) {
    if (!entry.isFile()) continue
    const path = join(entry.parentPath, entry.name)
    if (path !== infoPath) totalBytes += (await stat(path)).size
  }
  await writeFile(infoPath, JSON.stringify({ ...info, revision: fixture.revision, totalBytes,
    packs: Object.fromEntries(Object.entries(fixture.packs).map(([name, pack]) => [name, pack.bytes])),
    fixture: 'synthetic upgrade; not a production release',
  }, null, 2) + '\n')
  const audit = runNode('scripts/check-public-release.mjs', [], to).trim()
  return { revision: fixture.revision, coreBytes: fixture.coreBytes, probeSha256: hash(content), audit }
}
