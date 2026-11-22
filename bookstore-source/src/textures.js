import * as THREE from 'three';
import { BOOK_TITLES } from './shelf-books.js';
export { spineAtlas } from './shelf-books.js';

/* ------------------------------------------------------------------ */
/*  Small canvas-texture factory helpers                               */
/* ------------------------------------------------------------------ */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function shade(hex, amount) {
  const [r, g, b] = hexRgb(hex);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + amount * 255)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

function rgba(hex, alpha) {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function canvasTexture(w, h, draw, opts = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = opts.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  const wrap = opts.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.wrapS = t.wrapT = wrap;
  if (opts.repeat) t.repeat.set(opts.repeat[0], opts.repeat[1]);
  t.anisotropy = opts.anisotropy || 4;
  if (opts.rotation) t.rotation = opts.rotation;
  t.needsUpdate = true;
  return t;
}

/* ------------------------------------------------------------------ */
/*  Wood                                                               */
/* ------------------------------------------------------------------ */

export function woodTexture({ seed = 7, base = '#8a5a3a', planks = 6, size = 1024, grain = 1, repeat = [1, 1] } = {}) {
  return canvasTexture(size, size, (ctx, w, h) => {
    const rnd = mulberry32(seed);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);

    const ph = h / planks;
    for (let i = 0; i < planks; i++) {
      const y = i * ph;
      ctx.fillStyle = shade(base, (rnd() - 0.5) * 0.16);
      ctx.fillRect(0, y, w, ph);

      // board end joints
      let x = rnd() * 300;
      while (x < w) {
        ctx.fillStyle = 'rgba(28,14,7,0.32)';
        ctx.fillRect(x, y, 2.2, ph);
        x += 240 + rnd() * 520;
      }

      // grain
      const lines = Math.round(46 * grain);
      for (let g2 = 0; g2 < lines; g2++) {
        const gy = y + 3 + rnd() * (ph - 6);
        const dark = rnd() > 0.35;
        ctx.strokeStyle = dark ? 'rgba(26,12,4,0.10)' : 'rgba(255,225,185,0.055)';
        ctx.lineWidth = 0.7 + rnd() * 1.6;
        ctx.beginPath();
        ctx.moveTo(0, gy);
        const amp = 1.5 + rnd() * 4;
        ctx.bezierCurveTo(w * 0.25, gy + (rnd() - 0.5) * amp, w * 0.62, gy + (rnd() - 0.5) * amp, w, gy + (rnd() - 0.5) * amp * 0.6);
        ctx.stroke();
      }

      // occasional knot
      if (rnd() < 0.5) {
        const kx = rnd() * w;
        const ky = y + ph * (0.25 + rnd() * 0.5);
        for (let k = 0; k < 4; k++) {
          ctx.strokeStyle = `rgba(24,10,4,${0.16 - k * 0.03})`;
          ctx.lineWidth = 2.2 - k * 0.4;
          ctx.beginPath();
          ctx.ellipse(kx, ky, 10 + k * 6, 4 + k * 2.4, 0.35, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      ctx.fillStyle = 'rgba(22,10,4,0.45)';
      ctx.fillRect(0, y, w, 2);
    }

    // overall soft grime
    const vg = ctx.createLinearGradient(0, 0, w, h);
    vg.addColorStop(0, 'rgba(255,230,200,0.06)');
    vg.addColorStop(0.55, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(20,8,2,0.10)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
  }, { repeat, anisotropy: 8 });
}

export function woodBump({ seed = 11, size = 512 } = {}) {
  return canvasTexture(size, size, (ctx, w, h) => {
    const rnd = mulberry32(seed);
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 1200; i++) {
      const v = Math.round(100 + rnd() * 90);
      ctx.strokeStyle = `rgb(${v},${v},${v})`;
      ctx.lineWidth = 0.6;
      const y = rnd() * h;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(w * 0.4, y + (rnd() - 0.5) * 6, w * 0.7, y + (rnd() - 0.5) * 6, w, y);
      ctx.stroke();
    }
  }, { linear: true, repeat: [1, 1] });
}

/* ------------------------------------------------------------------ */
/*  Plaster walls                                                      */
/* ------------------------------------------------------------------ */

export function plasterTexture({ seed = 3, base = '#e6dbc9', size = 768 } = {}) {
  return canvasTexture(size, size, (ctx, w, h) => {
    const rnd = mulberry32(seed);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < 9000; i++) {
      const a = rnd() * 0.05;
      ctx.fillStyle = rnd() > 0.5 ? `rgba(255,248,235,${a})` : `rgba(90,64,44,${a * 0.8})`;
      const s = 0.6 + rnd() * 1.8;
      ctx.fillRect(rnd() * w, rnd() * h, s, s);
    }

    for (let i = 0; i < 9; i++) {
      const x = rnd() * w;
      const y = rnd() * h;
      const r = 80 + rnd() * 180;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,244,226,0.10)');
      g.addColorStop(1, 'rgba(255,244,226,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }

    const vg = ctx.createLinearGradient(0, 0, 0, h);
    vg.addColorStop(0, 'rgba(255,255,255,0.05)');
    vg.addColorStop(1, 'rgba(60,40,26,0.07)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
  }, { repeat: [1, 1], anisotropy: 4 });
}

/* ------------------------------------------------------------------ */
/*  Rug                                                                */
/* ------------------------------------------------------------------ */

export function rugTexture({ size = 1024 } = {}) {
  return canvasTexture(size, Math.round(size * .75), (ctx, w, h) => {
    ctx.scale(w / 1024, h / 768);
    const random = mulberry32(905);
    const madder = '#81463d', darkMadder = '#643731', indigo = '#302f38';
    const sand = '#b09a73', ochre = '#91714e', fadedBlue = '#536267';
    const band = (inset, color) => {
      ctx.fillStyle = color;
      ctx.fillRect(inset, inset, 1024 - inset * 2, 768 - inset * 2);
    };
    function petal(x, y, angle, length, width, color) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(length * .25, -width, length * .78, -width, length, 0);
      ctx.bezierCurveTo(length * .75, width, length * .28, width, 0, 0);
      ctx.fill();
      ctx.restore();
    }
    function flower(x, y, r, outer, inner, count = 8) {
      for (let i = 0; i < count; i++) {
        petal(x, y, i * 2 * Math.PI / count, r, r * .20, outer);
      }
      ctx.fillStyle = inner;
      ctx.beginPath();
      ctx.arc(x, y, r * .20, 0, Math.PI * 2);
      ctx.fill();
    }
    function scalloped(rx, ry, color) {
      ctx.beginPath();
      for (let i = 0; i <= 160; i++) {
        const a = i * Math.PI / 80;
        const lobe = 1 + .095 * Math.cos(8 * a) + .044 * Math.cos(16 * a);
        ctx.lineTo(512 + Math.cos(a) * rx * lobe, 384 + Math.sin(a) * ry * lobe);
      }
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    }

    band(0, indigo); band(10, ochre); band(14, darkMadder); band(24, sand);
    band(28, indigo); band(62, ochre); band(68, darkMadder); band(76, sand);
    band(79, madder);

    // Repeated floral border, threaded together by a meandering stem.
    function runningBorder(length) {
      ctx.beginPath();
      for (let x = 0; x <= length; x += 4) ctx.lineTo(x, Math.sin(x / 10) * 6);
      ctx.strokeStyle = ochre;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      for (let x = 18; x < length - 12; x += 43) {
        flower(x, 0, 12, x % 2 ? sand : madder, fadedBlue, 6);
        petal(x + 15, 2, -.64, 12, 3, fadedBlue);
        petal(x + 24, -1, 2.35, 10, 3, ochre);
      }
    }
    for (const [x,y,angle,length] of [[40,45,0,944],[984,723,Math.PI,944],
          [45,724,-Math.PI / 2,680],[979,44,Math.PI / 2,680]]) {
      ctx.save();
      ctx.translate(x,y);
      ctx.rotate(angle);
      runningBorder(length);
      ctx.restore();
    }

    scalloped(240, 161, darkMadder); scalloped(222, 150, ochre);
    scalloped(213, 141, sand); scalloped(201, 131, indigo);
    scalloped(129, 88, fadedBlue); scalloped(116, 76, darkMadder);
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6;
      const x = 512 + Math.cos(a) * 164, y = 384 + Math.sin(a) * 109;
      petal(512 + Math.cos(a) * 137, 384 + Math.sin(a) * 88, a, 31, 6, ochre);
      flower(x,y,13,i%2 ? sand : madder,ochre,6);
    }
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      petal(512,384,a,63,9,sand);
      petal(512,384,a+.11,46,5,ochre);
    }
    flower(512,384,23,fadedBlue,sand);
    for (const sy of [-1,1]) {
      for (const sx of [-1,1]) {
        ctx.save();
        ctx.translate(512,384);
        ctx.scale(sx,sy);
        ctx.strokeStyle = ochre;
        ctx.lineWidth = 2;
        for (const [x,y] of [[126,189],[238,120],[305,169],[355,59],[346,238],[239,239]]) {
          ctx.beginPath();
          ctx.moveTo(x+28,y+26);
          ctx.bezierCurveTo(x+19,y+3,x-20,y+25,x,y);
          ctx.stroke();
          flower(x,y,14,sand,indigo,7);
          flower(x+29,y+25,10,fadedBlue,ochre,6);
          petal(x+12,y+17,-1.34,15,4,indigo);
        }
        ctx.restore();
      }
    }

    // Rubbed pile reads as irregular colour loss rather than a uniform overlay.
    for (const [x,y,r,alpha] of [[218,331,210,.22],[710,570,157,.20],[810,172,117,.15],[465,651,135,.17]]) {
      const wear = ctx.createRadialGradient(x,y,0,x,y,r);
      wear.addColorStop(0, 'rgba(196,168,127,' + alpha + ')');
      wear.addColorStop(1, 'rgba(196,168,127,0)');
      ctx.fillStyle=wear;
      ctx.fillRect(0,0,1024,768);
    }
    // Short threads bleach in clusters along the traffic lanes.
    for (let i = 0; i < 42; i++) {
      const x = 96 + random() * 832, y = 87 + random() * 594;
      const length = 16 + random() * 66, height = 7 + random() * 32;
      ctx.save();
      ctx.translate(x,y);
      ctx.scale(length,height);
      const pile = ctx.createRadialGradient(0,0,0,0,0,1);
      pile.addColorStop(0,i%4?'rgba(211,181,146,.085)':'rgba(63,39,38,.14)');
      pile.addColorStop(1,'rgba(136,96,68,0)');
      ctx.fillStyle=pile;
      ctx.fillRect(-1,-1,2,2);
      ctx.restore();
    }
    // Slightly uneven weft and broken highlights across every dyed band.
    for (let y = 0; y < 768; y += 2) {
      ctx.fillStyle = y % 4 ? 'rgba(43,32,24,.12)' : 'rgba(247,224,176,.14)';
      ctx.fillRect(0, y, 1024, 1);
    }
    for (let i = 0; i < 19500; i++) {
      ctx.fillStyle = random() < .5 ? 'rgba(250,231,197,.14)' : 'rgba(45,30,25,.13)';
      ctx.fillRect(random() * 1024, random() * 768, 2 + random() * 6, 1);
    }
  }, { clamp: true, anisotropy: 8 });
}

// A panoramic woodcut on warm paper for the double-height bay behind the globe.
export function mountainPrint() {
  return canvasTexture(1200, 420, (ctx, w, h) => {
    const random = mulberry32(1168);
    ctx.fillStyle = '#e4d6b7';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#bb7550';
    ctx.beginPath();
    ctx.arc(840, 88, 39, 0, Math.PI * 2);
    ctx.fill();
    const layers = [
      { y: 188, peaks: [0, -36, -11, -89, -32, -60, -12, -41, 8, -19, -7], ink: '#a7b3a1' },
      { y: 249, peaks: [-16, -65, -31, -14, -77, -132, -68, -26, -50, -88, -16], ink: '#798f82' },
      { y: 309, peaks: [-88, -37, -63, -11, -24, -36, 4, -47, -102, -53, -83], ink: '#4e7069' },
      { y: 379, peaks: [-67, -48, -21, -14, -4, 2, -24, -43, -31, -64, -70], ink: '#344f4c' },
    ];
    for (const [layerIndex, layer] of layers.entries()) {
      const heights = [];
      ctx.beginPath(); ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += 3) {
        const u = x / w * (layer.peaks.length - 1), segment = Math.min(Math.floor(u), layer.peaks.length - 2);
        const offset = THREE.MathUtils.lerp(layer.peaks[segment], layer.peaks[segment + 1], u - segment);
        const y = layer.y + offset + 4 * Math.sin(x * .068 + layerIndex) + random() * 3;
        heights.push(y); ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h); ctx.closePath(); ctx.fillStyle = layer.ink; ctx.fill();
      ctx.save(); ctx.clip();
      ctx.strokeStyle = 'rgba(239,226,190,.20)'; ctx.lineWidth = 1.3;
      for (let i = 0; i < 420; i++) {
        const x = random() * w, y = heights[Math.floor(x / 3)] + random() * 45;
        const length = 6 + random() * 34;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - length, y + length * .62); ctx.stroke();
      }
      ctx.restore();
      if (layerIndex === 3) {
        for (let i = 0; i < 145; i++) {
          const x = random() * w, y = heights[Math.floor(x / 3)] + 4;
          const height = 3 + 24 * random() * Math.abs(x - w / 2) / (w / 2);
          ctx.beginPath(); ctx.moveTo(x, y - height); ctx.lineTo(x + height * .19, y);
          ctx.lineTo(x - height * .19, y); ctx.fill();
        }
      }
    }
    for (let i = 0; i < 12000; i++) {
      ctx.fillStyle = i % 2 ? 'rgba(52,44,34,.075)' : 'rgba(255,243,208,.12)';
      ctx.fillRect(random() * w, random() * h, 1 + random() * 5, 1);
    }
  }, { clamp: true, anisotropy: 8 });
}

