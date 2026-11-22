#!/usr/bin/env node
/**
 * Build the offline bookstore. index.html keeps its artwork, music and
 * application code inline and loads Three.js from a sibling classic script.
 * node build.mjs --standalone writes a fully self-contained copy to dist/.
 */

import path from 'node:path';
import { statSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// ---------------------------------------------------------------------------
// 常量 / 路径（以 build.mjs 所在目录为项目根目录，支持从任意 cwd 调用）
// ---------------------------------------------------------------------------

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.join(ROOT, 'src');
const ASSETS_DIR = path.join(ROOT, 'assets');
const ENTRY_FILE = path.join(SRC_DIR, 'main.js');
const TEMPLATE_FILE = path.join(ROOT, 'index.template.html');
const COMPANION = process.argv.includes('--companion');
const STANDALONE = COMPANION || process.argv.includes('--standalone');
const OUTPUT_FILE = COMPANION
  ? path.resolve(process.env.BOOKSTORE_OUTPUT ?? path.join(ROOT, '../study-room-p2p/.formal/bookstore/index.html'))
  : path.join(ROOT, STANDALONE ? 'dist/index.html' : 'index.html');
const THREE_FILE = 'three.bundle.js';

const PAGE_COUNT = 34; // assets/page_01.webp … page_34.webp
const PROFILE = COMPANION && process.env.BOOKSTORE_PROFILE
  ? JSON.parse(process.env.BOOKSTORE_PROFILE)
  : { edition: 'full', scene: 'refined', manuscript: 'complete', audio: 'local-record' };
const PAGE_LIMIT = PROFILE.manuscript === 'trial' ? Number(PROFILE.trialPages) : PAGE_COUNT;
if (!Number.isInteger(PAGE_LIMIT) || PAGE_LIMIT < 1 || PAGE_LIMIT > PAGE_COUNT
  || PROFILE.scene !== 'refined' || !['trial','complete'].includes(PROFILE.manuscript)
  || !['ambience','local-record'].includes(PROFILE.audio)) throw new Error('Invalid bookstore content profile');
if (PROFILE.edition === 'public' && PROFILE.audio !== 'ambience') throw new Error('Public edition requires programmatic ambience');
const ASSETS_PLACEHOLDER = '<!--__ASSETS__-->';
const APP_PLACEHOLDER = '<!--__APP__-->';
const MIN_EXPECTED_HTML_BYTES = 1024 * 1024; // 期望产出 > 1MB

const PAGE_FILE_RE = /^page_(\d+)\.webp$/i;
const tools = process.env.BOOKSTORE_TOOLCHAIN
  ? createRequire(path.join(path.resolve(process.env.BOOKSTORE_TOOLCHAIN), 'package.json'))
  : createRequire(new URL('../study-room-p2p/package.json', import.meta.url));
const releaseDir = path.dirname(OUTPUT_FILE);
const groups = { core: [], scenery: [], record: [] };
const recordData = /<script id="default-record-data"[^>]*>([\s\S]*?)<\/script>\s*<script>\s*\/\/ Keep the default record[\s\S]*?<\/script>/;

async function emitMedia(name, buffer, group = 'core') {
  const version = createHash('sha256').update(buffer).digest('hex').slice(0, 12);
  const ext = path.extname(name);
  const relative = 'media/' + name.slice(0, -ext.length) + '-' + version + ext;
  await mkdir(path.join(releaseDir, 'media'), { recursive: true });
  await writeFile(path.join(releaseDir, relative), buffer);
  groups[group].push(relative);
  return './' + relative;
}

async function includePdfEngine() {
  const packageFile = tools.resolve('pdfjs-dist/package.json');
  const pkg = JSON.parse(await readFile(packageFile, 'utf8'));
  const base = path.dirname(packageFile);
  const folder = 'pdf-' + pkg.version;
  const nested = ['cmaps', 'standard_fonts', 'wasm', 'iccs'];
  const paths = ['legacy/build/pdf.min.mjs', 'legacy/build/pdf.worker.min.mjs', 'LICENSE'];
  for (const dir of nested) {
    for (const file of await readdir(path.join(base, dir))) {
      if (dir === 'wasm' && file.startsWith('quickjs-eval')) continue;
      paths.push(dir + '/' + file);
    }
  }
  await Promise.all(paths.map(async (file) => {
    const relative = folder + '/' + file.replace('legacy/build/', '');
    const output = path.join(releaseDir, relative);
    await mkdir(path.dirname(output), { recursive: true });
    await copyFile(path.join(base, file), output);
    groups.core.push(relative);
  }));
  return './' + folder + '/';
}

const T0 = performance.now();
const elapsedMs = () => Math.round(performance.now() - T0);

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

class BuildError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BuildError';
  }
}

