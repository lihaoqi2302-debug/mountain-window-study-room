import { createShelfInspection } from './shelf-inspection.js';
let shelfInspection;
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildRoom, BOOK_TABLE, READING_CAMERA, ROOM } from './room.js';
import { TABLE } from './room-layout.js';
import { fitSeatedReading, readingPose, zoomReadingAt, constrainReadingPan } from './reading-navigation.js';
import { BOOK_PAGE_ASPECT, createBook } from './book.js';
import { createPostFX } from './postfx.js';
import { createAmbience } from './audio.js';
import { addSignage } from './signage.js';
import { createPdfImporter } from './pdfimport.js';
import { sampleBookTransfer, heldBookPose } from './book-motion.js';
import { createWalker } from './walking.js';
import { createInteractiveProps } from './interactive-props.js';
import { createLocalMusic } from './local-music.js';
import { configureStableRoomLighting, createStableShadows } from './stable-shadows.js';
import { SEATS,createSeatLook } from './seating.js';
import { SCENERY,createScenery,normalizeSceneryKey } from './scenery.js';
import { installStudyCompanion } from './study-companion.js';

/* ================================================================== */
/*  《地球 Online：一场轻盈的人生模拟》                                   */
/*  3D 沉浸式温馨书屋 + 真书翻阅系统 — 主程序                            */
/* ================================================================== */

const $ = (sel) => document.querySelector(sel);
const ROOM_SHADOW = 0x1d2730;

/* ------------------------------------------------------------------ */
/*  书籍结构（与重排版 13 的 34 页逐页对应）                              */
/* ------------------------------------------------------------------ */

const PAGES = [
  '封面',
  '扉页',
  '版权页',
  '致同行者',
  '目录 · 全书地图',
  '序章 · 欢迎登录地球 Online',
  '开篇 · 三条底层生存协议',
  '第一卷 · 内在秩序',
  '第一章 · 初始配置',
  '把宏大愿望切成七天的切口',
  '现实护栏 · 情绪缓冲三步曲',
  '第二章 · 底层主机',
  '四维精力蓄水池',
  '睡眠、昼夜节律与低功耗待机',
  '第二卷 · 公共场域',
  '第三章 · 多人副本',
  '边界练习 · 沈悦的回应示范',
  '第三章 · 田野微行动',
  '第四章 · 迷雾与筹码',
  '分期成本与风险护栏',
  '双向门决策与风险边界',
  '第三卷 · 现实建造',
  '第五章 · 自动运转',
  '两分钟法则与三版本执行系统',
  '第五章 · 田野微行动',
  '第六章 · 职场与城邦',
  '职场契约与劳动法备忘',
  '全国公共服务热线',
  '终章 · 把攻略合上，走进风里',
  '附录一 · 延伸阅读',
  '附录二 · 七日轻盈观察与边界练习册',
  '四维精力水池与现实安全垫审计',
  '自由田野手记',
  '封底',
];

/** 章节快速跳转（page 为 0 基页索引） */
const CHAPTERS = [
  { key: 'cover', label: '封面', en: 'COVER', page: 0 },
  { key: 'intro', label: '登录说明', en: 'PROLOGUE', page: 5 },
  { key: 'vol1', label: '第一卷 · 内在秩序', en: 'VOL. I', page: 7 },
  { key: 'vol2', label: '第二卷 · 公共场域', en: 'VOL. II', page: 14 },
  { key: 'vol3', label: '第三卷 · 现实建造', en: 'VOL. III', page: 21 },
  { key: 'appendix', label: '附录 · 延伸阅读与练习册', en: 'APPENDIX', page: 29 },
];
const PDF_CHAPTER = { key: 'pdf', label: '本地书稿', en: 'PDF', page: 0 };
const trialEdition = () => Boolean(window.__ASSETS__?.edition?.trial && !APP.state.pdfMode);

const LOADING_STEPS = [
  '正在点亮壁炉…',
  '正在挂上窗帘…',
  '正在把咖啡端上茶几…',
  '正在将书摆上书架…',
  '正在准备书页与灯光…',
  '马上就好…',
];

const APP = {
  state: {
    mode: 'loading', // loading | intro | explore | transitioning | reading
    soundOn: false,
    rainOn: false,
    noiseOn: false,
    tourOn: false,
    zoom: 1,
    savedSpread: 0,
    pdfMode: false,
    view: 'spread',
    pan: new THREE.Vector2(),
    readingOrbit: new THREE.Vector2(),
    readingDrag: 'orbit',
    locomotion: 'orbit',
    reducedMotion: !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    contextLost:false,
  },
  rect: null,
  camera: {
    homePos: new THREE.Vector3(),
    homeLook: new THREE.Vector3(),
    homeFov: 50,
    introPos: new THREE.Vector3(.24, .84, .16),
    introLook: BOOK_TABLE.center.clone(),
  },
};

let renderer, scene, camera, controls, fx, room, book, signage, amb, importer;
const lensTarget = new THREE.Vector3();
let bookRestPose = null;
const bookHeldPose = heldBookPose();
let props, walker, music;
let studyCompanion, sharedEnvironment, applySharedEnvironment;
let scenery,seatLook,seatRestore,shadowCache;
const walkInput = {};
const walkKeys = {KeyW:'forward', ArrowUp:'forward', KeyS:'backward', ArrowDown:'backward',
  KeyA:'left', ArrowLeft:'left', KeyD:'right', ArrowRight:'right',
  ShiftLeft:'sprint', ShiftRight:'sprint', Space:'jump'};
const heldWalkInputs = new Map();
let firstLockedMotion = false;
function pressWalkInput(source, action) {
  if (heldWalkInputs.has(source)) return;
  if (action === 'jump' && !walkInput.jump) walker.requestJump();
  heldWalkInputs.set(source,action);
  walkInput[action] = true;
}
function releaseWalkInput(source) {
  const action = heldWalkInputs.get(source);
  if (!action) return;
  heldWalkInputs.delete(source);
  walkInput[action] = [...heldWalkInputs.values()].includes(action);
}
let walkHadLock = false;
let hoverAction = null;
let hoverCheckTime = 0;
let lastTime = performance.now();
let elapsedTime = 0;
let raycaster;
const pointer = new THREE.Vector2(-10, -10);
let pointerDown = { x: 0, y: 0, t: 0, active: false };
const readingPointers = new Map();
let pinchGesture = null;
let usedMultiTouch = false;
let pageClickTimer = 0;
let transition = null;
let parallaxTarget = new THREE.Vector2(0, 0);
const parallax = new THREE.Vector2(0, 0);
let toastTimer = 0;
let loaderHideTimer = 0;
let lastInteraction = performance.now();
let entryStarted = null;
let originalCover = null;
let orbitZoom = 1;
let orbitBreath = 0;
const orbitTouches = new Map();
let orbitPinchDistance = 0;
let readingEntryFocus = false;
let roomHintTimer;
const ROOM_EXPOSURE = 1.08;
const frameStats = { calls: 0, triangles: 0, points: 0, frames: 0 };
const tmpM = new THREE.Matrix4();

/* ------------------------------------------------------------------ */
/*  01 · 加载与状态                                                         */
/* ------------------------------------------------------------------ */

function setProgress(pct, stepText) {
  const bar = $('#loadingBar');
  const num = $('#loadingPct');
  const step = $('#loadingStep');
  if (bar) {
    const value = Math.round(THREE.MathUtils.clamp(pct, 0, 100));
    bar.style.width = `${value}%`;
    bar.parentElement.setAttribute('aria-valuenow', String(value));
  }
  if (num) num.textContent = `${Math.round(pct)}%`;
  if (step && stepText) step.textContent = stepText;
}

function showToast(text, ms = 4200) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = text;
  el.classList.add('is-show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('is-show');
    setTimeout(() => {
      if (!el.classList.contains('is-show')) el.textContent = '';
    }, 420);
  }, ms);
}

function setBodyMode(mode) {
  const reading = mode === 'reading';
  const readUI = $('#readUI');
  const roomUi = [$('#roomTools'), $('#roomMenu'), $('#btnRead')];
  if (reading) {
    readUI.inert = false;
    document.body.dataset.mode = mode;
    $('#btnCloseBook').focus({preventScroll:true});
    readingEntryFocus = true;
    roomUi.forEach(element => { element.inert = true; });
  } else {
    roomUi.forEach(element => { element.inert = false; });
    document.body.dataset.mode = mode;
    $('#btnRead').focus({preventScroll:true});
    readUI.inert = true;
  }
}

/* ------------------------------------------------------------------ */
/*  02 · 相机过渡与环视                                                          */
/* ------------------------------------------------------------------ */

function quatFor(eye, look, up) {
  tmpM.lookAt(eye, look, up);
  return new THREE.Quaternion().setFromRotationMatrix(tmpM);
}

function startTransition({ toPos, toLook, toUp, duration = 1.7, fov = 50, focusBook = false, onUpdate, onEnd }) {
  if (transition?.focusBook) fx?.setShotFocus(0, 0);

  transition = {
    t: 0,
    duration,
    focusBook,
    fromPos: camera.position.clone(),
    toPos: toPos.clone(),
    fromQuat: camera.quaternion.clone(),
    toQuat: quatFor(toPos, toLook, toUp),
    fromFov: camera.fov,
    fromZoom: camera.zoom,
    toFov: fov,
    onUpdate,
    onEnd,
  };
}

const easeInOut = (t) => t*t*t*(t*(t*6-15)+10);

function updateTransition(dt) {
  if (!transition) return;
  const tr = transition;
  tr.t = APP.state.reducedMotion ? 1 : tr.t + dt / tr.duration;
  const t = Math.min(1, tr.t);
  const e = easeInOut(t);
  camera.position.lerpVectors(tr.fromPos, tr.toPos, e);
  camera.quaternion.slerpQuaternions(tr.fromQuat, tr.toQuat, e);
  camera.fov = tr.fromFov + (tr.toFov - tr.fromFov) * e;
  camera.zoom = THREE.MathUtils.lerp(tr.fromZoom, 1, e);
  camera.updateProjectionMatrix();
  if (tr.onUpdate) tr.onUpdate(e);
  if (tr.focusBook && fx && !APP.state.reducedMotion && APP.state.quality === 'high') {
    camera.updateMatrixWorld();
    const depth = -lensTarget.copy(book.group.position).applyMatrix4(camera.matrixWorldInverse).z;
    fx.setShotFocus(depth, 1 - THREE.MathUtils.smoothstep(t, .64, 1));
  }
  if (t >= 1) {
    transition = null;
    if (tr.focusBook) fx?.setShotFocus(0, 0);
    if (tr.onEnd) tr.onEnd();
  }
}

/* ------------------------------------------------------------------ */
/*  03 · 阅读、翻页与取景                                                          */
/* ------------------------------------------------------------------ */

function bookCentre() {
  return (BOOK_TABLE && BOOK_TABLE.center ? BOOK_TABLE.center : new THREE.Vector3(0, 0.42, -0.06)).clone();
}

/**
 * 阅读可用取景区：扣掉顶部信息栏、底部控制栏与安全边距后的矩形（CSS px）。
 * 只在尺寸变化 / 面板开合 / 模式切换时重新测量，避免每帧读布局。
 */
function usableRect() {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const cache = APP.rect;
  if (cache && !cache.dirty && cache.W === W && cache.H === H) return cache;

  const bar = $('#readBar');
  const meta = document.querySelector('.read-meta');
  const tools = $('#readCameraTools');
  const barBox = bar.getBoundingClientRect();
  const metaBox = meta.getBoundingClientRect();
  const barTop = barBox.height ? barBox.top : H - 86;
  const metaBottom = metaBox.height ? metaBox.bottom : 54;

  const padX = Math.max(20, Math.min(120, W * 0.062));
  const toolsBottom = tools.getBoundingClientRect().bottom;
  const top = Math.round(Math.max(18, metaBottom + 14, toolsBottom + 12));
  const bottom = Math.round(Math.min(H - 8, barTop - 16));
  APP.rect = {
    x: Math.round(padX),
    y: top,
    w: Math.max(60, Math.round(W - padX * 2)),
    h: Math.max(60, Math.round(bottom - top)),
    W,
    H,
    dirty: false,
  };
  return APP.rect;
}

function markRectDirty() {
  if (APP.rect) APP.rect.dirty = true;
}

/**
 * Keep the eye at sofa height; fit the page with the lens and cache the projected framing.
 */
