import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { portablePath, validateScene } from '../../scripts/scene-preflight.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const script = join(root, 'scripts/scene-preflight.mjs')
const evidence = join(root, 'test-results/round3-a')
const fixtureFiles = [
  'content.profile.json', 'bookstore-source/build.mjs', 'bookstore-source/index.template.html',
  'bookstore-source/package.json', 'bookstore-source/package-lock.json', 'bookstore-source/src/main.js', 'bookstore-source/assets',
]

async function fixture(t) {
  await mkdir(evidence, { recursive: true })
  const base = await mkdtemp(join(evidence, 'scene with spaces '))
  t.after(() => rm(base, { force: true, recursive: true }))
  await Promise.all(fixtureFiles.map(async (name) => {
    const dest = join(base, name)
    await mkdir(dirname(dest), { recursive: true })
    await cp(join(root, name), dest, { recursive: true })
  }))
  return {
    base,
    source: join(base, 'bookstore-source'),
    asset: (name) => join(base, 'bookstore-source/assets', name),
    async change(name, change) {
      const file = join(base, name)
      const data = JSON.parse(await readFile(file, 'utf8'))
      change(data)
      await writeFile(file, JSON.stringify(data))
    },
  }
}

const runCheck = (...args) => spawnSync(process.execPath, [script, '--check-only', ...args], {
  cwd: evidence, encoding: 'utf8', env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'BOOKSTORE_SOURCE')),
})
const parseReport = (output) => {
  const line = output.split(/\r?\n/).findLast((item) => item.startsWith('[scene-preflight] {'))
  assert.ok(line, output)
  return JSON.parse(line.slice('[scene-preflight] '.length))
}

test('valid public scene at a native absolute path with spaces', async (t) => {
  const f = await fixture(t)
  const report = await validateScene(f.base, f.source)
  assert.deepEqual({ pages: report.trialPages, images: report.imageCount, source: report.source },
    { pages: 6, images: 14, source: 'bookstore-source' })
})

test('check-only reports actual Git HEAD and rejects a different expected commit', async () => {
  await mkdir(evidence, { recursive: true })
  const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' })
  assert.equal(git.status, 0, git.stderr)
  const commit = git.stdout.trim()
  const good = runCheck('--expect-commit', commit)
  assert.equal(good.status, 0, good.stdout)
  assert.equal(parseReport(good.stdout).commit, commit)
  const bad = runCheck('--expect-commit', '0'.repeat(40))
  assert.equal(bad.status, 1, bad.stdout)
  assert.match(parseReport(bad.stdout).error, /Git HEAD does not match/)
})

test('a different directory (even an existing local source-like directory) is not allowed', async (t) => {
  const f = await fixture(t)
  const other = join(f.base, 'bookstore-source backup')
  await mkdir(other)
  await writeFile(join(other, 'build.mjs'), '// synthetic external source')
  for (const option of [other, '../bookstore-source', 'missing directory']) {
    await assert.rejects(validateScene(f.base, option), /must be the embedded bookstore-source/)
  }
})

test('portable names reject path traversal and platform-dependent aliases', () => {
  for (const item of ['../neighbor/a.webp', 'assets/../a.webp', '/etc/file', 'C:/file', 'C:file',
    '\\file', '\\\\server\\share\\file', 'assets\\file', 'assets//file', 'assets/file.', 'AUX.webp',
    'assets/file:stream', '%2e%2e/file', 'assets/file\n', 'assets/file\0', 'assets/file.webp ']) {
    assert.throws(() => portablePath(root, item), /invalid portable scene path/, JSON.stringify(item))
  }
  assert.equal(portablePath(root, 'assets with spaces/a.webp'), join(root, 'assets with spaces', 'a.webp'))
})

test('missing, empty, or wrong-type source nodes show the failed path', async (t) => {
  const f = await fixture(t)
  const cover = f.asset('cover.webp')
  const contents = await readFile(cover)
  await rm(cover)
  await assert.rejects(validateScene(f.base), /cannot access .*cover\.webp \(ENOENT\)/)
  await writeFile(cover, '')
  await assert.rejects(validateScene(f.base), /not a non-empty regular file: .*cover\.webp/)
  await writeFile(cover, contents)
  await writeFile(f.asset('spine.webp'), 'not an image')
  await assert.rejects(validateScene(f.base), /invalid WebP header: .*spine\.webp/)
  const assets = f.asset('')
  await rename(assets, `${assets}-backup`)
  await writeFile(assets, 'not a directory')
  await assert.rejects(validateScene(f.base), /not a directory: .*assets/)
})

