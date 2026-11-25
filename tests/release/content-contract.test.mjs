import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const dist = resolve(root, process.env.PUBLIC_OUT ?? 'dist-public')
const json = async (name) => JSON.parse(await readFile(resolve(dist, name), 'utf8'))

test('公开产物通过既有完整发布审计', () => {
  const result = spawnSync(process.execPath, [resolve(root, 'scripts/check-public-release.mjs')], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PUBLIC_OUT: dist },
  })
  assert.equal(result.status, 0, result.stderr)
})

test('试读仅含 1–6 页，同时声明完整 34 页目录', async () => {
  const html = await readFile(resolve(dist, 'bookstore/index.html'), 'utf8')
  const match = html.match(/window\.__ASSETS__ = (\{[^\r\n]*\});<\/script>/)
  assert(match, 'missing window.__ASSETS__')
  const assets = JSON.parse(match[1])
  assert.equal(assets.pages.length, 6)
  assert.deepEqual(assets.edition, { trial: true, totalPages: 34 })
  assert.equal(assets.record, undefined)
  const files = await readdir(resolve(dist, 'bookstore/media'))
  const pages = files.filter((name) => /^page_\d+-[0-9a-f]+\.webp$/.test(name)).sort()
  assert.equal(pages.length, 6)
  assert.deepEqual(pages.map((name) => Number(name.slice(5, 7))), [1, 2, 3, 4, 5, 6])
  assert(!pages.some((name) => Number(name.slice(5, 7)) > 6))
})

test('默认唱片从场景、离线包和文件清单过滤', async () => {
  const scene = await json('bookstore/offline-assets.json')
  const manifest = await json('offline-manifest.json')
  assert.deepEqual(scene.record, [])
  assert.equal(manifest.packs.record, undefined)
  const files = (await readdir(dist, { recursive: true })).map((name) => name.replaceAll('\\', '/'))
  assert(!files.some((name) => /(?:record|\.mp3|\.m4a|\.wav|\.flac|\.ogg|\.opus)/i.test(name)))
})

test('提交号、场景来源、SW 与离线清单 revision 可交叉定位', async () => {
  const info = await json('release-info.json')
  const manifest = await json('offline-manifest.json')
  const sw = await readFile(resolve(dist, 'sw.js'), 'utf8')
  const revision = /const revision = "([0-9a-f]+)"/.exec(sw)?.[1]
  assert.match(info.commit, /^[0-9a-f]{40}$/)
  assert.match(info.source.rev, /^[0-9a-f]{40}$/)
  assert.equal(info.source.path, 'bookstore-source')
  assert.equal(info.source.version, '1.0.0')
  assert.equal(info.revision, manifest.revision)
  assert.equal(revision, manifest.revision)
})

test('HTML 入口使用适配 Pages 子路径的相对资源地址', async () => {
  for (const name of ['index.html', 'bookstore/index.html']) {
    const html = await readFile(resolve(dist, name), 'utf8')
    for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      const url = match[1]
      if (/^(?:[a-z]+:|data:|#|\/\/)/i.test(url)) continue
      assert(!url.startsWith('/'), `${name} contains root-absolute resource ${url}`)
    }
  }
})