function solveReadingFraming() {
  const rect = usableRect();
  const isSingle = book && book.getView ? book.getView() === 'single' : false;
  const pages = book && book.getPages ? book.getPages() : { left: 0, right: 1 };
  const key = [rect.x, rect.y, rect.w, rect.h, rect.W, rect.H,
    APP.state.readingOrbit.x.toFixed(5), APP.state.readingOrbit.y.toFixed(5),
    isSingle, pages.left, pages.right].join('|');
  if (APP.frame && APP.frame.key === key) return APP.frame;
  APP.frame = { ...fitSeatedReading({
    corners: book?.getPageCorners?.() || [], center: bookCentre(), seat: READING_CAMERA.base,
    yaw: APP.state.readingOrbit.x, pitch: APP.state.readingOrbit.y,
    rect, width: rect.W, height: rect.H,
  }), key };
  return APP.frame;
}

function markFrameDirty() {
  APP.frame = null;
}

/**
 * 坐进沙发、俯身看书的阅读视角。
 * 取景按“可用区域”求解（顶部信息栏、底部控制栏、安全边距全部计入），
 * 并用 setViewOffset 把视锥平移到可用区中心，页面永远不会被控制栏遮住。
 */
function readingCameraPose(zoom = APP.state.zoom) {
  return readingPose(solveReadingFraming(), zoom, APP.state.pan);
}

function applyBookMix(p) {
  if (!book) return;
  book.setOpenProgress(p);
  if (room) {
    if (room.readingSpot) room.readingSpot.intensity = 1.7 * p;
    if (room.displaySpot) room.displaySpot.intensity = 2.45 * (1 - p) + 0.5 * p;
  }
}

function applyBookTransfer(value) {
  if (!book || !bookRestPose) return;
  const pose = sampleBookTransfer(bookRestPose, bookHeldPose, value);
  book.group.position.copy(pose.position);
  book.group.quaternion.copy(pose.quaternion);
}

function enterReading() {
  if (!book || !room) return;
  if (APP.state.mode !== 'explore') return;
  if (APP.state.locomotion === 'walk') leaveWalk({ announce: false });
  APP.state.mode = 'transitioning';
  APP.state.pendingExit = false;
  APP.state.tourOn = false;
  controls.autoRotate = false;
  $('#btnTour').setAttribute('aria-pressed','false');
  $('#btnTour').classList.remove('is-active');
  APP.camera.savedPos = camera.position.clone();
  APP.camera.savedFov = camera.fov;
  APP.camera.savedZoom = orbitZoom;
  APP.camera.savedLook = APP.state.locomotion==='seated'?seatLook.target():controls.target.clone();
  controls.enabled = false;
  book.setHover(false);
  parallax.set(0, 0);
  parallaxTarget.set(0, 0);
  renderer.domElement.style.cursor = 'default';
  setBodyMode('reading');
  toggleHelp(false);
  toggleToc(false);
  markRectDirty();
  markFrameDirty();
  APP.state.pan.set(0, 0);
  APP.state.readingOrbit.set(0, 0);
  APP.state.zoom = 1;
  camera.zoom = 1;
  camera.clearViewOffset();
  // 窄屏（竖屏手机 / 小窗）默认单页：双页跨页在这个宽度下字太小
  if (book.pageCount > 1 && !APP.state.viewUserSet && book.setView) {
    const narrow = window.innerWidth < 760 || (camera.aspect || 1.6) < 0.92;
    book.setView(narrow ? 'single' : 'spread');
  }
  APP.state.view = book.getView ? book.getView() : 'spread';
  updateReadingHud();
  // Fit the final held pose, then restore the rest pose before the first animation frame.
  applyBookTransfer(1);
  applyBookMix(1);
  markFrameDirty();
  const pose = readingCameraPose();
  applyBookTransfer(0);
  applyBookMix(0);
  markFrameDirty();
  if (fx) fx.setReadingMode(true);
  startTransition({
    focusBook: true,
    toPos: pose.pos,
    toLook: pose.look,
    toUp: pose.up,
    duration: 1.45,
    fov: pose.fov,
    onUpdate: (e) => {
      applyBookTransfer(THREE.MathUtils.smoothstep(e, 0.12, 0.86));
      const p = THREE.MathUtils.smoothstep(transition.t, 0.54, 0.83);
      applyBookMix(p);
    },
    onEnd: () => {
      APP.state.mode = 'reading';
      camera.up.copy(pose.up);
      renderer.domElement.style.cursor = 'grab';
      applyBookMix(1);
      applyBookTransfer(1);
      markFrameDirty();
      markRectDirty();
      if (book.setPaperFill) book.setPaperFill(0.30);
    },
  });
  if (amb) amb.playOpen();
}

function exitReading() {
  if (APP.state.mode !== 'reading') return;
  if (book.isTurning()) { APP.state.pendingExit = true; return; }
  APP.state.pendingExit = false;
  APP.state.savedSpread = book.getSpread();
  APP.state.mode = 'transitioning';
  clearReadingGesture();
  camera.clearViewOffset();
  camera.updateProjectionMatrix();
  setBodyMode('explore');
  toggleToc(false);
  toggleHelp(false);
  if (fx) fx.setReadingMode(false);
  const pos = (APP.camera.savedPos || APP.camera.homePos).clone();
  const look = (APP.camera.savedLook || APP.camera.homeLook).clone();
  startTransition({
    toPos: pos,
    toLook: look,
    toUp: new THREE.Vector3(0, 1, 0),
    duration: 1.35,
    fov: APP.camera.savedFov || 50,
    onUpdate: (e) => {
      const p = 1 - THREE.MathUtils.smoothstep(e, 0.04, 0.70);
      applyBookTransfer(1 - THREE.MathUtils.smoothstep(e, 0.25, 0.98));
      applyBookMix(p);
    },
    onEnd: () => {
      APP.state.mode = 'explore';
      camera.up.set(0, 1, 0);
      camera.clearViewOffset();
      if (book && book.setPaperFill) book.setPaperFill(0.16);
      controls.target.copy(look);
      orbitZoom = APP.camera.savedZoom || 1;
      if (APP.state.locomotion === 'orbit') { camera.zoom = orbitZoom; camera.updateProjectionMatrix(); }
      controls.enabled = APP.state.locomotion!=='seated';
      if(controls.enabled)controls.update();else seatLook?.apply(camera);
      applyBookMix(0);
      applyBookTransfer(0);
      renderer.domElement.style.cursor = 'grab';
    },
  });
  if (amb) amb.playClose();
}

function updateReadingCamera(dt) {
  if (APP.state.mode !== 'reading') return;
  const pose = readingCameraPose();
  camera.position.copy(pose.pos);
  camera.up.copy(pose.up);
  camera.lookAt(pose.look);
  camera.fov = pose.fov;
  camera.zoom = pose.lensZoom;
  // 把视锥平移到可用区中心（负号：视口偏移方向与内容位移相反）
  camera.setViewOffset(pose.rect.W, pose.rect.H, -pose.dx, -pose.dy, pose.rect.W, pose.rect.H);

}

/** 拖拽平移（阅读模式，单位：屏幕像素） */
function panReadingBy(dxPx, dyPx) {
  const pose = readingCameraPose();
  const k = pose.worldPerPx;
  APP.state.pan.x -= dxPx * k;
  APP.state.pan.y += dyPx * k;
  constrainReadingPan(APP.state.pan);
}

function zoomReading(factor, x = window.innerWidth / 2, y = window.innerHeight / 2) {
  if (APP.state.mode !== 'reading') return;
  const frame = solveReadingFraming();
  const at = new THREE.Vector2(x / window.innerWidth * 2 - 1, 1 - y / window.innerHeight * 2);
  raycaster.setFromCamera(at, camera);
  const hit = raycaster.intersectObjects(book.pickMeshes.filter(mesh => mesh.visible), false)[0];
  const depth = hit ? readingCameraPose().pos.clone().sub(hit.point).dot(frame.dir) : frame.distance;
  APP.state.zoom = zoomReadingAt({ zoom: APP.state.zoom, factor, pan: APP.state.pan,
    frame, x, y, width: window.innerWidth, height: window.innerHeight, depth });
  updateReadingTools();
}

function updateReadingTools() {
  const drag = $('#btnReadDrag');
  if (drag) {
    drag.textContent = APP.state.readingDrag === 'pan' ? '拖动：移动' : '拖动：转动';
    drag.setAttribute('aria-pressed', String(APP.state.readingDrag === 'pan'));
  }
  const percent = $('#readZoomValue');
  if (percent) percent.textContent = `${Math.round(100 / APP.state.zoom)}%`;
}

function resetSeatView() {
  APP.state.readingOrbit.set(0, 0);
  fitReadingPage(false);
  showToast('已回到沙发视角', 1600);
}

/** 适应页面：缩放与平移复位 */
function fitReadingPage(announce) {
  APP.state.zoom = 1;
  APP.state.pan.set(0, 0);
  markFrameDirty();
  updateReadingTools();
  if (announce) showToast('已适应页面', 1600);
}

/** 单页 / 双页切换 */
function toggleView() {
  if (!book || APP.state.mode !== 'reading') return;
  const next = book.getView() === 'single' ? 'spread' : 'single';
  if (!book.setView(next)) return;
  shadowCache?.invalidate();
  APP.state.view = next;
  APP.state.viewUserSet = true;
  fitReadingPage(false);
  markFrameDirty();
  markRectDirty();
  const btn = $('#btnSingle');
  if (btn) {
    btn.setAttribute('aria-pressed', String(next === 'single'));
    btn.classList.toggle('is-active', next === 'single');
    const label = btn.querySelector('.read-bar__label');
    if (label) label.textContent = next === 'single' ? '双页' : '单页';
  }
  updateReadingHud();
  showToast(next === 'single' ? '单页阅读 · 可拖拽平移、滚轮放大' : '双页跨页阅读', 2200);
}

/* ------------------------------------------------------------------ */
/*  阅读 HUD                                                          */
/* ------------------------------------------------------------------ */

function chapterOfPage(pageIdx) {
  if (APP.state.pdfMode) return PDF_CHAPTER;
  let best = CHAPTERS[0];
  for (const c of CHAPTERS) if (c.page <= pageIdx) best = c;
  return best;
}

function updatePageNumber(container, value) {
  const old = container.lastElementChild;
  if (old.textContent === value) return;
  const next = document.createElement('span');
  next.textContent = value;
  container.replaceChildren(next);
  if (APP.state.mode !== 'reading' || APP.state.reducedMotion) return;
  old.setAttribute('aria-hidden','true');
  container.prepend(old);
  const options = {duration:120, easing:'ease-out', fill:'both'};
  old.animate([{transform:'translateY(0)', opacity:1},{transform:'translateY(-6px)', opacity:0}],options)
    .onfinish = () => old.remove();
  next.animate([{transform:'translateY(6px)', opacity:0},{transform:'translateY(0)', opacity:1}],options);
}

function centerChapter(chapters, button) {
  const frame = chapters.getBoundingClientRect();
  const item = button.getBoundingClientRect();
  if (!frame.width || chapters.scrollWidth <= frame.width) return;
  chapters.scrollTo({
    left: chapters.scrollLeft + (item.left + item.right - frame.left - frame.right) / 2,
    behavior: APP.state.reducedMotion ? 'instant' : 'smooth',
  });
}

function updateReadingHud() {
  if (!book) return;
  updateReadingTools();
  const chapters = $('#chapterNav');
  if (chapters) chapters.hidden = APP.state.pdfMode;
  const p = book.getPages();
  const chapterEl = $('#readChapter');
  const pageEl = $('#readPage');
  const onePage = p.right < 0 || p.right === p.left;

  const li = p.left + 1;
  const ri = p.right < 0 ? p.left + 1 : p.right + 1;
  const currentPage = p.active;
  if (chapterEl) {
    const c = chapterOfPage(p.left);
    chapterEl.textContent = onePage ? PAGES[p.left] || c.label : `${PAGES[p.left] || ''} ／ ${PAGES[p.right] || ''}`;
  }
  if (pageEl) {
    pageEl.textContent = onePage ? `第 ${String(li).padStart(2, '0')} 页 / 共 ${p.count} 页` : `第 ${String(li).padStart(2, '0')}–${String(ri).padStart(2, '0')} 页 / 共 ${p.count} 页`;
  }
  const now = $('#pageNow');
  const total = $('#pageTotal');
  updatePageNumber(now, String(currentPage + 1).padStart(2, '0'));
  updatePageNumber(total, String(p.count));

  const isSingleView = p.view === 'single';
  const progress = isSingleView
    ? (p.single + 1) / Math.max(1, p.count)
    : (p.spread + 1) / Math.max(1, p.spreads);
  const bar = $('#readProgressBar');
  if (bar) bar.style.width = `${Math.min(100, Math.max(2, progress * 100))}%`;
  const track = $('#readProgressTrack');
  if (track) {
    track.setAttribute('aria-valuemax', String(p.count));
    track.setAttribute('aria-valuenow', String(currentPage + 1));
  }
  const singleBtn = $('#btnSingle');
  if (singleBtn) {
    singleBtn.disabled = p.count < 2;
    singleBtn.setAttribute('aria-pressed', String(isSingleView));
    singleBtn.classList.toggle('is-active', isSingleView);
  }

  // 目录高亮实际选择的页，双页模式下也可能是右页。
  document.querySelectorAll('#tocPanel .toc-item').forEach((btn) => {
    const idx = Number(btn.dataset.page || -1);
    const active = idx === currentPage;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-current', active ? 'true' : 'false');
  });

  // 章节按钮
  const currentChapter = chapterOfPage(currentPage).key;
  document.querySelectorAll('#chapterNav .chapter-jump').forEach((btn) => {
    const on = btn.dataset.goto === currentChapter;
    btn.disabled = trialEdition() && CHAPTERS.some((chapter) => chapter.key === btn.dataset.goto && chapter.page >= p.count);
    btn.title = btn.disabled ? '完整目录 · 此章不在试读范围' : '';
    const changed = on && !btn.classList.contains('is-active');
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-pressed', String(on));
    if (on && changed && !APP.state.pdfMode) centerChapter(chapters, btn);
  });

  const prev = $('#btnPrev');
  const next = $('#btnNext');
  if (prev) {
    const off = isSingleView ? p.single <= 0 : p.spread === 0;
    prev.classList.toggle('is-disabled', off);
    prev.disabled = off;
  }
  if (next) {
    const off = isSingleView ? p.single >= p.count - 1 : p.spread >= p.spreads - 1;
    next.classList.toggle('is-disabled', off);
    next.disabled = off;
  }
}