test('linked scene directory is rejected before accessing files at its destination', async (t) => {
  const f = await fixture(t)
  const assets = f.asset('')
  // Both sides are disposable; the destination is outside the embedded source.
  const outside = join(f.base, 'outside scene')
  await rename(assets, outside)
  await symlink(outside, assets, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(validateScene(f.base), /linked\/redirected path: .*assets/)
})

test('malformed public profile and attempts to expose complete/local content fail', async (t) => {
  const f = await fixture(t)
  const name = 'content.profile.json'
  const original = await readFile(join(f.base, name))
  for (const [field, value] of [['manuscript', 'complete'], ['trialPages', 7], ['trialPages', '6'], ['audio', 'local-record'], ['scene', '../outside'], ['path', '../outside']]) {
    await writeFile(join(f.base, name), original)
    await f.change(name, (data) => { data.public[field] = value })
    await assert.rejects(validateScene(f.base), /invalid public scene profile/)
  }
  await writeFile(join(f.base, name), '{')
  await assert.rejects(validateScene(f.base), /cannot read JSON .*content\.profile\.json \(invalid JSON\)/)
})

test('provenance rejects invalid hashes, unsafe entry IDs, duplicates, and non-HTTPS metadata', async (t) => {
  const f = await fixture(t)
  const name = 'bookstore-source/assets/scenery/current-provenance.json'
  const original = await readFile(join(f.base, name))
  for (const [change, pattern] of [
    [(d) => { d[0].embedded_sha256 = 'bad' }, /invalid scenery provenance/],
    [(d) => { d[0].mode = '../private' }, /unknown or duplicate provenance ID/],
    [(d) => { d[1].mode = d[0].mode }, /unknown or duplicate provenance ID/],
    [(d) => { d[0].source = 'file:///example' }, /invalid provenance source URL/],
    [(d) => { d[0].source = 'https://example.invalid\\broken' }, /invalid provenance source URL/],
    [(d) => { d[0].path = 'C:/private' }, /unknown or duplicate provenance ID/],
  ]) {
    await writeFile(join(f.base, name), original)
    await f.change(name, change)
    await assert.rejects(validateScene(f.base), pattern)
  }
})

test('stray manuscript, recording, unapproved page, and alternate page alias fail inventory', async (t) => {
  const f = await fixture(t)
  for (const file of ['extra.pdf', 'record.opus', 'page_07.webp', 'page_7.webp', 'page_1.webp', 'display/backup.webp']) {
    await writeFile(f.asset(file), 'synthetic fixture')
    await assert.rejects(validateScene(f.base), /unexpected source asset/)
    await rm(f.asset(file))
  }
})

// Opt-in local drill: requires an audited build in this worktree and installed
// Playwright Chromium. It listens only on 127.0.0.1:5611 and never swaps output.
// The preload parks only Vite at startup. The test kills exactly that child;
// prerelease must observe the interruption and retain the old active artifact.
test('old public artifact remains browseable after preflight failure and build interruption', {
  skip: process.env.SCENE_PREFLIGHT_DRILL !== '1', timeout: 180_000,
}, async (t) => {
  const { createServer } = await import('node:http')
  const { chromium } = await import('@playwright/test')
  const dist = join(root, 'dist-public')
  const port = 5611
  const origin = `http://127.0.0.1:${port}`
  const before = JSON.parse(await readFile(join(dist, 'release-info.json'), 'utf8'))
  const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
  async function treeDigest() {
    const hash = createHash('sha256')
    for (const path of (await readdir(dist, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name)).sort()) {
      hash.update(JSON.stringify(path.slice(dist.length))).update(digest(await readFile(path)))
    }
    return hash.digest('hex')
  }
  const originalHash = await treeDigest()
  const types = { html: 'text/html; charset=utf-8', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json', webp: 'image/webp' }
  const server = createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, origin)
      const path = pathname.slice(1) + (pathname.endsWith('/') ? 'index.html' : '')
      const file = portablePath(dist, path)
      const bytes = await readFile(file)
      res.writeHead(200, { 'content-type': types[path.split('.').at(-1)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
      res.end(bytes)
    } catch { res.writeHead(404).end() }
  })
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', accept) })
  t.after(() => new Promise((accept) => server.close(accept)))
  const browser = await chromium.launch()
  t.after(() => browser.close())
  const checks = {}
  async function browse(stage) {
    // Each phase opens a fresh context and reads through the active local server.
    const context = await browser.newContext({ serviceWorkers: 'block' })
    await context.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
    try {
      const page = await context.newPage()
      assert.equal((await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' })).status(), 200)
      const frame = page.locator('iframe[title="山窗书屋正式场景"]')
      await frame.waitFor({ state: 'attached', timeout: 30_000 })
      assert.equal((await page.goto(`${origin}/bookstore/`, { waitUntil: 'domcontentloaded' })).status(), 200)
      await page.waitForFunction(() => document.querySelectorAll('#tocPanel .toc-item').length === 34, undefined, { timeout: 30_000 })
      const scene = await page.evaluate(async () => {
        const { pages, scenery } = window.__ASSETS__
        const response = await fetch(scenery.mountain)
        return { trial: pages.length, catalog: document.querySelectorAll('#tocPanel .toc-item').length,
          status: response.status, mountainBytes: (await response.arrayBuffer()).byteLength }
      })
      assert.equal(scene.trial, 6)
      assert.equal(scene.status, 200)
      assert.ok(scene.mountainBytes > 0)
      const revision = await (await context.request.get(`${origin}/offline-manifest.json`)).json()
      assert.equal(revision.revision, before.revision)
      const contentHash = await treeDigest()
      assert.equal(contentHash, originalHash)
      checks[stage] = { ...scene, revision: revision.revision, contentHash }
    } finally { await context.close() }
  }
  await browse('before')

  const bad = spawnSync(process.execPath, [script, '--source', 'test-results/round3-a/not-embedded'], { cwd: root, encoding: 'utf8', timeout: 30_000 })
  const rejected = parseReport(bad.stdout)
  assert.equal(bad.status, 1, bad.stderr)
  assert.match(rejected.error, /must be the embedded/)
  assert.deepEqual(rejected.steps.map(({ name }) => name), ['git', 'source-validation'])
  await writeFile(join(evidence, 'drill-preflight-rejected.log'), bad.stdout + bad.stderr)
  await browse('afterPreflightRejection')

  const sandbox = await mkdtemp(join(evidence, 'interrupt kit '))
  t.after(() => rm(sandbox, { force: true, recursive: true }))
  const marker = '[round3-a drill] early Vite child '
  const vite = pathToFileURL(join(root, 'node_modules/vite/bin/vite.js')).href
  const preload = join(sandbox, 'interrupt.mjs')
  await writeFile(preload, `import { pathToFileURL } from 'node:url';\n` +
    `if (process.argv[1] && pathToFileURL(process.argv[1]).href === ${JSON.stringify(vite)} && process.argv.includes('build')) {\n` +
    `  console.log(${JSON.stringify(marker)} + process.pid); await new Promise(resolve => setTimeout(resolve, 60000)); process.exit(73);\n}\n`)
  const child = spawn(process.execPath, [script], { cwd: root, env: { ...process.env,
    BOOKSTORE_SOURCE: 'bookstore-source', NODE_OPTIONS: `--import=${pathToFileURL(preload).href}` } })
  let output = ''
  let stderr = ''
  let killed = false
  child.stdout.setEncoding('utf8').on('data', (chunk) => {
    output += chunk
    const line = output.split(/\r?\n/).find((item) => item.startsWith(marker))
    if (killed || !line || !output.includes(`${line}\n`) && !output.includes(`${line}\r\n`)) return
    const pid = Number(line.slice(marker.length))
    if (Number.isSafeInteger(pid) && pid > 0) { process.kill(pid, 'SIGTERM'); killed = true }
  })
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
  const code = await new Promise((accept, reject) => { child.once('error', reject); child.once('close', accept) })
  await writeFile(join(evidence, 'drill-interrupted.log'), output + stderr)
  assert.equal(killed, true, output + stderr)
  assert.equal(code, 1, output + stderr)
  assert.match(stderr, /dist-public 保持不变/)
  const interrupted = parseReport(output)
  assert.equal(interrupted.steps.at(-1).name, 'prerelease')
  assert.equal(interrupted.steps.at(-1).ok, false)
  assert.equal((await readdir(root)).includes('dist-public.next'), false)
  await browse('afterBuildInterruption')
  const report = { ok: true, port, node: process.version, platform: process.platform, browser: browser.version(),
    commit: before.commit, revision: before.revision, interrupt: 'Vite child terminated at startup, before swap', checks }
  await writeFile(join(evidence, 'old-artifact-drill.json'), JSON.stringify(report, null, 2) + '\n')
})
