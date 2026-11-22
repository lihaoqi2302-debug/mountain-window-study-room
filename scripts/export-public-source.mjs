import assert from 'node:assert/strict'
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = resolve(root, '../cozy-bookstore')
const target = resolve(process.argv[2] ?? resolve(root, 'bookstore-source'))
assert(target !== source && target !== root, 'Export requires a separate source folder')
const { public: profile } = JSON.parse(await readFile(resolve(root, 'content.profile.json'), 'utf8'))
assert.equal(profile.edition, 'public')
assert.equal(profile.audio, 'ambience')
const count = profile.manuscript === 'complete' ? 34 : profile.trialPages
assert(Number.isInteger(count) && count >= 1 && count <= 34)
const makeParent = (file) => mkdir(dirname(resolve(target, file)), { recursive: true })
async function copy(file) {
  await makeParent(file)
  if (/\.m?js$/.test(file)) {
    const text = await readFile(resolve(source, file), 'utf8')
    await writeFile(resolve(target, file), normalizeSource(text))
  } else {
    await copyFile(resolve(source, file), resolve(target, file))
  }
}

const normalizeSource = (text) => text.replace(/[ \t]+(?=\r?\n)/g, '').trimEnd() + '\n'

const existing = await readdir(target, { recursive: true }).catch((error) => {
  if (error.code !== 'ENOENT') throw error
  return []
})
const leak = existing.filter((file) => {
  const name = file.replaceAll('\\', '/')
  if (!name.startsWith('assets/')) return false
  const page = /\/page_(\d+)\.webp$/i.exec(name)
  return /\.(mp3|m4a|wav|pdf)$/i.test(name) || page && Number(page[1]) > count
})
assert(!leak.length, 'Use a fresh public source folder when narrowing the asset profile')
await Promise.all([
  'build.mjs', 'package.json', 'package-lock.json', 'LICENSE.fonts.txt',
  'assets/cover.webp', 'assets/spine.webp',
  'assets/scenery/aurora.webp', 'assets/scenery/current-provenance.json',
  'assets/artworks/provenance.json',
  ...['forest','mountain','snow','starry-night','water-lilies'].map((key) => 'assets/display/' + key + '.webp'),
  ...Array.from({length: count}, (_, index) => 'assets/page_' + String(index + 1).padStart(2,'0') + '.webp'),
  ...(await readdir(resolve(source, 'src'))).filter((name) => name.endsWith('.js')).map((name) => 'src/' + name),
].map(copy))
const template = await readFile(resolve(source, 'index.template.html'), 'utf8')
const safe = template.replace(/<script id="default-record-data"[^>]*>[\s\S]*?<\/script>\s*<script>\s*\/\/ Keep the default record[\s\S]*?<\/script>/, '')
assert(!/default-record-data|data:audio\//.test(safe), 'Default record still present in source')
await writeFile(resolve(target, 'index.template.html'), normalizeSource(safe))
console.log('Exported full scene source with', count, 'book pages and programmatic ambience')