function buildToc() {
  const panel = $('#tocPanel');
  if (!panel) return;
  const list = panel.querySelector('.toc-panel__list') || panel;
  list.innerHTML = '';
  let lastChapter = null;
  PAGES.forEach((label, i) => {
    const chapter = chapterOfPage(i);
    if (chapter !== lastChapter) {
      lastChapter = chapter;
      const head = document.createElement('div');
      head.className = 'toc-group';
      head.innerHTML = `<span class="toc-group__no">${chapter.en}</span><span class="toc-group__name">${chapter.label}</span>`;
      list.appendChild(head);
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toc-item';
    b.dataset.page = String(i);
    const locked = trialEdition() && i >= window.__ASSETS__.pages.length;
    if (locked) {
      b.setAttribute('aria-disabled', 'true');
      b.title = '此页不在试读范围';
    }
    const number = document.createElement('span');
    number.className = 'toc-num';
    number.textContent = String(i + 1).padStart(2, '0');
    const title = document.createElement('span');
    title.className = 'toc-label';
    title.textContent = label;
    b.append(number, title);
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (!book) return;
      if (locked) { showToast('这一页在完整目录中，当前版本可读前 ' + book.pageCount + ' 页'); return; }
      book.jumpToPage(i);
      toggleToc(false);
      updateReadingHud();
    });
    list.appendChild(b);
  });
}

function toggleToc(force) {
  const panel = $('#tocPanel');
  const btn = $('#btnToc');
  if (!panel) return;
  const next = typeof force === 'boolean' ? force : !panel.classList.contains('is-open');
  const wasOpen = !panel.hidden;
  panel.classList.toggle('is-open', next);
  panel.hidden = !next;
  markRectDirty();
  if (btn) {
    btn.classList.toggle('is-active', next);
    btn.setAttribute('aria-expanded', String(next));
  }
  if (next) {
    const active = panel.querySelector('.toc-item.is-active');
    if (active) active.scrollIntoView({ block: 'center', behavior: APP.state.reducedMotion ? 'instant' : 'smooth' });
    (active || $('#btnTocClose')).focus({preventScroll:true});
  } else if (wasOpen && APP.state.mode === 'reading') {
    btn.focus({preventScroll:true});
  }
}

function toggleHelp(force) {
  const panel = $('#helpPanel');
  if (!panel) return;
  const next = typeof force === 'boolean' ? force : !panel.classList.contains('is-open');
  const wasOpen = !panel.hidden;
  if (next) { toggleSceneryPanel(false); closeMusicPanel(); }
  if (next && APP.state.locomotion === 'walk') leaveWalk({announce:false});
  panel.classList.toggle('is-open', next);
  panel.hidden = !next;
  markRectDirty();
  const btn = $('#btnHelp');
  if (btn) {
    btn.classList.toggle('is-active', next);
    btn.setAttribute('aria-expanded', String(next));
  }
  if (next) $('#btnHelpClose').focus({preventScroll:true});
  else if (wasOpen && APP.state.mode === 'explore') roomToolFocus('btnHelp');
}

function turn(dir) {
  if (!book || APP.state.mode !== 'reading') return;
  if (APP.state.pendingExit) return;
  if (book.isTurning()) return;
  const ok = dir > 0 ? book.next() : book.prev();
  if (ok && amb) amb.playPageFlip(dir);
}

function jumpToChapter(key) {
  if (APP.state.pdfMode) return;
  const c = CHAPTERS.find((x) => x.key === key);
  if (!c || !book) return;
  if (APP.state.mode !== 'reading') return;
  book.jumpToPage(c.page);
  updateReadingHud();
  showToast(`已翻到「${c.label}」`, 2000);
}

/* ------------------------------------------------------------------ */
/*  交互                                                              */
/* ------------------------------------------------------------------ */

function pickClosed() {
  if (!book) return false;
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObjects(book.closedPickMeshes, false).length > 0;
}

function pickPageSide() {
  if (!book) return null;
  raycaster.setFromCamera(pointer, camera);
  const single = book.getView?.() === 'single';
  const meshes = book.pickMeshes.filter(mesh => mesh.visible);
  const hit = raycaster.intersectObjects(meshes, false)[0];
  if (!hit?.uv) return null;
  // Only the outer page edges turn a sheet. The body remains available for navigation.
  if (single) return hit.uv.x < 0.16 ? 'left' : hit.uv.x > 0.84 ? 'right' : null;
  if (hit.object === book.pickMeshes[0] && hit.uv.x < 0.16) return 'left';
  if (hit.object === book.pickMeshes[1] && hit.uv.x > 0.84) return 'right';
  return null;
}

function pinchFromPointers() {
  const [a, b] = [...readingPointers.values()];
  if (!a || !b) return null;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
    distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
}

function clearReadingGesture() {
  clearTimeout(pageClickTimer);
  const ids = [...readingPointers.keys()];
  readingPointers.clear();
  pinchGesture = null;
  usedMultiTouch = false;
  pointerDown.active = false;
  for (const id of ids) {
    try { renderer.domElement.releasePointerCapture(id); } catch (_e) { /* already released */ }
  }
}

function onPointerMove(ev) {
  if(shelfInspection?.move(ev))return;
  if (APP.state.locomotion === 'walk') {
    if (document.pointerLockElement !== renderer.domElement && pointerDown.active && ev.pointerId === pointerDown.id) {
      const dx = ev.clientX - pointerDown.panned.x, dy = ev.clientY - pointerDown.panned.y;
      walker.look(dx,dy); pointerDown.moved += Math.abs(dx) + Math.abs(dy);
      pointerDown.panned.x = ev.clientX; pointerDown.panned.y = ev.clientY;
    }
    return;
  }
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  if (APP.state.mode === 'reading') {
    if (!readingPointers.has(ev.pointerId)) return;
    readingPointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (readingPointers.size > 1) {
      const next = pinchFromPointers();
      if (next && pinchGesture) {
        zoomReading(pinchGesture.distance / next.distance, next.x, next.y);
        panReadingBy(next.x - pinchGesture.x, next.y - pinchGesture.y);
      }
      pinchGesture = next;
      return;
    }
    if (pointerDown.active && !usedMultiTouch && pointerDown.id === ev.pointerId) {
      const dx = ev.clientX - pointerDown.panned.x;
      const dy = ev.clientY - pointerDown.panned.y;
      pointerDown.panned.x = ev.clientX;
      pointerDown.panned.y = ev.clientY;
      pointerDown.moved += Math.abs(dx) + Math.abs(dy);
      if (pointerDown.moved > 6) {
        if (pointerDown.action === 'pan') panReadingBy(dx, dy);
        else {
          APP.state.readingOrbit.x -= dx * 0.005;
          const frame = solveReadingFraming();
          const basePhi = new THREE.Spherical().setFromVector3(READING_CAMERA.base.clone().sub(frame.center)).phi;
          APP.state.readingOrbit.y = THREE.MathUtils.clamp(APP.state.readingOrbit.y - dy * 0.004,
            0.12 - basePhi, 1.42 - basePhi);
          markFrameDirty();
        }
        renderer.domElement.style.cursor = 'grabbing';
      }
    }
    return;
  }
  if (APP.state.mode === 'explore') {
    if (APP.state.locomotion === 'seated') {
      if(pointerDown.active){
        const dx=ev.clientX-pointerDown.panned.x,dy=ev.clientY-pointerDown.panned.y;
        seatLook?.look(dx,dy);pointerDown.moved+=Math.abs(dx)+Math.abs(dy);pointerDown.panned={x:ev.clientX,y:ev.clientY};
      }else updateInteractionHover();
    } else updateInteractionHover();
  }
}

function onPointerDown(ev) {
  if (APP.state.locomotion === 'walk' && pointerDown.active && pointerDown.id !== ev.pointerId) return;
  if(shelfInspection?.down(ev)){ev.preventDefault();try{ev.currentTarget.setPointerCapture(ev.pointerId);}catch{}return;}
  if (APP.state.mode==='explore' && APP.state.locomotion!=='orbit') {
    ev.preventDefault();
    try { renderer.domElement.setPointerCapture(ev.pointerId); } catch(_e) {}
  }
  if (APP.state.mode === 'reading') {
    ev.preventDefault();
    readingPointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    try { renderer.domElement.setPointerCapture(ev.pointerId); } catch (_e) { /* synthetic input */ }
    if (readingPointers.size > 1) {
      usedMultiTouch = true;
      pinchGesture = pinchFromPointers();
      clearTimeout(pageClickTimer);
      return;
    }
  }
  pointerDown = {
    id: ev.pointerId,
    x: ev.clientX,
    y: ev.clientY,
    t: performance.now(),
    active: true,
    moved: 0,
    panned: { x: ev.clientX, y: ev.clientY },
    action: ev.shiftKey || ev.button !== 0 || APP.state.readingDrag === 'pan' ? 'pan' : 'orbit',
  };
  if (APP.state.mode === 'reading') parallaxTarget.set(0, 0);
}

function onPointerUp(ev) {
  if (APP.state.locomotion === 'walk' && pointerDown.id !== ev.pointerId) return;
  if(shelfInspection?.up()){try{ev.currentTarget.releasePointerCapture(ev.pointerId);}catch{}return;}
  const multi = usedMultiTouch;
  readingPointers.delete(ev.pointerId);
  try { renderer.domElement.releasePointerCapture(ev.pointerId); } catch (_e) { /* not captured */ }
  if (multi) {
    if (!readingPointers.size) clearReadingGesture();
    return;
  }
  if (!pointerDown.active) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  const moved = Math.max(
    Math.hypot(ev.clientX - pointerDown.x, ev.clientY - pointerDown.y),
    pointerDown.moved || 0
  );
  const elapsed = performance.now() - pointerDown.t;
  pointerDown.active = false;
  if (APP.state.mode === 'reading') renderer.domElement.style.cursor = 'grab';
  // 拖拽（平移）绝不触发翻页
  if (moved > 6 || elapsed > 800 || ev.button !== 0) return;
  if (APP.state.mode === 'explore') {
    performWorldInteraction(pickWorldInteraction(APP.state.locomotion==='walk' && document.pointerLockElement===renderer.domElement));
  } else if (APP.state.mode === 'reading') {
    const side = pickPageSide();
    clearTimeout(pageClickTimer);
    if (side) pageClickTimer = setTimeout(() => turn(side === 'left' ? -1 : 1), 240);
  }
}

function onWheel(ev) {
  if (APP.state.mode === 'explore' && APP.state.locomotion === 'orbit' && controls.enabled) {
    ev.preventDefault();
    const pixels = ev.deltaY * (ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 120 : 1);
    orbitZoom = THREE.MathUtils.clamp(orbitZoom * Math.exp(-pixels * .0018), .6, 2.2);
    lastInteraction = performance.now();
    return;
  }
  if (APP.state.mode !== 'reading') return;
  ev.preventDefault();
  zoomReading(Math.exp(THREE.MathUtils.clamp(ev.deltaY * 0.0012, -0.5, 0.5)), ev.clientX, ev.clientY);
}