/* ------------------------------------------------------------------ */
/*  Night sky beyond the window (cold, deep blue, distant city)        */
/* ------------------------------------------------------------------ */

export function skyTexture({ w = 1024, h = 1024 } = {}) {
  return canvasTexture(w, h, (ctx, W, H) => {
    const rnd = mulberry32(21);
    const horizon = H * 0.80;

    // deep night gradient: zenith -> horizon
    const g = ctx.createLinearGradient(0, 0, 0, horizon);
    g.addColorStop(0.0, '#0B1633');
    g.addColorStop(0.40, '#101B38');
    g.addColorStop(0.70, '#16233F');
    g.addColorStop(1.0, '#2A3A5C');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, horizon + 1);

    // faint moon + halo
    const mx = W * 0.72;
    const my = H * 0.19;
    const mg = ctx.createRadialGradient(mx, my, 0, mx, my, W * 0.22);
    mg.addColorStop(0.0, 'rgba(230,240,255,0.55)');
    mg.addColorStop(0.06, 'rgba(200,220,255,0.24)');
    mg.addColorStop(0.30, 'rgba(150,180,235,0.09)');
    mg.addColorStop(1.0, 'rgba(120,150,220,0)');
    ctx.fillStyle = mg;
    ctx.fillRect(0, 0, W, horizon);
    ctx.fillStyle = 'rgba(240,246,255,0.9)';
    ctx.beginPath();
    ctx.arc(mx, my, W * 0.016, 0, Math.PI * 2);
    ctx.fill();

    // stars: cold white (#DCE8FF), varied brightness, a few with a soft halo
    for (let i = 0; i < 360; i++) {
      const sx = rnd() * W;
      const sy = rnd() * (horizon - H * 0.05);
      const bright = 0.16 + rnd() * 0.74;
      const sr = 0.5 + rnd() * rnd() * 2.0;
      if (rnd() > 0.93) {
        const hg = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr * 8);
        hg.addColorStop(0.0, `rgba(220,232,255,${0.34 * bright})`);
        hg.addColorStop(1.0, 'rgba(220,232,255,0)');
        ctx.fillStyle = hg;
        ctx.fillRect(sx - sr * 8, sy - sr * 8, sr * 16, sr * 16);
      }
      ctx.fillStyle = `rgba(220,232,255,${bright})`;
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fill();
    }

    // thin cold haze layers low over the city
    for (let i = 0; i < 12; i++) {
      const hy = horizon - H * (0.02 + rnd() * 0.18);
      const hx = rnd() * W;
      const ww = 120 + rnd() * 380;
      const hh = 6 + rnd() * 16;
      ctx.fillStyle = `rgba(150,175,220,${0.02 + rnd() * 0.045})`;
      ctx.beginPath();
      ctx.ellipse(hx, hy, ww, hh, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // far skyline (hazier, lighter)
    ctx.fillStyle = 'rgba(30,41,64,0.75)';
    let bx = -30;
    while (bx < W + 30) {
      const bw = 26 + rnd() * 74;
      const bh = 26 + rnd() * 96;
      ctx.fillRect(bx, horizon - bh, bw, bh + 6);
      bx += bw + 2 + rnd() * 10;
    }

    // near skyline: cold little window lights
    const baseY = H * 0.885;
    bx = -40;
    while (bx < W + 40) {
      const bw = 44 + rnd() * 96;
      const bh = 44 + rnd() * 130;
      const top = baseY - bh;
      ctx.fillStyle = 'rgba(9,13,24,0.97)';
      ctx.fillRect(bx, top, bw, bh + (H - baseY) + 2);
      if (rnd() > 0.62) ctx.fillRect(bx + bw * (0.25 + rnd() * 0.4), top - 10 - rnd() * 18, bw * 0.08, 26);
      const cols = Math.max(1, Math.floor((bw - 10) / 17));
      const rows = Math.max(1, Math.floor((bh - 10) / 21));
      for (let c = 0; c < cols; c++) {
        for (let r2 = 0; r2 < rows; r2++) {
          if (rnd() > 0.70) {
            ctx.fillStyle = `rgba(210,228,255,${0.10 + rnd() * 0.40})`;
            ctx.fillRect(bx + 7 + c * 17, top + 9 + r2 * 21, 4, 6);
          }
        }
      }
      bx += bw + 2 + rnd() * 8;
    }

    // a low warm haze hugging the horizon only (distant city glow)
    const warm = ctx.createLinearGradient(0, horizon - H * 0.11, 0, horizon + H * 0.03);
    warm.addColorStop(0.0, 'rgba(255,168,104,0)');
    warm.addColorStop(0.55, 'rgba(255,164,100,0.09)');
    warm.addColorStop(1.0, 'rgba(255,150,90,0.03)');
    ctx.fillStyle = warm;
    ctx.fillRect(0, horizon - H * 0.11, W, H * 0.14);

    // cold vignette so the night reads deeper at the edges
    const vg = ctx.createRadialGradient(W * 0.5, H * 0.42, H * 0.18, W * 0.5, H * 0.42, H * 0.78);
    vg.addColorStop(0.0, 'rgba(0,0,0,0)');
    vg.addColorStop(1.0, 'rgba(2,5,14,0.30)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }, { clamp: true, anisotropy: 4 });
}

/* ------------------------------------------------------------------ */
/*  Book spines                                                        */
/* ------------------------------------------------------------------ */

const SPINE_TITLES = BOOK_TITLES;

/* Morandi / deep library palette: muted clay, olive-grey, dusty blue,
   warm charcoal, bone, oxblood, sage, walnut, pale ochre, slate.        */
const SPINE_COLORS = [
  ['#9A6B52', '#F1E6D4'], // muted clay
  ['#6E7053', '#EDE6D2'], // olive grey
  ['#4E5D73', '#E6E0D2'], // dusty blue
  ['#3B3833', '#E8DCC6'], // warm charcoal
  ['#D8CFC0', '#40382E'], // bone
  ['#6B2F2C', '#EFE0C8'], // oxblood
  ['#7E8874', '#F0EAD8'], // sage
  ['#2F3A32', '#DED3BE'], // deep green grey
  ['#8B6F5A', '#F2E8D6'], // umber
  ['#5B4A3F', '#E9DCC5'], // walnut
  ['#A08A6B', '#2E2820'], // pale ochre
  ['#46464E', '#E7DCC8'], // slate
  ['#7A6A5D', '#F0E7D6'], // taupe
  ['#59606B', '#EAE2D2'], // blue grey
  ['#8E7A64', '#332C24'], // clay brown
  ['#B0A48F', '#3A342B'], // pale stone
];

export function spineTexture(rnd, index) {
  const title = SPINE_TITLES[index % SPINE_TITLES.length];
  const [bg, fg] = SPINE_COLORS[index % SPINE_COLORS.length];
  const W = 128;
  const H = 512;
  const tex = canvasTexture(W, H, (ctx, w, h) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // leather / cloth sheen
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.10)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.02)');
    g.addColorStop(1, 'rgba(0,0,0,0.16)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // edge strips
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(0, 0, 4, h);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(w - 4, 0, 4, h);

    // gold rules
    ctx.strokeStyle = 'rgba(212,178,116,0.75)';
    ctx.lineWidth = 2;
    for (const y of [h * 0.10, h * 0.88]) {
      ctx.beginPath();
      ctx.moveTo(14, y);
      ctx.lineTo(w - 14, y);
      ctx.stroke();
    }
    // little diamond ornaments
    ctx.fillStyle = 'rgba(212,178,116,0.85)';
    for (const y of [h * 0.07, h * 0.91]) {
      ctx.beginPath();
      ctx.moveTo(w / 2, y - 5);
      ctx.lineTo(w / 2 + 5, y);
      ctx.lineTo(w / 2, y + 5);
      ctx.lineTo(w / 2 - 5, y);
      ctx.closePath();
      ctx.fill();
    }

    // vertical title
    const isLatin = /^[A-Z ]+$/.test(title);
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (isLatin) {
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(Math.PI / 2);
      ctx.font = '600 20px Georgia, "Times New Roman", serif';
      ctx.fillText(title, 0, 0);
      ctx.restore();
    } else {
      const chars = [...title];
      const available = h * 0.7;
      const size = Math.min(38, available / chars.length);
      ctx.font = `500 ${size}px "KaiTi","STKaiti","SimSun",serif`;
      let y = h * 0.5 - ((chars.length - 1) * size * 1.05) / 2;
      for (const ch of chars) {
        ctx.fillText(ch, w / 2, y);
        y += size * 1.05;
      }
    }

    // publisher mark: a quiet dark-gold rule (no bright publisher blocks)
    ctx.fillStyle = 'rgba(196,162,104,0.5)';
    ctx.fillRect(w / 2 - 10, h * 0.935, 20, 3);
    if (rnd() > 0.5) {
      ctx.fillStyle = 'rgba(176,142,86,0.55)';
      ctx.fillRect(w / 2 - 3, h * 0.955, 6, 2);
    }

    // subtle wear
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = `rgba(255,255,255,${rnd() * 0.035})`;
      ctx.fillRect(rnd() * w, rnd() * h, 1.5, 1.5);
    }
  }, { clamp: true, anisotropy: 4 });
  return tex;
}

