import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const out = resolve(root, process.env.PUBLIC_OUT ?? 'dist-public')
const profileFile = process.env.PUBLIC_PROFILE_FILE ?? resolve(root, 'content.profile.json')
const { public: profile } = JSON.parse(await readFile(profileFile, 'utf8'))
assert.equal(profile.edition, 'public', 'Public profile must be the public edition')
assert.equal(profile.manuscript, 'trial', 'Public release must be a trial manuscript')
assert.equal(profile.audio, 'ambience', 'Public release must use generated ambience')
assert(Number.isInteger(profile.trialPages) && profile.trialPages > 0 && profile.trialPages < 34, 'Trial page count out of range')

const files = (await readdir(out, { recursive: true })).map((file) => file.replaceAll('\\', '/'))
const banned = /\.(?:mp3|m4a|wav|flac|ogg|oga|opus|aac|webm|mp4|pdf)(?:$|[?#])/i
assert(!files.some((file) => banned.test(file)), 'Recording or raw PDF in public site')
for (const file of files.filter((name) => /\.(?:html|js|mjs|json)$/i.test(name) && !/(?:^|\/)pdf-[\d.]+\//.test(name))) {
  const text = await readFile(resolve(out, file), 'utf8')
  assert(!/data:(?:audio\/|application\/pdf)|JVBERi0/.test(text), `Embedded audio or PDF in ${file}`)
}
const html = await readFile(resolve(out, 'bookstore/index.html'), 'utf8')
assert(!/default-record-data|__loadDefaultRecord\s*=|data:audio\//.test(html), 'Embedded default record in public site')
const assetLine = html.match(/window\.__ASSETS__ = (\{[^\r\n]*\});<\/script>/)
assert(assetLine, 'Published scene has no asset manifest')
const assets = JSON.parse(assetLine[1])
const count = profile.trialPages
assert.equal(assets.pages.length, count, 'Scene manifest page count differs from the trial')
const pageNames = files.filter((file) => /page_\d+-[0-9a-f]+\.webp$/.test(file))
assert.equal(pageNames.length, count, 'Published page images differ from the trial')
const numbers = pageNames.map((file) => Number(/page_(\d+)-/.exec(file)[1])).sort((a, b) => a - b)
assert.deepEqual(numbers, Array.from({ length: count }, (_, index) => index + 1), 'Pages beyond trial range')
assert.equal(assets.record, undefined, 'Default record in scene manifest')
const scene = JSON.parse(await readFile(resolve(out, 'bookstore/offline-assets.json'), 'utf8'))
assert(scene.core.includes(assets.pdf.slice(2) + 'pdf.worker.min.mjs'))
assert(scene.core.includes(assets.scenery.mountain.slice(2)))
assert(scene.scenery.length === 6 && !scene.record.length, 'Unexpected offline scene packs')
const { revision, packs } = JSON.parse(await readFile(resolve(out, 'offline-manifest.json'), 'utf8'))
assert(!packs.record || !packs.record.files, 'Record pack in public offline manifest')
const limit = Number(process.env.PUBLIC_CORE_LIMIT ?? 15_000_000)
assert(packs.core.bytes < limit, `Core offline pack ${packs.core.bytes} B exceeds ${limit} B`)
const info = JSON.parse(await readFile(resolve(out, 'release-info.json'), 'utf8'))
assert.match(info.commit, /^[a-f0-9]{40}$/, 'Missing release commit SHA')
assert.equal(info.revision, revision, 'Release revision differs from the offline manifest')
assert.deepEqual(info.packs, Object.fromEntries(Object.entries(packs).map(([name, pack]) => [name, pack.bytes])))
assert(info.source?.path && info.source.version && /^[a-f0-9]{40}$/.test(info.source.rev), 'Missing release asset provenance')
console.log('Public release checked', { pages: count, coreBytes: packs.core.bytes, sceneryBytes: packs.scenery.bytes })
