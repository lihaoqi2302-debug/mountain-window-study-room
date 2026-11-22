import * as THREE from 'three';
import { BOOK_TABLE } from './room.js';
import { deformTurningPage } from './page-curl.js';

/* ==================================================================
   3D 典藏真书与物理翻页引擎
   ------------------------------------------------------------------
   · 严格 A4 比例（210 × 297 mm），硬壳精装：封面/封底板、圆弧书脊、
     书页侧边层叠纹理、书签丝带
   · 展开为左右双页视图；每一页都是 40 段细分网格，顶点着色器实时
     计算纸张绕书脊的圆柱卷曲、重力垂坠与抬起
   · 单张纸正反两套贴图（正面 = 当前右页，背面 = 下一跨页左页），
     由 gl_FrontFacing 切换，背面自动镜像 UV
   · 中缝环境光遮蔽（gutter AO）与卷曲法线重算，让纸面在暖光下有
     真实的弧度与阴影
   ================================================================== */

const PAGE_W = 0.21;      // A4 宽 210mm
const PAGE_H = 0.297;     // A4 高 297mm
export const BOOK_PAGE_ASPECT = PAGE_W / PAGE_H;
const BOARD_T = 0.0032;   // 硬壳板厚
const BLOCK_T = 0.0170;   // 合上时纸叠厚度
const STACK_T = 0.0058;   // 展开后单侧纸叠厚度
const SEG = 40;           // 每页沿书脊方向的细分段数

const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/* ------------------------------------------------------------------ */
/*  贴图工具                                                           */
/* ------------------------------------------------------------------ */

let _pageEdgeTex = null;
function pageEdgeTexture() {
  if (_pageEdgeTex) return _pageEdgeTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#efe6d3';
  g.fillRect(0, 0, 64, 512);
  // 细密的纸页层叠线
  for (let i = 0; i < 512; i += 2) {
    const a = 0.05 + Math.random() * 0.10;
    g.fillStyle = `rgba(150,132,104,${a.toFixed(3)})`;
    g.fillRect(0, i, 64, 1);
  }
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(255,252,244,${(0.25 + Math.random() * 0.5).toFixed(2)})`;
    g.fillRect(Math.random() * 64, Math.random() * 512, 1 + Math.random() * 2, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  _pageEdgeTex = t;
  return t;
}

let _blankTex = null;
function blankPageTexture() {
  if (_blankTex) return _blankTex;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 724;
  const g = c.getContext('2d');
  g.fillStyle = '#faf9f6';
  g.fillRect(0, 0, 512, 724);
  const grad = g.createLinearGradient(0, 0, 512, 0);
  grad.addColorStop(0, 'rgba(160,142,110,0.16)');
  grad.addColorStop(0.14, 'rgba(160,142,110,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 724);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  _blankTex = t;
  return t;
}

function whitePixel() {
  const c = document.createElement('canvas');
  c.width = c.height = 2;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 2, 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ------------------------------------------------------------------ */
/*  纸张几何：书脊在 x = 0，外缘在 x = side * PAGE_W                    */
/* ------------------------------------------------------------------ */

function buildPageGeometry(side) {
  const nx = SEG;
  const ny = 2;
  const pos = new Float32Array((nx + 1) * (ny + 1) * 3);
  const uv = new Float32Array((nx + 1) * (ny + 1) * 2);
  const nor = new Float32Array((nx + 1) * (ny + 1) * 3);
  let p = 0;
  let q = 0;
  for (let i = 0; i <= nx; i++) {
    const u = i / nx;                       // 0 = 书脊，1 = 外缘
    for (let j = 0; j <= ny; j++) {
      const v = j / ny;                     // 0 = 页顶，1 = 页底
      pos[p++] = side * u * PAGE_W;
      pos[p++] = (0.5 - v) * PAGE_H;
      pos[p++] = 0;
      uv[q++] = side > 0 ? u : 1 - u;       // 右页：书脊在贴图左缘；左页反之
      uv[q++] = 1 - v;
      nor[p - 3] = 0; nor[p - 2] = 0; nor[p - 1] = 1;
    }
  }
  const idx = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const a = i * (ny + 1) + j;
      const b = (i + 1) * (ny + 1) + j;
      if (side > 0) idx.push(a, b, a + 1, b, b + 1, a + 1);
      else idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.boundingSphere.radius = PAGE_W * 1.6;
  return g;
}

/* ------------------------------------------------------------------ */
/*  纸张材质：PBR + 顶点卷曲 + 正反双贴图 + 中缝 AO                      */
/* ------------------------------------------------------------------ */

const CURL_GLSL = /* glsl */`
uniform float uPhi;
uniform float uCurl;
uniform float uDroop;
uniform float uLift;
uniform float uSide;
uniform float uW;

vec3 pagePoint(vec2 xy) {
  float d = abs(xy.x);
  float u = clamp(d / uW, 0.0, 1.0);
  float R = uW / max(uCurl, 1e-4);
  float a = u * uCurl;
  float qx = R * sin(a);
  float qz = R * (1.0 - cos(a));
  float cs = cos(uPhi);
  float sn = sin(uPhi);
  vec3 p;
  p.x = uSide * (qx * cs - qz * sn);
  p.z = qx * sn + qz * cs;
  p.y = xy.y;
  float w = u * u;
  p.y -= uDroop * w * sn;
  p.z += uLift * w * sn;
  return p;
}

vec3 pageNormal(vec2 xy) {
  float e = 0.0016;
  vec3 c = pagePoint(xy);
  vec3 a = pagePoint(xy + vec2(e, 0.0));
  vec3 b = pagePoint(xy + vec2(0.0, e));
  vec3 n = cross(a - c, b - c);
  float len = length(n);
  return len > 1e-9 ? n / len : vec3(0.0, 0.0, 1.0);
}
`;

/** 一套独立的纸张 uniform（每张纸一份，共享同一个着色器程序） */
function makeUniformSet(side, spineU0, blank) {
  return {
    uFront: { value: blank },
    uBack: { value: blank },
    uPhi: { value: 0 },
    uCurl: { value: 0.028 },
    uDroop: { value: 0 },
    uLift: { value: 0 },
    uSide: { value: side },
    uW: { value: PAGE_W },
    uSpineU0: { value: spineU0 },
    uGutter: { value: 1 },
    uFill: { value: 0.20 },
    uDeformed: { value: 0 },
  };
}

const WHITE = { tex: null };

function makePageMaterial() {
  if (!WHITE.tex) WHITE.tex = whitePixel();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xfffcf5,
    roughness: 0.9,
    metalness: 0.0,
    side: THREE.DoubleSide,
    map: WHITE.tex,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 0.0,
    transparent: true,
    opacity: 1,
  });
  mat.shadowSide = THREE.DoubleSide;
  // 所有纸页共用同一份编译产物，uniform 各自独立
  mat.customProgramCacheKey = () => 'cozy-page-v2';
  return mat;
}

/** 给纸张材质装上卷曲位移 + 正反双贴图 + 中缝 AO */
function patchPageMaterial(mat, U) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `uniform float uDeformed;\n${CURL_GLSL}
void main() {`)
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = uDeformed > 0.5 ? normal : pageNormal(position.xy);')
      .replace('#include <begin_vertex>', 'vec3 transformed = uDeformed > 0.5 ? position : pagePoint(position.xy);');

    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `uniform sampler2D uFront;
uniform sampler2D uBack;
uniform float uSpineU0;
uniform float uFill;
uniform float uGutter;
void main() {`
      )
      .replace(
        '#include <map_fragment>',
        `vec4 sampledDiffuseColor = vec4(1.0);
#ifdef USE_MAP
  vec2 uvf = vMapUv;
  vec4 fC = texture2D(uFront, uvf);
  vec4 bC = texture2D(uBack, vec2(1.0 - uvf.x, uvf.y));
  sampledDiffuseColor = gl_FrontFacing ? fC : bC;
  diffuseColor *= sampledDiffuseColor;
  float gd = mix(1.0 - uvf.x, uvf.x, uSpineU0);
  float gao = mix(0.55, 1.0, smoothstep(0.0, 0.085, gd));
  diffuseColor.rgb *= mix(1.0, gao, uGutter);
#endif`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
#ifdef USE_MAP
  totalEmissiveRadiance += sampledDiffuseColor.rgb * diffuse * uFill;
#endif`
      );
  };
  mat.needsUpdate = true;
}

