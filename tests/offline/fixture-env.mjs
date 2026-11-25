// C 包（离线与 PDF 闭环）夹具的端口与路径口径。
//
// 端口固定加 400 偏移，避开既有套件：
//   preview:public 5197 → C 用 5597
//   preview:formal 5196
//   tests/online 5181 / 5182 / 7447 / 3478
// 若同机还要并行别的套件，用 STUDY_TEST_PORT_EXTRA 再叠加，默认 0。
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const extra = Number(process.env.STUDY_TEST_PORT_EXTRA ?? '0')
if (!Number.isInteger(extra) || extra < 0 || extra > 50_000) {
  throw new Error('STUDY_TEST_PORT_EXTRA must be an integer from 0 to 50000')
}

// 下面所有路径都相对仓库根目录，而不是「调用时的当前目录」：
// playwright 允许从任意 cwd 用 -c 指定配置，靠 cwd 解析会让证据落到意料之外的位置。
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** 固定 400 偏移，再叠加可选额外偏移。 */
export const PORT_OFFSET = 400 + extra
export const previewPort = 5197 + PORT_OFFSET
export const baseURL = `http://127.0.0.1:${previewPort}/`
export const fixtureURL = (path) => new URL(path, baseURL).href

/** 被验收的生产构建（public profile）与派生的 revision 快照。 */
export const distDir = 'dist-public'
/** test-results/ 已在 .gitignore 内，快照放这里不必改根配置。 */
export const revisionsDir = 'test-results/round2-c/revisions'
export const resultsDir = 'test-results/round2-c'
export const evidenceDir = 'evidence/round2/c-offline'

/** 仓库内的相对路径 → 绝对路径。 */
export const fromRoot = (path) => resolve(repoRoot, path)

/** 自制中文横竖混排夹具（见 make-pdf-fixture.py，随仓库分发）。 */
export const pdfFixture = 'tests/offline/fixtures/cn-mixed-6p.pdf'

/** VISION 里的质量地板：首次离线包公网版核心不超过 15 MB。 */
export const CORE_LIMIT = 15_000_000

/** 真实 CDN 主机，用于断言离线期间零外域请求。 */
export const cdnHosts = ['cdn.jsdelivr.net', 'unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'reactjs.org', 'docs.pmnd.rs']

export const isCDN = (url) => {
  try {
    return cdnHosts.includes(new URL(url).hostname)
  } catch {
    return false
  }
}
