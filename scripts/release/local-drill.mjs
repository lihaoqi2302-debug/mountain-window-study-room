import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}
const oldDir = resolve(root, arg('--old', 'test-results/round2-e/release-fixtures/old'))
const newDir = resolve(root, arg('--new', 'test-results/round2-e/release-fixtures/new'))
const work = resolve(root, arg('--work', 'test-results/round2-e/release-drill'))
const evidence = resolve(root, arg('--evidence', 'evidence/round2/e-release/windows/09-release-drill.json'))
const live = resolve(work, 'live')
const next = resolve(work, 'next')
const prev = resolve(work, 'prev')
const report = { platform: process.platform, node: process.version, realPages: false, steps: [], ok: false }

async function hashTree(directory) {
  const hash = createHash('sha256')
  const files = (await readdir(directory, { recursive: true })).sort()
  for (const name of files) {
    const file = resolve(directory, name)
    if (!(await stat(file)).isFile()) continue
    hash.update(name.replaceAll('\\', '/')).update(await readFile(file))
  }
  return hash.digest('hex')
}
async function revision(directory) {
  return JSON.parse(await readFile(resolve(directory, 'offline-manifest.json'), 'utf8')).revision
}
function audit(directory, extraEnv = {}) {
  return spawnSync(process.execPath, [resolve(root, 'scripts/check-public-release.mjs')], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PUBLIC_OUT: directory, ...extraEnv },
  })
}
async function timed(name, action) {
  const started = performance.now()
  const detail = await action()
  report.steps.push({ name, elapsedMs: Math.round(performance.now() - started), ...detail })
}
async function publish(source) {
  await rm(next, { recursive: true, force: true })
  await rm(prev, { recursive: true, force: true })
  await cp(source, next, { recursive: true })
  const checked = audit(next)
  assert.equal(checked.status, 0, checked.stderr)
  if (await stat(live).then(() => true, () => false)) await rename(live, prev)
  try { await rename(next, live) } catch (error) {
    if (await stat(prev).then(() => true, () => false)) await rename(prev, live)
    throw error
  }
  await rm(prev, { recursive: true, force: true })
}

try {
  assert.notEqual(await revision(oldDir), await revision(newDir), 'drill requires distinct old/new revisions')
  await rm(work, { recursive: true, force: true })
  await mkdir(work, { recursive: true })
  await timed('publish-old', async () => {
    await publish(oldDir)
    return { revision: await revision(live) }
  })
  await timed('publish-new-success', async () => {
    await publish(newDir)
    assert.equal(await revision(live), await revision(newDir))
    return { revision: await revision(live), sha256: await hashTree(live) }
  })
  await timed('audit-failure-preserves-live', async () => {
    const before = await hashTree(live)
    await cp(newDir, next, { recursive: true })
    await writeFile(resolve(next, 'bookstore/manuscript.pdf'), '%PDF-1.7\n')
    const rejected = audit(next)
    assert.notEqual(rejected.status, 0)
    await rm(next, { recursive: true, force: true })
    assert.equal(await hashTree(live), before)
    return { rejected: true, liveSha256: before, diagnostic: rejected.stderr.split(/\r?\n/).find((line) => line.includes('raw PDF')) ?? 'raw PDF rejected' }
  })
  await timed('size-limit-failure-preserves-live', async () => {
    const before = await hashTree(live)
    await cp(oldDir, next, { recursive: true })
    const rejected = audit(next, { PUBLIC_CORE_LIMIT: '1' })
    assert.notEqual(rejected.status, 0)
    await rm(next, { recursive: true, force: true })
    assert.equal(await hashTree(live), before)
    return { rejected: true, liveSha256: before }
  })
  await timed('rollback-old', async () => {
    await publish(oldDir)
    assert.equal(await revision(live), await revision(oldDir))
    return { revision: await revision(live), sha256: await hashTree(live) }
  })
  report.oldRevision = await revision(oldDir)
  report.newRevision = await revision(newDir)
  report.ok = true
} catch (error) {
  report.error = error.stack ?? String(error)
  process.exitCode = 1
} finally {
  report.totalElapsedMs = report.steps.reduce((sum, step) => sum + step.elapsedMs, 0)
  report.note = 'Local isolated directory timing only; Actions queue, Pages deployment and CDN propagation are excluded.'
  await mkdir(dirname(evidence), { recursive: true })
  await writeFile(evidence, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
}
