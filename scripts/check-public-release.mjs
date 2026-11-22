import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const out = resolve('dist-public')
const { public: profile } = JSON.parse(await readFile('content.profile.json', 'utf8'))
const files = await readdir(out, { recursive: true })
const banned = /\.(?:mp3|m4a|wav|flac|ogg|aac|pdf)(?:$|[?#])/i
assert(!files.some((file) => banned.test(file)), 'Recording or raw PDF in public site')
const html = await readFile(resolve(out, 'bookstore/index.html'), 'utf8')
assert(!/default-record-data|__loadDefaultRecord\s*=|data:audio\//.test(html), 'Embedded default record in public site')
const assetLine = html.match(/window\.__ASSETS__ = (\{[^\r\n]*\});<\/script>/)
assert(assetLine, 'Published scene has no asset manifest')
const assets = JSON.parse(assetLine[1])
const count = profile.manuscript === 'trial' ? profile.trialPages : assets.edition.totalPages
assert.equal(assets.pages.length, count)
const pageNames = files.filter((file) => /page_\d+-[0-9a-f]+\.webp$/.test(file))
assert.equal(pageNames.length, count)
assert.equal(assets.record, undefined)
const scene = JSON.parse(await readFile(resolve(out, 'bookstore/offline-assets.json'), 'utf8'))
assert(scene.core.includes(assets.pdf.slice(2) + 'pdf.worker.min.mjs'))
assert(scene.core.includes(assets.scenery.mountain.slice(2)))
assert(scene.scenery.length === 6 && !scene.record.length)
const { packs } = JSON.parse(await readFile(resolve(out, 'offline-manifest.json'), 'utf8'))
console.log('Public release checked', { pages: count, coreBytes: packs.core.bytes, sceneryBytes: packs.scenery.bytes })
