// Exercise the real prerelease failure path in this isolated E worktree only.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dist, hash, root, verifyFrozen } from './artifacts.mjs'

const results = join(root, 'test-results', 'round3-e')
const present = (path) => stat(path).then(() => true, (error) => {
  if (error.code === 'ENOENT') return false
  throw error
})
async function snapshot() {
  const rows = []
  for (const name of (await readdir(dist, { recursive: true })).sort()) {
    const path = join(dist, name)
    if ((await stat(path)).isFile()) rows.push([name.replaceAll('\\', '/'), hash(await readFile(path))])
  }
  return hash(JSON.stringify(rows))
}

await verifyFrozen()
assert(!(await present(dist + '.next')) && !(await present(dist + '.prev')), 'Existing staging directories: stop')
assert(!Object.keys(process.env).some((key) => /^(?:VITE_|BOOKSTORE_SOURCE$|PUBLIC_)/i.test(key)), 'Clear configuration overrides first')
await mkdir(results, { recursive: true })
const before = await snapshot()
const start = performance.now()
const child = spawnSync(process.execPath, [join(root, 'scripts', 'prerelease.mjs')], {
  cwd: root, env: { ...process.env, PUBLIC_CORE_LIMIT: '1' }, encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
})
const log = [child.stdout, child.stderr].join('\n')
const report = {
  command: 'node scripts/prerelease.mjs (PUBLIC_CORE_LIMIT=1)', exit: child.status,
  elapsedMs: Math.round(performance.now() - start), before, after: await snapshot(),
  nextExists: await present(dist + '.next'), prevExists: await present(dist + '.prev'),
  expectedDiagnostic: /Core offline pack \d+ B exceeds 1 B/.test(log),
}
report.ok = report.exit === 1 && report.expectedDiagnostic && report.before === report.after && !report.nextExists && !report.prevExists
await writeFile(join(results, 'prerelease-fault.log'), log)
await writeFile(join(results, 'prerelease-fault.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
assert(report.ok, 'The prerelease entry did not preserve the audited live tree')