function onKeyDown(ev) {
  if (APP.state.importing || ['loading','intro'].includes(APP.state.mode)) return;
  if ($('#roomTools')?.classList.contains('is-open')) {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      setRoomTools(false);
      $('#roomMenu').focus();
    }
    return;
  }
  if (shelfInspection?.key(ev)) { ev.preventDefault(); return; }
  if (!$('#sceneryPanel').hidden || !$('#musicPanel').hidden || !$('#helpPanel').hidden) {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      if (!$('#sceneryPanel').hidden) toggleSceneryPanel(false);
      else if (!$('#musicPanel').hidden) closeMusicPanel();
      else toggleHelp(false);
    }
    return;
  }
  if (ev.key === 'Escape' && APP.state.mode === 'reading' && !$('#tocPanel').hidden) {
    ev.preventDefault();
    toggleToc(false);
    return;
  }
  if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.isComposing || ev.target?.isContentEditable ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target?.tagName || '')) return;
  const key = ev.key;
  if (APP.state.mode === 'explore' && APP.state.locomotion === 'walk') {
    const action = walkKeys[ev.code];
    if (action) {
      ev.preventDefault();
      if (!ev.repeat) pressWalkInput(ev.code, action);
    } else if (key === 'Tab') {
      leaveWalk({announce:false});
    } else if (key === 'Escape' || ev.code === 'KeyV') {
      ev.preventDefault();
      if (!ev.repeat) leaveWalk();
    } else if (!ev.repeat && ev.code === 'KeyE') performWorldInteraction(pickWorldInteraction(true));
    else if (!ev.repeat && ev.code === 'KeyC') sitDown('sofa');
    else if (!ev.repeat && ev.code === 'KeyP') openMusicPanel();
    return;
  }
  if (ev.target?.closest?.('button') && ['Enter', ' '].includes(key)) return;
  if ((key==='c'||key==='C') && !ev.repeat && APP.state.mode==='explore') {
    APP.state.locomotion==='seated' ? standUp() : sitDown('sofa'); return;
  }
  if (ev.code==='KeyV' && !ev.repeat && APP.state.mode==='explore') { enterWalk(); return; }
  if ((key==='p'||key==='P') && !ev.repeat) { openMusicPanel(); return; }
  if (key === 'm' || key === 'M') toggleSound();
  if (APP.state.mode === 'reading') {
    if (key === 'Tab' && readingEntryFocus && ev.target === $('#btnCloseBook') && !ev.shiftKey) {
      readingEntryFocus = false;
      ev.preventDefault();
      $('#btnToc').focus({preventScroll:true});
      return;
    }
    if (key !== 'Tab' && ev.target !== $('#btnCloseBook')) readingEntryFocus = false;
    if (key === 'ArrowRight' || key === ' ' || key === 'PageDown') {
      ev.preventDefault();
      turn(1);
    } else if (key === 'ArrowLeft' || key === 'PageUp') {
      ev.preventDefault();
      turn(-1);
    } else if (key === '+' || key === '=') {
      ev.preventDefault();
      zoomReading(0.85);
    } else if (key === '-' || key === '_') {
      ev.preventDefault();
      zoomReading(1 / 0.85);
    } else if (key === '0' || key === 'f' || key === 'F') {
      fitReadingPage(true);
    } else if (key === 's' || key === 'S') {
      toggleView();
    } else if (key === 'r' || key === 'R') {
      resetSeatView();
    } else if (key === 'Escape') {
      ev.preventDefault();
      exitReading();
    }
    return;
  }
  if (APP.state.mode === 'explore') {
    if (key === 'Escape') toggleHelp(false);
    if (ev.code === 'KeyE' && !ev.repeat) {
      const action = hoverAction ? pickWorldInteraction() : pickWorldInteraction(true);
      if (action) { ev.preventDefault(); performWorldInteraction(action); }
    }
    if (key === 'Enter' && !ev.repeat) enterReading();
  }
}

// 05 · 环境音与唱片播放
async function toggleSound() {
  if (!amb) return;
  try {
    const on = await amb.toggle();
    APP.state.soundOn = !!on;
    const btn = $('#btnSound');
    if (btn) {
      btn.classList.toggle('is-active', !!on);
      btn.setAttribute('aria-pressed', String(!!on));
    }
    showToast(on ? '壁炉环境音已开启' : '壁炉环境音已关闭', 2000);
  } catch (err) {
    console.warn('ambience failed', err);
  }
}

async function toggleRain() {
  if (!amb || !amb.toggleRain) return;
  try {
    const on = await amb.toggleRain();
    APP.state.rainOn = !!on;
    const btn = $('#btnRain');
    if (btn) {
      btn.classList.toggle('is-active', !!on);
      btn.setAttribute('aria-pressed', String(!!on));
    }
    showToast(on ? '窗外下起了微雨' : '雨停了', 2000);
  } catch (err) {
    console.warn('rain failed', err);
  }
}

async function toggleNoise() {
  if (!amb || !amb.toggleNoise) return;
  try {
    const on = await amb.toggleNoise();
    APP.state.noiseOn = !!on;
    const btn = $('#btnNoise');
    if (btn) {
      btn.classList.toggle('is-active', !!on);
      btn.setAttribute('aria-pressed', String(!!on));
    }
    showToast(on ? '白噪音已开启 · 专注模式' : '白噪音已关闭', 2000);
  } catch (err) {
    console.warn('noise failed', err);
  }
}

function toggleTour() {
  if(APP.state.locomotion==='seated'){standUp(false,()=>toggleTour());return;}
  if(APP.state.reducedMotion){showToast('已启用减少动态效果，自动漫游保持关闭',2500);return;}
  if(APP.state.locomotion==='walk')leaveWalk({announce:false});
  APP.state.tourOn = !APP.state.tourOn;
  if (controls) {
    controls.autoRotate = APP.state.tourOn;
    controls.autoRotateSpeed = 0.4;
  }
  const btn = $('#btnTour');
  if (btn) {
    btn.classList.toggle('is-active', APP.state.tourOn);
    btn.setAttribute('aria-pressed', String(APP.state.tourOn));
  }
}

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  } catch (err) {
    showToast('浏览器暂时无法进入全屏');
  }
}

/* ------------------------------------------------------------------ */
/*  PDF 导入                                                          */
/* ------------------------------------------------------------------ */

function setDropOverlay(on) {
  const el = $('#dropOverlay');
  if (!el) return;
  el.hidden = false;
  el.classList.toggle('is-show', !!on);
  if (!on) setTimeout(() => { if (!el.classList.contains('is-show')) el.hidden = true; }, 380);
}

/* ------------------------------------------------------------------ */
/*  In-world actions and first-person movement                         */
/* ------------------------------------------------------------------ */

// 04 · 自由行走、碰撞与近距离互动
function clearWalkInput() {
  heldWalkInputs.clear();
  for (const key of Object.keys(walkInput)) walkInput[key] = false;
  walker?.stop();
}

function enterWalk({lockPointer=true} = {}) {
  if(APP.state.locomotion==='seated'){standUp(true);return;}
  if (!walker || APP.state.mode !== 'explore' || $('#musicPanel')?.classList.contains('is-open')) return;
  clearWalkInput();
  APP.state.locomotion = 'walk'; APP.state.tourOn = false;
  controls.enabled = false; controls.autoRotate = false;
  $('#btnTour')?.classList.remove('is-active');
  $('#btnTour')?.setAttribute('aria-pressed','false');
  walker.place(camera.position,camera.quaternion);
  camera.zoom = 1; camera.clearViewOffset();
  document.body.dataset.walking = 'true';
  $('#btnWalk')?.setAttribute('aria-pressed','true');
  walkHadLock = false;
  const canvas = renderer.domElement;
  clearReadingGesture();
  canvas.focus({preventScroll:true});
  try {
    const result = lockPointer && !matchMedia('(pointer:coarse)').matches ? canvas.requestPointerLock?.() : null;
    result?.catch?.(() => { if (APP.state.locomotion==='walk') showToast('按住画面拖动环视，Esc 退出',3000); });
  } catch (_e) { /* Drag-look remains available when pointer lock is unavailable. */ }
  showToast('自由行走 · WASD 移动 · 鼠标环视 · Shift 快走 · 空格跳跃 · E 互动 · Esc 退出',5500);
}

function leaveWalk({ announce = true } = {}) {
  if (APP.state.locomotion !== 'walk') return;
  APP.state.locomotion = 'orbit'; walkHadLock = false;
  clearWalkInput();
  clearReadingGesture();
  if (document.pointerLockElement === renderer.domElement) document.exitPointerLock?.();
  document.body.dataset.walking = 'false';
  $('#btnWalk')?.setAttribute('aria-pressed','false');
  camera.up.set(0,1,0);
  const forward = camera.getWorldDirection(new THREE.Vector3());
  controls.target.copy(camera.position).addScaledVector(forward,1.8);
  controls.enabled = true;
  renderer.domElement.style.cursor = 'grab';
  if (announce) showToast('已退出行走，恢复环绕查看',2200);
}

function makeWalker() {
  room.root.updateMatrixWorld(true);
  const objects = [...room.bookcases,room.sofa,...room.walkFurniture,
    ...room.root.children.filter(object=>['armchair','side-table','fireplace','door','ladder','floor-lamp','coat-rack','plant'].includes(object.name))].filter(Boolean);
  const obstacles = objects.map(object=>new THREE.Box3().setFromObject(object));
  obstacles.push(new THREE.Box3(new THREE.Vector3(TABLE.x-TABLE.width/2,TABLE.y,TABLE.z-TABLE.depth/2),
    new THREE.Vector3(TABLE.x+TABLE.width/2,TABLE.top,TABLE.z+TABLE.depth/2)));
  obstacles.push(...props.collisionBoxes);
  walker = createWalker({ bounds: new THREE.Box3(new THREE.Vector3(-ROOM.hx+0.25,0.05,-ROOM.hz+0.25),
    new THREE.Vector3(ROOM.hx-0.25,ROOM.h-0.15,ROOM.hz-0.25)),obstacles });
}

const centerAim = new THREE.Vector2();
const hitPoint = new THREE.Vector3();
const worldPicker = new THREE.Raycaster();
const staticPickBounds = new Map();
const roomOccluders = [];
const hitsBuffer = [];

function prepareInteractionBounds() {
  room.root.updateMatrixWorld(true);
  for (const root of [room.sofa,room.armchair,...shelfInspection.pickRoots,studyCompanion?.guideBook].filter(Boolean)) {
    staticPickBounds.set(root,new THREE.Box3().setFromObject(root));
  }
  room.root.traverse(object => {
    if (!object.isMesh || !object.visible) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (!materials.some(m => m && !m.transparent && m.opacity > .5)) return;
    // A selectable volume is already tested exactly as a target. Its parent can
    // change during inspection, so it does not belong in the fixed room index.
    for (let node=object;node;node=node.parent) if (staticPickBounds.has(node)) return;
    const bounds = new THREE.Box3().setFromObject(object);
    roomOccluders.push({object,bounds});
  });
}

function withinRay(box, ray, distance) {
  if (box.containsPoint(ray.origin)) return true;
  return ray.intersectBox(box, hitPoint) !== null &&
    hitPoint.distanceToSquared(ray.origin) <= distance * distance;
}

function pickWorldInteraction(centered = false) {
  if (!book || !props || !raycaster || shelfInspection?.active) return null;
  worldPicker.setFromCamera(centered || document.pointerLockElement === renderer.domElement ? centerAim : pointer,camera);
  worldPicker.far = APP.state.locomotion === 'walk' ? 2.4 : 20;
  let nearest = null;
  for (const root of [...book.closedPickMeshes,...props.pickRoots,...staticPickBounds.keys()]) {
    const bounds = staticPickBounds.get(root);
    if (!root.visible || (bounds && !withinRay(bounds,worldPicker.ray,worldPicker.far))) continue;
    hitsBuffer.length = 0;
    worldPicker.intersectObject(root,true,hitsBuffer);
    const hit = hitsBuffer.find(hit => {
      if (!hit.object.isMesh) return false;
      for (let node=hit.object;node;node=node.parent) if (!node.visible) return false;
      return true;
    });
    if (hit && (!nearest || hit.distance < nearest.distance)) {
      nearest = hit; worldPicker.far = hit.distance;
    }
  }
  if (!nearest) return null;
  worldPicker.far = nearest.distance - .025;
  for (const {object,bounds} of roomOccluders) {
    if (!withinRay(bounds,worldPicker.ray,worldPicker.far)) continue;
    hitsBuffer.length = 0;
    worldPicker.intersectObject(object,false,hitsBuffer);
    if (hitsBuffer.length) return null;
  }
  let id = 'book';
  for (let object=nearest.object;object;object=object.parent) if (object.userData.interaction) { id=object.userData.interaction;break; }
  return {id,distance:nearest.distance};
}