/** 人类可读的字节数，例如 "1.42 MB" */
function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '未知大小';
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

/** 大小 + 精确字节数，例如 "1.42 MB (1,489,000 bytes)" */
function formatBytesExact(bytes) {
  return `${formatBytes(bytes)} (${Number(bytes).toLocaleString('en-US')} bytes)`;
}

function rel(p) {
  const relative = path.relative(ROOT, p);
  return relative && !relative.startsWith('..') ? relative : p;
}

/** 校验普通非空文件；失败时抛出带清晰路径的 BuildError */
function assertNonEmptyFile(filePath, label) {
  let st;
  try {
    st = statSync(filePath);
  } catch (err) {
    const reason = err && err.code === 'ENOENT' ? '文件不存在' : `无法访问（${err && err.code ? err.code : err && err.message}）`;
    throw new BuildError(`${label}缺失：${filePath}（${reason}）`);
  }
  if (!st.isFile()) {
    throw new BuildError(`${label}不是普通文件：${filePath}`);
  }
  if (st.size === 0) {
    throw new BuildError(`${label}是空文件（0 字节）：${filePath}`);
  }
  return st;
}

function countOccurrences(haystack, needle) {
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

/**
 * 内联 <script> 前转义 </script：
 * 若 bundle 字符串里出现 "</script>"，HTML 解析器会提前闭合脚本标签，
 * 因此替换成 "<\/script>"（JS 字符串里 \/ 等价于 /，语义不变）。
 */
function escapeInlineScript(code) {
  return code.replace(/<\/script/gi, '<\\/script');
}

/** 打印 esbuild 的结构化错误/警告，含 file:line:column 与源码行 + 脱字符 */
function printEsbuildIssues(kind, issues) {
  if (!Array.isArray(issues) || issues.length === 0) return;
  const writer = kind === '错误' ? console.error : console.warn;
  writer(`[build] esbuild ${kind}（${issues.length} 个）：`);
  for (const issue of issues) {
    const loc = issue && issue.location;
    if (loc && loc.file) {
      const line = Number.isFinite(loc.line) ? loc.line : '?';
      const column = Number.isFinite(loc.column) ? loc.column : '?';
      writer(`  ${loc.file}:${line}:${column} — ${issue.text}`);
      if (loc.lineText) {
        const indent = ' '.repeat(Math.max(0, (loc.column || 1) - 1));
        const width = Math.max(1, Math.min(loc.length || 1, 120));
        writer(`    ${loc.lineText}`);
        writer(`    ${indent}${'^'.repeat(width)}`);
      }
    } else {
      writer(`  - ${issue.text}`);
    }
    if (Array.isArray(issue.notes)) {
      for (const note of issue.notes) writer(`    注：${note.text}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 步骤 1：收集并校验资源（页面按数字页码排序，转 data URI）
// ---------------------------------------------------------------------------

async function readWebp(filePath, label) {
  let buf;
  try {
    buf = await readFile(filePath);
  } catch (err) {
    throw new BuildError(`读取${label}失败：${filePath}（${err && err.code ? err.code : err && err.message}）`);
  }
  if (buf.length === 0) {
    throw new BuildError(`${label}是空文件（0 字节）：${filePath}`);
  }
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') {
    throw new BuildError(`${label}不是有效的 WebP 文件（缺少 RIFF/WEBP 文件头）：${filePath}`);
  }
  return buf;
}

async function collectAssets() {
  let entries;
  try {
    entries = await readdir(ASSETS_DIR, { withFileTypes: true });
  } catch (err) {
    throw new BuildError(
      `无法读取资源目录：${ASSETS_DIR}（${err && err.code ? err.code : err && err.message}）\n` +
        `  请确认 assets/ 目录存在，且包含 page_01.webp … page_${PAGE_COUNT}.webp 与 cover.webp。`,
    );
  }

  const pageByNumber = new Map();
  const ambiguous = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = PAGE_FILE_RE.exec(entry.name);
    if (!match) continue;
    const pageNumber = Number.parseInt(match[1], 10);
    if (pageNumber < 1 || pageNumber > PAGE_LIMIT) continue;
    if (pageByNumber.has(pageNumber)) {
      ambiguous.push(`${pageByNumber.get(pageNumber)} / ${entry.name}`);
      continue;
    }
    pageByNumber.set(pageNumber, entry.name);
  }

  const missingPages = [];
  for (let pageNumber = 1; pageNumber <= PAGE_LIMIT; pageNumber += 1) {
    if (!pageByNumber.has(pageNumber)) {
      missingPages.push(path.join(ASSETS_DIR, `page_${String(pageNumber).padStart(2, '0')}.webp`));
    }
  }
  if (ambiguous.length > 0) {
    throw new BuildError(
      '同一个页码存在多个 WebP 资源，无法确定使用哪一个：\n' + ambiguous.map((item) => `  - ${item}`).join('\n'),
    );
  }
  if (missingPages.length > 0) {
    throw new BuildError(
      `缺少 ${missingPages.length} 个页面资源（共需 ${PAGE_LIMIT} 页）：\n` + missingPages.map((p) => `  - ${p}`).join('\n'),
    );
  }

  const pageNumbers = [...pageByNumber.keys()].sort((a, b) => a - b);
  const pageFiles = pageNumbers.map((n) => path.join(ASSETS_DIR, pageByNumber.get(n)));

  const coverPath = path.join(ASSETS_DIR, 'cover.webp');
  assertNonEmptyFile(coverPath, '封面资源 assets/cover.webp');

  // 并行读取全部 WebP
  const spinePath = path.join(ASSETS_DIR, 'spine.webp');
  assertNonEmptyFile(spinePath, '书脊资源 assets/spine.webp');

  const [pageBuffers, coverBuffer, spineBuffer] = await Promise.all([
    Promise.all(pageFiles.map((file, index) => readWebp(file, `页面资源 ${rel(file)}（第 ${pageNumbers[index]} 页）`))),
    readWebp(coverPath, '封面资源 assets/cover.webp'),
    readWebp(spinePath, '书脊资源 assets/spine.webp'),
  ]);

  const encode = (name, buffer, group) => COMPANION
    ? emitMedia(name, buffer, group) : `data:image/webp;base64,${buffer.toString('base64')}`;
  const pages = await Promise.all(pageBuffers.map((buffer, i) => encode(path.basename(pageFiles[i]), buffer)));
  const cover = await encode('cover.webp', coverBuffer);
  const spine = await encode('spine.webp', spineBuffer);

  const scenery = {};
  const sceneryMobile = {};
  const sharp = COMPANION ? tools('sharp') : null;
  for (const key of ['mountain','aurora','forest','snow']) {
    const file = path.join(ASSETS_DIR,key === 'aurora' ? 'scenery' : 'display',key+'.webp');
    const buffer = await readWebp(file,'实景全景 '+key);
    const group = key === 'mountain' ? 'core' : 'scenery';
    scenery[key] = await encode(key + '.webp', sharp
      ? await sharp(buffer).resize({ width: 4608, withoutEnlargement: true }).webp({quality:86}).toBuffer()
      : buffer, group);
    if (sharp) sceneryMobile[key] = await encode(key + '-mobile.webp',
      await sharp(buffer).resize({width:1536, withoutEnlargement:true}).webp({quality:79}).toBuffer(), group);
  }

  const artworks={};
  for(const key of ['starry-night','water-lilies']){
    const buffer=await readWebp(path.join(ASSETS_DIR,'display',key+'.webp'),'名画 '+key);
    artworks[key] = await encode(key + '.webp', sharp
      ? await sharp(buffer).resize({width:1600, withoutEnlargement:true}).webp({quality:87}).toBuffer() : buffer);
  }
  const rawBytes = pageBuffers.reduce((sum, buf) => sum + buf.length, coverBuffer.length + spineBuffer.length);
  const encodedBytes = Buffer.byteLength(JSON.stringify({ pages, cover, spine }), 'utf8');

  return { pages, cover, spine, scenery, sceneryMobile, artworks, pageFiles, pageNumbers, rawBytes, encodedBytes };
}

// ---------------------------------------------------------------------------
// 步骤 2：用 esbuild 打包 src/main.js（内存输出，不写 dist）
// ---------------------------------------------------------------------------

async function bundleThree() {
  const sourceFiles = (await readdir(SRC_DIR)).filter(name => name.endsWith('.js'));
  const sources = await Promise.all(sourceFiles.map(name => readFile(path.join(SRC_DIR, name), 'utf8')));
  const specifiers = [...new Set(sources.flatMap(source =>
    [...source.matchAll(/\bfrom ['"](three(?:\/[^'"]*)?)['"]/g)].map(match => match[1]),
  ))].sort();
  const modules = new Map(await Promise.all(specifiers.map(async (specifier, index) => {
    const name = 'module' + index;
    const exports = Object.keys(await import(specifier));
    return [specifier, {name, exports}];
  })));
  const contents = [...modules].map(([specifier, {name}]) =>
    `export * as ${name} from ${JSON.stringify(specifier)};`
  ).join('\n');
  const vendor = await build({
    stdin: {contents, resolveDir: ROOT}, bundle: true, format: 'iife', globalName: 'BookstoreThree',
    minify: true, legalComments: 'eof', target: ['chrome100'], write: false,
  });
  return {
    code: vendor.outputFiles[0].text,
    plugin: {
      name: 'bookstore-three',
      setup(builder) {
        builder.onResolve({filter:/^three(?:\/|$)/}, args => ({path:args.path, namespace:'bookstore-three'}));
        builder.onLoad({filter:/.*/, namespace:'bookstore-three'}, args => {
          const {name, exports} = modules.get(args.path);
          const contents = exports.map(symbol => `export const ${symbol} = BookstoreThree.${name}.${symbol};`).join('\n');
          return {contents};
        });
      },
    },
  };
}

async function bundleApp(vendor) {
  assertNonEmptyFile(ENTRY_FILE, '入口文件 src/main.js');

  const started = performance.now();
  let result;
  try {
    result = await build({
      entryPoints: [ENTRY_FILE],
      bundle: true,
      format: 'iife',
      minify: true,
      target: ['chrome100'],
      sourcemap: false,
      loader: { '.js': 'js' },
      define: { __STUDY_COMPANION__: JSON.stringify(COMPANION) },
      plugins: vendor ? [vendor.plugin] : [],
      write: false,
      absWorkingDir: ROOT,
      logLevel: 'silent',
    });
  } catch (err) {
    const errors = err && Array.isArray(err.errors) ? err.errors : [];
    printEsbuildIssues('错误', errors);
    printEsbuildIssues('警告', err && err.warnings);
    if (errors.length === 0) {
      console.error(`[build] esbuild 调用异常：${(err && err.stack) || err}`);
    }
    const suffix = errors.length > 0 ? `（${errors.length} 个错误，详见上方 file:line:column）` : '';
    throw new BuildError(`esbuild 打包 src/main.js 失败${suffix}`);
  }

  printEsbuildIssues('警告', result.warnings);

  const outputFiles = Array.isArray(result.outputFiles) ? result.outputFiles : [];
  const output = outputFiles.find((file) => typeof file.path === 'string' && file.path.endsWith('.js')) || outputFiles[0];
  if (!output || typeof output.text !== 'string') {
    throw new BuildError('esbuild 未返回任何 JS 输出（write:false 模式异常）');
  }
  if (output.text.length === 0) {
    throw new BuildError('esbuild 输出的 JS 为空（0 字节）');
  }

  return {
    code: output.text,
    bytes: Buffer.byteLength(output.text, 'utf8'),
    ms: Math.round(performance.now() - started),
  };
}

// ---------------------------------------------------------------------------
// 步骤 3/4：组装并写出自包含 index.html
// ---------------------------------------------------------------------------

async function loadTemplate() {
  assertNonEmptyFile(TEMPLATE_FILE, '模板 index.template.html');
  let html;
  try {
    html = await readFile(TEMPLATE_FILE, 'utf8');
  } catch (err) {
    throw new BuildError(`读取模板失败：${TEMPLATE_FILE}（${err && err.code ? err.code : err && err.message}）`);
  }

  const assetsHits = countOccurrences(html, ASSETS_PLACEHOLDER);
  const appHits = countOccurrences(html, APP_PLACEHOLDER);
  if (assetsHits === 0) {
    throw new BuildError(`index.template.html 中找不到资源占位符 ${ASSETS_PLACEHOLDER}：${TEMPLATE_FILE}`);
  }
  if (appHits === 0) {
    throw new BuildError(`index.template.html 中找不到应用占位符 ${APP_PLACEHOLDER}：${TEMPLATE_FILE}`);
  }
  if (assetsHits > 1 || appHits > 1) {
    throw new BuildError(
      `index.template.html 中占位符重复（${ASSETS_PLACEHOLDER} × ${assetsHits}，${APP_PLACEHOLDER} × ${appHits}），` +
        '每个占位符应只出现一次，否则会重复注入脚本。',
    );
  }
  if (!/<\/html>/i.test(html)) {
    throw new BuildError(`index.template.html 不完整：找不到 </html>（模板可能只写了一半）：${TEMPLATE_FILE}`);
  }
  if (html.indexOf(ASSETS_PLACEHOLDER) > html.indexOf(APP_PLACEHOLDER)) {
    console.warn(
      `[build] 警告：模板中 ${APP_PLACEHOLDER} 出现在 ${ASSETS_PLACEHOLDER} 之前，` +
        '如果 main.js 在启动时同步读取 window.__ASSETS__，运行时会拿不到素材。',
    );
  }

  return html;
}

function composeHtml(templateHtml, assets, bundle, vendor) {
  const assetsJson = JSON.stringify({
    pages: assets.pages, cover: assets.cover, spine: assets.spine, scenery: assets.scenery,
    sceneryMobile: assets.sceneryMobile, artworks: assets.artworks, pdf: assets.pdf, record: assets.record,
    edition: assets.edition,
  });
  // 注入脚本：先定义素材，再执行应用 bundle
  const assetsScript = `<script>window.__ASSETS__ = ${escapeInlineScript(assetsJson)};</script>`;
  const appScript = (vendor ? `<script src="${THREE_FILE}"></script>\n` : '') + `<script>${escapeInlineScript(bundle.code)}</script>`;

  // Browsers can fetch only the subresources selected by the companion edition.
  let html = templateHtml.split(ASSETS_PLACEHOLDER).join(assetsScript);
  html = html.split(APP_PLACEHOLDER).join(appScript);

  if (html.includes(ASSETS_PLACEHOLDER) || html.includes(APP_PLACEHOLDER)) {
    throw new BuildError('占位符替换后仍残留 <!--__ASSETS__--> 或 <!--__APP__-->，模板结构异常');
  }
  if (!html.includes('window.__ASSETS__')) {
    throw new BuildError('生成结果中缺少 window.__ASSETS__ 注入脚本');
  }
  return html;
}

async function writeOutput(html) {
  try {
    await writeFile(OUTPUT_FILE, html, 'utf8');
  } catch (err) {
    throw new BuildError(`写入 ${OUTPUT_FILE} 失败（${err && err.code ? err.code : err && err.message}）`);
  }

  // 回读校验：UTF-8 编码长度、素材变量、闭合标签、无占位符残留
  const expected = Buffer.from(html, 'utf8');
  let written;
  try {
    written = await readFile(OUTPUT_FILE);
  } catch (err) {
    throw new BuildError(`回读 ${OUTPUT_FILE} 失败（${err && err.code ? err.code : err && err.message}）`);
  }
  if (!written.equals(expected)) {
    throw new BuildError(`回读校验失败：${OUTPUT_FILE} 内容与预期不一致（写入可能被外部修改）`);
  }
  const text = written.toString('utf8');
  if (!text.includes('window.__ASSETS__')) {
    throw new BuildError(`校验失败：${OUTPUT_FILE} 中不含 window.__ASSETS__`);
  }
  if (!/<\/html>/i.test(text)) {
    throw new BuildError(`校验失败：${OUTPUT_FILE} 中不含 </html>`);
  }
  if (text.includes(ASSETS_PLACEHOLDER) || text.includes(APP_PLACEHOLDER)) {
    throw new BuildError(`校验失败：${OUTPUT_FILE} 中仍有未替换的占位符`);
  }
  return written.length;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function main() {
  console.log('[build] cozy-bookstore → ' + rel(OUTPUT_FILE));
  console.log(`[build] 项目根目录：${ROOT}`);

  // 前置条件检查（尽量一次性列出所有缺失项）
  const problems = [];
  for (const [filePath, label] of [
    [ENTRY_FILE, '入口文件 src/main.js'],
    [TEMPLATE_FILE, '模板 index.template.html'],
  ]) {
    try {
      assertNonEmptyFile(filePath, label);
    } catch (err) {
      problems.push(err.message);
    }
  }
  try {
    const st = statSync(ASSETS_DIR);
    if (!st.isDirectory()) problems.push(`资源路径不是目录：${ASSETS_DIR}`);
  } catch (err) {
    problems.push(`资源目录缺失：${ASSETS_DIR}（${err && err.code ? err.code : err && err.message}）`);
  }
  if (problems.length > 0) {
    throw new BuildError('构建前置条件不满足：\n' + problems.map((p) => `  - ${p}`).join('\n'));
  }

  // 1) 资源 → data URI
  const assets = await collectAssets();
  console.log(
    `[build] 素材：${assets.pageFiles.length} 页 + cover.webp，` +
      `资源 ${formatBytes(assets.rawBytes)}，页面引用 ${formatBytes(assets.encodedBytes)}`,
  );

  // 2) 模板
  let templateHtml = await loadTemplate();
  if (COMPANION) {
    const record = templateHtml.match(recordData);
    if (record && PROFILE.audio === 'local-record') {
      const { name, base64 } = JSON.parse(record[1]);
      assets.record = { name, url: await emitMedia('record.mp3', Buffer.from(base64, 'base64'), 'record') };
    }
    templateHtml = templateHtml.replace(recordData, '');
    if (templateHtml.includes('id="default-record-data"')) throw new BuildError('无法安全分离默认唱片');
    assets.edition = { trial: PROFILE.manuscript === 'trial', totalPages: PAGE_COUNT };
    if (assets.edition.trial) {
      templateHtml = templateHtml.replace('一场轻盈的人生模拟　·　三卷三十四页',
        '一场轻盈的人生模拟　·　前 ' + PAGE_LIMIT + ' 页试读');
    }
    assets.pdf = await includePdfEngine();
    await writeFile(path.join(releaseDir, 'offline-assets.json'), JSON.stringify(groups, null, 2));
  }
  console.log(`[build] 模板：${rel(TEMPLATE_FILE)}（${formatBytes(Buffer.byteLength(templateHtml, 'utf8'))}）`);

  // 3) esbuild 打包
  const vendor = STANDALONE ? null : await bundleThree();
  const bundle = await bundleApp(vendor);
  console.log(`[build] bundle：${formatBytesExact(bundle.bytes)}，esbuild 用时 ${bundle.ms} ms`);

  // 4) 组装 + 写出
  const html = composeHtml(templateHtml, assets, bundle, vendor);
  await mkdir(path.dirname(OUTPUT_FILE), {recursive:true});
  if (vendor) await writeFile(path.join(ROOT, THREE_FILE), vendor.code, 'utf8');
  const finalBytes = await writeOutput(html);

  // 5) 构建信息
  console.log('');
  console.log('[build] ───────────── 构建摘要 ─────────────');
  console.log('[build] 入口        : src/main.js');
  console.log(
    `[build] 页面素材    : ${assets.pageNumbers[0]}–${assets.pageNumbers[assets.pageNumbers.length - 1]} 页（${assets.pageFiles
      .map((p) => path.basename(p))
      .join(', ')}）`,
  );
  console.log('[build] 封面素材    : assets/cover.webp');
  console.log(`[build] 素材原始大小: ${formatBytesExact(assets.rawBytes)}`);
  console.log(`[build] 素材 Base64 : ${formatBytesExact(assets.encodedBytes)}`);
  console.log(`[build] bundle 大小 : ${formatBytesExact(bundle.bytes)}（esbuild ${bundle.ms} ms）`);
  console.log(`[build] 产出文件    : ${rel(OUTPUT_FILE)}`);
  console.log(`[build] 最终大小    : ${formatBytesExact(finalBytes)}`);
  console.log(`[build] 总耗时      : ${elapsedMs()} ms`);
  console.log('[build] ──────────────────────────────────');

  if (finalBytes < MIN_EXPECTED_HTML_BYTES) {
    console.warn(
      `[build] 警告：index.html 只有 ${formatBytes(finalBytes)}，低于预期的 1MB；` +
        '请确认素材与 three 是否真的被打进单文件。',
    );
  }
  console.log(`[build] ✅ 构建成功（${elapsedMs()} ms）。本地预览：node scripts/serve.mjs`);
}

main().catch((err) => {
  console.error('');
  if (err instanceof BuildError) {
    console.error(`[build] ❌ 构建失败：${err.message}`);
  } else {
    console.error('[build] ❌ 构建失败（未预期错误）：');
    console.error((err && err.stack) || String(err));
  }
  console.error('[build] index.html 未被更新。');
  process.exitCode = 1;
});