/* ------------------------------------------------------------------ */
/*  分页贴图缓存（GPU 驻留上限，按需上传，避免 27 张超采样贴图爆显存）    */
/* ------------------------------------------------------------------ */

function createPageCache(sources, { quality } = {}) {
  const max = quality === 'low' ? 6 : 10;
  const loader = new THREE.TextureLoader();
  const entries = new Map(); // index -> { tex, loading, used, promise }
  let clock = 0;
  const readyCbs = [];
  const errorCbs = [];
  const maxAniso = quality === 'low' ? 4 : 16;
  let disposed = false;
  let pinned = new Set();

  function touch(i) {
    const e = entries.get(i);
    if (e) e.used = ++clock;
  }

  function evict() {
    if (entries.size <= max) return;
    const list = [...entries.entries()].filter(([i, e]) => e.tex && !pinned.has(i)).sort((a, b) => a[1].used - b[1].used);
    let n = entries.size - max;
    for (const [i, e] of list) {
      if (n <= 0) break;
      e.tex.dispose();
      entries.delete(i);
      n--;
    }
  }

  function request(i) {
    if (disposed || !sources[i]) return null;
    let e = entries.get(i);
    if (e) {
      touch(i);
      return e.promise;
    }
    const controller = new AbortController();
    e = { tex: null, used: ++clock, promise: null, controller };
    entries.set(i, e);
    const source = sources[i];
    e.promise = Promise.resolve()
      .then(() => typeof source === 'function' ? source(i, controller.signal) : loader.loadAsync(source))
      .then((tex) => {
        if (disposed || entries.get(i) !== e) { tex.dispose(); return null; }
        const image = tex.image;
        const ratio = Math.min(1, (quality === 'low' ? 1720 : 2550) / Math.max(image.width, image.height));
        if (ratio < 1) {
          const scaled = document.createElement('canvas');
          scaled.width = Math.round(image.width * ratio);
          scaled.height = Math.round(image.height * ratio);
          scaled.getContext('2d').drawImage(image, 0, 0, scaled.width, scaled.height);
          tex.image = scaled;
        }
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = Math.min(maxAniso, 16);
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = true;
        tex.needsUpdate = true;
        e.tex = tex;
        readyCbs.forEach((cb) => cb(i, tex));
        evict();
        return tex;
      })
      .catch((err) => {
        if (disposed || controller.signal.aborted || entries.get(i) !== e) return null;
        entries.delete(i);
        console.warn('[book] page texture failed', i, err);
        errorCbs.forEach((cb) => cb(i));
        return null;
      });
    return e.promise;
  }

  return {
    isReady(i) {
      const e = entries.get(i);
      return !!(e && e.tex);
    },
    get(i) {
      const e = entries.get(i);
      if (e && e.tex) {
        touch(i);
        return e.tex;
      }
      request(i);
      return null;
    },
    request,
    ensure(indices) {
      indices.forEach((i) => request(i));
    },
    pin(indices) { pinned = new Set(indices.filter(i => i >= 0)); evict(); },
    keep(indices) {
      const wanted = new Set(indices);
      for (const [i, entry] of entries) {
        if (wanted.has(i) || pinned.has(i)) continue;
        entries.delete(i);
        entry.controller.abort();
        entry.tex?.dispose();
      }
      this.ensure(indices);
    },
    get resident() { return [...entries.values()].filter(({ tex }) => tex).length; },
    onReady(cb) {
      readyCbs.push(cb);
    },
    onError(cb) { errorCbs.push(cb); },
    dispose() {
      disposed = true;
      readyCbs.length = 0;
      errorCbs.length = 0;
      for (const [, e] of entries) { e.controller.abort(); e.tex?.dispose(); }
      entries.clear();
    },
  };
}

