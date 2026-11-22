/**
 * pdfimport.js —— 用户自带 PDF 导入器
 * ============================================================================
 *
 * 目标：应用是「双击 index.html 从 file:// 打开」的单文件 WebGL 应用（esbuild 只
 * 在构建期存在，运行时没有打包器、没有本地服务器）。因此 PDF 引擎不能被打进
 * bundle，只能在运行时从 CDN 以 ES module 动态 import 进来。
 *
 * 本模块的三条铁律：
 *   1) import 期绝对零副作用：不碰 DOM、没有 top-level await、不发起网络请求；
 *      未调用 createPdfImporter() 时完全不活动（可被 tree-shake 掉）。
 *   2) 页码按需光栅化：A4 页面在 scale=3.2 时约 2380x3370 px ≈ 32 MB RGBA，
 *      所以绝不一次性渲染全部页面（见下方「内存策略」）。
 *   3) 任何 worker / 网络 / 加密问题都只降级、不炸掉导入流程。
 *
 * 内存策略：
 *   - 载入时只立刻渲染前 2 页（EAGER_PAGES），其余页留作懒惰渲染；
 *   - renderPage(i) 按需渲染，结果进 LRU（最多 10 张画布）；被淘汰的画布同时从
 *     pages 条目上摘掉（pages[i].canvas 置为 null），否则 pages 数组会一直持有
 *     强引用、LRU 形同虚设；
 *   - 缩略图单独用低倍率渲染，体积很小，单独 LRU（最多 48 张）。
 *
 * CDN / worker 策略见 loadEngine() 与 setupWorker() 的注释。
 *
 * @module pdfimport
 */

/* -------------------------------------------------------------------------- */
/*  常量                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * PDF 引擎候选源，按顺序尝试。
 * - kind='esm'：pdfjs-dist 4.x 的官方 ES module 构建（推荐，直接 `import()` 即可）
 * - kind='umd'：pdfjs-dist 3.11 的 UMD 构建（作为最后兜底；`import()` 执行后它把
 *   API 挂在 globalThis.pdfjsLib 上）
 * 版本号已用 HEAD 请求实测存在（2026-11 校验）。
 * @type {ReadonlyArray<{url: string, kind: 'esm'|'umd'}>}
 */