function updateInteractionHover(centered = false) {
  setInteractionHover(pickWorldInteraction(centered));
}

function setInteractionHover(action) {
  const id = action?.id || '';
  book?.setHover(id==='book'); props?.setHover(id);
  if (id !== (hoverAction?.id || '')) {
    clearTimeout(roomHintTimer);
    const hint = $('#worldInteractionHint');
    if (hint) {
      hint.hidden = !id;
      hint.textContent = id==='book' ? (APP.state.locomotion === 'seated' ? '翻开茶几上的书' : '坐到沙发上，准备翻书') :
        id==='study-guide' ? '点击 / E · 翻阅《本科生速通指南》' :
          id.startsWith('shelf-volume-') ? '点击 / E · 抽出这本书，转动查看' : id==='music' ? '点击 / E · 打开唱片机' : id.startsWith('seat-')?'点击 / E · 坐下来休息':'点击 / E · 端起咖啡';
    }
  }
  hoverAction = action;
  if (APP.state.locomotion !== 'walk') renderer.domElement.style.cursor = id ? 'pointer' : 'grab';
}

function performWorldInteraction(action) {
  if (!action || APP.state.mode !== 'explore') return;
  if (shelfInspection?.active)return;
  if(action.id.startsWith('shelf-volume-'))shelfInspection.take(action.id);
  else if (action.id==='book') {
    if (APP.state.locomotion === 'seated') enterReading();
    else sitDown('sofa');
  }
  else if(action.id==='seat-sofa')sitDown('sofa');
  else if(action.id==='seat-armchair')sitDown('armchair');
  else if(action.id==='study-guide')studyCompanion?.openGuide();
  else if (action.id==='music') openMusicPanel();
  else if (action.id==='coffee' && props.sip()) showToast('端起咖啡，给自己片刻休息 · 杯子会自动轻放回杯碟',3000);
}

function openMusicPanel() {
  if (!['explore','reading'].includes(APP.state.mode) || APP.state.importing) return;
  toggleSceneryPanel(false);
  toggleHelp(false);
  toggleToc(false);
  if (APP.state.locomotion==='walk') leaveWalk({announce:false});
  clearWalkInput();
  const panel=$('#musicPanel'); if(panel){panel.classList.add('is-open');panel.hidden=false;}
  $('#musicImport')?.focus({preventScroll:true});
  void loadOptionalRecord();
}

function seatButton(active){
  const button=$('#btnSit');if(!button)return;
  button.setAttribute('aria-pressed',String(active));button.classList.toggle('is-active',active);
  button.querySelector('.chip__label').textContent=active?'起身':'坐下';
  document.body.dataset.seated=String(active);
}

function sitDown(id='sofa', onDone){
  if(APP.state.mode!=='explore'||!SEATS[id])return;
  if(APP.state.locomotion==='seated'&&APP.state.seatId===id){if(onDone)onDone();else standUp();return;}
  if(APP.state.locomotion!=='seated')seatRestore={position:camera.position.clone(),look:controls.enabled?controls.target.clone():camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3())),fov:camera.fov,walk:APP.state.locomotion==='walk'};
  if(APP.state.locomotion==='walk')leaveWalk({announce:false});
  APP.state.tourOn=false;controls.autoRotate=false;$('#btnTour')?.setAttribute('aria-pressed','false');$('#btnTour')?.classList.remove('is-active');
  clearWalkInput();clearReadingGesture();controls.enabled=false;APP.state.mode='transitioning';
  seatLook=createSeatLook(SEATS[id]);APP.state.seatId=id;
  startTransition({toPos:seatLook.eye,toLook:seatLook.target(),toUp:new THREE.Vector3(0,1,0),duration:1.2,fov:58,
    onEnd(){APP.state.mode='explore';APP.state.locomotion='seated';seatLook.apply(camera);seatButton(true);renderer.domElement.style.cursor='grab';onDone?.();}});
  showToast('坐在'+SEATS[id].label+'上 · 拖动环视 · C 起身 · 点击书本阅读',4500);
}

function goToView(position, look, fov = APP.camera.homeFov) {
  if (APP.state.mode !== 'explore' || shelfInspection?.active || APP.state.importing) return;
  if (APP.state.locomotion === 'walk') leaveWalk({ announce: false });
  if (APP.state.locomotion === 'seated') { seatButton(false); seatLook = null; }
  APP.state.locomotion = 'orbit';
  APP.state.mode = 'transitioning';
  APP.state.tourOn = false;
  controls.autoRotate = false;
  controls.enabled = false;
  $('#btnTour').classList.remove('is-active');
  $('#btnTour').setAttribute('aria-pressed', 'false');
  orbitZoom = 1;
  orbitBreath = 0;
  startTransition({ toPos: position, toLook: look, toUp: camera.up, duration: 1, fov, onEnd() {
    controls.target.copy(look);
    controls.enabled = true;
    APP.state.mode = 'explore';
    controls.update();
  } });
}

function standUp(forceWalk=false,onDone){
  if(APP.state.mode!=='explore'||APP.state.locomotion!=='seated')return;
  const restore=seatRestore||{position:APP.camera.homePos,look:APP.camera.homeLook,fov:APP.camera.homeFov};
  clearReadingGesture();APP.state.mode='transitioning';controls.enabled=false;seatButton(false);
  startTransition({toPos:restore.position,toLook:restore.look,toUp:new THREE.Vector3(0,1,0),duration:1.05,fov:restore.fov,
    onEnd(){
      APP.state.mode='explore';APP.state.locomotion='orbit';seatLook=null;controls.target.copy(restore.look);controls.enabled=true;controls.update();
      if (forceWalk || restore.walk) enterWalk({lockPointer:false});
      onDone?.();
    }});
}

// 06 · 书屋工具、窗景与弹层
function roomToolFocus(id) {
  const onMobile = window.matchMedia('(max-width: 880px)').matches;
  $(onMobile ? '#roomMenu' : '#'+id)?.focus({preventScroll:true});
}

function toggleSceneryPanel(force){
  const panel=$('#sceneryPanel');if(!panel)return;
  const open=typeof force==='boolean'?force:!panel.classList.contains('is-open');
  if (!open && panel.hidden) return;
  if (open) { toggleHelp(false); closeMusicPanel(); }
  if(open&&APP.state.locomotion==='walk')leaveWalk({announce:false});
  panel.hidden=!open;panel.classList.toggle('is-open',open);$('#btnScenery')?.setAttribute('aria-expanded',String(open));
  if(open)panel.querySelector('[data-scenery]')?.focus();else (window.matchMedia('(max-width: 880px)').matches ? $('#roomMenu') : $('#btnScenery'))?.focus({preventScroll:true});
}

