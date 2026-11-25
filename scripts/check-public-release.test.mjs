// Fault-injection tests for check-public-release.mjs. Run: npm run test:release
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { appendFile, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dist = resolve(root, 'dist-public')
const checker = resolve(root, 'scripts/check-public-release.mjs')
if (!existsSync(resolve(dist, 'offline-manifest.json'))) {
  console.error('dist-public 不存在或不完整：请先运行 npm run build:public（或 npm run prerelease）')
  process.exit(1)
}

let temp
before(async () => { temp = await mkdtemp(join(tmpdir(), 'public-release-test-')) })
after(async () => { await rm(temp, { recursive: true, force: true }) })

let n = 0
async function fixture(mutate) {
  const out = join(temp, `case-${n++}`)
  await cp(dist, out, { recursive: true })
  const env = { PUBLIC_OUT: out }
  await mutate?.(out, env)
  return env
}
const run = (env) => spawnSync(process.execPath, [checker], { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } })
async function expectFail(mutate, pattern) {
  const result = run(await fixture(mutate))
  assert.notEqual(result.status, 0, 'check should fail')
  if (pattern) assert.match(result.stderr, pattern)
}

test('对照组：原样副本通过', async () => {
  const result = run(await fixture())
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Public release checked/)
})
test('混入 page_34', () => expectFail((out) => writeFile(join(out, 'bookstore/page_34-0123abcd.webp'), 'x'), /Published page images|Pages beyond/))
test('manuscript=complete 配置', () => expectFail(async (out, env) => {
  const profile = JSON.parse(await readFile(resolve(root, 'content.profile.json'), 'utf8'))
  profile.public.manuscript = 'complete'
  env.PUBLIC_PROFILE_FILE = join(out, '..', `profile-${n}.json`)
  await writeFile(env.PUBLIC_PROFILE_FILE, JSON.stringify(profile))
}, /trial manuscript/))
test('原始 .pdf', () => expectFail((out) => writeFile(join(out, 'bookstore/manuscript.pdf'), '%PDF-1.7'), /raw PDF/))
test('HTML 内嵌 data:application/pdf', () => expectFail((out) =>
  appendFile(join(out, 'index.html'), '<a href="data:application/pdf;base64,AAAA"></a>'), /Embedded audio or PDF/))
test('.opus 唱片', () => expectFail((out) => writeFile(join(out, 'assets/record.opus'), 'x'), /Recording/))
test('default-record-data', () => expectFail((out) =>
  appendFile(join(out, 'bookstore/index.html'), '<script id="default-record-data"></script>'), /default record/))
test('核心超限 (PUBLIC_CORE_LIMIT=1)', () => expectFail((out, env) => { env.PUBLIC_CORE_LIMIT = '1' }, /exceeds/))
test('缺少发布元数据', () => expectFail((out) => rm(join(out, 'release-info.json')), /release-info\.json/))
test('发布元数据与离线版本不一致', () => expectFail(async (out) => {
  const file = join(out, 'release-info.json')
  const info = JSON.parse(await readFile(file, 'utf8'))
  info.revision += '-wrong'
  await writeFile(file, JSON.stringify(info))
}, /Release revision differs/))