/* ------------------------------------------------------------------ */
/*  Small decorative art prints                                        */
/* ------------------------------------------------------------------ */

export function artTexture(kind = 0, { w = 384, h = 480 } = {}) {
  return canvasTexture(w, h, (ctx, W, H) => {
    const rnd = mulberry32(31 + kind * 17);
    ctx.fillStyle = '#eee7d8';
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 1200; i++) {
      ctx.fillStyle = `rgba(120,100,70,${rnd() * 0.03})`;
      ctx.fillRect(rnd() * W, rnd() * H, 2, 2);
    }
    ctx.fillStyle = '#16206e';
    if (kind === 0) {
      ctx.beginPath();
      ctx.arc(W * 0.52, H * 0.38, W * 0.24, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1b1a18';
      ctx.fillRect(W * 0.14, H * 0.72, W * 0.72, 3);
      ctx.font = '600 20px Georgia, serif';
      ctx.fillText('NO SAVE POINT', W * 0.14, H * 0.80);
    } else if (kind === 1) {
      ctx.fillStyle = '#1b1a18';
      ctx.beginPath();
      ctx.moveTo(W * 0.16, H * 0.78);
      ctx.lineTo(W * 0.5, H * 0.2);
      ctx.lineTo(W * 0.84, H * 0.78);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#eee7d8';
      ctx.beginPath();
      ctx.arc(W * 0.52, H * 0.52, W * 0.10, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = '#16206e';
      ctx.lineWidth = 3;
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.arc(W * 0.5, H * 0.45, 20 + i * 26, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = '#1b1a18';
      ctx.fillRect(W * 0.14, H * 0.82, W * 0.72, 2);
    }
    ctx.strokeStyle = 'rgba(60,45,30,0.25)';
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, W - 10, H - 10);
  }, { clamp: true });
}

/* ------------------------------------------------------------------ */
/*  Glow / sprites / particles                                         */
/* ------------------------------------------------------------------ */

export function radialGlowTexture({ size = 128, inner = 'rgba(255,226,178,1)', mid = 'rgba(255,196,120,0.45)' } = {}) {
  return canvasTexture(size, size, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, inner);
    g.addColorStop(0.25, mid);
    g.addColorStop(1, 'rgba(255,170,90,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, { clamp: true });
}

export function dustTexture() {
  return canvasTexture(64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,244,220,0.9)');
    g.addColorStop(0.4, 'rgba(255,228,190,0.35)');
    g.addColorStop(1, 'rgba(255,210,160,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, { clamp: true });
}

/**
 * Soft elliptical occlusion blob used as a "contact shadow" decal under the
 * heavy furniture. Black RGB + feathered alpha, so it can be composited with
 * plain alpha blending (out = dst * (1 - a)) on top of floor or rug.
 */
export function contactShadowTexture({ size = 256 } = {}) {
  return canvasTexture(size, size, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.5);
    g.addColorStop(0.0, 'rgba(0,0,0,0.96)');
    g.addColorStop(0.30, 'rgba(0,0,0,0.80)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.46)');
    g.addColorStop(0.78, 'rgba(0,0,0,0.16)');
    g.addColorStop(1.0, 'rgba(0,0,0,0)');
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, { clamp: true, anisotropy: 2 });
}

export function flameTexture({ w = 192, h = 384 } = {}) {
  return canvasTexture(w, h, (ctx, W, H) => {
    // Compose soft, curved tongues around the embers. Density sets both the
    // translucent edge and the smaller, hotter core of each tongue.
    const pixels = ctx.createImageData(W, H);
    const tongues = [
      { x: .49, height: .89, width: .16, bend: .135, phase: .7 },
      { x: .29, height: .56, width: .11, bend: -.09, phase: .25 },
      { x: .68, height: .66, width: .10, bend: .12, phase: 1.8 },
      { x: .54, height: .43, width: .095, bend: -.09, phase: 3.1 },
    ];
    for (let y = 0; y < H; y++) {
      const v = 1 - (y + .5) / H;
      for (let x = 0; x < W; x++) {
        const u = (x + .5) / W;
        let density = 0;
        for (const tongue of tongues) {
          const t = v / tongue.height;
          if (t >= 1) continue;
          const center = tongue.x + tongue.bend * t * Math.sin(6.4 * t + tongue.phase);
          const radius = .006 + tongue.width * Math.pow(1 - t, .76);
          const cross = (u - center) / radius;
          density += Math.exp(-cross * cross * 1.6) * Math.pow(1 - t, .59);
        }
        const heat = Math.min(1, density);
        const index = (y * W + x) * 4;
        pixels.data[index] = 248;
        pixels.data[index + 1] = 92 + 131 * heat;
        pixels.data[index + 2] = 20 + 114 * heat * heat;
        pixels.data[index + 3] = 235 * heat * Math.min(1, v * 23);
      }
    }
    ctx.putImageData(pixels, 0, 0);
  }, { clamp: true });
}

export function emberTexture({ size = 256 } = {}) {
  return canvasTexture(size, size, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h * 0.65, 0, w / 2, h * 0.65, w * 0.5);
    g.addColorStop(0, 'rgba(255,190,110,0.9)');
    g.addColorStop(0.35, 'rgba(255,110,40,0.55)');
    g.addColorStop(1, 'rgba(120,30,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      const x = w / 2 + (Math.random() - 0.5) * w * 0.7;
      const y = h * 0.65 + (Math.random() - 0.5) * h * 0.28;
      ctx.fillStyle = `rgba(255,${150 + Math.random() * 80},70,${Math.random() * 0.5})`;
      ctx.fillRect(x, y, 1.5 + Math.random() * 2, 1.5 + Math.random() * 2);
    }
  }, { clamp: true });
}