function setupLivingRoom(){
  room.sofa.userData.interaction='seat-sofa';room.armchair.userData.interaction='seat-armchair';
  scenery=createScenery(room,{scene,quality:APP.state.quality,reducedMotion:APP.state.reducedMotion});
  let scenerySelection=0;
  const reflectScenery=key=>document.querySelectorAll('[data-scenery]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.scenery===key)));
  const saveScenery=key=>{
    reflectScenery(key);
    try {
      if(key) localStorage.setItem('sanctuary-scenery',key);
      else localStorage.removeItem('sanctuary-scenery');
    } catch {}
  };
  const select=async (key,persist=true)=>{
    key=normalizeSceneryKey(key);if(!Object.hasOwn(SCENERY,key))return;const request=++scenerySelection;
    try{
      await scenery.choose(key);if(request!==scenerySelection)return;
      if(persist)saveScenery(scenery.current);
      else reflectScenery(scenery.current);
    }catch(error){if(request===scenerySelection){reflectScenery(scenery.current);showToast('窗景载入失败，请重试');}}
  };
  $('#btnSit')?.addEventListener('click',()=>APP.state.locomotion==='seated'?standUp():sitDown('sofa'));
  const sceneryButton=$('#btnScenery');
  sceneryButton?.addEventListener('click',()=>{if(!sharedEnvironment)toggleSceneryPanel();});
  $('#sceneryClose')?.addEventListener('click',()=>toggleSceneryPanel(false));
  document.querySelectorAll('[data-scenery]').forEach(button=>button.addEventListener('click',()=>select(button.dataset.scenery)));
  void scenery.ready.then(()=>{if(!scenerySelection)saveScenery(scenery.current);});
  if (__STUDY_COMPANION__) {
    const weatherScenery={dusk:'mountain',day:'forest',rain:'mountain',snow:'snow'};
    let soloScenery;
    applySharedEnvironment=value=>{
      const previous=sharedEnvironment;
      if(!previous&&!value)return;
      if(!previous)soloScenery=scenery.current;
      sharedEnvironment=value;
      const hint=$('#worldInteractionHint');
      if(value&&!hint.hidden&&hint.textContent==='壁炉已经点好了')hint.textContent='共学房间已就绪';
      sceneryButton.disabled=!!value;
      sceneryButton.title=value?'窗景由房主在共学面板设置':'窗外景色';
      for(const button of document.querySelectorAll('[data-scenery]'))button.disabled=!!value;
      room.windowPane.uniforms.rain.value=Number(value?.weather==='rain');
      if(previous?.weather!==value?.weather)void select(value?weatherScenery[value.weather]:soloScenery,false);
    };
  }
  const preference=window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const setMotion=()=>{APP.state.reducedMotion=!!preference?.matches;controls.enableDamping=!APP.state.reducedMotion;room.setReducedMotion(APP.state.reducedMotion);scenery.setReducedMotion(APP.state.reducedMotion);book?.setReducedMotion(APP.state.reducedMotion);props?.setReducedMotion(APP.state.reducedMotion);shelfInspection?.setReducedMotion?.(APP.state.reducedMotion);syncRecordMark(recordPlaying);if(APP.state.reducedMotion&&controls.autoRotate){controls.autoRotate=false;APP.state.tourOn=false;$('#btnTour').setAttribute('aria-pressed','false');$('#btnTour').classList.remove('is-active');}};
  setMotion();preference?.addEventListener?.('change',setMotion);
}

function closeMusicPanel() {
  const panel=$('#musicPanel');
  if (panel.hidden) return;
  panel.classList.remove('is-open');
  panel.hidden = true;
  if (APP.state.mode === 'reading') $('#btnReadMusic').focus({preventScroll:true});
  else roomToolFocus('btnMusic');
}

function musicTime(seconds) {
  const s=Math.max(0,Math.floor(Number(seconds)||0));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');
}

let recordSpin;
let recordCoast;
let recordPlaying = false;
let recordRequest;

function loadOptionalRecord() {
  const record = window.__ASSETS__?.record;
  if (!record || music.snapshot().tracks.length) return;
  recordRequest ??= fetch(record.url).then(async (response) => {
    if (!response.ok) throw new Error('Record unavailable');
    const content = await response.blob();
    if (!music.snapshot().tracks.length) await music.importFiles([new File([content], record.name, { type:'audio/mpeg' })]);
  }).catch(() => {
    if (!music.snapshot().tracks.length) $('#musicStatus').textContent = '默认唱片尚未缓存，可以导入本机音乐。';
  }).finally(() => { recordRequest = undefined; });
  return recordRequest;
}

function syncRecordMark(playing) {
  recordPlaying = playing;
  if (!recordSpin) return;
  recordCoast?.cancel();
  if (APP.state.reducedMotion) { recordSpin.pause(); return; }
  if (playing) { recordSpin.play(); return; }
  const angularOffset = (Number(recordSpin.currentTime) || 0) % (60000 / 33) * 33 * .006;
  recordSpin.pause();
  recordCoast = $('.record-mark').animate([{transform:`rotate(${angularOffset}deg)`},{transform:`rotate(${angularOffset + 20}deg)`}],
    {duration:200, easing:'ease-out'});
  recordCoast.onfinish = () => {
      if (!recordPlaying) recordSpin.currentTime = (angularOffset + 20) * (60000 / 33) / 360;
    };
}

async function importMusic(files) {
  if (files.length) await music.importFiles(files);
}

function setupMusic() {
  recordSpin = $('.record-mark').animate([{transform:'rotate(0deg)'},{transform:'rotate(360deg)'}],
    {duration:60000 / 33, iterations:Infinity});
  recordSpin.pause();
  let previousError = '';
  music=createLocalMusic({audio:$('#localMusicAudio'),onChange:state=> {
    props.setPlaying(state.playing);
    if (state.error && state.error !== previousError && state.error !== '点击播放开始音乐') showToast(state.error);
    previousError = state.error;
    if (recordPlaying !== state.playing) syncRecordMark(state.playing);
    $('#musicTrackTitle').textContent=state.title;
    $('#musicStatus').textContent=state.error || (state.tracks.length ? (state.index+1)+' / '+state.tracks.length+' · 本地播放' : '音乐仅在你的浏览器内播放');
    $('#musicPlay').textContent=state.playing?'暂停':'播放';
    $('#musicPlay').disabled=!state.tracks.length;
    $('#musicPrev').disabled=$('#musicNext').disabled=state.tracks.length<2;
    const seek=$('#musicSeek');seek.disabled=!state.duration;seek.max=String(state.duration||1);
    if(document.activeElement!==seek)seek.value=String(state.time);
    $('#musicTime').textContent=musicTime(state.time)+' / '+musicTime(state.duration);
  }});
  $('#musicImport').addEventListener('click',()=>$('#musicInput').click());
  $('#musicInput').addEventListener('change',async event=>{
    await importMusic(event.target.files);event.target.value='';
  });
  $('#musicPlay').addEventListener('click',()=>music.toggle());
  $('#musicPrev').addEventListener('click',()=>music.previous());
  $('#musicNext').addEventListener('click',()=>music.next());
  $('#musicSeek').addEventListener('input',event=>music.seek(Number(event.target.value)));
  $('#musicVolume').addEventListener('input',event=>music.setVolume(Number(event.target.value)/100));
  $('#musicClose').addEventListener('click',closeMusicPanel);
  music.setVolume(0.65);
  window.__loadDefaultRecord?.(music);
  window.addEventListener('pagehide',event=>{if(!event.persisted)music.dispose();});
}

/**
 * 当前书页在屏幕上的包围矩形（CSS px）。
 * 挂在 book 上一起暴露，验收脚本可以直接调用判断取景是否与控制栏重叠。
 */
function pageScreenRect() {
  if (!book) return null;
  const pts = book.getPageCorners();
  if (!pts.length) return null;
  let l = Infinity;
  let t = Infinity;
  let r = -Infinity;
  let b = -Infinity;
  for (const p of pts) {
    const v = p.clone().project(camera);
    const x = (v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    l = Math.min(l, x);
    t = Math.min(t, y);
    r = Math.max(r, x);
    b = Math.max(b, y);
  }
  return { left: l, top: t, right: r, bottom: b, width: r - l, height: b - t };
}

function mountBook(sources, coverTex, bookmarkKey = '') {
  const previous = book;
  const previousView = previous?.getView?.();
  book = createBook(scene, sources, coverTex, PAGES, { quality: APP.state.quality });
  previous?.dispose?.();
  bookRestPose = { position: book.group.position.clone(), quaternion: book.group.quaternion.clone() };
  book.setReducedMotion(APP.state.reducedMotion);
  book.onSpread((_spread,left) => {
    markFrameDirty();
    updateReadingHud();
    if (bookmarkKey && APP.state.mode === 'reading') {
      try { localStorage.setItem(bookmarkKey,String(left)); } catch { /* Storage may be disabled. */ }
    }
  });
  book.onTurn(() => {updateReadingHud();shadowCache?.invalidate();});
  if (sources.length === 1 || previousView === 'single') book.setView('single');
  if (bookmarkKey) {
    try {
      const page = Number(localStorage.getItem(bookmarkKey));
      if (Number.isInteger(page) && page > 0 && page < sources.length) book.jumpToPage(page);
    } catch { /* Storage may be disabled. */ }
  }
  book.preload?.(2);
  markFrameDirty();
  if (book) book.pageScreenRect = () => pageScreenRect();
  return book;
}

function showLoader(text) {
  const el = $('#loading');
  if (!el) return;
  clearTimeout(loaderHideTimer);
  el.style.display = '';
  el.classList.remove('is-done');
  el.setAttribute('aria-busy', 'true');
  setProgress(4, text || '正在解析书稿…');
}

function hideLoader() {
  const el = $('#loading');
  if (!el) return;
  clearTimeout(loaderHideTimer);
  el.classList.add('is-done');
  el.setAttribute('aria-busy', 'false');
  loaderHideTimer = setTimeout(() => { el.style.display = 'none'; }, 700);
}

function wireDropZone() {
  let depth = 0;
  const isFileDrag = (ev) => {
    const dt = ev.dataTransfer;
    if (!dt) return false;
    return Array.from(dt.types || []).includes('Files');
  };
  window.addEventListener('dragenter', (ev) => {
    if (!isFileDrag(ev)) return;
    ev.preventDefault();
    depth++;
    setDropOverlay(true);
  });
  window.addEventListener('dragover', (ev) => {
    if (!isFileDrag(ev)) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (ev) => {
    if (!isFileDrag(ev)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) setDropOverlay(false);
  });
  window.addEventListener('drop', (ev) => {
    if (!isFileDrag(ev)) return;
    ev.preventDefault();
    depth = 0;
    setDropOverlay(false);
    const files=[...ev.dataTransfer.files];
    const audioFiles=files.filter(file=>file.type.startsWith('audio/')||/\.(mp3|wav|ogg|m4a|flac|aac|opus)$/i.test(file.name));
    if(audioFiles.length){openMusicPanel();importMusic(audioFiles);}
    else handlePdfFiles(files);
  });
}

function encodePdfPage(source) {
  const maxHeight = 2400;
  const aspect = source.width / source.height;
  if (Math.abs(aspect / BOOK_PAGE_ASPECT - 1) < .001 && source.height <= maxHeight) {
    return source.toDataURL('image/webp',.9);
  }
  const canvas = document.createElement('canvas');
  canvas.height = Math.min(maxHeight, Math.ceil(Math.max(source.height, source.width / BOOK_PAGE_ASPECT)));
  canvas.width = Math.round(canvas.height * BOOK_PAGE_ASPECT);
  const ctx = canvas.getContext('2d');
  const scale = Math.min(canvas.width/source.width, canvas.height/source.height);
  const width = source.width*scale, height = source.height*scale;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(source,(canvas.width-width)/2,(canvas.height-height)/2,width,height);
  return canvas.toDataURL('image/webp',.9);
}

async function handlePdfFiles(files) {
  if (!importer) return;
  const list = Array.from(files || []);
  if (!list.length) return;
  if (APP.state.importing || APP.state.mode==='transitioning' || APP.state.mode==='intro') {
    showToast('请等当前动作完成后再导入书稿',2500);return;
  }
  if (APP.state.locomotion==='walk')leaveWalk({announce:false});
  APP.state.importing=true;
  setDropOverlay(false);
  showLoader('正在解析书稿…');
  try {
    const meta = await importer.handleFiles(list);
    const count = (meta && meta.count) || importer.getPageCount() || 0;
    if (!count) throw new Error('这本 PDF 里没有可显示的页面');
    const label = (meta && meta.name) || (list[0].name || '本地书稿').replace(/\.pdf$/i, '');

    const scale = APP.state.quality === 'low' ? 1.9 : 2.6;
    const uris = [];
    for (let i = 0; i < count; i++) {
      setProgress(8 + (i / count) * 88, `正在排版第 ${i + 1} / ${count} 页…`);
      await new Promise((resolve) => setTimeout(resolve, 0));
      const canvas = meta?.pages?.[i]?.canvas || await importer.renderPage(i, scale);
      if (!canvas) throw new Error(`第 ${i + 1} 页渲染失败`);
      uris.push(encodePdfPage(canvas));
    }

    mountBook(uris, originalCover);
    await book.waitForVisible();
    PAGES.length = 0;
    for (let i = 0; i < count; i++) PAGES.push(`${label} · 第 ${i + 1} 页`);
    APP.state.pdfMode = true;

    buildToc();

    setProgress(100, '书稿已装订完成');
    await new Promise((r) => setTimeout(r, 260));
    hideLoader();

    if (APP.state.mode !== 'reading') {
      APP.state.mode = 'explore';
      enterReading();
    } else {
      applyBookMix(1);
      applyBookTransfer(1);
      markFrameDirty();
    }
    updateReadingHud();
    showToast(`已换成新书 · ${count} 页`, 4200);
  } catch (err) {
    hideLoader();
    showToast(`导入失败：${err && err.message ? err.message : err}`, 6000);
  } finally {
    APP.state.importing=false;
  }
}

/* ------------------------------------------------------------------ */
/*  启动                                                              */
/* ------------------------------------------------------------------ */

/**
 * 设备能力分级：弱机降档（像素比、阴影贴图、后处理），强机才开满。
 * 依据：GPU 名称、逻辑核心数、内存、DPR、是否移动端。
 */
function readQualityChoice() {
  try {
    const choice = localStorage.getItem('sanctuary-quality');
    if (['high','medium','low'].includes(choice)) return choice;
  } catch {}
  return 'auto';
}

function pickQuality() {
  const choice = readQualityChoice();
  if (choice !== 'auto') return choice;
  let gpu = '';
  try {
    const gl = renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (dbg) gpu = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '');
  } catch (_e) {
    /* ignore */
  }
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 8;
  const dpr = window.devicePixelRatio || 1;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
    || matchMedia('(pointer: coarse)').matches && Math.min(screen.width,screen.height) <= 920;
  const weakGpu = /SwiftShader|llvmpipe|Mali-[GT][0-9]|Adreno \(TM\) [1-5]|Intel\(R\) (HD|UHD) Graphics [0-6]|HD Graphics [0-6]/i.test(gpu);
  if (mobile || weakGpu || cores <= 4 || mem <= 4) return 'low';
  if (dpr > 2.4 || innerWidth <= 880 || cores <= 6) return 'medium';
  return 'high';
}

const QUALITY = {
  low: { dpr: 1.25, shadows: 768 },
  medium: { dpr: 1.5, shadows: 1280 },
  high: { dpr: 2.0, shadows: 2048 },
};

function setupRenderer() {
  configureStableRoomLighting();
  const canvas = $('#scene');
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
    stencil: false,
  });
  APP.state.quality = pickQuality();
  const q = QUALITY[APP.state.quality];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.dpr));
  renderer.shadowMap.autoUpdate = true;
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = ROOM_EXPOSURE;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // r187 起 PCFSoft 已并入 PCF；靠 shadow.radius 做软化
  renderer.setClearColor(ROOM_SHADOW, 1);
  // 关掉自动清零：一帧里阴影 pass + 所有后处理 pass 的调用数会累加，
  // 这样统计到的才是整帧真实开销，而不是最后一个全屏 pass 的 1 次调用。
  renderer.info.autoReset = false;
}

function setHomeFraming(aspect) {
  APP.camera.homeFov = 48;
  if (aspect < .84) {
    APP.camera.homePos.set(-.25, 1.32, 3.04);
    APP.camera.homeLook.set(.05, 1.02, -.76);
  } else if (aspect >= 1.34) {
    const wide = THREE.MathUtils.smoothstep(aspect, 1.78, 2.84);
    APP.camera.homePos.set(THREE.MathUtils.lerp(-3.29,-2.46,wide),1.33,3.30+.04*wide);
    APP.camera.homeLook.set(THREE.MathUtils.lerp(-1.63,-1.40,wide),1.13+.06*wide,-.70);
  } else {
    APP.camera.homePos.set(1.55, 1.32, 3.28);
    APP.camera.homeLook.set(-.34, 1.02, -.76);
  }
}

function setupScene() {
  setHomeFraming(window.innerWidth / window.innerHeight);
  scene = new THREE.Scene();
  scene.background = new THREE.Color(ROOM_SHADOW);
  scene.fog = new THREE.FogExp2(ROOM_SHADOW, .043);

  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.01, 60);
  camera.position.copy(APP.camera.introPos);
  camera.up.set(0, 1, 0);
  camera.lookAt(APP.camera.introLook);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new RoomEnvironment();
  scene.environment = pmrem.fromScene(envScene, 0.04).texture;
  scene.environmentIntensity = 0.25;
  envScene.dispose?.();
  pmrem.dispose();

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(APP.camera.homeLook);
  controls.enableDamping = !APP.state.reducedMotion;
  controls.dampingFactor = 0.06;
  controls.rotateSpeed = 0.5;
  controls.zoomSpeed = 0.6;
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.screenSpacePanning = true;
  controls.minDistance = 0.65;
  controls.maxDistance = 5.8;
  controls.minPolarAngle = THREE.MathUtils.degToRad(4);
  controls.maxPolarAngle = THREE.MathUtils.degToRad(89);
  controls.minAzimuthAngle = -Infinity;
  controls.maxAzimuthAngle = Infinity;
  controls.enabled = false;
}

// The home shot only uploads the objects in front of it. Warm the other walls
// into a tiny linear target while the loading screen is still up.
async function warmRoomViews() {
  const previous = renderer.getRenderTarget();
  const target = new THREE.WebGLRenderTarget(48,48,{type:THREE.HalfFloatType});
  const eye = new THREE.PerspectiveCamera(108,1,.02,60);
  eye.position.set(0,1.6,0);
  try {
    renderer.setRenderTarget(target);
    await renderer.compileAsync(scene,eye);
    for (const [x,z] of [[1,0],[0,1],[-1,0],[0,-1]]) {
      eye.lookAt(x,1.56,z);
      renderer.render(scene,eye);
      await new Promise(requestAnimationFrame);
    }
  } finally {
    renderer.setRenderTarget(previous);
    target.dispose();
    shadowCache?.invalidate();
  }
}

