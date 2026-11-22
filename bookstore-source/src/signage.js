import * as THREE from 'three';

/* ================================================================== */
/*  Cozy bookstore — wall signage & small decorative lettering         */
/*                                                                     */
/*  Everything is generated in-module from <canvas> textures + three   */
/*  geometry. No external images are used.                             */
/*                                                                     */
/*  Layout reference (from room.js):                                   */
/*    room          X 8.4 / Z 7.2 / H 3.5                              */
/*    back wall     z = -3.60, bookcase tops ≈ y 2.916                 */
/*    left wall     x = -4.20, framed print at z -1.70                 */
/*    round side table at (-2.72, 0, -0.32), top surface y ≈ 0.5775    */
/*                                                                     */
/*  Exports: addSignage(scene, { shadow }) -> THREE.Group (+ .update)  */
/* ================================================================== */

const FONT_CN = '"KaiTi","STKaiti","SimSun",serif';
const FONT_EN = 'Georgia,"Times New Roman",serif';

const COLORS = {
  walnut: '#3b2617',
  walnutDark: '#24150c',
  brass: 0xc8a25e,
  brassDark: 0xa67f44,
  cream: '#efe3cc',
  creamBright: '#f8f0df',
  ink: '#161412',
  paper: '#f1e8d6',
  electricBlue: '#2236ff',
  engrave: '#27180d',
};

/* ------------------------------------------------------------------ */
/*  tiny deterministic helpers                                         */
/* ------------------------------------------------------------------ */