// Neutral yarn colours let the same weave serve several dyed textiles.
export function upholsteryWeave({ size = 384, ribbed = false, repeat = [2, 2] } = {}) {
  return canvasTexture(size,size,(ctx,w,h) => {
    const rnd = mulberry32(371);
    ctx.fillStyle = '#d7d2c9';
    ctx.fillRect(0,0,w,h);
    for (let i=0;i<24;i++) {
      const x=rnd()*w,y=rnd()*h,r=40+rnd()*83;
      const wash=ctx.createRadialGradient(x,y,2,x,y,r);
      wash.addColorStop(0,i%2 ? 'rgba(104,94,83,.09)' : 'rgba(255,252,244,.14)');
      wash.addColorStop(1,'rgba(215,210,201,0)');
      ctx.fillStyle=wash;
      ctx.fillRect(x-r,y-r,r*2,r*2);
    }
    for (let x=0;x<w;x+=ribbed?8:3) {
      ctx.fillStyle=ribbed?'rgba(77,70,62,.24)':'rgba(106,97,86,.16)';
      ctx.fillRect(x,0,ribbed?2:1,h);
      ctx.fillStyle='rgba(255,252,244,.25)';
      ctx.fillRect(x+2,0,ribbed?2:.7,h);
    }
    for(let i=0;i<5600;i++) {
      ctx.fillStyle=i%3?'rgba(63,55,47,.115)':'rgba(255,252,244,.21)';
      ctx.fillRect(rnd()*w,rnd()*h,1.5+rnd()*3,.6+rnd());
    }
  },{repeat,anisotropy:8});
}