/* ------------------------------------------------------------------ */
/*  主角                                                              */
/* ------------------------------------------------------------------ */

export function createBook(scene, pageSources, coverTexture, labels, {
  quality = 'high', initialPage = 0, initialView = 'spread',
} = {}) {
  const root = new THREE.Group();
  root.name = 'hero-book';
  scene.add(root);

  const center = BOOK_TABLE?.center ? BOOK_TABLE.center.clone() : new THREE.Vector3(0, 0.44, -0.06);
  const baseTilt = Number.isFinite(BOOK_TABLE?.tilt) ? BOOK_TABLE.tilt : 0;

  const group = new THREE.Group();
  group.name = 'book-group';
  group.position.copy(center);
  group.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), BOOK_TABLE.yaw || 0);
  group.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), baseTilt));
  root.add(group);

  /* URL sources and PDF rasterizers share one bounded texture cache. */
  const sources = [];
  const preloadedMap = new Map();
  pageSources.forEach((src, idx) => {
    if (typeof src === 'string' || typeof src === 'function') sources.push(src);
    else {
      sources.push(null);
      preloadedMap.set(idx, src);
    }
  });
  const cache = createPageCache(sources, { quality });
  const pageCount = pageSources.length;
  const cacheIndexFor = (i) => (sources[i] ? i : -1);

  const blankTex = blankPageTexture();

  function textureFor(i) {
    if (i < 0 || i >= pageCount) return blankTex;
    if (!sources[i]) return preloadedMap.get(i) || blankTex;
    return cache.get(i) || blankTex;
  }


  /* ================================================================ */
  /*  合上的书                                                         */
  /* ================================================================ */
  const closedGroup = new THREE.Group();
  closedGroup.name = 'book-closed';
  closedGroup.position.y = BLOCK_T / 2 + BOARD_T;
  group.add(closedGroup);
  const closedMats = [];

  const inkMat = new THREE.MeshStandardMaterial({ color: 0x1e2028, roughness: 0.52, metalness: 0.16 });
  const inkBackMat = new THREE.MeshStandardMaterial({ color: 0x15171d, roughness: 0.58, metalness: 0.12 });
  const bandMat = new THREE.MeshStandardMaterial({ color: 0xa9844c, roughness: 0.34, metalness: 0.86 });
  closedMats.push(inkMat, inkBackMat, bandMat);

  // 封面贴图（顶面朝上，书本的 -Z 侧朝向读者）
  const coverTex = coverTexture || blankTex;
  coverTex.colorSpace = THREE.SRGBColorSpace;
  coverTex.anisotropy = 16;
  const coverTop = coverTex.clone();
  coverTop.needsUpdate = true;
  coverTop.wrapS = coverTop.wrapT = THREE.ClampToEdgeWrapping;
  coverTop.repeat.set(1, 1);
  coverTop.offset.set(0, 0);
  const coverMat = new THREE.MeshStandardMaterial({
    map: coverTop,
    roughness: 0.76,
    metalness: 0,
    emissive: new THREE.Color(0xffffff),
    emissiveMap: coverTop,
    emissiveIntensity: 0.14,
  });
  closedMats.push(coverMat);

  const boardW = PAGE_W + 0.006;
  const boardD = PAGE_H + 0.006;

  // 前封面板
  const frontBoard = new THREE.Mesh(new THREE.BoxGeometry(boardW, BOARD_T, boardD), [
    inkMat, inkMat, coverMat, inkBackMat, inkMat, inkMat,
  ]);
  frontBoard.position.set(0.002, BLOCK_T / 2 + BOARD_T / 2, 0);
  frontBoard.castShadow = false;
  frontBoard.receiveShadow = true;
  const coverHinge = new THREE.Group();
  coverHinge.position.x = -PAGE_W / 2;
  frontBoard.position.x += PAGE_W / 2;
  coverHinge.add(frontBoard);
  closedGroup.add(coverHinge);

  // 后封面板
  const backBoard = new THREE.Mesh(new THREE.BoxGeometry(boardW, BOARD_T, boardD), inkBackMat);
  backBoard.position.set(0.002, -BLOCK_T / 2 - BOARD_T / 2, 0);
  backBoard.castShadow = false;
  backBoard.receiveShadow = true;
  closedGroup.add(backBoard);

  // 纸叠（三边露出的层叠纹理）
  const edgeTex = pageEdgeTexture();
  const edgeMat = new THREE.MeshStandardMaterial({
    map: edgeTex,
    roughness: 0.95,
    metalness: 0.0,
    color: 0xf4ecdb,
  });
  closedMats.push(edgeMat);
  const blockGeo = new THREE.BoxGeometry(PAGE_W - 0.002, BLOCK_T, PAGE_H - 0.002);
  {
    const uvA = blockGeo.attributes.uv;
    for (let i = 0; i < uvA.count; i++) uvA.setXY(i, uvA.getX(i) * 3, uvA.getY(i));
  }
  const block = new THREE.Mesh(blockGeo, edgeMat);
  block.castShadow = false;
  block.receiveShadow = true;
  closedGroup.add(block);

  // 圆弧书脊
  const spineR = BLOCK_T / 2 + BOARD_T;
  const spineGeo = new THREE.CylinderGeometry(spineR, spineR, boardD, 18, 1, false, Math.PI * 0.5, Math.PI);
  spineGeo.rotateX(Math.PI / 2);
  spineGeo.rotateZ(Math.PI / 2);
  const spineMat = new THREE.MeshStandardMaterial({
    color: 0x1e2028,
    roughness: 0.44,
    metalness: 0.2,
    emissive: new THREE.Color(0x1e40d8),
    emissiveIntensity: 0.06,
  });
  closedMats.push(spineMat);
  const spine = new THREE.Mesh(spineGeo, spineMat);
  spine.position.set(-PAGE_W / 2 + 0.001, 0, 0);
  spine.castShadow = false;
  closedGroup.add(spine);

  // 书脊烫金横带
  for (const z of [-PAGE_H * 0.34, -PAGE_H * 0.17, 0, PAGE_H * 0.17, PAGE_H * 0.34]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.0028, 0.0022, 0.011), bandMat);
    band.position.set(-PAGE_W / 2 - spineR * 0.92, 0, z);
    closedGroup.add(band);
  }

  // 书签丝带
  const ribbonMat = new THREE.MeshStandardMaterial({
    color: 0x1e40d8,
    roughness: 0.62,
    metalness: 0.06,
    side: THREE.DoubleSide,
    emissive: new THREE.Color(0x1e40d8),
    emissiveIntensity: 0.22,
  });
  closedMats.push(ribbonMat);
  const ribbon = new THREE.Mesh(new THREE.PlaneGeometry(0.0075, PAGE_H * 0.30, 1, 8), ribbonMat);
  ribbon.rotation.x = -Math.PI / 2;
  ribbon.rotation.z = 0.04;
  ribbon.position.set(PAGE_W * 0.06, BLOCK_T / 2 + BOARD_T + 0.0016, -PAGE_H * 0.30);
  closedGroup.add(ribbon);

  /* ---------- 悬停光环与微光 ---------- */
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xffd6a1,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.17, 0.19, 72), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.0008;
  ring.scale.set(1, 1.42, 1);
  group.add(ring);

  const sparkleMat = new THREE.SpriteMaterial({
    map: (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d');
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, 'rgba(255,246,222,1)');
      grad.addColorStop(0.32, 'rgba(255,214,150,0.5)');
      grad.addColorStop(1, 'rgba(255,190,120,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })(),
    color: 0xffe2b8,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const sparkle = new THREE.Sprite(sparkleMat);
  sparkle.scale.set(0.16, 0.16, 1);
  sparkle.position.set(0, BLOCK_T + BOARD_T * 2 + 0.075, 0);
  group.add(sparkle);

  /* ================================================================ */
  /*  展开的双页                                                        */
  /* ================================================================ */
  const openGroup = new THREE.Group();
  openGroup.name = 'book-open';
  openGroup.visible = false;
  openGroup.position.y = BOARD_T / 2;
  group.add(openGroup);
  const openMats = [];

  const boardSideW = PAGE_W + 0.004;
  const boardSideD = PAGE_H + 0.006;
  const leftBoard = new THREE.Mesh(new THREE.BoxGeometry(boardSideW, BOARD_T, boardSideD), inkMat);
  leftBoard.position.set(-PAGE_W / 2, 0, 0);
  leftBoard.receiveShadow = true;
  openGroup.add(leftBoard);
  const rightBoard = new THREE.Mesh(new THREE.BoxGeometry(boardSideW, BOARD_T, boardSideD), inkMat);
  rightBoard.position.set(PAGE_W / 2, 0, 0);
  rightBoard.receiveShadow = true;
  openGroup.add(rightBoard);

  const stackTopY = BOARD_T / 2 + STACK_T;
  const leftStack = new THREE.Mesh(new THREE.BoxGeometry(PAGE_W - 0.001, STACK_T, PAGE_H - 0.002), edgeMat);
  leftStack.position.set(-PAGE_W / 2, BOARD_T / 2 + STACK_T / 2, 0);
  leftStack.receiveShadow = true;
  openGroup.add(leftStack);
  const rightStack = new THREE.Mesh(new THREE.BoxGeometry(PAGE_W - 0.001, STACK_T, PAGE_H - 0.002), edgeMat);
  rightStack.position.set(PAGE_W / 2, BOARD_T / 2 + STACK_T / 2, 0);
  rightStack.receiveShadow = true;
  openGroup.add(rightStack);

  // 书脊填角
  const gutterMat = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.7, metalness: 0.1 });
  openMats.push(gutterMat);
  const gutterBlock = new THREE.Mesh(new THREE.BoxGeometry(0.006, STACK_T + BOARD_T, PAGE_H - 0.002), gutterMat);
  gutterBlock.position.set(0, BOARD_T / 2 + (STACK_T + BOARD_T) / 2 - BOARD_T, 0);
  openGroup.add(gutterBlock);

  // 静态左右页
  const pageY = stackTopY + 0.0002;
  const leftMat = makePageMaterial();
  const rightMat = makePageMaterial();
  const sheetMat = makePageMaterial();
  openMats.push(leftMat, rightMat, sheetMat);

  const geoLeft = buildPageGeometry(-1);
  const geoRight = buildPageGeometry(1);

  const leftPage = new THREE.Mesh(geoLeft, leftMat);
  leftPage.rotation.x = -Math.PI / 2;
  leftPage.position.set(0, pageY, 0);
  leftPage.receiveShadow = true;
  openGroup.add(leftPage);

  const rightPage = new THREE.Mesh(geoRight, rightMat);
  rightPage.rotation.x = -Math.PI / 2;
  rightPage.position.set(0, pageY, 0);
  rightPage.receiveShadow = true;
  openGroup.add(rightPage);

  // 翻动中的纸
  const sheet = new THREE.Mesh(geoRight.clone(), sheetMat);
  sheet.rotation.x = -Math.PI / 2;
  sheet.position.set(0, pageY + 0.0015, 0);
  sheet.castShadow = true;
  sheet.visible = false;
  openGroup.add(sheet);
  const sheetOriginal = sheet.geometry.attributes.position.array.slice();
  sheet.frustumCulled = false;
  const leftLeaf = new THREE.Group();
  leftLeaf.name = 'book-left-leaf';
  openGroup.add(leftLeaf);
  leftLeaf.add(leftBoard, leftStack, leftPage);

  // (uniforms are per-sheet)

  /* ---------- 接触阴影 ---------- */
  // Contact shadows are provided by the table; no tilted, floating dark card.

  /* ================================================================ */
  /*  状态机                                                            */
  /* ================================================================ */
  const spreadCount = Math.ceil(pageCount / 2);
  let single = Math.max(0, Math.min(pageCount - 1, initialPage));
  let spread = Math.floor(single / 2);
  let turn = null;
  let reducedMotion = false;
  let hover = 0;
  let hoverTarget = 0;
  const listeners = { spread: [], turn: [], error: [] };
  let visibleState = 'closed';
  /** 'spread' 双页跨页 ｜ 'single' 单页（适合认真阅读） */
  let view = pageCount === 1 || initialView === 'single' ? 'single' : 'spread';

  const pageIndexLeft = () => (view === 'single' ? single : spread * 2);
  const pageIndexRight = () =>
    view === 'single' ? -1 : spread * 2 + 1 < pageCount ? spread * 2 + 1 : -1;

  /**
   * 单页 / 双页的几何布局。
   * 单页时只保留 geoRight 那张纸（书脊在左），把它平移到中间，
   * 另一侧的书页、纸叠、书板与中缝填角全部隐藏。
   */
  function applyViewLayout() {
    const isSingle = view === 'single';
    leftPage.visible = !isSingle;
    leftLeaf.visible = !isSingle;
    leftStack.visible = !isSingle;
    leftBoard.visible = !isSingle;
    gutterBlock.visible = !isSingle;
    rightPage.visible = true;
    rightStack.visible = true;
    rightBoard.visible = true;
    if (isSingle) {
      rightPage.position.x = -PAGE_W / 2;
      sheet.position.x = -PAGE_W / 2;
      rightStack.position.x = 0;
      rightBoard.position.x = 0;
    } else {
      rightPage.position.x = 0;
      sheet.position.x = 0;
      rightStack.position.x = PAGE_W / 2;
      rightBoard.position.x = PAGE_W / 2;
    }
  }

  /* 三张纸各有独立的 uniform 集合（共享同一个着色器程序） */
  const leftU = makeUniformSet(-1, 0, blankTex);
  const rightU = makeUniformSet(1, 1, blankTex);
  const sheetU = makeUniformSet(1, 1, blankTex);
  sheetU.uDeformed.value = 1;
  patchPageMaterial(leftMat, leftU);
  patchPageMaterial(rightMat, rightU);
  patchPageMaterial(sheetMat, sheetU);
  function refreshStatic() {
    applyViewLayout();
    const requestedPages = pendingJump < 0 ? [] : view === 'single'
      ? [pendingPage] : [pendingJump * 2, pendingJump * 2 + 1];
    cache.pin([pageIndexLeft(), pageIndexRight(), ...requestedPages]);
    if (view === 'single') {
      // 单页模式：可见的是 rightPage，它承载当前单页
      const t0 = textureFor(single);
      rightU.uFront.value = t0;
      rightU.uBack.value = t0;
      leftU.uFront.value = t0;
      leftU.uBack.value = t0;
      cache.keep([single - 2, single - 1, single, single + 1, single + 2, ...requestedPages]
        .map(cacheIndexFor).filter((i) => i >= 0));
      return;
    }
    const li = pageIndexLeft();
    const ri = pageIndexRight();
    leftU.uFront.value = textureFor(li);
    leftU.uBack.value = leftU.uFront.value;
    const rt = ri >= 0 ? textureFor(ri) : blankTex;
    rightU.uFront.value = rt;
    rightU.uBack.value = rt;
    // 预热邻近页
    cache.keep([li - 2, li - 1, li, li + 1, ri, ri + 1, ri + 2, ...requestedPages]
      .map(cacheIndexFor).filter((i) => i >= 0));
  }

  // 贴图异步到位后刷新
  cache.onReady(() => {
    if (turn) return;
    if (pendingJump >= 0) {
      if (pagesReady(pendingJump, pendingPage)) applySpread(pendingJump, pendingPage);
      return;
    }
    if (pendingView) {
      if (pagesReady(Math.floor(single / 2), single, pendingView)) applyView(pendingView);
      return;
    }
    if (pendingTurn) { const direction = pendingTurn; pendingTurn = 0; startTurn(direction); return; }
    refreshStatic();
  });
  cache.onError((index) => {
    const target = pendingJump >= 0
      ? indicesFor(pendingPage, view)
      : pendingView ? indicesFor(single, pendingView)
        : pendingTurn ? indicesFor(view === 'single' ? single + pendingTurn : (spread + pendingTurn) * 2, view) : [];
    if (!target.includes(index)) return;
    pendingJump = pendingPage = -1;
    pendingTurn = 0;
    pendingView = null;
    if (!turn) cache.pin([pageIndexLeft(), pageIndexRight()]);
    listeners.error.forEach((cb) => cb(index));
  });

  function emitSpread() {
    for (const cb of listeners.spread) cb(spread, pageIndexLeft(), pageIndexRight());
  }

  function startTurn(dir) {
    if (turn || pendingJump >= 0 || pendingView) return false;

    /* ---------- 单页模式：一次只翻一页，纸向右/左扫出画面 ---------- */
    if (view === 'single') {
      const to = single + dir;
      if (to < 0 || to >= pageCount) return false;
      if (!pageReady(to)) { pendingTurn = dir; cache.ensure([cacheIndexFor(to)].filter(i => i >= 0)); return false; }
      cache.pin([single,to]);
      sheet.visible = true;
      sheet.position.x = dir > 0 ? -PAGE_W / 2 : PAGE_W / 2;
      sheetU.uSide.value = dir > 0 ? 1 : -1;
      turn = {
        dir,
        t: 0,
        dur: 0.92,
        swapped: true,
        mode: 'single',
        to,
        nextSpread: Math.floor(to / 2),
        phiFrom: 0,
        phiTo: Math.PI,
      };
      const cur = textureFor(single);
      sheetU.uFront.value = cur;
      sheetU.uBack.value = cur;
      sheetU.uPhi.value = 0;
      // 纸抬起来的瞬间，下面已经是目标页（与真实翻页一致）
      const t2 = textureFor(to);
      rightU.uFront.value = t2;
      rightU.uBack.value = t2;
      sheetU.uSpineU0.value = 1;
      sheetU.uGutter.value = 1;
      cache.ensure([single - 1, single, to, to + 1].map(cacheIndexFor).filter((i) => i >= 0));
      for (const cb of listeners.turn) cb(true, dir);
      return true;
    }

    /* ---------- 双页模式 ---------- */
    if (dir > 0 && spread >= spreadCount - 1) return false;
    if (dir < 0 && spread <= 0) return false;

    const curL = pageIndexLeft();
    const curR = pageIndexRight();
    const nextSpread = spread + dir;
    const nextL = nextSpread * 2;
    const nextR = nextSpread * 2 + 1 < pageCount ? nextSpread * 2 + 1 : -1;
    if (!pageReady(nextL) || !pageReady(nextR)) {
      pendingTurn = dir;
      cache.ensure([nextL, nextR].map(cacheIndexFor).filter(i => i >= 0));
      return false;
    }
    cache.pin([curL, curR, nextL, nextR]);
    sheetU.uSide.value = 1;
    sheet.position.x = 0;

    sheet.visible = true;
    turn = {
      dir,
      t: 0,
      dur: 1.02,
      swapped: false,
      mode: 'spread',
      curL,
      curR,
      nextL,
      nextR,
      nextSpread,
      phiFrom: dir > 0 ? 0 : Math.PI,
      phiTo: dir > 0 ? Math.PI : 0,
    };

    if (dir > 0) {
      // 正面 = 当前右页；背面 = 下一跨页左页
      sheetU.uFront.value = curR >= 0 ? textureFor(curR) : blankTex;
      sheetU.uBack.value = textureFor(nextL);
      sheetU.uPhi.value = 0;
      // 纸一抬起来，下面那页立刻变成「下一页」（此刻被纸完全盖住，看不见跳变）
      const rt = nextR >= 0 ? textureFor(nextR) : blankTex;
      rightU.uFront.value = rt;
      rightU.uBack.value = rt;
    } else {
      // 起始贴在左侧：正面 = 上一跨页右页；背面 = 当前左页
      const prevSpread = spread - 1;
      const prevR = prevSpread * 2 + 1 < pageCount ? prevSpread * 2 + 1 : -1;
      sheetU.uFront.value = prevR >= 0 ? textureFor(prevR) : blankTex;
      sheetU.uBack.value = textureFor(curL);
      sheetU.uPhi.value = Math.PI;
      // 同理：纸条在左侧抬起时，左页立刻换成「上一跨页的左页」
      leftU.uFront.value = textureFor(nextL);
      leftU.uBack.value = leftU.uFront.value;
    }
    sheetU.uSpineU0.value = 1;
    sheetU.uGutter.value = 1;

    for (const cb of listeners.turn) cb(true, dir);
    return true;
  }

  function finishTurn() {
    if (!turn) return;
    if (turn.mode === 'single') {
      single = turn.to;
      spread = Math.floor(single / 2);
    } else {
      spread = turn.nextSpread;
      single = spread * 2;
    }
    sheet.visible = false;
    sheetMat.opacity = 1;
    sheetU.uFront.value = blankTex;
    sheetU.uBack.value = blankTex;
    const done = turn;
    turn = null;
    if (pendingJump >= 0 && pagesReady(pendingJump, pendingPage)) {
      applySpread(pendingJump, pendingPage);
      for (const cb of listeners.turn) cb(false, done.dir);
      return;
    }
    refreshStatic();
    for (const cb of listeners.turn) cb(false, done.dir);
    emitSpread();
  }

  function update(dt) {
    if (turn && reducedMotion) finishTurn();
    if (turn) {
      turn.t += dt / turn.dur;
      const t = clamp01(turn.t);
      const e = easeInOutCubic(t);
      sheetU.uPhi.value = turn.phiFrom + (turn.phiTo - turn.phiFrom) * e;

      // 卷曲在翻动中途最强，两端几乎平展
      // 卷曲必须从「静页的微小弧度」平滑起振、再回到同一弧度，
      // 否则翻页最开头和最末尾会看到纸面突然弯折/突然拍平（原本的抖动感）
      const arc = Math.sin(Math.PI * t);
      const IDLE_CURL = 0.026;
      const peak = 0.95;
      sheetU.uCurl.value = IDLE_CURL + (peak - IDLE_CURL) * Math.pow(arc, 0.85);
      sheetU.uDroop.value = -0.030 * arc;
      sheetU.uLift.value = 0.013 * arc;
      deformTurningPage(sheet.geometry, sheetOriginal, { width: PAGE_W, side: sheetU.uSide.value,
        phi: sheetU.uPhi.value, curl: sheetU.uCurl.value,
        droop: sheetU.uDroop.value, lift: sheetU.uLift.value });
      sheetMat.opacity = turn.mode === 'single' ? 1 - THREE.MathUtils.smoothstep(t, 0.80, 1) : 1;

      if (!turn.swapped && t >= 0.5) {
        turn.swapped = true;
        // 半程时纸几乎竖直，静页悄然换成下一跨页
        const li = turn.nextSpread * 2;
        const ri = turn.nextSpread * 2 + 1 < pageCount ? turn.nextSpread * 2 + 1 : -1;
        if (turn.dir > 0) {
          leftU.uFront.value = textureFor(li);
          leftU.uBack.value = leftU.uFront.value;
        } else {
          const rt2 = ri >= 0 ? textureFor(ri) : blankTex;
          rightU.uFront.value = rt2;
          rightU.uBack.value = rt2;
        }
        cache.ensure([li - 2, li, li + 1, ri, ri + 1].map(cacheIndexFor).filter((i) => i >= 0));
      }
      if (t >= 1) finishTurn();
    }

    // 静页的轻微卷曲
    const idleCurl = 0.026;
    leftU.uCurl.value = idleCurl;
    rightU.uCurl.value = idleCurl;
    leftU.uDroop.value = 0;
    rightU.uDroop.value = 0;
    leftU.uLift.value = 0;
    rightU.uLift.value = 0;
    leftU.uPhi.value = 0;
    rightU.uPhi.value = 0;

    // 悬停
    hover += (hoverTarget - hover) * Math.min(1, dt * 9);
    ringMat.opacity = hover * 0.24;
    sparkleMat.opacity = hover * 0.27;
    // 悬停微光在“不悬停”时必须彻底停止渲染：Sprite 会被 AO / 景深的
    // 深度预处理采样，即使 opacity 为 0 也会在画面里留下一块方块伪影。
    const glowOn = hover > 0.02;
    ring.visible = glowOn;
    sparkle.visible = glowOn;
    const now = reducedMotion ? 0 : performance.now() * 0.001;
    sparkle.position.y = BLOCK_T + BOARD_T * 2 + 0.075 + Math.sin(now * 1.6) * 0.008 + (reducedMotion ? 0 : hover * 0.012);
    sparkle.scale.setScalar(0.14 + hover * 0.03 + Math.sin(now * 2.1) * 0.004);
    // 合上时轻微浮起
    closedGroup.position.y = BLOCK_T / 2 + BOARD_T + (reducedMotion ? 0 : hover * 0.012);
  }

  function setHover(v) {
    hoverTarget = v ? 1 : 0;
  }
  const isHovered = () => hoverTarget > 0;

  function setVisible(which, v) {
    if (which === 'closed') {
      closedGroup.visible = v;
      ring.visible = v;
      sparkle.visible = v;
    }
    if (which === 'open') openGroup.visible = v;
    visibleState = which === 'open' && v ? 'open' : visibleState;
  }

  function setOpacity(which, o) {
    const mats = which === 'closed' ? closedMats : openMats;
    for (const m of mats) {
      m.opacity = o;
      /* keep transparent */

    }
    if (which === 'closed') {
      ringMat.opacity = Math.min(ringMat.opacity, o);
      sparkleMat.opacity *= o;
    }
  }

  function setOpenProgress(value) {
    const p = clamp01(value);
    closedGroup.visible = p < 0.999;
    openGroup.visible = p > 0.015;
    coverHinge.rotation.z = Math.PI * THREE.MathUtils.smoothstep(p, 0, 0.82);
    closedGroup.position.x = (view === 'single' ? 0 : PAGE_W / 2) * THREE.MathUtils.smoothstep(p, 0, 0.4);
    leftLeaf.rotation.z = -Math.PI * (1 - THREE.MathUtils.smoothstep(p, 0.12, 1));
    setOpacity('closed', 1 - THREE.MathUtils.smoothstep(p, 0.62, 1));
    setOpacity('open', THREE.MathUtils.smoothstep(p, 0.08, 0.38));
    if (p > 0) setHover(false);
    if (p >= 0.999) visibleState = 'open';
  }

  let pendingJump = -1;
  let pendingPage = -1;
  let pendingTurn = 0;
  let pendingView = null;

  /** 某一页是否已经有可渲染贴图（预载贴图或缓存命中） */
  function pageReady(i) {
    if (i < 0 || i >= pageCount) return true;
    if (!sources[i]) return !!preloadedMap.get(i);
    return cache.isReady(i);
  }

  function indicesFor(index, layout) {
    const left = Math.floor(index / 2) * 2;
    return layout === 'single' ? [index] : [left, left + 1];
  }

  function pagesReady(target, index = target * 2, layout = view) {
    return indicesFor(index, layout).every(pageReady);
  }

  function applySpread(target, pageIdx) {
    spread = target;
    single = pageIdx;
    pendingJump = -1;
    pendingPage = -1;
    refreshStatic();
    emitSpread();
  }

  /**
   * 跳页。若目标页贴图还没上传，先挂起请求，等贴图到位再切换视图——
   * 否则会先闪出一页空白纸（这是之前章节跳转时肉眼可见的小 bug）。
   */
  function jumpToPage(pageIdx) {
    if (!Number.isFinite(pageIdx)) return false;
    pageIdx = Math.max(0, Math.min(pageCount - 1, Math.floor(pageIdx)));
    const target = Math.max(0, Math.min(spreadCount - 1, Math.floor(pageIdx / 2)));
    if (!turn && pageIdx === single) {
      pendingJump = pendingPage = -1; pendingTurn = 0; pendingView = null; refreshStatic(); return false;
    }
    pendingTurn = 0;
    pendingView = null;
    if (!turn && pagesReady(target, pageIdx)) {
      applySpread(target, pageIdx);
      return true;
    }
    pendingJump = target;
    pendingPage = pageIdx;
    const wanted = indicesFor(pageIdx, view);
    if (!turn) cache.pin([pageIndexLeft(), pageIndexRight(), ...wanted]);
    cache.keep(wanted.map(cacheIndexFor).filter((i) => i >= 0));
    return true;
  }

  const next = () => startTurn(1);
  const prev = () => startTurn(-1);
  const onSpread = (cb) => listeners.spread.push(cb);
  const onTurn = (cb) => listeners.turn.push(cb);
  const onPageError = (cb) => listeners.error.push(cb);
  const getSpread = () => spread;
  const getPages = () => ({
    left: pageIndexLeft(),
    right: pageIndexRight(),
    count: pageCount,
    spread,
    spreads: spreadCount,
    view,
    single,
    active: single,
  });

  /** 切换单页 / 双页，并保持当前阅读位置 */
  function setView(next) {
    const want = next === 'single' ? 'single' : 'spread';
    if (want === view || (want === 'spread' && pageCount < 2)) return false;
    if (turn) return false;
    pendingJump = pendingPage = -1;
    pendingTurn = 0;
    if (!pagesReady(Math.floor(single / 2), single, want)) {
      pendingView = want;
      const wanted = indicesFor(single, want);
      cache.pin([pageIndexLeft(), pageIndexRight(), ...wanted]);
      cache.keep(wanted.map(cacheIndexFor).filter((i) => i >= 0));
      return true;
    }
    applyView(want);
    return true;
  }

  function applyView(want) {
    pendingView = null;
    spread = Math.floor(single / 2);
    view = want;
    refreshStatic();
    emitSpread();
  }

  const getView = () => view;
  const isTurning = () => !!turn;

  /**
   * 当前可见书页的四个角（世界坐标），供外部做“页面上屏矩形”计算。
   * 单页返回 4 个点，双页返回 8 个点。
   */
  function getPageCorners() {
    root.updateMatrixWorld(true);
    const out = [];
    const push = (mesh, x0, x1) => {
      if (!mesh.visible) return;
      for (const x of [x0, x1]) {
        for (const yy of [-PAGE_H / 2, PAGE_H / 2]) {
          out.push(mesh.localToWorld(new THREE.Vector3(x, yy, 0)));
        }
      }
    };
    if (view === 'single') push(rightPage, 0, PAGE_W);
    else {
      push(leftPage, -PAGE_W, 0);
      push(rightPage, 0, PAGE_W);
    }
    return out;
  }

  function preload(around = 1) {
    if (view === 'single') {
      const list = [];
      for (let k = -around * 2; k <= around * 2; k++) list.push(single + k);
      cache.ensure(list.filter((i) => i >= 0 && i < pageCount).map(cacheIndexFor).filter((i) => i >= 0));
      return;
    }
    const li = pageIndexLeft();
    const ri = pageIndexRight();
    const list = [];
    for (let k = -around; k <= around + 1; k++) {
      list.push(li + k * 2, ri + k * 2);
    }
    cache.ensure(list.filter((i) => i >= 0 && i < pageCount).map(cacheIndexFor).filter((i) => i >= 0));
  }

  function dispose() {
    cache.dispose();
    const geometries = new Set(), materials = new Set(), textures = new Set(preloadedMap.values());
    root.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      const list = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
      for (const material of list) {
        materials.add(material);
        for (const key of ['map', 'normalMap', 'alphaMap']) if (material[key]) textures.add(material[key]);
      }
    });
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    textures.forEach(texture => {
      if (texture !== coverTexture && texture !== WHITE.tex && texture !== _blankTex) texture.dispose();
    });
    listeners.turn.length = listeners.spread.length = listeners.error.length = 0;
    scene.remove(root);
  }


  refreshStatic();
  setOpacity('closed', 1);
  setOpacity('open', 1);
  setVisible('closed', true);
  setVisible('open', false);

  return {
    root,
    group,
    turningSheet: sheet,
    closedGroup,
    openGroup,
    closedPickMeshes: [frontBoard, block, spine],
    pickMeshes: [leftPage, rightPage],
    next,
    prev,
    update,
    setHover,
    setReducedMotion(value) { reducedMotion = value; },
    isHovered,
    setVisible,
    setOpacity,
    setOpenProgress,
    jumpToPage,
    setView,
    getView,
    getPageCorners,
    onSpread,
    onTurn,
    onPageError,
    getSpread,
    getPages,
    isTurning,
    preload,
    waitForVisible: async () => (await Promise.all([pageIndexLeft(), pageIndexRight()].map(cacheIndexFor)
      .filter((index) => index >= 0).map(cache.request))).every(Boolean),
    get residentPages() { return cache.resident; },
    dispose,
    labels,
    pageCount,
    pages: { width: PAGE_W, height: PAGE_H },
    /** 纸张自发光补偿（0..1），用于在不同灯光下保持正文清晰 */
    _u: { leftU, rightU, sheetU },
    setPaperFill(v) {
      leftU.uFill.value = v;
      rightU.uFill.value = v;
      sheetU.uFill.value = v;
    },
    setGutter(v) {
      leftU.uGutter.value = v;
      rightU.uGutter.value = v;
      sheetU.uGutter.value = v;
    },
    get visibleState() {
      return visibleState;
    },
  };
}