function clampCameraInRoom() {
  if (!camera || !ROOM) return;
  controls.target.x = THREE.MathUtils.clamp(controls.target.x, -ROOM.hx + 1.0, ROOM.hx - 1.0);
  controls.target.z = THREE.MathUtils.clamp(controls.target.z, -ROOM.hz + 1.0, ROOM.hz - 1.0);
  controls.target.y = THREE.MathUtils.clamp(controls.target.y, 0.65, 2.5);
  camera.position.x = THREE.MathUtils.clamp(camera.position.x, -ROOM.hx + 0.62, ROOM.hx - 0.62);
  camera.position.z = THREE.MathUtils.clamp(camera.position.z, -ROOM.hz + 0.68, ROOM.hz - 0.24);
  camera.position.y = THREE.MathUtils.clamp(camera.position.y, 0.72, ROOM.h - 0.35);
  if (room) {
    if (!APP.camera.obstacles) {
      APP.camera.obstacles = [room.sofa, room.table, props?.player, room.armchair, ...room.walkFurniture]
        .filter(Boolean).map(object => new THREE.Box3().setFromObject(object));
    }
    for (const box of APP.camera.obstacles) {
      if (camera.position.x > box.min.x - 0.08 && camera.position.x < box.max.x + 0.08 &&
          camera.position.z > box.min.z - 0.08 && camera.position.z < box.max.z + 0.08 &&
          camera.position.y < box.max.y + 0.12) camera.position.y = box.max.y + 0.12;
    }
  }
  camera.lookAt(controls.target);
}

function wireCanvas() {
  const el = renderer.domElement;
  el.tabIndex = -1;
  el.addEventListener('webglcontextlost',event=>{
    event.preventDefault();APP.state.contextLost=true;clearWalkInput();
    const status=$('#graphicStatus');if(status){status.hidden=false;status.querySelector('p').textContent='画面暂时中断，正在等待图形恢复…';}
  });
  el.addEventListener('webglcontextrestored',()=>{
    try{
      fx?.dispose();fx=createPostFX(renderer,scene,camera);fx.setSize(window.innerWidth,window.innerHeight);fx.setQuality(APP.state.quality);fx.setReadingMode(APP.state.mode==='reading');
      shadowCache?.invalidate();renderer.shadowMap.needsUpdate=true;APP.state.contextLost=false;lastTime=performance.now();$('#graphicStatus').hidden=true;
      showToast('画面已恢复，阅读位置已保留',2200);
    }catch(error){$('#graphicStatus p').textContent='暂时无法恢复画面，可刷新后继续。';console.error(error);}
  });
  const pinchDistance = () => {
    const [a,b] = orbitTouches.values();
    return b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  el.addEventListener('pointerdown', ev => {
    if (ev.pointerType !== 'touch' || !controls.enabled || APP.state.mode !== 'explore') return;
    orbitTouches.set(ev.pointerId, {x:ev.clientX, y:ev.clientY});
    orbitPinchDistance = pinchDistance();
    if (orbitPinchDistance) pointerDown.active = false;
  });
  el.addEventListener('pointermove', ev => {
    if (!orbitTouches.has(ev.pointerId)) return;
    orbitTouches.set(ev.pointerId, {x:ev.clientX, y:ev.clientY});
    const distance = pinchDistance();
    if (distance && orbitPinchDistance && controls.enabled && APP.state.mode === 'explore') {
      orbitZoom = THREE.MathUtils.clamp(orbitZoom * distance / orbitPinchDistance, .6, 2.2);
    }
    orbitPinchDistance = distance;
  });
  for (const name of ['pointerup','pointercancel','lostpointercapture']) {
    el.addEventListener(name, ev => {
      orbitTouches.delete(ev.pointerId);
      orbitPinchDistance = pinchDistance();
    });
  }
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerleave', () => {
    if (APP.state.mode === 'explore' && APP.state.locomotion !== 'walk') setInteractionHover(null);
  });
  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointerup', onPointerUp);
  el.addEventListener('pointercancel',()=>{clearReadingGesture();shelfInspection?.cancelDrag();});
  el.addEventListener('lostpointercapture', ev => {
    shelfInspection?.cancelDrag();
    if (readingPointers.has(ev.pointerId) || (APP.state.locomotion === 'walk' && pointerDown.id === ev.pointerId)) clearReadingGesture();
  });
  el.addEventListener('wheel', onWheel, { passive: false });
  el.style.cursor = 'grab';
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('dblclick', ev => {
    if (APP.state.mode !== 'reading') return;
    clearTimeout(pageClickTimer);
    if (APP.state.zoom < 0.65) fitReadingPage(false);
    else zoomReading(0.45 / APP.state.zoom, ev.clientX, ev.clientY);
  });
  window.addEventListener('blur', () => {orbitTouches.clear();orbitPinchDistance=0;clearReadingGesture();clearWalkInput();shelfInspection?.cancelDrag();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)clearWalkInput();});
  document.addEventListener('mousemove',ev=>{
    if (APP.state.locomotion !== 'walk' || document.pointerLockElement !== el) return;
    const dx = ev.movementX || 0, dy = ev.movementY || 0;
    if (firstLockedMotion) {
      firstLockedMotion = false;
      if (Math.abs(dx) + Math.abs(dy) > 90) return;
    }
    walker.look(dx,dy);
    if (pointerDown.active) pointerDown.moved += Math.abs(dx) + Math.abs(dy);
  });
  document.addEventListener('pointerlockchange',()=>{
    if (document.pointerLockElement === el) {
      if (APP.state.locomotion !== 'walk') { document.exitPointerLock(); return; }
      walkHadLock = true; firstLockedMotion = true;
    }
    else if(walkHadLock && APP.state.locomotion==='walk')leaveWalk();
  });
  document.addEventListener('pointerlockerror',()=>{
    if(APP.state.locomotion==='walk')showToast('按住画面拖动也能环视，WASD 正常移动',3500);
  });
}

function setRoomTools(open) {
  $('#roomTools').classList.toggle('is-open', open);
  $('#roomMenu').setAttribute('aria-expanded', String(open));
}

function wireUi() {
  $('#graphicReload')?.addEventListener('click',()=>location.reload());
  const tools = $('#roomTools');
  const toolsButton = $('#roomMenu');
  const qualitySelect = $('#roomQuality');
  const currentChoice = readQualityChoice();
  qualitySelect.value = currentChoice;
  qualitySelect.options[0].textContent = '画质 · 自动（' + {high:'桌面高',medium:'均衡',low:'移动低'}[APP.state.quality] + '）';
  qualitySelect.addEventListener('change', () => {
    try { localStorage.setItem('sanctuary-quality', qualitySelect.value); }
    catch { qualitySelect.value = currentChoice; showToast('浏览器无法保存画质设置'); return; }
    location.reload();
  });
  $('#quickViews').addEventListener('click', (event) => {
    if (APP.state.mode !== 'explore' || APP.state.importing) return;
    switch (event.target.closest('button')?.dataset.view) {
      case 'read': sitDown('sofa', enterReading); break;
      case 'hearth': goToView(new THREE.Vector3(1.0,1.35,2.7),new THREE.Vector3(-.30,1.45,-.74),52); break;
      case 'shelves': $('#btnShelfSample').click(); break;
      case 'home': goToView(APP.camera.homePos, APP.camera.homeLook); break;
    }
  });
  window.matchMedia('(max-width: 880px)').addEventListener('change', () => setRoomTools(false));
  toolsButton.addEventListener('click', () => setRoomTools(!tools.classList.contains('is-open')));
  tools.addEventListener('click', event => {
    if (!event.target.closest('button') || !tools.classList.contains('is-open')) return;
    if (tools.contains(document.activeElement)) toolsButton.focus();
    setRoomTools(false);
  });
  const closeOutside = event => {
    if (!tools.contains(event.target) && !toolsButton.contains(event.target)) setRoomTools(false);
  };
  document.addEventListener('pointerdown', closeOutside);
  document.addEventListener('focusin', closeOutside);
  $('#readBar').addEventListener('transitionend', event => {
    if (event.target === $('#readBar') && event.propertyName === 'transform') markRectDirty();
  });
  $('#btnRead')?.addEventListener('click', () => enterReading());
  $('#btnPrev')?.addEventListener('click', () => turn(-1));
  $('#btnNext')?.addEventListener('click', () => turn(1));
  $('#btnExit')?.addEventListener('click', () => exitReading());
  $('#btnCloseBook')?.addEventListener('click', () => exitReading());
  $('#btnToc')?.addEventListener('click', () => toggleToc());
  $('#btnTocClose')?.addEventListener('click', () => toggleToc(false));
  $('#btnSound')?.addEventListener('click', () => toggleSound());
  $('#btnRain')?.addEventListener('click', () => toggleRain());
  $('#btnNoise')?.addEventListener('click', () => toggleNoise());
  $('#btnTour')?.addEventListener('click', () => toggleTour());
  $('#btnFull')?.addEventListener('click', () => toggleFullscreen());
  $('#btnHelp')?.addEventListener('click', () => toggleHelp());
  $('#btnHelpClose')?.addEventListener('click', () => toggleHelp(false));
  $('#btnWalk')?.addEventListener('click',()=>APP.state.locomotion==='walk'?leaveWalk():enterWalk());
  $('#btnMusic')?.addEventListener('click',openMusicPanel);
  $('#btnReadMusic')?.addEventListener('click',openMusicPanel);
  $('#btnReadCoffee')?.addEventListener('click',()=>{
    if(props?.busy)return;
    fitReadingPage(false);
    if(props?.sip(camera))showToast('端起咖啡，读到这里稍作休息',2500);
  });
  $('#btnSingle')?.addEventListener('click', () => toggleView());
  $('#btnFit')?.addEventListener('click', () => fitReadingPage(true));
  $('#btnZoomIn')?.addEventListener('click', () => zoomReading(0.8));
  $('#btnZoomOut')?.addEventListener('click', () => zoomReading(1.25));
  $('#btnSeatView')?.addEventListener('click', resetSeatView);
  $('#btnReadDrag')?.addEventListener('click', () => {
    APP.state.readingDrag = APP.state.readingDrag === 'orbit' ? 'pan' : 'orbit';
    updateReadingTools();
  });
  $('#btnPdf')?.addEventListener('click', () => $('#pdfInput')?.click());
  $('#pdfInput')?.addEventListener('change', (ev) => {
    handlePdfFiles(ev.target.files);
    ev.target.value = '';
  });
  document.querySelectorAll('#chapterNav .chapter-jump').forEach((btn) => {
    btn.addEventListener('click', () => jumpToChapter(btn.dataset.goto));
  });
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', ev => {
    if (heldWalkInputs.has(ev.code)) { ev.preventDefault(); releaseWalkInput(ev.code); }
  });
  document.querySelectorAll('[data-walk]').forEach(button => {
    button.addEventListener('pointerdown', ev => {
      if (APP.state.locomotion !== 'walk') return;
      ev.preventDefault();
      pressWalkInput(ev.pointerId,button.dataset.walk);
      button.setPointerCapture(ev.pointerId);
    });
    for (const event of ['pointerup','pointercancel','lostpointercapture']) {
      button.addEventListener(event, ev => releaseWalkInput(ev.pointerId));
    }
  });
  window.addEventListener('resize', onResize);
  document.addEventListener('fullscreenchange', () => {
    const btn = $('#btnFull');
    if (btn) {
      btn.classList.toggle('is-active', !!document.fullscreenElement);
      btn.setAttribute('aria-pressed', String(!!document.fullscreenElement));
    }
  });
  document.addEventListener('pointerdown', (ev) => {
    const panel = $('#tocPanel');
    if (!panel || !panel.classList.contains('is-open')) return;
    if (panel.contains(ev.target) || $('#btnToc')?.contains(ev.target)) return;
    toggleToc(false);
  });
  const markInteraction = () => { lastInteraction = performance.now(); };
  window.addEventListener('keydown', markInteraction, { passive: true });
  window.addEventListener('pointerdown', markInteraction, { passive: true });
  window.addEventListener('pointermove', markInteraction, { passive: true });
}