export function stonewareGlaze({ size = 256 } = {}) {
  return canvasTexture(size,size,(ctx,w,h) => {
    const glaze=ctx.createLinearGradient(0,0,0,h);
    glaze.addColorStop(0,'#7d7e77');
    glaze.addColorStop(.035,'#8d8d80');
    glaze.addColorStop(.14,'#c0b8a6');
    glaze.addColorStop(.40,'#d3c9b9');
    glaze.addColorStop(1,'#b3a896');
    ctx.fillStyle=glaze;
    ctx.fillRect(0,0,w,h);
    const rnd=mulberry32(745);
    for(let i=0;i<4800;i++){
      ctx.fillStyle=i%3?'rgba(62,52,41,.09)':'rgba(248,229,203,.22)';
      ctx.fillRect(rnd()*w,rnd()*h,.6+rnd()*1.7,.6+rnd());
    }
  },{clamp:true,anisotropy:6});
}

export function fabricBump({ size = 256 } = {}) {
  return canvasTexture(size, size, (ctx, w, h) => {
    const rnd = mulberry32(77);
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += 2) {
        const v = Math.round(112 + Math.sin(x * 0.8) * 10 + Math.sin(y * 0.8) * 10 + rnd() * 18);
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(x, y, 2, 2);
      }
    }
  }, { linear: true, repeat: [6, 6] });
}

/* ------------------------------------------------------------------ */
/*  Stone for the fireplace                                            */
/* ------------------------------------------------------------------ */

export function stoneTexture({ size = 512, relief = false } = {}) {
  return canvasTexture(size, size, (ctx, w, h) => {
    const rnd = mulberry32(43), rows=7, ph=h/rows, bw=w/3;
    const brickNoise=mulberry32(85);
    const stone=hexRgb('#a89e90');
    const colors=Array.from({length:rows*3},()=>{
      const value=.935+.13*brickNoise();
      const warmth=(brickNoise()-.5)*.052;
      const channels=stone.map((c,i)=>Math.round(c*(value+(1-i)*warmth)));
      return 'rgb('+channels.join(',')+')';
    });
    ctx.fillStyle=relief?'#696969':'#6e655a';ctx.fillRect(0,0,w,h);
    for(let row=0;row<rows;row++){
      for(let column=-1;column<4;column++){
        const x=column*bw+(row%2)*bw*.5,y=row*ph;
        const inset=Math.max(1,size/280);
        ctx.fillStyle=relief?'#999999':colors[row*3+(column+3)%3];
        const bevel = size/170;
        ctx.beginPath();
        ctx.roundRect(x+inset,y+inset,bw-inset*2,ph-inset*2,bevel);
        ctx.fill();
        if(relief){
          ctx.fillStyle='#b2b2b2';
          ctx.beginPath();
          ctx.roundRect(x+inset+bevel,y+inset+bevel,bw-2*(inset+bevel),ph-2*(inset+bevel),bevel);
          ctx.fill();
          continue;
        }
        const wash=ctx.createLinearGradient(x,y,x+bw,y+ph);
        wash.addColorStop(0,'rgba(245,234,207,.08)');wash.addColorStop(1,'rgba(45,40,31,.07)');
        ctx.fillStyle=wash;ctx.fillRect(x+inset,y+inset,bw-inset*2,ph-inset*2);
        for(let k=0;k<26;k++){
          ctx.fillStyle=rnd()>.45?'rgba(67,59,43,.08)':'rgba(238,227,201,.11)';
          ctx.fillRect(x+rnd()*bw,y+rnd()*ph,.6+rnd()*size/350,.6+rnd()*size/480);
        }
        ctx.strokeStyle='rgba(78,71,53,.11)';ctx.lineWidth=.45;
        const vy=y+ph*(.3+rnd()*.4);ctx.beginPath();ctx.moveTo(x,vy);ctx.bezierCurveTo(x+bw*.4,vy-3,x+bw*.7,vy+3,x+bw,vy+1);ctx.stroke();
        ctx.strokeStyle='rgba(238,225,197,.11)';ctx.lineWidth=.6;ctx.beginPath();ctx.moveTo(x+inset,y+inset);ctx.lineTo(x+bw-inset,y+inset);ctx.stroke();
      }
    }
  }, { repeat:[1,1], anisotropy:4 });
}

/* ------------------------------------------------------------------ */
/*  Soft plaid throw blanket                                           */
/* ------------------------------------------------------------------ */

// Crossing warp and weft. Linear height is separate from the neutral
// diffuse speckle so the dye colour stays independent of the bump strength.
export function sofaLinenTextures() {
  const size = 384, warpCount = 48, weftCount = 48;
  const random = mulberry32(902);
  const warp = Float32Array.from({length:warpCount},random);
  const weft = Float32Array.from({length:weftCount},random);
  const pixels = new Float32Array(size*size);
  const step = size/warpCount;
  for (let y=0;y<size;y++) {
    const j=Math.floor(y/step), fy=(y+.5)/step-j;
    for (let x=0;x<size;x++) {
      const i=Math.floor(x/step), fx=(x+.5)/step-i;
      const across=Math.sin(Math.PI*fx)**1.6;
      const along=Math.sin(Math.PI*fy)**1.6;
      const up=(i+j)%2===0;
      const warpFibre=across*(.47+.20*warp[i])*(up ? .95 : .38);
      const weftFibre=along*(.47+.20*weft[j])*(up ? .37 : .98);
      pixels[y*size+x]=Math.max(warpFibre,weftFibre)+.07*random();
    }
  }
  const draw=(ctx,w,h,base,contrast)=>{
    const image=ctx.createImageData(w,h);
    for(let i=0;i<pixels.length;i++){
      const g=Math.round(base+contrast*pixels[i]);
      const k=i*4;
      image.data[k]=image.data[k+1]=image.data[k+2]=g;
      image.data[k+3]=255;
    }
    ctx.putImageData(image,0,0);
  };
  return {
    linenDiffuse:canvasTexture(size,size,(ctx,w,h)=>draw(ctx,w,h,212,57),{repeat:[4,4],anisotropy:8}),
    linenHeight:canvasTexture(size,size,(ctx,w,h)=>draw(ctx,w,h,79,150),{repeat:[4,4],linear:true,anisotropy:8}),
  };
}

