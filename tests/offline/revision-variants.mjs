// 从一份既有的 public 构建派生出可复现的 revision 变体（A→B→C），不重新构建。
//
// 依据 vite.config.ts 的 offlineBundle：
//   version = sha256(worker.js 源码文本)
//   for [name, paths] of Object.entries(groups):        // 键序 core → scenery（record 空则跳过）
//     version.update(name)
//     for file of paths.sort():                         // 默认字典序，即 UTF-16 码元序
//       content = readFile(file); version.update(file).update(content)
//   revision = digest('hex').slice(0, 16)
//
// 因此「部署了新版本」在夹具里的等价物是：往 core 包里加一个内容不同的资源，
// 用同一套算法重算 revision 并改写 sw.js / offline-manifest.json。
// A/B/C 的差别与真实发布一致：revision 变、缓存家族键变、core 字节数变，
// 而 HTML 与 entry chunk 保持不变，便于单独验证「扩展包沿用」与「旧新标签共存」。
//
// 两个必须小心的坑：
//   1. worker.js 在 Windows 工作树里是 CRLF（core.autocrlf=true），插件按原样读取后
//      直接拼在头部后面，所以 sw.js 里第三行起是 CRLF 文本。任何按 '\n' 切分再
//      join 的改写都会把 revision 打错，因此这里只用字符下标切片，绝不重建源码。
//   2. 头部两行是插件用 '\n' 拼的，与正文的 CRLF 混排，所以也不能按行规范化。
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

const REVISION_PREFIX = 'const revision = '
const PACKS_PREFIX = 'const packs = '

/**
 * 拆出 sw.js 的 revision、packs 与插件未改动的 worker 源码。
 * code 与构建时被 sha256 的文本逐字节一致（含 CRLF）。
 */
export function readBundle(source) {
  const first = source.indexOf('\n')
  const second = first < 0 ? -1 : source.indexOf('\n', first + 1)
  if (first < 0 || second < 0) throw new Error('sw.js 缺少 offlineBundle 生成的两行头部')
  const revisionLine = source.slice(0, first).replace(/\r$/, '')
  const packsLine = source.slice(first + 1, second).replace(/\r$/, '')
  if (!revisionLine.startsWith(REVISION_PREFIX)) throw new Error('sw.js 第一行不是 revision')
  if (!packsLine.startsWith(PACKS_PREFIX)) throw new Error('sw.js 第二行不是 packs')
  return {
    revision: JSON.parse(revisionLine.slice(REVISION_PREFIX.length).replace(/;$/, '')),
    packs: JSON.parse(packsLine.slice(PACKS_PREFIX.length).replace(/;$/, '')),
    code: source.slice(second + 1),
  }
}

/**
 * 按 vite.config.ts 的算法复算 revision。
 * @param {string} code worker.js 源码（必须与构建时逐字节一致）
 * @param {Record<string, { files: Array<{ path: string }> }>} packs 键序即哈希顺序
 * @param {(path: string) => Promise<Buffer>} read 读取构建根目录下的文件内容
 */
export async function computeRevision(code, packs, read) {
  const version = createHash('sha256').update(code)
  for (const name of Object.keys(packs)) {
    version.update(name)
    for (const path of packs[name].files.map((file) => file.path).sort()) {
      version.update(path).update(await read(path))
    }
  }
  return version.digest('hex').slice(0, 16)
}

/** 复制目录树，使每个变体与原始产物拥有独立文件。 */
export async function mirror(from, to) {
  const source = resolve(from)
  const target = resolve(to)
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })
  async function walk(relative) {
    for (const entry of await readdir(join(source, relative), { withFileTypes: true })) {
      const inner = relative ? join(relative, entry.name) : entry.name
      if (entry.isDirectory()) {
        await mkdir(join(target, inner), { recursive: true })
        await walk(inner)
      } else if (entry.isFile()) {
        await mkdir(dirname(join(target, inner)), { recursive: true })
        await copyFile(join(source, inner), join(target, inner))
      }
    }
  }
  await walk('')
  return target
}

/**
 * 生成一个 revision 变体。
 * @param {{ from: string, to: string, label?: string, extra?: Array<{ path: string, content: string }>, pack?: string }} options
 *   extra 里的 path 相对构建根目录；content 会真实写盘并计入所选包，从而改动 revision。
 */
export async function makeVariant({ from, to, label = '', extra = [], pack = 'core' }) {
  const target = await mirror(from, to)
  const swPath = join(target, 'sw.js')
  const bundle = readBundle(await readFile(swPath, 'utf8'))

  for (const item of extra) {
    const full = join(target, item.path)
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, item.content)
  }

  // 以磁盘实际体积为准登记，保证 bytes 与 revision 都反映真实产物。
  const paths = [...new Set([...(bundle.packs[pack]?.files ?? []).map(({ path }) => path),
    ...extra.map((item) => item.path)])].sort()
  const sizes = new Map()
  for (const path of paths) sizes.set(path, (await stat(join(target, path))).size)
  const rebuilt = {
    files: paths.map((path) => ({ path, bytes: sizes.get(path) })),
    bytes: paths.reduce((sum, path) => sum + sizes.get(path), 0),
  }

  // 键序沿用原 sw.js（core → scenery），与插件的哈希顺序一致。
  const packs = {}
  for (const name of Object.keys(bundle.packs)) packs[name] = name === pack ? rebuilt : bundle.packs[name]
  if (!packs[pack]) packs[pack] = rebuilt

  const revision = await computeRevision(bundle.code, packs, (path) => readFile(join(target, path)))
  await writeFile(swPath, `${REVISION_PREFIX}${JSON.stringify(revision)};\n${PACKS_PREFIX}${JSON.stringify(packs)};\n${bundle.code}`)

  const manifestPath = join(target, 'offline-manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8').catch(() => '{}'))
  await writeFile(manifestPath, JSON.stringify({
    ...manifest,
    revision,
    label,
    packs: Object.fromEntries(Object.entries(packs).map(([name, item]) => [name, { bytes: item.bytes, files: item.files.length }])),
  }, null, 2))

  return { dir: target, revision, coreBytes: packs.core.bytes, packBytes: packs[pack].bytes, packs }
}

/** 读一份构建的 revision 与各包体积，供证据记录使用。 */
export async function describeBuild(dir) {
  const bundle = readBundle(await readFile(join(resolve(dir), 'sw.js'), 'utf8'))
  return {
    revision: bundle.revision,
    packs: Object.fromEntries(Object.entries(bundle.packs).map(([name, item]) => [name, { bytes: item.bytes, files: item.files.length }])),
  }
}