function onResize() {
  if (!renderer) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const atHome = APP.state.mode === 'explore' && APP.state.locomotion === 'orbit' &&
    !shelfInspection?.active && camera.position.distanceTo(APP.camera.homePos) < .10 &&
    controls.target.distanceTo(APP.camera.homeLook) < .04;
  setHomeFraming(w / h);
  if (atHome) {
    camera.position.copy(APP.camera.homePos);
    camera.fov = APP.camera.homeFov;
    controls.target.copy(APP.camera.homeLook);
    controls.update();
  }
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  if (fx) fx.setSize(w, h);
  markRectDirty();
  markFrameDirty();
  updateReadingTools();
}

async function boot() {
  try {
    setupRenderer();
    setupScene();
    wireCanvas();
    wireUi();
    buildToc();

    const assets = window.__ASSETS__;
    if (!assets || !assets.pages || !assets.pages.length) throw new Error('未找到内嵌书籍素材');

    setProgress(6, LOADING_STEPS[0]);
    const titleFont = document.fonts?.load('500 32px "Mountain Room Serif"', '山窗书屋地球');
    const loader = new THREE.TextureLoader();
    const maxAniso = Math.min(16, renderer.capabilities.getMaxAnisotropy());

    const coverTexture = await loader.loadAsync(assets.cover).catch(() => null);
    if (coverTexture) {
      coverTexture.colorSpace = THREE.SRGBColorSpace;
      coverTexture.anisotropy = maxAniso;
    }
    originalCover = coverTexture;
    setProgress(18, LOADING_STEPS[1]);

    const sources = assets.pages;

    setProgress(70, LOADING_STEPS[3]);
    const gallery={};
    for(const [key,source]of Object.entries(assets.artworks||{})){
      const texture=await loader.loadAsync(source);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=maxAniso;texture.name='masterwork:'+key;gallery[key]=texture;
    }
    room = buildRoom(scene, { coverTexture, spineTexture: assets.spine, gallery, quality: APP.state.quality,reducedMotion:APP.state.reducedMotion });
    props = createInteractiveProps(scene,room);
    const sampleVolumes=[];room.root.traverse(o=>{if(o.userData.interaction?.startsWith('shelf-volume-'))sampleVolumes.push(o);});
    document.addEventListener('click',ev=>{
      if(shelfInspection?.active && !ev.target.closest('#shelfInspection') && ev.target.closest('button')){ev.preventDefault();ev.stopImmediatePropagation();showToast('请先把手中的书放回书架');}
    },true);
    shelfInspection=createShelfInspection({scene,camera,controls,volumes:sampleVolumes,onTake:()=>{
      if(APP.state.locomotion==='walk')leaveWalk({announce:false});
      APP.state.tourOn=false;controls.autoRotate=false;$('#btnTour')?.classList.remove('is-active');$('#btnTour')?.setAttribute('aria-pressed','false');
      $('#worldInteractionHint').hidden=true;pointerDown.active=false;
    },onRestore:()=>{pointerDown.active=false;}});
    const sampleButton = $('#btnShelfSample');
    sampleButton.addEventListener('click',()=>{
      if(APP.state.mode!=='explore'||shelfInspection.active){showToast('请先回到书屋');return;}
      const locate=()=>{
        if(APP.state.locomotion==='walk')leaveWalk({announce:false});
        APP.state.tourOn=false;controls.autoRotate=false;$('#btnTour').setAttribute('aria-pressed','false');$('#btnTour').classList.remove('is-active');
        const center=new THREE.Vector3();sampleVolumes.forEach(v=>center.add(v.getWorldPosition(new THREE.Vector3())));center.divideScalar(sampleVolumes.length);
        goToView(center.clone().add(new THREE.Vector3(.05,.08,1.30)), center, 50);
        showToast('中层五本布面精装书可以拿起 · 点击书脊查看，Esc 放回',5500);
      };
      locate();
    });
    makeWalker();
    setupMusic();
    setProgress(84, LOADING_STEPS[4]);

    mountBook(sources, coverTexture, __STUDY_COMPANION__ ? 'study-companion-earth-page-v1' : '');
    await book.waitForVisible();
    setupLivingRoom();
    if (__STUDY_COMPANION__) {
      studyCompanion=installStudyCompanion({
        scene,room,getState:()=>APP.state,getWalker:()=>walker,
        getChapter:()=>APP.state.mode==='reading'&&!APP.state.pdfMode?chapterOfPage(book.getPages().active).key:null,
        updateReadingLayout:markRectDirty,
        setEnvironment:applySharedEnvironment,
        openEarth:()=>{if(!shelfInspection.active)enterReading();},
        prepareGuide:()=>{
          if(APP.state.mode!=='explore'||shelfInspection.active)return false;
          if(APP.state.locomotion==='walk')leaveWalk({announce:false});
          return true;
        },
      });
    }
    await scenery.ready;
    shadowCache=createStableShadows(renderer,()=>[book?.group,book?.closedGroup,props?.cup,props?.arm,shelfInspection?.held]);

    try {
      signage = addSignage(scene, { shadow: true, brass: room.materials.brass });
    } catch (err) {
      console.warn('signage skipped', err);
    }

    fx = createPostFX(renderer, scene, camera);
    fx.setSize(window.innerWidth, window.innerHeight);
    if (fx.setQuality) fx.setQuality(APP.state.quality);
    // 阴影贴图精度也随档位走（room 里的灯已在建场景时创建，这里覆盖 mapSize）
    if (room && room.lampSpot && room.lampSpot.castShadow) {
      const size = QUALITY[APP.state.quality].shadows;
      room.lampSpot.shadow.mapSize.set(size, size);
      if (room.lampSpot.shadow.map) {
        room.lampSpot.shadow.map.dispose();
        room.lampSpot.shadow.map = null;
      }
    }

    amb = createAmbience();
    for (const [id, active] of [['#btnRain',amb.isRainEnabled()],['#btnNoise',amb.isNoiseEnabled()]]) {
      $(id).setAttribute('aria-pressed', String(active));
      $(id).classList.toggle('is-active', active);
    }

    importer = createPdfImporter({
      onProgress: (pct, label) => setProgress(pct, label),
      onError: (e) => console.warn('pdf', e),
    });
    wireDropZone();

    raycaster = new THREE.Raycaster();
    raycaster.far = 20;
    prepareInteractionBounds();
    setProgress(94,'正在准备四周的书架与灯光…');
    await warmRoomViews();
    await titleFont;
    await document.fonts?.ready;
    renderer.toneMappingExposure = APP.state.reducedMotion ? ROOM_EXPOSURE : 0;
    room.update(0, 0, APP.state.reducedMotion ? 1 : .4);
    fx.render(0);
    setProgress(100, '欢迎来到山窗书屋');
    await new Promise((r) => setTimeout(r, 380));

    entryStarted = performance.now();
    document.body.dataset.entry = 'ready';
    hideLoader();

    camera.position.copy(APP.camera.introPos);
    camera.lookAt(APP.camera.introLook);
    APP.state.mode = 'intro';
    startTransition({
      focusBook: true,
      toPos: APP.camera.homePos,
      toLook: APP.camera.homeLook,
      toUp: new THREE.Vector3(0, 1, 0),
      duration: 2.8,
      fov: APP.camera.homeFov,
      onEnd: () => {
        APP.state.mode = 'explore';
        camera.up.set(0, 1, 0);
        controls.target.copy(APP.camera.homeLook);
        controls.enabled = true;
        controls.update();
        renderer.domElement.style.cursor = 'grab';
        lastInteraction = performance.now();
        for (const id of ['#roomMenu','#roomTools','#btnRead','#quickViews']) $(id).inert = false;
        const hint = $('#worldInteractionHint');
        hint.textContent = sharedEnvironment ? '共学房间已就绪' : '壁炉已经点好了';
        hint.hidden = false;
        roomHintTimer = setTimeout(() => { hint.hidden = true; }, 2400);
        console.info('山窗书屋 ready', {pages:book.pageCount, quality:APP.state.quality});
      },
    });

    renderer.setAnimationLoop(tick);
    // 给验收脚本的整帧统计钩子
    window.__frameStats = () => ({ ...frameStats });
    window.__debug = {
      renderer,
      scene,
      camera,
      controls,
      get book() { return book; },
      room,
      props,
      shelfInspection,
      get walker(){return walker;},
      get music(){return music;},
      get scenery(){return scenery;},
      get shadowCache(){return shadowCache;},
      app: APP,
      get fx() { return fx; },
      amb,
      THREE,
      get importer() {
        return importer;
      },
      pageScreenRect: () => pageScreenRect(),
      /** 整帧真实 draw call / 三角面（含阴影与全部后处理 pass） */
      frameStats: () => ({ ...frameStats }),
      usableRect: () => ({ ...usableRect() }),
    };
  } catch (err) {
    console.error(err);
    const panel = $('#errorPanel');
    if (panel) {
      panel.hidden = false;
      panel.classList.add('is-open');
      const detail = document.createElement('p');
      detail.className = 'error-detail';
      detail.style.cssText = 'margin-top:12px;font-size:10px;line-height:1.7;letter-spacing:.05em;opacity:.55;word-break:break-word;max-width:340px;text-align:center;';
      detail.textContent = String(err && err.message ? err.message : err);
      panel.appendChild(detail);
    }
    const loading = $('#loading');
    if (loading) {
      loading.classList.add('is-done');
      loading.setAttribute('aria-busy', 'false');
    }
    setProgress(100, '加载失败');
  }
}

/* ------------------------------------------------------------------ */
/*  渲染循环                                                          */
/* ------------------------------------------------------------------ */

function tick() {
  if(APP.state.contextLost)return;
  const now = performance.now();
  const rawDt = (now - lastTime) / 1000;
  const dt = Math.min(rawDt, 0.05);
  const animDt = Math.min(rawDt, 0.22);
  lastTime = now;
  elapsedTime += Math.min(rawDt, 0.1);
  const t = elapsedTime;

  if (transition) updateTransition(animDt);
  const entryAge = entryStarted === null ? 1200 : now - entryStarted;
  const fireRise = APP.state.reducedMotion ? 1 : .4 + .6 * THREE.MathUtils.smoothstep(entryAge, 0, 1200);
  renderer.toneMappingExposure = APP.state.reducedMotion
    ? ROOM_EXPOSURE : ROOM_EXPOSURE * THREE.MathUtils.smoothstep(entryAge, 0, 900);

  if (APP.state.mode==='explore' && APP.state.locomotion==='walk') {
    const body=walker.update(dt,walkInput);
    camera.position.copy(body.position);
    if (!APP.state.reducedMotion) camera.position.y += Math.sin(t*9)*.005*body.bob - body.landingDip;
    camera.quaternion.copy(body.quaternion);
    if (camera.fov !== 62) {
      camera.fov = THREE.MathUtils.damp(camera.fov,62,7,dt);
      if (Math.abs(camera.fov-62)<.005) camera.fov=62;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
    if(now-hoverCheckTime>60){hoverCheckTime=now;updateInteractionHover(true);}
  } else if(APP.state.mode==='explore'&&APP.state.locomotion==='seated'){
    seatLook?.apply(camera);
  } else if ((APP.state.mode === 'explore' || APP.state.mode === 'transitioning') && controls && controls.enabled) {
    controls.update();
    clampCameraInRoom();
    const idleFor = now - lastInteraction - 3000;
    const breathe = idleFor > 0 && !controls.autoRotate ? Math.sin(idleFor * Math.PI / 4000) * .005 : 0;
    orbitBreath = APP.state.reducedMotion ? 0 : THREE.MathUtils.damp(orbitBreath, breathe, 3, dt);
    const zoom = APP.state.reducedMotion ? orbitZoom : THREE.MathUtils.damp(camera.zoom, orbitZoom * (1 + orbitBreath), 9, dt);
    if (Math.abs(zoom - camera.zoom) > .00003) { camera.zoom = zoom; camera.updateProjectionMatrix(); }
  }
  if (APP.state.mode === 'reading') updateReadingCamera(dt);
  if (APP.state.mode === 'intro') camera.up.set(0, 1, 0);

  if (book) book.update(animDt);
  if (APP.state.pendingExit && !book?.isTurning()) exitReading();
  if (room) room.update(t, dt, sharedEnvironment?.hearth===false ? 0 : fireRise * (APP.state.soundOn ? 1.15 : 1));
  if (props) props.update(t,dt);
  shelfInspection?.update(dt);
  scenery?.update(dt);
  shadowCache?.update(!!transition||!!book?.isTurning());
  studyCompanion?.update(dt,now);
  if (signage && signage.update) signage.update(APP.state.reducedMotion ? 0 : t);

  if (fx) fx.render(dt);
  else renderer.render(scene, camera);

  // 记录整帧真实开销，然后清零给下一帧
  const info = renderer.info;
  if (info) {
    frameStats.calls = info.render.calls;
    frameStats.triangles = info.render.triangles;
    frameStats.points = info.render.points;
    frameStats.frames++;
    info.reset();
  }
}

boot();