export function sofaWoolPlaid() {
  return canvasTexture(512,512,(ctx,w,h)=>{
    ctx.fillStyle='#434e59';
    ctx.fillRect(0,0,w,h);
    const dye=[
      ['#c2b59f',.169,.005,.60],['#c2b59f',.182,.002,.40],
      ['#7a4232',.227,.014,.65],['#b0a894',.665,.005,.54],
      ['#c2b59f',.679,.003,.40],['#7a4232',.715,.010,.60],
    ];
    for(const [color,at,width,alpha] of dye){
      ctx.globalAlpha=alpha;
      ctx.fillStyle=color;
      ctx.fillRect(w*at,0,w*width,h);
      ctx.fillRect(0,h*at,w,h*width);
    }
    ctx.globalAlpha=1;
    const rnd=mulberry32(219);
    for(let y=0;y<h;y+=4) for(let x=0;x<w;x+=5) {
      const light=(Math.floor(x/5)+y/4)%2===0;
      ctx.fillStyle=light?'rgba(212,198,175,.16)':'rgba(19,26,29,.18)';
      const length=2+rnd()*2;
      ctx.fillRect(x+(light ? rnd() : 0),y+.7,length,light?1.8:1.4);
    }
  },{repeat:[1.4,2.2],anisotropy:8});
}

export function plaidTexture({ size = 384 } = {}) {
  return canvasTexture(size, size, (ctx, w, h) => {
    const rnd = mulberry32(118);
    ctx.fillStyle = '#d9cebc';
    ctx.fillRect(0, 0, w, h);
    const bands = [
      { color: 'rgba(113,78,52,.26)', at: .16, width: .055 },
      { color: 'rgba(104,51,44,.40)', at: .22, width: .010 },
      { color: 'rgba(132,93,61,.24)', at: .48, width: .033 },
      { color: 'rgba(107,60,50,.38)', at: .70, width: .013 },
      { color: 'rgba(124,94,69,.28)', at: .74, width: .045 },
    ];
    for (const b of bands) {
      ctx.fillStyle = b.color;
      ctx.fillRect(0, h * b.at, w, h * b.width);
      ctx.fillRect(w * b.at, 0, w * b.width, h);
      ctx.fillStyle = 'rgba(255,250,240,0.28)';
      ctx.fillRect(w * b.at + 2, 0, w * b.width * 0.25, h);
      ctx.fillRect(0, h * b.at + 2, w, h * b.width * 0.25);
    }
    // weave texture
    for (let i = 0; i < w; i += 3) {
      ctx.strokeStyle = 'rgba(90,70,50,0.045)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, h);
      ctx.stroke();
    }
    for (let j = 0; j < h; j += 3) {
      ctx.strokeStyle = 'rgba(255,255,255,0.035)';
      ctx.beginPath();
      ctx.moveTo(0, j);
      ctx.lineTo(w, j);
      ctx.stroke();
    }
    for (let i = 0; i < 500; i++) {
      ctx.fillStyle = `rgba(120,100,70,${rnd() * 0.04})`;
      ctx.fillRect(rnd() * w, rnd() * h, 2, 2);
    }
  }, { repeat: [2, 2], anisotropy: 4 });
}

/* ------------------------------------------------------------------ */
/*  Tileable value-noise helpers (normal maps / roughness maps)        */
/* ------------------------------------------------------------------ */

/* periodic value noise: sample(x,y) tiles seamlessly over `size` */
function periodicField(size, cells, seed) {
  const rnd = mulberry32(seed);
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  return function sample(x, y) {
    const fx = (x / size) * cells;
    const fy = (y / size) * cells;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const i0 = ((x0 % cells) + cells) % cells;
    const j0 = ((y0 % cells) + cells) % cells;
    const i1 = (i0 + 1) % cells;
    const j1 = (j0 + 1) % cells;
    const a = g[j0 * cells + i0];
    const b = g[j0 * cells + i1];
    const c = g[j1 * cells + i0];
    const d = g[j1 * cells + i1];
    return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
  };
}

/* build a tangent-space normal map (linear data) from a height function */
function heightToNormal(size, heightFn, strength = 8) {
  const hm = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) hm[y * size + x] = heightFn(x, y);
  }
  return canvasTexture(size, size, (ctx, w, h) => {
    const img = ctx.createImageData(w, h);
    const d = img.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const xl = hm[y * w + ((x - 1 + w) % w)];
        const xr = hm[y * w + ((x + 1) % w)];
        const yu = hm[((y - 1 + h) % h) * w + x];
        const yd = hm[((y + 1) % h) * w + x];
        const nx = (xl - xr) * strength;
        const ny = (yu - yd) * strength;
        const nz = 1;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        const i = (y * w + x) * 4;
        d[i] = Math.round(((nx / len) * 0.5 + 0.5) * 255);
        d[i + 1] = Math.round(((ny / len) * 0.5 + 0.5) * 255);
        d[i + 2] = Math.round(((nz / len) * 0.5 + 0.5) * 255);
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, { linear: true, repeat: [1, 1], anisotropy: 4 });
}

/* nubby bouclé: tight irregular loops + fine fibre fuzz (tileable) */
export function boucleNormal({ size = 512, strength = 9 } = {}) {
  const f1 = periodicField(size, 26, 511);
  const f2 = periodicField(size, 61, 512);
  const f3 = periodicField(size, 143, 513);
  return heightToNormal(size, (x, y) => {
    const v = f1(x, y) * 0.46 + f2(x, y) * 0.34 + f3(x, y) * 0.2;
    return Math.pow(v, 1.7);
  }, strength);
}

/* soft pebbled leather grain (tileable) */
export function leatherNormal({ size = 512, strength = 5.5 } = {}) {
  const f1 = periodicField(size, 18, 601);
  const f2 = periodicField(size, 37, 602);
  const f3 = periodicField(size, 84, 603);
  return heightToNormal(size, (x, y) => {
    const v = f1(x, y) * 0.5 + f2(x, y) * 0.32 + f3(x, y) * 0.18;
    return Math.pow(v, 1.15);
  }, strength);
}

/* thick wool pile: coarse loops with a faint directional lay (tileable).
   The extra high-frequency octave keeps the pile fine enough that the rug
   never reads as coarse stone grain at a distance. */