const PDFJS_SOURCES = Object.freeze([
  { url: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.min.mjs', kind: 'esm' },
  { url: 'https://unpkg.com/pdfjs-dist@4.8.69/build/pdf.min.mjs', kind: 'esm' },
  { url: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js', kind: 'umd' },
]);

/** 默认超采样倍率：A4 (595x842 pt) * 3.2 ≈ 1904x2694… 实际含 viewBox 约 2380x3370。 */
export const DEFAULT_RENDER_SCALE = 3.2;

/** 允许的倍率范围，防止误传 100 倍把显存/内存打爆。 */
const MIN_SCALE = 0.25;
const MAX_SCALE = 8;

/** 内存中最多保留的整页画布数量（LRU）。 */
const MAX_CACHED_PAGES = 10;

/** 载入后立刻渲染的页数；其余按需渲染。 */
const EAGER_PAGES = 2;

/** 缩略图 LRU 容量与默认宽度（px）。 */
const MAX_CACHED_THUMBS = 48;
const DEFAULT_THUMB_WIDTH = 220;

/** 拖放高亮时临时加在容器上的 class（若元素支持 classList）。 */
const DROP_ACTIVE_CLASS = 'pdf-drop-active';

/** 中文提示语集中管理。 */
const MSG = {
  engineFail: 'PDF 引擎加载失败：请检查网络后重试（需要访问 cdn.jsdelivr.net）',
  noDialog: '当前环境无法打开文件选择框（缺少 document）。',
  notPdf: '只能导入 PDF 文件（.pdf），请重新选择。',
  emptyDrop: '没有检测到文件，请拖入一个 .pdf 文件。',
  encrypted: '该 PDF 已加密，请先解除密码保护',
  corrupt: '这个 PDF 无法解析，可能已损坏。',
  emptyDoc: '这个 PDF 里没有可渲染的页面。',
  notLoaded: '尚未载入 PDF，请先调用 handleFiles / loadFromArrayBuffer。',
  badIndex: '页码超出范围。',
  disposed: '导入器已释放（dispose），请重新创建。',
  workerFail: 'PDF worker 启动失败，已退回主线程渲染（会慢一些）。',
};

/* -------------------------------------------------------------------------- */
/*  模块级引擎缓存                                                             */
/* -------------------------------------------------------------------------- */

/**
 * 已解析的引擎（pdf.js 库 + worker 状态 + 资源 URL）。进程内只解析一次，
 * 多个 importer 实例共享同一个库对象。
 * @type {Promise<EngineHandle> | null}
 */
let enginePromise = null;

/**
 * @typedef {Object} EngineHandle
 * @property {any} lib                     pdf.js 库命名空间（含 getDocument / GlobalWorkerOptions）
 * @property {string} url                  实际生效的 CDN 模块地址
 * @property {'esm'|'umd'} kind            构建类型
 * @property {string} cMapUrl              CJK 等 CID 字体的 cMap 目录（末尾带 /）
 * @property {string} standardFontDataUrl  标准字体目录（末尾带 /）
 * @property {string} workerUrl            worker 脚本 CDN 地址
 * @property {string|null} workerBlobUrl   worker 脚本的 blob: URL（取不到则为 null）
 * @property {string} moduleUrl            模块地址（用于推导 worker 地址）
 */

/**
 * worker 源码的 blob: URL 缓存（CDN 地址 -> blob: URL）。
 *
 * 为什么要缓存：worker 脚本约 1.4MB，每次导入都重新 fetch 太浪费；
 * 而 blob: URL 可以被多个 Worker 实例复用（revokeObjectURL 也不会杀死已创建的
 * Worker），所以「一个 URL、每份文档各建一个 Worker」是既省流量又安全的做法。
 * @type {Map<string, Promise<string|null>>}
 */
const workerBlobCache = new Map();

/**
 * 取引擎；失败时清空缓存，允许下一次重试（例如用户恢复网络后再次导入）。
 * @returns {Promise<EngineHandle>}
 */
function getEngine() {
  if (!enginePromise) {
    enginePromise = loadEngine().catch((err) => {
      enginePromise = null;
      throw err;
    });
  }
  return enginePromise;
}

/**
 * 依次尝试 PDFJS_SOURCES，成功即返回。
 *
 * 注意：这里刻意用「变量」而非字面量做 `import()` 的参数。
 * esbuild 打包时看到字面量动态 import 会尝试在构建期解析该 URL 并报错
 * （`Could not resolve "https://..."`）。传变量则原样保留为运行时 import，
 * 这正是 file:// 场景下我们想要的：bundle 里只留一行 `import(url)`。
 *
 * @returns {Promise<EngineHandle>}
 */
async function loadEngine() {
  const local = window.__ASSETS__?.pdf;
  if (__STUDY_COMPANION__) {
    if (!local) throw new Error('本地 PDF 引擎缺失。可联网重新保存离线版后重试。');
    const base = new URL(local, document.baseURI);
    const asset = (name) => new URL(name, base).href;
    try {
      const lib = await import(/* @vite-ignore */ asset('pdf.min.mjs'));
      return {
        lib, workerUrl: asset('pdf.worker.min.mjs'),
        cMapUrl: asset('cmaps/'), standardFontDataUrl: asset('standard_fonts/'),
        wasmUrl: asset('wasm/'), iccUrl: asset('iccs/'),
      };
    } catch (issue) {
      const error = new Error('本地 PDF 引擎未加载。可联网重新保存离线版后重试。');
      error.cause = issue;
      throw error;
    }
  }
  const failures = [];

  for (const source of PDFJS_SOURCES) {
    try {
      const moduleUrl = source.url; // 变量化，避免 esbuild 静态解析（见上）
      const mod = await import(/* webpackIgnore: true */ /* @vite-ignore */ moduleUrl);
      const lib = pickLib(mod, source.kind);
      if (!lib || typeof lib.getDocument !== 'function') {
        throw new Error('模块已载入但缺少 getDocument 导出');
      }

      // CDN 包根目录：.../build/pdf.min.mjs -> .../
      const packageBase = moduleUrl.replace(/\/build\/[^/]+$/, '/');
      const workerUrl = workerUrlFor(moduleUrl);
      // 预取 worker 源码（失败不致命，attachWorker 会自动降级到 workerSrc / 主线程）
      const workerBlobUrl = await getWorkerBlobUrl(workerUrl);

      return {
        lib,
        url: moduleUrl,
        moduleUrl,
        kind: source.kind,
        // CID 字体（中文/日文 PDF 常见）需要 cMap，否则文字会缺字或乱码。
        // 这两个目录在 jsdelivr / unpkg 上均带 `Access-Control-Allow-Origin: *`，
        // 因此 file:// (origin=null) 也能 fetch 到。
        cMapUrl: packageBase + 'cmaps/',
        standardFontDataUrl: packageBase + 'standard_fonts/',
        workerUrl,
        workerBlobUrl,
      };
    } catch (err) {
      failures.push(`${source.url} → ${err && err.message ? err.message : err}`);
      // 继续尝试下一个源
    }
  }

  const err = new Error(MSG.engineFail);
  err.cause = failures.join(' | ');
  throw err;
}

/**
 * 从动态 import 的命名空间里取出 pdf.js 库对象。
 * - ESM 构建：命名空间本身就是库（有 getDocument），少数情况挂在 default 上；
 * - UMD 构建：脚本执行时把库挂到 globalThis.pdfjsLib（也可能命中 default）。
 * @param {any} mod
 * @param {'esm'|'umd'} kind
 * @returns {any} 库对象或 null
 */
function pickLib(mod, kind) {
  if (!mod) return null;
  if (typeof mod.getDocument === 'function') return mod;
  if (mod.default && typeof mod.default.getDocument === 'function') return mod.default;
  if (kind === 'umd') {
    const g = globalThis.pdfjsLib;
    if (g && typeof g.getDocument === 'function') return g;
  }
  return null;
}

/**
 * 由模块地址推出 worker 地址：
 *   .../build/pdf.min.mjs        -> .../build/pdf.worker.min.mjs
 *   .../build/pdf.min.js         -> .../build/pdf.worker.min.js
 * @param {string} moduleUrl
 * @returns {string}
 */
function workerUrlFor(moduleUrl) {
  return moduleUrl.replace(/pdf\.min\.(m?js)$/i, 'pdf.worker.min.$1');
}

/**
 * 取 worker 脚本的 blob: URL（带缓存，永不抛出）。
 *
 * 为什么必须走 Blob：
 *   页面来自 file://（origin 为 null），浏览器不允许 `new Worker('https://…')`
 *   —— 跨源脚本无法直接构造 worker。于是改成：fetch 到 worker 源码文本 →
 *   包成 Blob（type: 'text/javascript'）→ createObjectURL → 用 blob: URL 建 worker
 *   （blob: 与页面同源，合法）。
 *
 * @param {string} workerUrl CDN 上的 worker 脚本地址
 * @returns {Promise<string|null>} blob: URL；失败返回 null
 */
function getWorkerBlobUrl(workerUrl) {
  if (workerBlobCache.has(workerUrl)) return workerBlobCache.get(workerUrl);

  const pending = (async () => {
    try {
      const res = await fetch(workerUrl, { mode: 'cors', credentials: 'omit' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const code = await res.text();
      // worker 脚本有 1MB+；明显过小说明拿到的是错误页/重定向页
      if (!code || code.length < 1024) throw new Error('worker 脚本内容异常');
      return URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    } catch (_err) {
      return null; // 交由 attachWorker 降级
    }
  })();

  workerBlobCache.set(workerUrl, pending);
  return pending;
}

/**
 * 为「一份新文档」绑定 worker。永不抛出，三级降级：
 *   1) blob worker（最好；4.x 用 type:'module'，3.11 用 classic）
 *   2) 直接设 `GlobalWorkerOptions.workerSrc = <cdn url>`（个别环境允许跨源 worker）
 *   3) 什么都不设 → pdf.js 退回主线程「假 worker」，只是慢，功能不减
 *
 * 注意：每个文档都要新建 Worker 实例。因为 pdf.js 在 PDFDocumentProxy.destroy()
 * 时会顺手 terminate 掉通过 workerPort 传进去的 worker；如果整个会话复用同一个
 * Worker，第二次导入就会拿到一个已终止的端口而卡死。blob: URL 本身可以复用，
 * 重建 Worker 实例很便宜（源码不再走网络）。
 *
 * @param {EngineHandle} engine
 * @returns {Promise<{mode:'blob'|'src'|'none', worker?: Worker, blobUrl?: string}>}
 */
async function attachWorker(engine) {
  const workerUrl = engine.workerUrl;
  const options = ensureWorkerOptions(engine.lib);

  // 【实测结论 · file:// 场景】blob module worker 会永久挂起：模块 worker 无法在
  // file:// 页面里启动，pdf.js 的 getDocument 会一直等待永不回来的消息。
  // 因此这里【优先】走 workerSrc 路径：pdf.js 会自己尝试 new Worker(cdnUrl)，
  // 跨源被拒后自动退回主线程「假 worker」，1–2 秒内即可正常解析。
  try {
    options.workerPort = null;
    options.workerSrc = workerUrl;
    return { mode: 'src' };
  } catch (_err) {
    // 继续降级
  }

  // ---- 方案 3：没有 worker（主线程渲染）-----------------------------------
  return { mode: 'none' };
}

/**
 * 拿到（必要时创建）GlobalWorkerOptions 容器。
 * @param {any} lib
 * @returns {any}
 */
function ensureWorkerOptions(lib) {
  if (!lib.GlobalWorkerOptions || typeof lib.GlobalWorkerOptions !== 'object') {
    lib.GlobalWorkerOptions = {};
  }
  return lib.GlobalWorkerOptions;
}

/* -------------------------------------------------------------------------- */
/*  小工具                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * 判断前几个字节是否是 PDF 魔数（`%PDF`，即 0x25 0x50 0x44 0x46）。
 * @param {Uint8Array} head
 * @returns {boolean}
 */
function isPdfMagic(head) {
  return (
    !!head &&
    head.length >= 4 &&
    head[0] === 0x25 && // %
    head[1] === 0x50 && // P
    head[2] === 0x44 && // D
    head[3] === 0x46 //   F
  );
}

/**
 * 把任意 BufferSource 复制成独立的 Uint8Array。
 *
 * 为什么要复制？pdf.js 的 getDocument({data}) 会把 this buffer **转移**给 worker
 * （transfer），转移后调用方手里的 ArrayBuffer 会变成 detached，之后再读就是 0 字节。
 * 我们复制一份交出去，调用方的 buffer 保持可用。
 *
 * @param {ArrayBuffer|Uint8Array|ArrayBufferView} buf
 * @returns {Uint8Array}
 */
function copyBytes(buf) {
  if (!buf) return new Uint8Array(0);
  if (buf instanceof Uint8Array) {
    const out = new Uint8Array(buf.byteLength);
    out.set(buf);
    return out;
  }
  if (ArrayBuffer.isView(buf)) {
    const view = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const out = new Uint8Array(view.byteLength);
    out.set(view);
    return out;
  }
  // ArrayBuffer
  const out = new Uint8Array(buf.byteLength);
  out.set(new Uint8Array(buf));
  return out;
}

/**
 * 把底层异常翻译成面向用户的中文 Error。
 * @param {any} err
 * @returns {Error}
 */
function toUserError(err) {
  if (err instanceof Error && err.__userFacing) return err;
  const name = (err && err.name) || '';
  let message = (err && err.message) || String(err || '');

  if (name === 'PasswordException' || /password/i.test(message)) {
    message = MSG.encrypted;
  } else if (name === 'InvalidPDFException' || /invalid pdf structure/i.test(message)) {
    message = MSG.corrupt;
  } else if (/engine/i.test(message) && !message) {
    message = MSG.engineFail;
  } else if (!message) {
    message = MSG.corrupt;
  }

  const out = new Error(message);
  out.name = 'PdfImportError';
  out.__userFacing = true;
  out.cause = err;
  return out;
}

/**
 * 构造一条「已经是对用户友好的中文」的错误（不会被 toUserError 二次包装）。
 * @param {string} message
 * @returns {Error}
 */
function userError(message) {
  const err = new Error(message);
  err.name = 'PdfImportError';
  err.__userFacing = true;
  return err;
}

/**
 * 倍率钳制。
 * @param {number} scale
 * @returns {number}
 */
function clampScale(scale) {
  const n = typeof scale === 'number' && isFinite(scale) ? scale : DEFAULT_RENDER_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, n));
}

/* -------------------------------------------------------------------------- */
/*  工厂                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 创建一个 PDF 导入器实例。
 *
 * 实例内部维护：pdf.js 文档、页面画布 LRU、缩略图 LRU、渲染串行队列。
 * 同一时间只持有一个文档；再次导入会自动释放上一个。
 *
 * @param {Object} [options]
 * @param {(percent: number, label: string) => void} [options.onProgress]
 *        进度回调。percent 为 0~100 的整数，label 是中文状态描述。
 * @param {(error: Error) => void} [options.onError]
 *        失败回调。收到的一定是中文 Error；handleFiles 等仍会 resolve 为 null。
 * @returns {{
 *   openDialog: () => void,
 *   handleFiles: (files: FileList|File[]) => Promise<{count:number,pages:Array<{index:number,canvas:HTMLCanvasElement|null,width:number,height:number,ready:boolean}>,labels:string[]}|null>,
 *   attachDropZone: (el: HTMLElement) => () => void,
 *   loadFromArrayBuffer: (buf: ArrayBuffer|Uint8Array, name?: string) => Promise<{count:number,pages:Array<{index:number,canvas:HTMLCanvasElement|null,width:number,height:number,ready:boolean}>,labels:string[]}|null>,
 *   renderPage: (index: number, scale?: number) => Promise<HTMLCanvasElement>,
 *   getThumbnail: (index: number, width?: number) => Promise<HTMLCanvasElement>,
 *   getPageCount: () => number,
 *   getAspect: () => number,
 *   dispose: () => void,
 *   readonly name: string
 * }}
 */
export function createPdfImporter({ onProgress, onError } = {}) {
  /** 进度回调（安全调用）。 */
  const report = (percent, label) => {
    if (typeof onProgress !== 'function') return;
    try {
      onProgress(Math.max(0, Math.min(100, Math.round(percent))), String(label || ''));
    } catch (_e) {
      /* 回调里的异常不能影响导入流程 */
    }
  };

  /** 失败回调（安全调用）。 */
  const fail = (err) => {
    const userFacing = toUserError(err);
    if (typeof onError === 'function') {
      try {
        onError(userFacing);
      } catch (_e) {
        /* 忽略 */
      }
    }
    return userFacing;
  };

  /** 内部状态。所有字段都只在函数里初始化，保证 import 期零活动。 */
  const state = {
    /** @type {any} pdf.js PDFDocumentProxy */
    doc: null,
    pageCount: 0,
    /** 第 0 页的 width/height（scale=1 的 viewport） */
    aspect: 0,
    baseWidth: 0,
    baseHeight: 0,
    name: '',
    /** 结果数组（live view，渲染完成时原地填充） */
    /** @type {Array<{index:number, canvas:HTMLCanvasElement|null, width:number, height:number, ready:boolean}>} */
    pages: [],
    /** @type {string[]} */
    labels: [],
    /** 整页画布 LRU：index -> {canvas, scale} */
    /** @type {Map<number, {canvas: HTMLCanvasElement, scale: number}>} */
    cache: new Map(),
    /** 缩略图 LRU：`${index}@${width}` -> canvas */
    /** @type {Map<string, HTMLCanvasElement>} */
    thumbs: new Map(),
    /** 渲染串行链：pdf.js 同一文档并发渲染容易抢 canvas，串起来更稳 */
    /** @type {Promise<any>} */
    renderChain: Promise.resolve(),
    /** 每次载入新文档 +1；旧任务回来后用它判断是否该丢弃结果 */
    generation: 0,
    /** worker 句柄（来自引擎，仅用于 dispose 时清理） */
    /** @type {{mode:string, worker?:Worker, blobUrl?:string}|null} */
    worker: null,
    /** 引擎句柄，供资源 URL 使用 */
    /** @type {EngineHandle|null} */
    engine: null,
    disposed: false,
    /** 记录 openDialog 创建但尚未回收的 input，dispose 时兜底移除 */
    /** @type {Set<HTMLInputElement>} */
    pendingInputs: new Set(),
  };

  /* ---------------------------- 渲染基础设施 ---------------------------- */

  /**
   * 串行执行渲染任务。
   * @template T
   * @param {() => Promise<T>} task
   * @returns {Promise<T>}
   */
  function enqueue(task) {
    const run = state.renderChain.then(() => task());
    // 链条本身不能因为某次失败而断掉
    state.renderChain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  /**
   * 真正把某页画到一张新 canvas 上。
   * @param {number} index 0-based 页号
   * @param {number} scale 倍率
   * @param {number} generation 调用时刻的文档代号
   * @returns {Promise<HTMLCanvasElement>}
   */
  async function rasterize(index, scale, generation) {
    const doc = state.doc;
    if (!doc) throw userError(MSG.notLoaded);

    const page = await doc.getPage(index + 1); // pdf.js 页号 1-based
    try {
      if (generation !== state.generation) throw userError('导入已切换，本次渲染作废。');

      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      // 直接按 CSS 像素 1:1 分配，即「设备像素 = 位图像素」，不做任何 DPR 缩放，
      // 保证超采样尺寸精确可控（A4 @3.2 ≈ 2380x3370）。
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));

      const ctx = canvas.getContext('2d');
      if (!ctx) throw userError('浏览器无法创建 2D 画布上下文，无法渲染 PDF。');
      // 先铺白底：PDF 页面本身可能是透明的，透明纹理在 WebGL 里会发黑。
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();

      await page.render({ canvasContext: ctx, viewport, intent: 'display' }).promise;
      return canvas;
    } finally {
      // 官方建议每页画完就 cleanup，释放页内临时资源（字体、图像缓存）
      try {
        page.cleanup();
      } catch (_e) {
        /* 忽略 */
      }
    }
  }

  /**
   * 写入整页 LRU，并按容量淘汰最旧项。
   * @param {number} index
   * @param {HTMLCanvasElement} canvas
   * @param {number} scale
   */
  function cachePut(index, canvas, scale) {
    state.cache.delete(index);
    state.cache.set(index, { canvas, scale });

    while (state.cache.size > MAX_CACHED_PAGES) {
      const oldest = state.cache.keys().next();
      if (oldest.done) break;
      const key = oldest.value;
      const evicted = state.cache.get(key);
      state.cache.delete(key);
      // 同步把 pages 条目上的强引用摘掉，否则 LRU 只删了自己的 key，
      // canvas 仍被 pages[key] 引用，内存根本降不下来。
      const entry = state.pages[key];
      if (entry && entry.canvas === (evicted && evicted.canvas)) {
        entry.canvas = null;
        entry.ready = false;
      }
    }
  }

  /**
   * 读整页缓存（命中即刷新技术序，实现 LRU）。
   * @param {number} index
   * @param {number} scale 命中项倍率需 ≥ 请求倍率才复用
   * @returns {HTMLCanvasElement|null}
   */
  function cacheGet(index, scale) {
    const hit = state.cache.get(index);
    if (!hit) return null;
    if (hit.scale + 1e-6 < scale) return null; // 质量不够，重渲
    state.cache.delete(index);
    state.cache.set(index, hit); // 移到队尾（最近使用）
    return hit.canvas;
  }

  /**
   * 更新 pages 条目（renderPage 成功后同步 live view）。
   * @param {number} index
   * @param {HTMLCanvasElement} canvas
   * @param {number} scale
   */
  function syncEntry(index, canvas, scale) {
    const entry = state.pages[index];
    if (!entry) return;
    entry.canvas = canvas;
    entry.ready = true;
    entry.scale = scale;
    entry.width = canvas.width;
    entry.height = canvas.height;
  }

  /* ------------------------------ 载入流程 ------------------------------ */

  /**
   * 终止当前文档的 worker 并把 GlobalWorkerOptions.workerPort 归零。
   * blob: URL 仍留在模块级缓存里（下一份文档直接复用，不必重新下载）。
   * @returns {void}
   */
  function detachWorker() {
    const info = state.worker;
    state.worker = null;
    if (!info) return;
    if (info.worker) {
      try {
        info.worker.terminate();
      } catch (_e) {
        /* 忽略 */
      }
    }
    try {
      const lib = state.engine && state.engine.lib;
      const options = lib && lib.GlobalWorkerOptions;
      if (options && options.workerPort === info.worker) options.workerPort = null;
    } catch (_e) {
      /* 忽略 */
    }
  }

  /**
   * 释放当前文档及其缓存（不改 disposed 标记）。
   * @returns {Promise<void>}
   */
  async function releaseDocument() {
    state.generation += 1; // 作废进行中的渲染任务
    const doc = state.doc;
    state.doc = null;
    state.pageCount = 0;
    state.aspect = 0;
    state.baseWidth = 0;
    state.baseHeight = 0;
    state.pages = [];
    state.labels = [];
    state.cache.clear();
    state.thumbs.clear();
    if (doc) {
      try {
        await doc.destroy();
      } catch (_e) {
        /* 忽略 */
      }
    }
    detachWorker();
  }

  /**
   * 用 ArrayBuffer 载入并渲染首屏页面。
   * @param {ArrayBuffer|Uint8Array} raw
   * @param {string} [name]
   * @returns {Promise<{count:number, pages:Array<any>, labels:string[]}>}
   */
  async function ingest(raw, name) {
    if (state.disposed) throw userError(MSG.disposed);

    const bytes = copyBytes(raw);
    if (bytes.byteLength === 0) throw userError(MSG.notPdf);
    if (!isPdfMagic(bytes.subarray(0, 5))) throw userError(MSG.notPdf);

    report(1, '加载 PDF 引擎…');
    const engine = await getEngine();
    state.engine = engine;

    report(6, '解析 PDF 文档…');
    // 释放上一份文档（内部会终止它对应的 worker 并递增 generation）
    await releaseDocument();

    // 每份文档一个全新 Worker：pdf.js 的 doc.destroy() 会 terminate 掉通过
    // workerPort 传入的 worker，复用同一个实例会导致第二次导入卡死。
    state.worker = await attachWorker(engine);
    if (state.worker.mode !== 'blob') {
      // 不是致命问题，只是可能走主线程、慢一些
      report(8, MSG.workerFail);
    }

    const generation = state.generation + 1;
    state.generation = generation;

    const task = engine.lib.getDocument({
      data: bytes,
      // CID 字体（中文 PDF 极常见）需要 cMap；标准字体用于未内嵌的 Helvetica/Times
      cMapUrl: engine.cMapUrl,
      cMapPacked: true,
      standardFontDataUrl: engine.standardFontDataUrl,
      wasmUrl: engine.wasmUrl,
      iccUrl: engine.iccUrl,
      isEvalSupported: false,
      // 不传 password：遇到加密文档直接抛 PasswordException，由下面统一转成中文提示
    });

    let doc;
    try {
      doc = await task.promise;
    } catch (err) {
      throw toUserError(err);
    }

    if (generation !== state.generation) {
      try {
        await doc.destroy();
      } catch (_e) {
        /* 忽略 */
      }
      throw userError('导入已切换，本次载入作废。');
    }

    state.doc = doc;
    state.pageCount = doc.numPages || 0;
    state.name = String(name || '');

    if (state.pageCount <= 0) {
      await releaseDocument();
      throw userError(MSG.emptyDoc);
    }

    // 用第 1 页的 scale=1 viewport 取得基准尺寸（决定 aspect 与各页目标像素）
    const firstPage = await doc.getPage(1);
    try {
      const base = firstPage.getViewport({ scale: 1 });
      state.baseWidth = base.width;
      state.baseHeight = base.height;
      state.aspect = base.height > 0 ? base.width / base.height : 0.7071; // A4 ≈ 0.707
    } finally {
      try {
        firstPage.cleanup();
      } catch (_e) {
        /* 忽略 */
      }
    }

    // 建立结果数组：width/height 先按默认倍率算好，canvas 等渲染完再填
    const targetW = Math.max(1, Math.round(state.baseWidth * DEFAULT_RENDER_SCALE));
    const targetH = Math.max(1, Math.round(state.baseHeight * DEFAULT_RENDER_SCALE));
    const baseName = state.name.replace(/\.pdf$/i, '') || 'PDF';
    state.pages = [];
    state.labels = [];
    for (let i = 0; i < state.pageCount; i += 1) {
      state.pages.push({ index: i, canvas: null, width: targetW, height: targetH, ready: false });
      state.labels.push(`${baseName} · 第 ${i + 1} 页`);
    }

    // 只预渲染前 EAGER_PAGES 页；其余留给 renderPage 按需。
    // 这是硬性内存约束：每页画布 ~32MB，14 页全画 = 450MB，必崩。
    const eager = Math.min(EAGER_PAGES, state.pageCount);
    let rendered = 0;
    for (let i = 0; i < eager; i += 1) {
      report((rendered / state.pageCount) * 100, `渲染第 ${i + 1}/${state.pageCount} 页…`);
      const canvas = await enqueue(() => rasterize(i, DEFAULT_RENDER_SCALE, generation));
      if (generation !== state.generation) throw userError('导入已切换，本次载入作废。');
      cachePut(i, canvas, DEFAULT_RENDER_SCALE);
      syncEntry(i, canvas, DEFAULT_RENDER_SCALE);
      rendered += 1;
    }

    report(
      (rendered / state.pageCount) * 100,
      rendered >= state.pageCount
        ? `已就绪：${state.pageCount} 页`
        : `已就绪：${rendered}/${state.pageCount} 页已渲染，其余按需渲染`
    );

    return {
      count: state.pages.length,
      pages: state.pages,
      labels: state.labels,
      name: state.name,
      aspect: state.aspect,
      pageCount: state.pageCount,
    };
  }

  /* ------------------------------ 公开 API ------------------------------ */

  /**
   * 打开系统文件选择框（隐藏的 `<input type="file" accept="application/pdf">`）。
   * 选择后自动走 handleFiles。无需用户自己创建元素。
   * @returns {void}
   */
  function openDialog() {
    if (state.disposed) {
      fail(userError(MSG.disposed));
      return;
    }
    if (typeof document === 'undefined' || !document.createElement) {
      fail(userError(MSG.noDialog));
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf,.pdf';
    input.multiple = false;
    input.setAttribute('aria-hidden', 'true');
    input.style.cssText =
      'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';
    state.pendingInputs.add(input);

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      try {
        input.removeEventListener('change', onChange);
        input.removeEventListener('cancel', onCancel);
        globalThis.removeEventListener('focus', onFocus);
        input.remove();
      } catch (_e) {
        /* 忽略 */
      }
      state.pendingInputs.delete(input);
    };

    function onChange() {
      const files = input.files;
      cleanup();
      if (files && files.length) handleFiles(files);
    }

    function onCancel() {
      cleanup();
    }

    // 用户点「取消」时多数浏览器不触发 change；窗口重新获得焦点后稍等再回收
    function onFocus() {
      setTimeout(() => {
        if (!input.files || input.files.length === 0) cleanup();
      }, 800);
    }

    input.addEventListener('change', onChange);
    input.addEventListener('cancel', onCancel);
    globalThis.addEventListener('focus', onFocus, { once: true });

    (document.body || document.documentElement).appendChild(input);
    input.click();
  }

  /**
   * 处理用户选中的文件（FileList 或 File[]）。
   * 只接受 `.pdf`（扩展名 + `%PDF` 魔数双重校验）；失败时回调 onError 并 resolve 为 null。
   *
   * 返回的 `pages` 是「活视图」：前 2 页已画好，后续页面 `canvas` 为 null、
   * `ready=false`，调用 renderPage(i) 后该条目会被原地填好。
   *
   * @param {FileList|File[]|null} fileList
   * @returns {Promise<{count:number, pages:Array<{index:number,canvas:HTMLCanvasElement|null,width:number,height:number,ready:boolean}>, labels:string[]}|null>}
   */
  async function handleFiles(fileList) {
    if (state.disposed) {
      fail(userError(MSG.disposed));
      return null;
    }
    const files = fileList ? Array.from(fileList) : [];
    if (!files.length) return null;

    // 多个文件时取第一个 PDF（其余忽略，保持行为可预期）
    const file = files.find((f) => f && /\.pdf$/i.test(f.name || '')) || files[0];

    try {
      if (!file || typeof file.slice !== 'function') throw userError(MSG.notPdf);
      if (!/\.pdf$/i.test(file.name || '')) throw userError(MSG.notPdf);

      // 扩展名可以随便改，再校验前 5 字节的 %PDF 魔数
      const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
      if (!isPdfMagic(head)) throw userError(MSG.notPdf);

      const buffer = await file.arrayBuffer();
      return await ingest(buffer, file.name);
    } catch (err) {
      fail(err);
      return null;
    }
  }

  /**
   * 直接从内存载入 PDF（已下载好的、由 FileReader 读出的等）。
   * @param {ArrayBuffer|Uint8Array} buf
   * @param {string} [name] 用于 labels 的文件名
   * @returns {Promise<{count:number, pages:Array<{index:number,canvas:HTMLCanvasElement|null,width:number,height:number,ready:boolean}>, labels:string[]}|null>}
   */
  async function loadFromArrayBuffer(buf, name) {
    if (state.disposed) {
      fail(userError(MSG.disposed));
      return null;
    }
    try {
      if (!buf) throw userError(MSG.notPdf);
      return await ingest(buf, name);
    } catch (err) {
      fail(err);
      return null;
    }
  }

  /**
   * 给元素挂上拖放导入。返回 detach()，调用后移除监听与高亮 class。
   * 拖放期间会给元素加 `pdf-drop-active` class（若支持 classList），方便做高亮样式。
   * @param {HTMLElement} el 拖放目标（例如画布容器或整个 body）
   * @returns {() => void} detach
   */
  function attachDropZone(el) {
    if (!el || typeof el.addEventListener !== 'function') {
      fail(userError('attachDropZone 需要一个可监听事件的 DOM 元素。'));
      return () => {};
    }

    let depth = 0; // dragenter/dragleave 会成对冒泡，用计数器避免闪烁

    /** @param {DragEvent} e */
    const hasFiles = (e) => {
      const dt = e && e.dataTransfer;
      if (!dt) return false;
      const types = dt.types;
      if (!types) return true;
      for (let i = 0; i < types.length; i += 1) {
        if (types[i] === 'Files') return true;
      }
      return false;
    };

    const highlight = (on) => {
      try {
        if (el.classList) {
          if (on) el.classList.add(DROP_ACTIVE_CLASS);
          else el.classList.remove(DROP_ACTIVE_CLASS);
        }
      } catch (_e) {
        /* 忽略 */
      }
    };

    /** @param {DragEvent} e */
    const onDragEnter = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth += 1;
      highlight(true);
    };

    /** @param {DragEvent} e */
    const onDragOver = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); // 不 preventDefault 的话浏览器会直接打开 PDF
      try {
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      } catch (_e) {
        /* 忽略 */
      }
    };

    /** @param {DragEvent} e */
    const onDragLeave = (e) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) highlight(false);
    };

    /** @param {DragEvent} e */
    const onDrop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      depth = 0;
      highlight(false);
      const dt = e.dataTransfer;
      const files = dt && dt.files;
      if (files && files.length) {
        handleFiles(files);
      } else {
        fail(userError(MSG.emptyDrop));
      }
    };

    el.addEventListener('dragenter', onDragEnter);
    el.addEventListener('dragover', onDragOver);
    el.addEventListener('dragleave', onDragLeave);
    el.addEventListener('drop', onDrop);

    return function detach() {
      try {
        el.removeEventListener('dragenter', onDragEnter);
        el.removeEventListener('dragover', onDragOver);
        el.removeEventListener('dragleave', onDragLeave);
        el.removeEventListener('drop', onDrop);
      } catch (_e) {
        /* 忽略 */
      }
      depth = 0;
      highlight(false);
    };
  }

  /**
   * 按需渲染某一页（0-based），结果进 LRU 并使用缓存。
   * 若缓存里已有「倍率 ≥ 请求倍率」的画布则直接复用，不重复渲染。
   * @param {number} index 0-based 页号
   * @param {number} [scale=3.2] 超采样倍率（会被钳制到 0.25~8）
   * @returns {Promise<HTMLCanvasElement>} 已绘制完成的画布
   */
  async function renderPage(index, scale = DEFAULT_RENDER_SCALE) {
    if (state.disposed) throw userError(MSG.disposed);
    if (!state.doc) throw userError(MSG.notLoaded);
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= state.pageCount) {
      throw userError(MSG.badIndex);
    }
    const s = clampScale(scale);

    const hit = cacheGet(i, s);
    if (hit) {
      syncEntry(i, hit, state.cache.get(i) ? state.cache.get(i).scale : s);
      return hit;
    }

    const generation = state.generation;
    report(
      (state.cache.size / state.pageCount) * 100,
      `渲染第 ${i + 1}/${state.pageCount} 页…`
    );

    const canvas = await enqueue(() => rasterize(i, s, generation));
    if (generation !== state.generation) throw userError('导入已切换，本次渲染作废。');

    cachePut(i, canvas, s);
    syncEntry(i, canvas, s);
    report(
      (state.cache.size / state.pageCount) * 100,
      `第 ${i + 1} 页已就绪（缓存 ${state.cache.size}/${Math.min(
        state.pageCount,
        MAX_CACHED_PAGES
      )} 页）`
    );
    return canvas;
  }

  /**
   * 轻量缩略图：单独用低倍率渲染一张小画布（默认宽 220px，约 1MB 以内），
   * 与整页缓存分开存放（LRU 上限 48 张），适合做侧边栏页面条。
   * @param {number} index 0-based 页号
   * @param {number} [width=220] 目标像素宽度
   * @returns {Promise<HTMLCanvasElement>}
   */
  async function getThumbnail(index, width = DEFAULT_THUMB_WIDTH) {
    if (state.disposed) throw userError(MSG.disposed);
    if (!state.doc) throw userError(MSG.notLoaded);
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= state.pageCount) {
      throw userError(MSG.badIndex);
    }
    const w = Math.max(32, Math.min(1024, Math.round(Number(width) || DEFAULT_THUMB_WIDTH)));
    const key = `${i}@${w}`;

    const cached = state.thumbs.get(key);
    if (cached) {
      state.thumbs.delete(key);
      state.thumbs.set(key, cached); // LRU 触碰
      return cached;
    }

    const generation = state.generation;
    const page = await state.doc.getPage(i + 1);
    let thumb;
    try {
      if (generation !== state.generation) throw userError('导入已切换，本次渲染作废。');
      const base = page.getViewport({ scale: 1 });
      const scale = w / Math.max(1, base.width);
      const viewport = page.getViewport({ scale });

      thumb = document.createElement('canvas');
      thumb.width = Math.max(1, Math.round(viewport.width));
      thumb.height = Math.max(1, Math.round(viewport.height));
      const ctx = thumb.getContext('2d');
      if (!ctx) throw userError('浏览器无法创建 2D 画布上下文，无法渲染 PDF。');
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, thumb.width, thumb.height);
      ctx.restore();
      await page.render({ canvasContext: ctx, viewport, intent: 'display' }).promise;
    } finally {
      try {
        page.cleanup();
      } catch (_e) {
        /* 忽略 */
      }
    }

    state.thumbs.set(key, thumb);
    while (state.thumbs.size > MAX_CACHED_THUMBS) {
      const oldest = state.thumbs.keys().next();
      if (oldest.done) break;
      state.thumbs.delete(oldest.value);
    }
    return thumb;
  }

  /**
   * 已载入文档的页数（未载入时为 0）。
   * @returns {number}
   */
  function getPageCount() {
    return state.pageCount;
  }

  /**
   * 第 0 页的宽高比（width / height，与 scale 无关）；未载入时为 0。
   * 书页网格用它决定平面尺寸，保证不变形。
   * @returns {number}
   */
  function getAspect() {
    return state.aspect;
  }

  /**
   * 释放文档、所有画布缓存、缩略图、worker 与 blob URL。
   * 释放后实例不可再用（请新建）；重复调用安全。
   * @returns {void}
   */
  function dispose() {
    if (state.disposed) return;
    state.disposed = true;

    // 1) 撤销文档（异步进行，不等它）
    releaseDocument();

    // 2) 清理 openDialog 遗留的 input
    for (const input of Array.from(state.pendingInputs)) {
      try {
        input.remove();
      } catch (_e) {
        /* 忽略 */
      }
    }
    state.pendingInputs.clear();

    // 3) 终止 worker，并回收 worker 脚本的 blob: URL（约 1.4MB，不回收就是泄漏）
    detachWorker();
    for (const [url, pending] of Array.from(workerBlobCache.entries())) {
      workerBlobCache.delete(url);
      Promise.resolve(pending)
        .then((blobUrl) => {
          if (blobUrl) {
            try {
              URL.revokeObjectURL(blobUrl);
            } catch (_e) {
              /* 忽略 */
            }
          }
        })
        .catch(() => {
          /* 忽略 */
        });
    }

    state.engine = null;
  }

  return {
    openDialog,
    handleFiles,
    attachDropZone,
    loadFromArrayBuffer,
    renderPage,
    getThumbnail,
    getPageCount,
    getAspect,
    dispose,
    /** @type {string} 当前文档名（未载入时为空串） */
    get name() {
      return state.name;
    },
  };
}