function seededRandom(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(width, height, draw, { anisotropy = 8 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  draw(ctx, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = anisotropy;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Width of a string drawn one glyph at a time, with explicit tracking. */
function trackedWidth(ctx, text, tracking) {
  const chars = Array.from(text);
  let width = 0;
  for (const ch of chars) width += ctx.measureText(ch).width;
  return width + Math.max(0, chars.length - 1) * tracking;
}

/** Draw centred text with real letter-spacing (canvas has no portable API). */
function drawTracked(ctx, text, centerX, centerY, tracking, color) {
  const chars = Array.from(text);
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((sum, w) => sum + w, 0) + Math.max(0, chars.length - 1) * tracking;

  const previousAlign = ctx.textAlign;
  const previousBaseline = ctx.textBaseline;
  const previousFill = ctx.fillStyle;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;

  let x = centerX - total / 2;
  for (let i = 0; i < chars.length; i++) {
    ctx.fillText(chars[i], x, centerY);
    x += widths[i] + tracking;
  }

  ctx.textAlign = previousAlign;
  ctx.textBaseline = previousBaseline;
  ctx.fillStyle = previousFill;
  return total;
}

/** Faux carved lettering: dark offset shadow, warm fill, tiny top highlight. */
function drawCarvedText(ctx, text, centerX, centerY, tracking, { fill, shadow, highlight, shadowY = 4 }) {
  ctx.save();
  ctx.globalAlpha *= 0.62;
  drawTracked(ctx, text, centerX, centerY + shadowY, tracking, shadow);
  ctx.restore();

  drawTracked(ctx, text, centerX, centerY, tracking, fill);

  if (highlight) {
    ctx.save();
    ctx.globalAlpha *= 0.22;
    drawTracked(ctx, text, centerX, centerY - 1.5, tracking, highlight);
    ctx.restore();
  }
}

function woodCanvas(width, height, { seed = 3, base = COLORS.walnut, dark = COLORS.walnutDark, planks = 3 } = {}) {
  return canvasTexture(width, height, (ctx, w, h) => {
    const rnd = seededRandom(seed);

    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);

    // Broad board bands, kept subtle so the sign still reads as one piece.
    const bandHeight = h / planks;
    for (let i = 0; i < planks; i++) {
      const y = i * bandHeight;
      ctx.fillStyle = `rgba(255,224,190,${0.02 + rnd() * 0.035})`;
      ctx.fillRect(0, y, w, bandHeight);
      ctx.fillStyle = 'rgba(20,10,5,0.24)';
      ctx.fillRect(0, y, w, 2);
    }

    // Grain.
    const lines = Math.round(h * 1.8);
    for (let i = 0; i < lines; i++) {
      const y = rnd() * h;
      const light = rnd() > 0.58;
      ctx.strokeStyle = light ? `rgba(255,230,200,${0.025 + rnd() * 0.045})` : `rgba(18,9,4,${0.04 + rnd() * 0.075})`;
      ctx.lineWidth = 0.6 + rnd() * 2.0;
      ctx.beginPath();
      ctx.moveTo(-6, y);
      ctx.bezierCurveTo(
        w * 0.25,
        y + (rnd() - 0.5) * 4,
        w * 0.62,
        y + (rnd() - 0.5) * 5,
        w + 6,
        y + (rnd() - 0.5) * 3
      );
      ctx.stroke();
    }

    // A couple of quiet knots.
    for (let k = 0; k < 2; k++) {
      if (rnd() < 0.7) {
        const kx = rnd() * w;
        const ky = rnd() * h;
        for (let i = 0; i < 4; i++) {
          ctx.strokeStyle = `rgba(15,7,3,${0.16 - i * 0.033})`;
          ctx.lineWidth = 2.4 - i * 0.45;
          ctx.beginPath();
          ctx.ellipse(kx, ky, 10 + i * 8, 3 + i * 2.2, 0.1, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    // Fine speckle and edge vignette.
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = rnd() > 0.5 ? 'rgba(255,235,205,0.03)' : 'rgba(10,5,2,0.045)';
      ctx.fillRect(rnd() * w, rnd() * h, 1.5, 1.5);
    }

    const edge = ctx.createLinearGradient(0, 0, 0, h);
    edge.addColorStop(0, 'rgba(12,6,3,0.28)');
    edge.addColorStop(0.1, 'rgba(12,6,3,0)');
    edge.addColorStop(0.9, 'rgba(12,6,3,0)');
    edge.addColorStop(1, 'rgba(12,6,3,0.34)');
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, w, h);

    const side = ctx.createLinearGradient(0, 0, w, 0);
    side.addColorStop(0, 'rgba(10,5,2,0.22)');
    side.addColorStop(0.07, 'rgba(10,5,2,0)');
    side.addColorStop(0.93, 'rgba(10,5,2,0)');
    side.addColorStop(1, 'rgba(10,5,2,0.2)');
    ctx.fillStyle = side;
    ctx.fillRect(0, 0, w, h);
  }, { anisotropy: 8 });
}

/* ------------------------------------------------------------------ */
/*  Canvas artwork                                                     */
/* ------------------------------------------------------------------ */

/** Main bookcase sign lettering — transparent overlay on the walnut board. */
function signLetteringTexture() {
  return canvasTexture(2048, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;

    // Large spaced Chinese title.
    ctx.font = `500 138px ${FONT_CN}`;
    drawCarvedText(ctx, '温馨书屋', cx, 86, 126, {
      fill: COLORS.cream,
      shadow: COLORS.engrave,
      highlight: COLORS.creamBright,
      shadowY: 5,
    });

    // A hairline brass rule between the two lines.
    const ruleY = 168;
    const ruleW = 560;
    ctx.save();
    ctx.strokeStyle = 'rgba(232,208,166,0.30)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(cx - ruleW / 2, ruleY);
    ctx.lineTo(cx + ruleW / 2, ruleY);
    ctx.stroke();
    ctx.fillStyle = 'rgba(232,208,166,0.44)';
    ctx.beginPath();
    ctx.moveTo(cx, ruleY - 4);
    ctx.lineTo(cx + 4, ruleY);
    ctx.lineTo(cx, ruleY + 4);
    ctx.lineTo(cx - 4, ruleY);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Small letter-spaced English line.
    ctx.font = `600 29px ${FONT_EN}`;
    drawCarvedText(ctx, 'EARTH ONLINE  ·  COZY READING ROOM', cx, 210, 10, {
      fill: '#eee1c7',
      shadow: '#25160c',
      highlight: '#fff8ea',
      shadowY: 3,
    });
  }, { anisotropy: 8 });
}

/** Tall brass plaque face: stacked micro lettering + electric-blue rule. */
function plaqueLetteringTexture() {
  return canvasTexture(320, 1024, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;

    // Engraved hairline border.
    ctx.save();
    ctx.strokeStyle = 'rgba(44,28,14,0.30)';
    ctx.lineWidth = 2;
    ctx.strokeRect(14, 14, w - 28, h - 28);
    ctx.strokeStyle = 'rgba(255,235,195,0.16)';
    ctx.lineWidth = 1;
    ctx.strokeRect(17, 17, w - 34, h - 34);
    ctx.restore();

    // Small mounting screws.
    for (const y of [62, h - 62]) {
      ctx.save();
      ctx.fillStyle = 'rgba(38,24,12,0.55)';
      ctx.beginPath();
      ctx.arc(cx, y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,238,200,0.30)';
      ctx.beginPath();
      ctx.arc(cx - 1.5, y - 1.5, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Top ornament.
    ctx.save();
    ctx.fillStyle = 'rgba(43,28,14,0.55)';
    ctx.beginPath();
    ctx.moveTo(cx, 132);
    ctx.lineTo(cx + 8, 144);
    ctx.lineTo(cx, 156);
    ctx.lineTo(cx - 8, 144);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.font = `600 54px ${FONT_EN}`;
    drawCarvedText(ctx, 'NO SAVE', cx, 292, 5, {
      fill: 'rgba(43,27,13,0.82)',
      shadow: 'rgba(255,236,196,0.18)',
      shadowY: -1.5,
    });
    drawCarvedText(ctx, 'POINT', cx, 360, 7, {
      fill: 'rgba(43,27,13,0.82)',
      shadow: 'rgba(255,236,196,0.18)',
      shadowY: -1.5,
    });

    // Electric-blue rule with tiny end diamonds.
    const lineY = 436;
    ctx.save();
    ctx.strokeStyle = 'rgba(41,58,255,0.90)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - 70, lineY);
    ctx.lineTo(cx + 70, lineY);
    ctx.stroke();
    ctx.fillStyle = 'rgba(41,58,255,0.90)';
    for (const x of [cx - 78, cx + 78]) {
      ctx.beginPath();
      ctx.moveTo(x, lineY - 4);
      ctx.lineTo(x + 4, lineY);
      ctx.lineTo(x, lineY + 4);
      ctx.lineTo(x - 4, lineY);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    drawCarvedText(ctx, 'ONE REAL', cx, 566, 4, {
      fill: 'rgba(43,27,13,0.82)',
      shadow: 'rgba(255,236,196,0.18)',
      shadowY: -1.5,
    });
    drawCarvedText(ctx, 'WORLD', cx, 634, 9, {
      fill: 'rgba(43,27,13,0.82)',
      shadow: 'rgba(255,236,196,0.18)',
      shadowY: -1.5,
    });

    // Lower ornament.
    ctx.save();
    ctx.strokeStyle = 'rgba(43,28,14,0.34)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(cx - 58, 738);
    ctx.lineTo(cx + 58, 738);
    ctx.stroke();
    ctx.fillStyle = 'rgba(43,28,14,0.55)';
    ctx.beginPath();
    ctx.arc(cx, 738, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }, { anisotropy: 8 });
}

/** Small tent-card face. */
function tableCardTexture() {
  return canvasTexture(512, 352, (ctx, w, h) => {
    const rnd = seededRandom(88);

    // Warm card stock.
    const paper = ctx.createLinearGradient(0, 0, 0, h);
    paper.addColorStop(0, '#f6efdf');
    paper.addColorStop(0.55, '#f2e8d5');
    paper.addColorStop(1, '#eadfcb');
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, w, h);

    // Fibre + edge wear.
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = rnd() > 0.5 ? `rgba(110,88,58,${rnd() * 0.022})` : `rgba(255,255,245,${rnd() * 0.05})`;
      ctx.fillRect(rnd() * w, rnd() * h, 1.2 + rnd() * 1.8, 1.2);
    }
    ctx.strokeStyle = 'rgba(60,46,28,0.16)';
    ctx.lineWidth = 2;
    ctx.strokeRect(9, 9, w - 18, h - 18);

    // Tiny eyebrow.
    ctx.font = `500 21px ${FONT_EN}`;
    drawTracked(ctx, 'COZY READING ROOM', w / 2, 62, 4.2, 'rgba(86,69,45,0.72)');

    // Chinese invitation.
    ctx.font = `500 68px ${FONT_CN}`;
    drawCarvedText(ctx, '请随意翻阅', w / 2, 158, 4, {
      fill: COLORS.ink,
      shadow: 'rgba(80,58,30,0.28)',
      highlight: 'rgba(255,252,238,0.42)',
      shadowY: 2,
    });

    // English line.
    ctx.font = `600 30px ${FONT_EN}`;
    drawTracked(ctx, 'PLEASE READ', w / 2, 238, 7, '#1b1815');

    // Fine rule.
    ctx.save();
    ctx.strokeStyle = 'rgba(28,24,18,0.46)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(w / 2 - 86, 274);
    ctx.lineTo(w / 2 + 86, 274);
    ctx.stroke();
    ctx.restore();

    // Electric-blue corner chip.
    ctx.fillStyle = COLORS.electricBlue;
    ctx.fillRect(w - 92, h - 82, 52, 38);
    ctx.fillStyle = 'rgba(255,255,255,0.20)';
    ctx.fillRect(w - 92, h - 82, 52, 3);
  }, { anisotropy: 8 });
}

/** Window-side wooden plaque face. */
function windowPlaqueLetteringTexture() {
  return canvasTexture(1024, 320, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;

    ctx.font = `600 62px ${FONT_EN}`;
    let englishWidth = trackedWidth(ctx, 'READ SLOWLY', 9);
    ctx.font = `500 70px ${FONT_CN}`;
    const chineseWidth = trackedWidth(ctx, '慢慢读', 10);
    const dotGap = 58;
    const total = englishWidth + dotGap * 2 + chineseWidth;
    let x = cx - total / 2;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.65;
    ctx.fillStyle = COLORS.engrave;
    ctx.font = `600 62px ${FONT_EN}`;
    drawTracked(ctx, 'READ SLOWLY', x + englishWidth / 2, 164 + 3, 9, 'rgba(31,18,9,0.7)');
    ctx.restore();

    ctx.font = `600 62px ${FONT_EN}`;
    drawTracked(ctx, 'READ SLOWLY', x + englishWidth / 2, 164, 9, COLORS.cream);

    x += englishWidth + dotGap * 0.5;
    ctx.fillStyle = 'rgba(239,227,204,0.8)';
    ctx.beginPath();
    ctx.arc(x, 165, 5, 0, Math.PI * 2);
    ctx.fill();

    x += dotGap * 0.5;
    ctx.font = `500 70px ${FONT_CN}`;
    ctx.save();
    ctx.globalAlpha = 0.65;
    drawTracked(ctx, '慢慢读', x + chineseWidth / 2, 167, 10, 'rgba(31,18,9,0.7)');
    ctx.restore();
    drawTracked(ctx, '慢慢读', x + chineseWidth / 2, 164, 10, COLORS.cream);

    // Thin inlaid rule below.
    ctx.save();
    ctx.strokeStyle = 'rgba(232,214,178,0.28)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(cx - 250, 246);
    ctx.lineTo(cx + 250, 246);
    ctx.stroke();
    ctx.restore();
  }, { anisotropy: 8 });
}

/** Soft additive halo used by the two little wall sconces. */
function sconceGlowTexture() {
  return canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,224,164,0.95)');
    g.addColorStop(0.25, 'rgba(255,196,116,0.46)');
    g.addColorStop(0.6, 'rgba(255,166,88,0.12)');
    g.addColorStop(1, 'rgba(255,150,70,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, { anisotropy: 4 });
}

/* ------------------------------------------------------------------ */
/*  Geometry / material helpers                                        */
/* ------------------------------------------------------------------ */

function brassFrameGeometry(outerWidth, outerHeight, band, depth) {
  const ow = outerWidth / 2;
  const oh = outerHeight / 2;
  const iw = ow - band;
  const ih = oh - band;

  const shape = new THREE.Shape();
  shape.moveTo(-ow, -oh);
  shape.lineTo(ow, -oh);
  shape.lineTo(ow, oh);
  shape.lineTo(-ow, oh);
  shape.closePath();

  const hole = new THREE.Path();
  hole.moveTo(-iw, -ih);
  hole.lineTo(-iw, ih);
  hole.lineTo(iw, ih);
  hole.lineTo(iw, -ih);
  hole.closePath();
  shape.holes.push(hole);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.002,
    bevelSize: 0.003,
    bevelSegments: 1,
    curveSegments: 1,
    steps: 1,
  });
  geometry.computeVertexNormals();
  return geometry;
}

function markMesh(mesh, { cast = false, receive = true, allowShadow = true } = {}) {
  mesh.castShadow = allowShadow && cast;
  mesh.receiveShadow = allowShadow && receive;
  return mesh;
}

/* ------------------------------------------------------------------ */
/*  main export                                                        */
/* ------------------------------------------------------------------ */

export function addSignage(scene, { shadow = true, brass } = {}) {
  if (!scene) throw new Error('addSignage: a THREE.Scene is required');

  const root = new THREE.Group();
  root.name = 'signage';
  scene.add(root);

  const allowShadow = shadow !== false;

  /* ---------------- shared materials / textures ---------------- */
  const walnutTexture = woodCanvas(1024, 256, { seed: 17, base: COLORS.walnut, dark: COLORS.walnutDark, planks: 2 });
  const windowWoodTexture = woodCanvas(512, 192, { seed: 41, base: '#6d4a2e', dark: '#2f1d10', planks: 2 });

  const walnutMaterial = new THREE.MeshStandardMaterial({
    map: walnutTexture,
    color: 0xffffff,
    roughness: 0.57,
    metalness: 0.02,
  });

  const windowWoodMaterial = new THREE.MeshStandardMaterial({
    map: windowWoodTexture,
    color: 0xffffff,
    roughness: 0.62,
    metalness: 0.02,
  });

  const brassMaterial = brass ?? new THREE.MeshStandardMaterial({
    color: COLORS.brass,
    metalness: 0.9,
    roughness: 0.27,
  });

  const plaqueBrassMaterial = new THREE.MeshStandardMaterial({
    color: 0xbd9458,
    metalness: 0.86,
    roughness: 0.36,
  });

  const paperEdgeMaterial = new THREE.MeshStandardMaterial({
    color: 0xece2cf,
    roughness: 0.9,
    metalness: 0.0,
  });

  const signTextMaterial = new THREE.MeshStandardMaterial({
    map: signLetteringTexture(),
    transparent: true,
    depthWrite: false,
    roughness: 0.82,
    metalness: 0.0,
    emissive: 0xffeccb,
    emissiveIntensity: 0.055,
    side: THREE.FrontSide,
  });

  const plaqueTextMaterial = new THREE.MeshStandardMaterial({
    map: plaqueLetteringTexture(),
    transparent: true,
    depthWrite: false,
    roughness: 0.47,
    metalness: 0.22,
    side: THREE.FrontSide,
  });

  const cardTextMaterial = new THREE.MeshStandardMaterial({
    map: tableCardTexture(),
    roughness: 0.88,
    metalness: 0.0,
    side: THREE.FrontSide,
  });

  const windowTextMaterial = new THREE.MeshStandardMaterial({
    map: windowPlaqueLetteringTexture(),
    transparent: true,
    depthWrite: false,
    roughness: 0.7,
    metalness: 0.03,
    emissive: 0xffe9c8,
    emissiveIntensity: 0.035,
    side: THREE.FrontSide,
  });

  /* ================================================================ */
  /*  1. Main walnut sign above the bookcases                          */
  /* ================================================================ */
  const signGroup = new THREE.Group();
  signGroup.name = 'signage-main-sign';
  signGroup.position.set(0, 3.15, -3.50);
  root.add(signGroup);

  const SIGN = {
    outerW: 2.60,
    outerH: 0.34,
    boardW: 2.56,
    boardH: 0.30,
    boardD: 0.040,
    band: 0.035,
    frameDepth: 0.018,
  };

  // Walnut board. Its front face sits at local z = +0.020.
  const signBoard = new THREE.Mesh(
    new THREE.BoxGeometry(SIGN.boardW, SIGN.boardH, SIGN.boardD),
    walnutMaterial
  );
  signBoard.position.set(0, 0, 0);
  markMesh(signBoard, { cast: true, receive: true, allowShadow });
  signGroup.add(signBoard);

  // Raised thin brass frame, flush around the board.
  const signFrame = new THREE.Mesh(
    brassFrameGeometry(SIGN.outerW, SIGN.outerH, SIGN.band, SIGN.frameDepth),
    brassMaterial
  );
  signFrame.position.set(0, 0, 0.014);
  markMesh(signFrame, { cast: true, receive: true, allowShadow });
  signGroup.add(signFrame);

  // Lettering plane, floating just above the wood inside the frame opening.
  const signText = new THREE.Mesh(new THREE.PlaneGeometry(2.16, 0.27), signTextMaterial);
  signText.position.set(0, 0.001, 0.0265);
  signText.castShadow = false;
  signText.receiveShadow = false;
  signGroup.add(signText);

  /* ----- two small brass wall sconces flanking the sign ----- */
  const glowTexture = sconceGlowTexture();
  const bulbMaterials = [];
  const glowMaterials = [];
  const SCONCE_X = 1.40;

  function buildSconce(side) {
    const g = new THREE.Group();
    g.position.set(side * SCONCE_X, 0.012, 0);
    g.name = side < 0 ? 'signage-sconce-left' : 'signage-sconce-right';
    signGroup.add(g);

    // Round brass backplate against the back wall (local wall z = -0.10).
    const backplate = new THREE.Mesh(
      new THREE.CylinderGeometry(0.049, 0.049, 0.014, 24),
      brassMaterial
    );
    backplate.rotation.x = Math.PI / 2;
    backplate.position.set(0, 0, -0.083);
    markMesh(backplate, { cast: false, receive: true, allowShadow });
    g.add(backplate);

    // Short arm reaching forward.
    const arm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0072, 0.0082, 0.10, 10),
      brassMaterial
    );
    arm.rotation.x = Math.PI / 2;
    arm.position.set(0, 0, -0.033);
    markMesh(arm, { cast: false, receive: true, allowShadow });
    g.add(arm);

    // Warm luminous point.
    const bulbMaterial = new THREE.MeshStandardMaterial({
      color: 0x4a321d,
      emissive: 0xffca86,
      emissiveIntensity: 1.75,
      roughness: 0.35,
      metalness: 0.08,
      toneMapped: false,
    });
    bulbMaterials.push(bulbMaterial);

    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.0175, 14, 10), bulbMaterial);
    bulb.position.set(0, 0, 0.019);
    bulb.castShadow = false;
    bulb.receiveShadow = false;
    g.add(bulb);

    // Very soft halo; kept small so it does not compete with the main lights.
    const glowMaterial = new THREE.SpriteMaterial({
      map: glowTexture,
      color: 0xffcf92,
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
    });
    glowMaterials.push(glowMaterial);
    const glow = new THREE.Sprite(glowMaterial);
    glow.position.set(0, 0, 0.024);
    glow.scale.set(0.15, 0.15, 1);
    g.add(glow);

    return g;
  }

  buildSconce(-1);
  buildSconce(1);

  // One intentionally weak point light in front of the sign.
  const signLight = new THREE.PointLight(0xffc48a, 0.16, 1.8, 2.0);
  signLight.position.set(0, 3.02, -3.20);
  signLight.castShadow = false;
  root.add(signLight);

  /* ================================================================ */
  /*  2. Tall brass plaque by the left bookcase                        */
  /* ================================================================ */
  const plaqueGroup = new THREE.Group();
  plaqueGroup.name = 'signage-vertical-plaque';
  plaqueGroup.position.set(-3.36, 1.50, -3.128);
  root.add(plaqueGroup);

  const plaqueBase = new THREE.Mesh(
    new THREE.BoxGeometry(0.160, 0.500, 0.014),
    plaqueBrassMaterial
  );
  plaqueBase.position.set(0, 0, 0);
  markMesh(plaqueBase, { cast: true, receive: true, allowShadow });
  plaqueGroup.add(plaqueBase);

  const plaqueText = new THREE.Mesh(new THREE.PlaneGeometry(0.150, 0.480), plaqueTextMaterial);
  plaqueText.position.set(0, 0, 0.009);
  plaqueText.castShadow = false;
  plaqueText.receiveShadow = false;
  plaqueGroup.add(plaqueText);

  /* ================================================================ */
  /*  3. Little paper tent card on the round side table                */
  /* ================================================================ */
  const cardGroup = new THREE.Group();
  cardGroup.name = 'signage-table-card';
  // Table top is y ≈ 0.5775. Centre height accounts for the lean.
  cardGroup.position.set(-2.62, 0.632, -0.17);
  cardGroup.rotation.set(-0.22, 0.90, 0.0);
  root.add(cardGroup);

  const cardBacking = new THREE.Mesh(
    new THREE.BoxGeometry(0.160, 0.110, 0.0042),
    paperEdgeMaterial
  );
  markMesh(cardBacking, { cast: true, receive: true, allowShadow });
  cardGroup.add(cardBacking);

  const cardFace = new THREE.Mesh(new THREE.PlaneGeometry(0.160, 0.110), cardTextMaterial);
  cardFace.position.set(0, 0, 0.0028);
  cardFace.castShadow = false;
  cardFace.receiveShadow = false;
  cardGroup.add(cardFace);

  /* ================================================================ */
  /*  4. Small wooden plaque on the left wall                          */
  /* ================================================================ */
  const windowPlaqueGroup = new THREE.Group();
  windowPlaqueGroup.name = 'signage-window-plaque';
  windowPlaqueGroup.position.set(-4.187, 1.65, -2.30);
  // Faces +X, into the room.
  windowPlaqueGroup.rotation.y = Math.PI / 2;
  root.add(windowPlaqueGroup);

  const windowPlaqueBoard = new THREE.Mesh(
    new THREE.BoxGeometry(0.420, 0.160, 0.026),
    windowWoodMaterial
  );
  // Local +Z now points into the room (+X). Board is thin along local Z.
  windowPlaqueBoard.position.set(0, 0, 0);
  markMesh(windowPlaqueBoard, { cast: true, receive: true, allowShadow });
  windowPlaqueGroup.add(windowPlaqueBoard);

  const windowPlaqueText = new THREE.Mesh(
    new THREE.PlaneGeometry(0.384, 0.120),
    windowTextMaterial
  );
  windowPlaqueText.position.set(0, 0, 0.0145);
  windowPlaqueText.castShadow = false;
  windowPlaqueText.receiveShadow = false;
  windowPlaqueGroup.add(windowPlaqueText);

  /* ================================================================ */
  /*  animation — only the two tiny sconces breathe, very gently       */
  /* ================================================================ */
  const bulbBaseIntensity = 1.75;
  const glowBaseOpacity = 0.32;
  const lightBaseIntensity = 0.16;

  function update(t) {
    const time = Number.isFinite(t) ? t : performance.now() * 0.001;

    for (let i = 0; i < bulbMaterials.length; i++) {
      const phase = i * 1.7 + 0.6;
      const breathe = 0.965 + 0.035 * Math.sin(time * 1.15 + phase);
      bulbMaterials[i].emissiveIntensity = bulbBaseIntensity * breathe;
      glowMaterials[i].opacity = glowBaseOpacity * (0.94 + 0.06 * Math.sin(time * 1.05 + phase + 0.8));
    }
    signLight.intensity = lightBaseIntensity * (0.945 + 0.055 * Math.sin(time * 1.2 + 0.9));
  }

  // The API asks for a group *and* an optional update; attach it to the group
  // so both calling styles work.
  root.update = update;
  root.signage = {
    update,
    sign: signGroup,
    plaque: plaqueGroup,
    card: cardGroup,
    windowPlaque: windowPlaqueGroup,
    lights: [signLight],
  };

  update(0);
  return root;
}

export default addSignage;