export function woolNormal({ size = 512, strength = 5.2 } = {}) {
  const f1 = periodicField(size, 22, 701);
  const f2 = periodicField(size, 48, 702);
  const f3 = periodicField(size, 110, 703);
  const f4 = periodicField(size, 196, 704);
  return heightToNormal(size, (x, y) => {
    const lay = Math.sin((x / size) * Math.PI * 2 * 24) * 0.032;
    const v = f1(x, y) * 0.40 + f2(x, y) * 0.29 + f3(x, y) * 0.20 + f4(x, y) * 0.11 + lay;
    return Math.pow(Math.max(0, v), 1.22);
  }, strength);
}

/* ------------------------------------------------------------------ */
/*  Walnut + floor roughness variation                                 */
/* ------------------------------------------------------------------ */

export function walnutTexture({ seed = 41, size = 1024, planks = 4, repeat = [1, 1] } = {}) {
  return canvasTexture(size,size,(ctx,w,h)=>{
    const rnd=mulberry32(seed);
    const board=h/planks;
    for(let i=0;i<planks;i++){
      const y=i*board;
      const base=shade('#4c3325',(rnd()-.5)*.054);
      ctx.save();
      ctx.beginPath();ctx.rect(0,y,w,board);ctx.clip();
      ctx.fillStyle=base;ctx.fillRect(0,y,w,board);

      const center=.26+rnd()*.47;
      const phase=rnd()*Math.PI*2;
      const drift=(u,v)=>{
        const wave=Math.sin(u*Math.PI*2+phase)*.013+Math.sin(u*Math.PI*4-.4)*.008;
        const arch=Math.cos((u-center)*Math.PI*2);
        const ridge=(.5+.5*arch)**3;
        return v+wave+(v-.52)*ridge*.40+.086*ridge;
      };
      for(let line=0;line<164;line++){
        const v=rnd()*1.27-.13;
        const dark=rnd()<.64;
        ctx.strokeStyle=dark?`rgba(24,13,8,${.05+rnd()*.18})`:`rgba(193,143,99,${.035+rnd()*.085})`;
        ctx.lineWidth=(.37+rnd()**2*2)*w/1024;
        ctx.beginPath();
        for(let step=0;step<=65;step++){
          const u=step/65, gy=y+drift(u,v)*board;
          if(step===0)ctx.moveTo(0,gy);else ctx.lineTo(u*w,gy);
        }
        ctx.stroke();
      }
      // Pores, faded open grain and shallow wear in the direction of the cut.
      for(let j=0;j<380;j++){
        const u=rnd(),v=rnd(),py=y+drift(u,v)*board;
        ctx.fillStyle=j%3?'rgba(27,14,8,.15)':'rgba(210,156,111,.10)';
        ctx.fillRect(u*w,py,.8+rnd()*6,.5+rnd()*.65);
      }
      const profile=ctx.createLinearGradient(0,y,0,y+board);
      profile.addColorStop(0,'rgba(26,13,6,.26)');
      profile.addColorStop(.07,'rgba(170,123,82,.12)');
      profile.addColorStop(.36,'rgba(172,131,94,.05)');
      profile.addColorStop(.72,'rgba(29,16,9,.03)');
      profile.addColorStop(1,'rgba(27,15,7,.18)');
      ctx.fillStyle=profile;ctx.fillRect(0,y,w,board);
      ctx.restore();
    }
  },{repeat,anisotropy:8});
}

export function cutPaperEdges() {
  return canvasTexture(512,192,(ctx,w,h)=>{
    const rnd=mulberry32(1184);
    ctx.fillStyle='#cfc0a3';ctx.fillRect(0,0,w,h);
    for(let y=1;y<h;y+=1.3+rnd()*2.2){
      const edge=ctx.createLinearGradient(0,y,w,y);
      edge.addColorStop(0,'rgba(78,60,39,.20)');
      edge.addColorStop(.57,y%3?'rgba(103,82,52,.13)':'rgba(249,228,180,.16)');
      edge.addColorStop(1,'rgba(76,57,35,.24)');
      ctx.fillStyle=edge;ctx.fillRect(0,y,w,.40+rnd()*.65);
    }
    for(let j=0;j<85;j++){
      ctx.fillStyle='rgba(109,80,41,.085)';
      ctx.fillRect(rnd()*w,rnd()*h,2+rnd()*32,.5+rnd());
    }
  },{clamp:true,anisotropy:8});
}

// A small original cloth-cover atlas. The seam, faded foil and paper rub sit
// in the albedo, so nothing glitters or changes with the camera angle.
export function stackedBookCovers() {
  const cells=[
    ['#776149','#d1b58b','山居札记','MOUNTAIN NOTES'],
    ['#4a555a','#b5b19e','西窗小记','WEST WINDOW'],
    ['#535747','#c6b993','草木图鉴','BOTANICAL STUDIES'],
    ['#655148','#c5ae97','田野笔记','FIELD NOTES'],
  ];
  return canvasTexture(1024,384,(ctx)=>{
    const rnd=mulberry32(5255);
    cells.forEach(([cloth,ink,title,subtitle],i)=>{
      ctx.save();
      ctx.translate(i*256,0);
      ctx.beginPath();ctx.rect(0,0,256,384);ctx.clip();
      ctx.fillStyle=cloth;ctx.fillRect(0,0,256,384);
      for(let x=0;x<256;x+=3){
        ctx.fillStyle=x%2?'rgba(35,24,16,.13)':'rgba(232,210,177,.13)';
        ctx.fillRect(x,0,1,384);
      }
      for(let y=0;y<384;y+=3){
        ctx.fillStyle=y%2?'rgba(29,21,14,.11)':'rgba(226,207,170,.10)';
        ctx.fillRect(0,y,256,1);
      }
      const gutter=ctx.createLinearGradient(0,0,47,0);
      gutter.addColorStop(0,'rgba(33,23,17,.23)');
      gutter.addColorStop(.43,'rgba(22,17,12,.12)');
      gutter.addColorStop(.5,'rgba(19,13,8,.26)');
      gutter.addColorStop(.60,'rgba(228,199,147,.13)');
      gutter.addColorStop(1,'rgba(228,199,147,0)');
      ctx.fillStyle=gutter;ctx.fillRect(0,0,47,384);
      ctx.strokeStyle=ink;ctx.globalAlpha=.60;ctx.lineWidth=.85;
      ctx.strokeRect(30,14,207,355);
      ctx.strokeRect(34,19,199,345);
      ctx.globalAlpha=.89;ctx.fillStyle=ink;ctx.textAlign='center';
      ctx.font='600 27px "Noto Serif SC", "SimSun", serif';
      ctx.fillText(title,134,113);
      ctx.font='12px Georgia,serif';ctx.fillText(subtitle,134,142);
      ctx.globalAlpha=.66;ctx.beginPath();
      if(i===2){
        ctx.moveTo(124,270);ctx.quadraticCurveTo(142,241,148,205);
        ctx.moveTo(138,240);ctx.quadraticCurveTo(107,230,112,214);ctx.quadraticCurveTo(140,218,138,240);
        ctx.moveTo(144,229);ctx.quadraticCurveTo(149,203,167,200);ctx.quadraticCurveTo(167,218,144,229);
      }else{
        ctx.moveTo(77,253);ctx.lineTo(114,219);ctx.lineTo(132,239);ctx.lineTo(155,208);ctx.lineTo(189,253);
        ctx.moveTo(91,261);ctx.quadraticCurveTo(129,244,175,259);
      }
      ctx.stroke();
      ctx.globalAlpha=1;
      for(let j=0;j<78;j++){
        const y=rnd()*384,x=rnd()<.48?rnd()*30:256-rnd()*26;
        ctx.fillStyle='rgba(214,182,132,.15)';
        ctx.fillRect(x,y,1+rnd()*3,1+rnd()*4);
      }
      ctx.restore();
    });
  },{clamp:true,anisotropy:8});
}
export function woodRoughness({ seed = 71, size = 512, planks = 6 } = {}) {
  return canvasTexture(size, size, (ctx, w, h) => {
    const rnd = mulberry32(seed);
    const ph = h / planks;
    for (let i = 0; i < planks; i++) {
      const y = i * ph;
      const v = 192 + Math.round((rnd() - 0.5) * 26);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(0, y, w, ph);

      // grain: a touch duller than the polished board
      for (let g2 = 0; g2 < 90; g2++) {
        const gy = y + 2 + rnd() * (ph - 4);
        const vv = 190 + Math.round((rnd() - 0.5) * 36);
        ctx.strokeStyle = `rgba(${vv},${vv},${vv},0.55)`;
        ctx.lineWidth = 0.7 + rnd() * 2.2;
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.bezierCurveTo(w * 0.3, gy + (rnd() - 0.5) * 4, w * 0.7, gy + (rnd() - 0.5) * 4, w, gy + (rnd() - 0.5) * 3);
        ctx.stroke();
      }

      // worn, duller patches
      for (let k = 0; k < 3; k++) {
        const px = rnd() * w;
        const py = y + ph * (0.2 + rnd() * 0.6);
        const pr = 40 + rnd() * 90;
        const rg = ctx.createRadialGradient(px, py, 0, px, py, pr);
        rg.addColorStop(0, 'rgba(196,196,196,0.30)');
        rg.addColorStop(1, 'rgba(196,196,196,0)');
        ctx.fillStyle = rg;
        ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2);
      }

      // board joint (rougher)
      ctx.fillStyle = 'rgba(206,206,206,0.8)';
      ctx.fillRect(0, y, w, 2);
    }
  }, { linear: true, repeat: [1, 1], anisotropy: 4 });
}

/* ------------------------------------------------------------------ */
/*  Rice-paper wall finish (near white, faint long fibres)             */
/* ------------------------------------------------------------------ */

// Hand-trowelled warm plaster, with subdued mottling and no directional fibres.
export function oatPlasterTexture(base,seed,size=512,ceilingDepth=0) {
  return canvasTexture(size,size,(ctx,w,h) => {
    const rnd=mulberry32(seed);
    ctx.fillStyle=base;
    ctx.fillRect(0,0,w,h);
    for(let i=0;i<45;i++){
      const x=rnd()*w,y=rnd()*h,r=(.075+rnd()*.19)*w,opacity=.018+rnd()*.035;
      const color=i%3?'114,94,76':'252,242,221';
      for(const dx of [-w,0,w]) for(const dy of [-h,0,h]){
        const px=x+dx,py=y+dy;
        if(px+r<0||py+r<0||px-r>w||py-r>h)continue;
        const wash=ctx.createRadialGradient(px,py,0,px,py,r);
        wash.addColorStop(0,'rgba('+color+','+opacity+')');
        wash.addColorStop(1,'rgba('+color+',0)');
        ctx.fillStyle=wash;
        ctx.fillRect(px-r,py-r,r*2,r*2);
      }
    }
    for(let i=0;i<13000;i++){
      ctx.fillStyle=i%3?'rgba(88,69,52,.057)':'rgba(245,237,217,.13)';
      ctx.fillRect(rnd()*w,rnd()*h,.6+rnd()*2,.6+rnd()*1.4);
    }
    if(ceilingDepth){
      const penumbra=ctx.createRadialGradient(w*.5,h*.5,w*.1,w*.5,h*.5,w*.67);
      penumbra.addColorStop(0,'rgba(83,66,52,0)');
      penumbra.addColorStop(1,'rgba(70,53,40,.32)');
      ctx.fillStyle=penumbra;
      ctx.fillRect(0,0,w,h);
      const band=h*.054;
      for(const z of [-2.55,0,2.55]){
        const y=h*(.5+z/ceilingDepth);
        const joint=ctx.createLinearGradient(0,y-band,0,y+band);
        joint.addColorStop(0,'rgba(60,45,34,0)');
        joint.addColorStop(.5,'rgba(60,45,34,.38)');
        joint.addColorStop(1,'rgba(60,45,34,0)');
        ctx.fillStyle=joint;
        ctx.fillRect(0,y-band,w,band*2);
      }
    }
  },{anisotropy:6});
}

export function ricePaperTexture({ seed = 311, base = '#F2EDE3', size = 1024, tint = 0 } = {}) {
  return canvasTexture(size, size, (ctx, w, h) => {
    const rnd = mulberry32(seed);
    ctx.fillStyle = shade(base, tint);
    ctx.fillRect(0, 0, w, h);

    // soft pulp mottling
    for (let i = 0; i < 5200; i++) {
      const a = 0.02 + rnd() * 0.05;
      ctx.fillStyle = rnd() > 0.5 ? `rgba(255,253,247,${a})` : `rgba(196,186,168,${a * 0.75})`;
      const s = 0.8 + rnd() * 2.6;
      ctx.fillRect(rnd() * w, rnd() * h, s, s);
    }

    // faint broad wash
    for (let i = 0; i < 8; i++) {
      const x = rnd() * w;
      const y = rnd() * h;
      const r = 90 + rnd() * 210;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,253,246,0.09)');
      g.addColorStop(1, 'rgba(255,253,246,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }

    // long, thin, slightly waving fibres (drawn wrapped so the tile repeats)
    for (let i = 0; i < 240; i++) {
      const fy = h * (0.03 + rnd() * 0.94);
      const fx = rnd() * w;
      const len = 90 + rnd() * 560;
      const bend = (rnd() - 0.5) * 22;
      const light = rnd() > 0.42;
      ctx.strokeStyle = light
        ? `rgba(255,255,252,${0.10 + rnd() * 0.16})`
        : `rgba(190,178,158,${0.05 + rnd() * 0.09})`;
      ctx.lineWidth = 0.6 + rnd() * 1.0;
      for (const off of [-w, 0, w]) {
        ctx.beginPath();
        ctx.moveTo(fx + off, fy);
        ctx.quadraticCurveTo(fx + off + len * 0.5, fy + bend, fx + off + len, fy + bend * 0.3);
        ctx.stroke();
      }
    }

    // gentle vertical value falloff
    const vg = ctx.createLinearGradient(0, 0, 0, h);
    vg.addColorStop(0, 'rgba(255,255,255,0.045)');
    vg.addColorStop(1, 'rgba(150,138,120,0.055)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
  }, { repeat: [1, 1], anisotropy: 4 });
}

/* ------------------------------------------------------------------ */
/*  Book-spine atlas: 8 x 16 cells of 256 x 128 (cell 0 = page edge)   */
/*  One texture + one merged material keeps the whole library cheap.   */
/* ------------------------------------------------------------------ */

// The aspect-aware instanced library atlas is implemented in shelf-books.js.
