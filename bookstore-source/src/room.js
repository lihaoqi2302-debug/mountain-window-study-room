import { SOFA, TABLE, CHAIR, SIDE_TABLE, POUF, RECORD_CONSOLE, CUP, RUG, rugSurface } from './room-layout.js';
import { placeSeatThrow, shadeSofaFabric, workLeather, buildEntryConsole, addFramedPrint, addMantelArrangement, addHearthTools, buildWickerBasket } from './room-accents.js';
import { frontWelt, stuffedCushion, woodGrain, addShadeDetail, createWovenMat, addJoineryDetails, createPlankFloor, addReadingTableDetails, addMantelDetails } from './interior-craft.js';
import { createBotanicalMaterials, createBotanicalPlant, createBentwoodRack } from './botanical-craft.js';
import { createBoundVolume } from './shelf-inspection.js';
import { createHearthFlame } from './hearth-flame.js';
import { buildFirebed, addSpareFirewood } from './fireplace-craft.js';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as TX from './textures.js';
import { prepareBookMaterial, createShelfBooks } from './shelf-books.js';
import { createMaterialFinishes, makeBrassMaterial, finishStoneGeometry } from './material-finishes.js';

/* ================================================================== */
/*  A quiet private study at dusk: walnut shelves, cream bouclé,       */
/*  cognac leather, wool, one warm reading lamp, a cold blue window.   */
/*                                                                     */
/*  Everything static is merged per material into a handful of meshes  */
/*  (BufferGeometryUtils.mergeGeometries) so the whole room stays at   */
/*  a few dozen draw calls instead of a thousand.                      */
/* ================================================================== */

export const ROOM = { w: 8.4, d: 7.2, h: 3.5, hx: 4.2, hz: 3.6 };

/* --- coffee table / brass stand / hero book ------------------------ */
const TABLE_TOP_Y = TABLE.top;   // world Y of the walnut table surface
const STAND_TILT = .71;     // Display the cover toward the entrance; the held book turns toward the reader.
const STAND_TOP_Y = TABLE_TOP_Y + Math.sin(STAND_TILT) * 0.297 / 2 + 0.012;

export const BOOK_TABLE = {
  // the book's local origin sits on the brass stand surface (+6 mm so the
  // bottom board never intersects the brass plates)
  center: new THREE.Vector3(TABLE.x + .17, STAND_TOP_Y + .006, TABLE.z + .048),
  topY: STAND_TOP_Y,
  tilt: STAND_TILT,
  yaw: .28,
};

export const READING_CAMERA = {
  base: new THREE.Vector3(SOFA.x,1.12,SOFA.z+.06),
  look: BOOK_TABLE.center.clone(),
  up: new THREE.Vector3(0, 1, 0),
};

/* --- window opening on the left wall ------------------------------- */
const WIN = { z0: -0.60, z1: 1.90, y0: 0.06, y1: 3.44 };
const WIN_W = WIN.z1 - WIN.z0;         // 2.50
const WIN_H = WIN.y1 - WIN.y0;         // 3.38
const WIN_CZ = (WIN.z0 + WIN.z1) / 2;  // 0.65
const LAMP = new THREE.Vector3(-3.5, 0, -1.25);
const ENTRY_PLANT = {x:3.56,z:3.12};
const WINDOW_PLANT = {x:-3.46,z:3.40};
const WALL_X = -ROOM.hx - 0.08;        // centre of the left wall slab

/* --- bookcases ----------------------------------------------------- */
const CASE_D = 0.40;
const CASE_H = 3.40;
const LEVELS = [0.09, 0.55, 1.01, 1.47, 1.93, 2.39, 2.85, 3.31];

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

/* ------------------------------------------------------------------ */
/*  geometry helpers                                                   */
/* ------------------------------------------------------------------ */

const boxGeo = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cylGeo = (rt, rb, h, seg = 16, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
const sphGeo = (r, seg = 16) => new THREE.SphereGeometry(r, seg, Math.max(8, seg - 4));
const planeGeo = (w, h, ws = 1, hs = 1) => new THREE.PlaneGeometry(w, h, ws, hs);
const torusGeo = (r, tube, rs = 8, ts = 24, arc = Math.PI * 2) => new THREE.TorusGeometry(r, tube, rs, ts, arc);

function roundedGeo(w, h, d, r = 0.05, seg = 2) {
  return new RoundedBoxGeometry(w, h, d, seg, Math.min(r, Math.min(w, h, d) * 0.45));
}

function glowSprite(texture, color, scale, opacity = 0.85) {
  const m = new THREE.SpriteMaterial({
    map: texture,
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const s = new THREE.Sprite(m);
  s.scale.set(scale, scale, 1);
  return s;
}

/* ------------------------------------------------------------------ */
/*  main build                                                         */
/* ------------------------------------------------------------------ */

export function buildRoom(scene, { coverTexture, quality = 'high', reducedMotion = false, gallery = {} }) {
  let reduceMotion=reducedMotion;
  const rnd = TX.mulberry32(20261115);
  const root = new THREE.Group();
  root.name = 'room';
  scene.add(root);

  const _e = new THREE.Euler();
  const _q = new THREE.Quaternion();
  const _m4 = new THREE.Matrix4();
  const _v = new THREE.Vector3();
  const _sv = new THREE.Vector3();

  /* ================================================================ */
  /*  textures                                                         */
  /* ================================================================ */

  const rice = [
    TX.oatPlasterTexture('#d8cfc0',311),
    TX.oatPlasterTexture('#cfc4b2',312),
    TX.oatPlasterTexture('#d7cab7',313),
    TX.oatPlasterTexture('#d8cfc0',314),
  ];
  for (const t of rice) t.repeat.set(2.4, 1.3);

  const atlas = TX.spineAtlas({ quality });
  const finishes = createMaterialFinishes(quality);
  const botanicalMaterials=createBotanicalMaterials();

  const textures = {
    ...finishes,
    floor: TX.woodTexture({ seed: 7, base: '#725741', planks: 7, repeat: [3.2, 2.6], grain: 0.70 }),
    floorBump: TX.woodBump({ seed: 12 }),
    floorRough: TX.woodRoughness({ seed: 71, planks: 7 }),
    walnut: TX.walnutTexture({ seed: 41, planks: 4 }),
    walnutShelf: TX.walnutTexture({ seed: 47, planks: 2 }),
    oak: TX.woodTexture({ seed: 19, base: '#8a5c3a', size: 512, planks: 5, repeat: [1, 2] }),
    darkWood: TX.woodTexture({ seed: 23, base: '#4A3225', size: 512, planks: 4 }),
    rice,
    riceA: rice[0],
    riceB: rice[1],
    riceC: rice[2],
    riceD: rice[3],
    ceilingPlaster: TX.oatPlasterTexture('#d2c6b4',316,512,ROOM.d),
    mountainPrint: TX.mountainPrint(),
    rug: TX.rugTexture(),
    rugNormal: TX.woolNormal({ size: 512 }),
    contact: TX.contactShadowTexture(),
    walnutTop: TX.walnutTexture({ seed: 43, planks: 3 }),
    cutPaper: TX.cutPaperEdges(),
    printedCovers: TX.stackedBookCovers(),
    clothWeave: TX.upholsteryWeave(),
    curtainWeave: TX.upholsteryWeave({repeat:[2,7]}),
    boucleNormal: TX.boucleNormal({ size: 512 }),
    leatherNormal: TX.leatherNormal({ size: 512 }),
    spineAtlas: atlas,
    sky: TX.skyTexture(),
    stone: TX.stoneTexture({size:quality==='high'?512:256}),
    stoneRelief: TX.stoneTexture({size:quality==='high'?512:256,relief:true}),
    fabric: TX.fabricBump(),
    plaid: TX.plaidTexture(),
    ...TX.sofaLinenTextures(),
    sofaPlaid: TX.sofaWoolPlaid(),
    cupGlaze: TX.stonewareGlaze(),
    glow: TX.radialGlowTexture({ size: 128 }),
    glowCool: TX.radialGlowTexture({
      size: 256,
      inner: 'rgba(226,238,255,0.95)',
      mid: 'rgba(150,186,240,0.35)',
    }),
    dust: TX.dustTexture(),
    art: [TX.artTexture(0), TX.artTexture(1), TX.artTexture(2)],
  };

  textures.floorBump.repeat.set(3.2, 2.6);
  textures.floorRough.repeat.set(3.2, 2.6);
  textures.fabric.repeat.set(4, 4);
  textures.boucleNormal.repeat.set(5, 5);
  textures.leatherNormal.repeat.set(4, 4);
  textures.rugNormal.repeat.set(3, 2);

  /* ================================================================ */
  /*  materials                                                        */
  /* ================================================================ */

  const shadowFlags = new Map();
  const flag = (mat, cast = true, receive = true) => {
    shadowFlags.set(mat, { cast, receive });
    return mat;
  };

  const boucleMat = (color, map = textures.clothWeave) => {
    const properties = {
      color,
      map,
      roughness: 0.97,
      metalness: 0,
      normalMap: quality==='low'?null:textures.boucleNormal,
      normalScale: new THREE.Vector2(0.36, 0.36),
      bumpMap: quality==='high'?textures.fabric:null,
      bumpScale: 0.004,
    };
    return quality==='high'?new THREE.MeshPhysicalMaterial({...properties,sheen:.12,sheenRoughness:.95,sheenColor:new THREE.Color(0xFFEFD8)}):new THREE.MeshStandardMaterial(properties);
  };

  const leatherMat = (color, extra = {}) => {
    const properties = {
      color,
      map: finishes.leatherAge || null,
      roughness: quality==='low'?.69:1,
      roughnessMap: finishes.leatherFinish || null,
      metalness: 0,
      normalMap: quality==='low'?null:textures.leatherNormal,
      normalScale: new THREE.Vector2(0.27, 0.27),
      bumpMap: quality==='high'?finishes.leatherFinish:null,
      bumpScale:.001,
      ...extra,
    };
    return quality==='high'?new THREE.MeshPhysicalMaterial({...properties,clearcoat:.07,clearcoatRoughness:.72}):new THREE.MeshStandardMaterial(properties);
  };

  const sofaLinen = (color,vertexColors=true) => new THREE.MeshStandardMaterial({
    color, vertexColors, roughness:.92, metalness:0,
    map:textures.linenDiffuse, bumpMap:quality==='low'?null:textures.linenHeight,
    bumpScale:.00072,
  });

  const plaster = (map, roughness=.90) => new THREE.MeshStandardMaterial({
    map, roughness, bumpMap: quality==='low'?null:map, bumpScale:.00055,
  });
  const M = {
    /* architecture */
    wallA: plaster(textures.riceA),
    wallB: plaster(textures.riceB, .89),
    wallC: plaster(textures.riceC),
    wallD: plaster(textures.riceD),
    ceiling: flag(plaster(textures.ceilingPlaster,.93),false,true),
    floor: flag(
      new THREE.MeshStandardMaterial({
        map: textures.floor,
        bumpMap: textures.floorBump,
        bumpScale: quality==='high'?0.0008:0.0004,
        roughnessMap: textures.floorRough,
        roughness: 1.0,
        metalness: 0.03,
      }),
      false,
      true
    ),
    trim: new THREE.MeshStandardMaterial({ color: 0xbcb09d, roughness: 0.9 }),

    /* joinery */
    shelf: new THREE.MeshStandardMaterial({ map: textures.walnutShelf, roughness: finishes.woodFinish?1:.68, roughnessMap:finishes.woodFinish||null,bumpMap:quality==='high'?finishes.woodFinish:null,bumpScale:.0007,metalness:0 }),
    walnut: new THREE.MeshStandardMaterial({ map: textures.walnut, roughness: finishes.woodFinish?1:.64, roughnessMap:finishes.woodFinish||null,bumpMap:quality==='high'?finishes.woodFinish:null,bumpScale:.0007,metalness:0 }),
    // table top: its own map so the grain runs along the long edge
    walnutTop: new THREE.MeshStandardMaterial({ map: textures.walnutTop, roughness: finishes.woodFinish?1:.64,roughnessMap:finishes.woodFinish||null,bumpMap:quality==='high'?finishes.woodFinish:null,bumpScale:.0007,metalness:0 }),
    shelfInside: flag(
      new THREE.MeshStandardMaterial({
        color: 0x3A2A1E,
        roughness: 0.94,
      }),
      false,
      true
    ),
    // LED: no longer a bare emissive bar on the shelf lip. It is a dim,
    // recessed warm slit under the shelf, tone-mapped so it can never
    // outshine the reading table.
    ledStrip: flag(
      new THREE.MeshStandardMaterial({
        color: 0x2A2018,
        roughness: 0.85,
        emissive: 0x8A5A2E,
        emissiveIntensity: 0.34,
      }),
      false,
      false
    ),

    /* metals */
    brass: makeBrassMaterial(0x9c7e4c,quality,finishes),
    frameBrass: new THREE.MeshStandardMaterial({color:0x9c7e4c,metalness:.77,
      roughness:.45,map:finishes.brassPatina||null,envMapIntensity:.56}),
    brassDark: makeBrassMaterial(0x866946,quality,finishes,true),

    /* Main sofa gets its own materials. The window chair uses the original set. */
    sofaLinen: sofaLinen(0xb9ac98),
    linenWelting: sofaLinen(0x9f8d76,false),
    sofaHide: new THREE.MeshStandardMaterial({
      color:0x6b442b, map:finishes.leatherAge||null, roughness:.74, metalness:0,vertexColors:true,
      normalMap:quality==='low'?null:textures.leatherNormal,
      normalScale:new THREE.Vector2(.16,.16), bumpMap:finishes.leatherFinish||null,
      bumpScale:.00040,
    }),
    sofaClay: sofaLinen(0x7d4232),
    sofaSlate: sofaLinen(0x485460),
    sofaCoffee: sofaLinen(0x523b2e),
    sofaThrow: new THREE.MeshStandardMaterial({
      map:textures.sofaPlaid, roughness:.95, side:THREE.DoubleSide, vertexColors:true,
      bumpMap:quality==='low'?null:textures.linenHeight, bumpScale:.00095,
    }),
    sofaWelting: boucleMat(0x4e5e52),
    chairLinen: boucleMat(0x55736a),
    chairWelting: boucleMat(0x435b53),
    leatherWelting: leatherMat(0x573b2c,{roughness:.84}),
    leather: leatherMat(0x77503A,{vertexColors:true}),
    leatherDark: leatherMat(0x59402F),
    pillowBone: boucleMat(0xc9bfa9),
    pillowLeather: leatherMat(0x76513A),
    woolThrow: new THREE.MeshStandardMaterial({
      map: textures.plaid,
      color: 0xfff7ea,
      roughness: 0.96,
      bumpMap: textures.fabric,
      bumpScale: 0.013,
    }),

    /* rug */
    rug: flag(
      new THREE.MeshStandardMaterial({
        map: textures.rug,
        normalMap: textures.rugNormal,
        normalScale: new THREE.Vector2(0.55, 0.55),
        color: 0xC7BEB0,
        roughness: 0.99,
        metalness: 0,
      }),
      false,
      true
    ),
    rugFringe: flag(
      new THREE.MeshStandardMaterial({
        color: 0xC6B79F,
        roughness: 0.97,
        emissive: 0x6B5B46,
        emissiveIntensity: 0.22,
      }),
      false,
      true
    ),

    /* books: one atlas material family for the whole library.
       Three emissive strengths so neighbouring cases never read as one
       evenly glowing wall — the cases next to the floor lamp stay a touch
       more legible, the far corners sink back. */
    books: flag(
      new THREE.MeshStandardMaterial({
        map: atlas.texture,
        color: 0xC8BCAB,
        roughness: 0.72,
        metalness: 0.03,
        emissive: 0xFFFFFF,
        emissiveMap: atlas.texture,
        emissiveIntensity: 0.030,
      }),
      false,
      true
    ),
    booksWarm: flag(
      new THREE.MeshStandardMaterial({
        map: atlas.texture,
        color: 0xD4C8B6,
        roughness: 0.68,
        metalness: 0.03,
        emissive: 0xFFF3E2,
        emissiveMap: atlas.texture,
        emissiveIntensity: 0.035,
      }),
      false,
      true
    ),
    booksDim: flag(
      new THREE.MeshStandardMaterial({
        map: atlas.texture,
        color: 0xBBAF9E,
        roughness: 0.76,
        metalness: 0.03,
        emissive: 0xF2F4FF,
        emissiveMap: atlas.texture,
        emissiveIntensity: 0.020,
      }),
      false,
      true
    ),
    bookStack: flag(new THREE.MeshStandardMaterial({ color: 0x7C6A58, roughness: 0.86 }), false, true),
    bookStackAlt: flag(new THREE.MeshStandardMaterial({ color: 0x4E5A60, roughness: 0.86 }), false, true),
    paper: new THREE.MeshStandardMaterial({ color: 0xC9BDA6, roughness: 0.92 }),
    cutPaper: new THREE.MeshStandardMaterial({map:textures.cutPaper,roughness:.95}),
    printedCover: new THREE.MeshStandardMaterial({map:textures.printedCovers,roughness:.91}),

    /* window */
    glass: flag(
      new THREE.MeshStandardMaterial({
        color: 0xC9DDF0,
        transparent: true,
        opacity: 0.10,
        roughness: 0.06,
        metalness: 0.25,
      }),
      false,
      false
    ),
    sky: flag(new THREE.MeshBasicMaterial({ map: textures.sky, toneMapped: false, color: 0xEAF0FF }), false, false),
    curtain: new THREE.MeshStandardMaterial({
      color: 0xCDBFA7,
      map: textures.curtainWeave,
      roughness: 0.96,
      side: THREE.DoubleSide,
      vertexColors: true,
      bumpMap: textures.curtainWeave,
      bumpScale: 0.0014,
    }),

    /* fireplace */
    stone: new THREE.MeshStandardMaterial({ map: textures.stone, roughness: finishes.stoneFinish?1:.92,
      roughnessMap:finishes.stoneFinish||null,bumpMap:textures.stoneRelief,
      bumpScale:quality==='low'?.0018:.0034,vertexColors:true }),
    stoneDark: new THREE.MeshStandardMaterial({ color: 0x241F1B, roughness: 0.96 }),
    /* decor */
    matboard: new THREE.MeshStandardMaterial({color:0xc9bfa9,roughness:.93}),
    stoneware: new THREE.MeshStandardMaterial({color:0xbdb3a3,roughness:.70,
      bumpMap:textures.cupGlaze,bumpScale:.00028}),
    cupStoneware: new THREE.MeshStandardMaterial({map:textures.cupGlaze,roughness:.66,
      bumpMap:textures.cupGlaze,bumpScale:.00027}),
    bowlsLip: new THREE.MeshStandardMaterial({color:0x766f64,roughness:.69}),
    iron: new THREE.MeshStandardMaterial({color:0x302c27,roughness:.70,metalness:.68}),
    wicker: new THREE.MeshStandardMaterial({color:0x614832,roughness:.92}),
    wickerEdge: new THREE.MeshStandardMaterial({color:0x503929,roughness:.91}),
    driedLeaves: new THREE.MeshStandardMaterial({color:0x677362,roughness:.87}),

    ceramic: new THREE.MeshPhysicalMaterial({
      color: 0xE7DCCB,
      roughness: 0.26,
      metalness: 0,
      clearcoat: 0.6,
      clearcoatRoughness: 0.22,
    }),
    tea: new THREE.MeshStandardMaterial({
      color: 0x6B3A18,
      roughness: 0.22,
      metalness: 0,
      emissive: 0xFF8A3C,
      emissiveIntensity: 0.12,
    }),
    candle: new THREE.MeshStandardMaterial({ color: 0xDFD2B8, roughness: 0.66 }),
    wick: new THREE.MeshStandardMaterial({ color: 0x2A2118, roughness: 1 }),
    flameCore: flag(
      new THREE.MeshBasicMaterial({
        color: 0xFFC46B,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
      false,
      false
    ),
    black: new THREE.MeshStandardMaterial({ color: 0x15130F, roughness: 0.68 }),

    /* contact shadows: soft occlusion decals that sit a couple of mm above
       the floor / rug so heavy furniture never looks like it floats */
    contact: flag(
      new THREE.MeshBasicMaterial({
        map: textures.contact,
        transparent: true,
        opacity: 0.61,
        depthWrite: false,
        depthTest: true,
        toneMapped: true,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
      false,
      false
    ),
    contactSoft: flag(
      new THREE.MeshBasicMaterial({
        map: textures.contact,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
        depthTest: true,
        toneMapped: true,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
      false,
      false
    ),
    shadeWarm: flag(
      new THREE.MeshStandardMaterial({
        color: 0xF0D9AD,
        roughness: 0.9,
        side: THREE.DoubleSide,
        emissive: 0xFFB86B,
        emissiveIntensity: 0.24,
      }),
      false,
      false
    ),
    bulb: flag(new THREE.MeshBasicMaterial({ color:new THREE.Color(0xFFE0AB).multiplyScalar(1.38) }), false, false),
    plant: new THREE.MeshStandardMaterial({ color: 0x3F6A45, roughness: 0.85, side: THREE.DoubleSide }),
    plantDark: new THREE.MeshStandardMaterial({ color: 0x2F5237, roughness: 0.88, side: THREE.DoubleSide }),
    stem: new THREE.MeshStandardMaterial({ color: 0x4A6A3C, roughness: 0.9 }),
    pot: new THREE.MeshStandardMaterial({ color: 0x9B6A50, roughness: 0.88 }),
    potCream: new THREE.MeshStandardMaterial({ color: 0xD8C8AE, roughness: 0.86 }),
    soil: new THREE.MeshStandardMaterial({ color: 0x33261B, roughness: 1 }),
    scarf: new THREE.MeshStandardMaterial({
      color: 0x8E6A52,
      roughness: 0.93,
      side: THREE.DoubleSide,
      bumpMap: textures.fabric,
      bumpScale: 0.013,
    }),
    art: textures.art.map(
      (t) => new THREE.MeshStandardMaterial({ map: t, roughness: 0.86 })
    ),
    cover: new THREE.MeshStandardMaterial({ map: coverTexture, roughness: 0.82 }),
  };

  textures.paintings=Object.values(gallery);
  M.starryNight=new THREE.MeshStandardMaterial({map:gallery['starry-night'],roughness:.88,name:'Vincent van Gogh — The Starry Night'});
  M.waterLilies=new THREE.MeshStandardMaterial({map:gallery['water-lilies'],roughness:.9,name:'Claude Monet — Water Lilies'});
  for (const material of [M.books, M.booksWarm, M.booksDim]) prepareBookMaterial(material, atlas);
  // One small, original Canvas map for the desktop globe; low keeps a plain sphere.
  if (quality !== 'low') {
    textures.globe = TX.canvasTexture(256, 128, (ctx, w, h) => {
      ctx.fillStyle='#b5b099';ctx.fillRect(0,0,w,h);
      ctx.strokeStyle='rgba(68,73,57,.26)';ctx.lineWidth=.6;
      for(let x=0;x<w;x+=w/12){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}
      for(let y=h/6;y<h;y+=h/6){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
      // Hand-drawn continental silhouettes, rather than generic circles.
      ctx.fillStyle='#717b5c';ctx.strokeStyle='#657052';ctx.lineWidth=.6;
      const continents=[
        [[18,29],[27,20],[40,20],[44,27],[54,27],[60,36],[55,42],[46,45],[47,53],[54,58],[52,62],[43,56],[37,49],[29,47],[29,40],[21,36]],
        [[53,62],[64,65],[74,73],[73,83],[67,92],[64,105],[59,113],[56,98],[52,87],[49,77]],
        [[70,15],[82,12],[86,20],[80,29],[73,29]],
        [[115,29],[125,24],[138,26],[146,22],[159,22],[167,28],[184,28],[200,36],[210,43],[202,49],[190,49],[184,57],[173,52],[165,56],[162,67],[156,62],[150,50],[140,46],[132,49],[127,42],[117,41]],
        [[122,48],[138,48],[148,57],[146,68],[139,79],[132,87],[125,77],[122,65],[116,57]],
        [[180,82],[190,77],[204,80],[211,91],[204,98],[192,97],[184,92]],
        [[202,54],[207,49],[209,54],[205,60]],[[151,79],[154,86],[151,94],[148,89]],
      ];
      for(const points of continents){ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fill();ctx.stroke();}
    }, {clamp:true});
  }
  M.globe = new THREE.MeshStandardMaterial({map:textures.globe || null,color:quality==='low'?0x8a8b6d:0xffffff,roughness:.84});

  /* ================================================================ */
  /*  merge scopes: every object keeps a Group, its parts get merged    */
  /* ================================================================ */

  function mkScope(name, o = {}) {
    const group = new THREE.Group();
    group.name = name;
    group.position.set(o.x || 0, o.y || 0, o.z || 0);
    if (o.rx) group.rotation.x = o.rx;
    if (o.ry) group.rotation.y = o.ry;
    if (o.rz) group.rotation.z = o.rz;
    root.add(group);

    const buckets = new Map();

    const put = (mat, geo, opts = {}) => {
      let b = buckets.get(mat);
      if (!b) b = { mat, geos: [] }, buckets.set(mat, b);
      const g = geo.index ? geo.toNonIndexed() : geo;
      if (opts.p || opts.r || opts.s) {
        const p = opts.p || [0, 0, 0];
        const r = opts.r || [0, 0, 0];
        const s = opts.s || [1, 1, 1];
        _e.set(r[0], r[1], r[2]);
        _q.setFromEuler(_e);
        _m4.compose(_v.set(p[0], p[1], p[2]), _q, _sv.set(s[0], s[1], s[2]));
        g.applyMatrix4(_m4);
      }
      b.geos.push(g);
      return g;
    };

    const flush = () => {
      for (const [mat, b] of buckets) {
        if (!b.geos.length) continue;
        const merged = mergeGeometries(b.geos, false);
        if (!merged) {
          console.warn('[room] merge failed for', name, mat.name || '(material)');
          continue;
        }
        const f = shadowFlags.get(mat) || { cast: true, receive: true };
        const mesh = new THREE.Mesh(merged, mat);
        mesh.name = `${name}:${b.geos.length}parts`;
        mesh.castShadow = f.cast;
        mesh.receiveShadow = f.receive;
        group.add(mesh);
        for (const g of b.geos) g.dispose();
      }
      buckets.clear();
    };

    return { name, group, put, flush };
  }

  const scopes = [];
  const scope = (name, o) => {
    const s = mkScope(name, o);
    scopes.push(s);
    return s;
  };

  /* ================================================================ */
  /*  shell: floor, ceiling, walls, beams, skirting, door              */
  /* ================================================================ */

  const floor = createPlankFloor(ROOM.w,ROOM.d);
  root.add(floor);

  const ceiling = new THREE.Mesh(boxGeo(ROOM.w, 0.14, ROOM.d), M.ceiling);
  ceiling.name = 'ceiling';
  ceiling.position.y = ROOM.h + 0.07;
  ceiling.castShadow = false; // was casting a hard 8 m shadow into the room
  ceiling.receiveShadow = true;
  root.add(ceiling);

  const shell = scope('shell');

  // beams (shortened so they never poke through the side bookcases)
  for (const z of [-2.55, 0, 2.55]) {
    shell.put(M.shelf, boxGeo(7.44, 0.17, 0.22), { p: [0, ROOM.h - 0.11, z] });
  }

  // four walls, one rice-paper family (+-3% value between them)
  shell.put(M.wallA, boxGeo(ROOM.w, ROOM.h, 0.16), { p: [0, ROOM.h / 2, -ROOM.hz - 0.08] });
  shell.put(M.wallC, boxGeo(ROOM.w, ROOM.h, 0.16), { p: [0, ROOM.h / 2, ROOM.hz + 0.08] });
  shell.put(M.wallB, boxGeo(0.16, ROOM.h, ROOM.d), { p: [ROOM.hx + 0.08, ROOM.h / 2, 0] });
  // left wall: four pieces around the full-height window opening
  shell.put(M.wallD, boxGeo(0.16, WIN.y0, ROOM.d), { p: [WALL_X, WIN.y0 / 2, 0] });
  shell.put(M.wallD, boxGeo(0.16, ROOM.h - WIN.y1, ROOM.d), { p: [WALL_X, (ROOM.h + WIN.y1) / 2, 0] });
  shell.put(M.wallD, boxGeo(0.16, ROOM.h, WIN.z0 + ROOM.hz), {
    p: [WALL_X, ROOM.h / 2, (WIN.z0 - ROOM.hz) / 2],
  });
  shell.put(M.wallD, boxGeo(0.16, ROOM.h, ROOM.hz - WIN.z1), {
    p: [WALL_X, ROOM.h / 2, (WIN.z1 + ROOM.hz) / 2],
  });

  // skirting + cornice (split around the window on the left wall)
  const skirt = (w, d, x, z) => {
    const entrySide=z > ROOM.hz - .06;
    shell.put(entrySide ? M.walnut : M.trim, boxGeo(w,entrySide?.17:.14,d),
      {p:[x,entrySide?.085:.07,z]});
    shell.put(M.trim, boxGeo(w, 0.09, d), { p: [x, ROOM.h - 0.045, z] });
    if(quality!=='low'){
      shell.put(entrySide?M.walnut:M.trim,boxGeo(w,.018,d+.012),{p:[x,entrySide?.179:.149,z]});
      shell.put(M.walnut,boxGeo(w,.012,d+.005),{p:[x,.018,z]});
    }
  };
  skirt(ROOM.w - 0.1, 0.05, 0, -ROOM.hz + 0.025);
  skirt(ROOM.w - 0.1, 0.05, 0, ROOM.hz - 0.025);
  skirt(0.05, ROOM.d - 0.1, ROOM.hx - 0.025, 0);
  skirt(0.05, 2.975, -ROOM.hx + 0.025, -2.0875);
  skirt(0.05, 1.675, -ROOM.hx + 0.025, 2.7375);
  if(quality!=='low')for(const z of [-2.55,0,2.55])for(const sign of [-1,1]){
    shell.put(M.shelf,boxGeo(.16,.06,.25),{p:[sign*3.62,3.25,z]});
    shell.put(M.shelf,boxGeo(.10,.065,.22),{p:[sign*3.65,3.19,z]});
  }

  /* ================================================================ */
  /*  window: full-height opening onto a cold winter night                */
  /* ================================================================ */

  const winScope = scope('window');

  // reveal lining, same rice-paper family as the wall (no material mismatch)
  winScope.put(M.wallD, boxGeo(0.20, WIN_H + 0.06, 0.03), { p: [WALL_X, (WIN.y0 + WIN.y1) / 2, WIN.z0 - 0.015] });
  winScope.put(M.wallD, boxGeo(0.20, WIN_H + 0.06, 0.03), { p: [WALL_X, (WIN.y0 + WIN.y1) / 2, WIN.z1 + 0.015] });
  winScope.put(M.wallD, boxGeo(0.20, 0.03, WIN_W + 0.06), { p: [WALL_X, WIN.y1 + 0.015, WIN_CZ] });
  // window board (sits slightly above the glass line, embedded in the wall stub)
  winScope.put(M.walnut, boxGeo(0.36, 0.05, WIN_W + 0.12), { p: [-4.09, 0.04, WIN_CZ] });

  // walnut casing
  winScope.put(M.shelf, boxGeo(0.10, 0.09, WIN_W + 0.20), { p: [-4.15, WIN.y1 + 0.045, WIN_CZ] });
  winScope.put(M.shelf, boxGeo(0.10, 0.07, WIN_W + 0.20), { p: [-4.15, 0.045, WIN_CZ] });
  winScope.put(M.shelf, boxGeo(0.10, WIN_H + 0.16, 0.08), { p: [-4.15, (WIN.y0 + WIN.y1) / 2, WIN.z0 - 0.04] });
  winScope.put(M.shelf, boxGeo(0.10, WIN_H + 0.16, 0.08), { p: [-4.15, (WIN.y0 + WIN.y1) / 2, WIN.z1 + 0.04] });

  // glass + re-gridded mullions (2 vertical, 3 horizontal)
  const glassX = -4.28;
  const windowPane = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: {
      night: { value: 0 },
      rain: { value: 0 },
      rainTime: { value: 0 },
      hearthGlow: { value: 1 },
      floorLamp: { value: V3(2 * glassX - LAMP.x, 1.74, LAMP.z) },
      pendant: { value: V3(2 * glassX, 2.96, -.02) },
      hearth: { value: V3(2 * glassX - 3.56, .61, -.95) },
    },
    vertexShader: `
      varying vec3 panePosition;
      varying vec2 paneUv;
      void main() {
        paneUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.);
        panePosition = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `
      varying vec3 panePosition;
      varying vec2 paneUv;
      uniform vec3 floorLamp, pendant, hearth;
      uniform float night, rain, rainTime, hearthGlow;
      float reflectedShade(vec3 virtualCenter, vec2 size) {
        vec3 ray = panePosition - cameraPosition;
        float t = (virtualCenter.x - cameraPosition.x) / min(-.001, ray.x);
        vec2 delta = (cameraPosition + t * ray - virtualCenter).zy / size;
        float radius = mix(1., .38, clamp(delta.y + .5, 0., 1.));
        float shade = (1. - smoothstep(radius - .16, radius + .14, abs(delta.x)))
                    * (1. - smoothstep(.39, .58, abs(delta.y)));
        return .065 * shade + .022 * exp(-dot(delta, delta) * 1.4);
      }
      void main() {
        vec3 ray = panePosition - cameraPosition;
        float t = (hearth.x - cameraPosition.x) / min(-.001, ray.x);
        vec2 fire = (cameraPosition + t * ray - hearth).zy / vec2(.36, .28);
        float fireReflection = .044 * hearthGlow * exp(-dot(fire,fire));
        float glow = night * (reflectedShade(floorLamp, vec2(.30, .30))
                            + reflectedShade(pendant, vec2(.28, .25)) + fireReflection);
        vec2 edge = min(paneUv, 1. - paneUv);
        float ripple = .62 + .19 * sin(paneUv.x * 87. + paneUv.y * 13.)
                            + .13 * sin(paneUv.x * 221. + paneUv.y * 27.);
        float frost = (exp(-edge.x * 34.) * .073 + exp(-paneUv.y * 15.) * .105) * ripple;
        float mist = (.27 + .73 * night) * frost;
        float base = .042 + mist;
        float droplets = 0.;
        if (rain > 0.) {
          float column = floor(paneUv.x * 65.);
          float seed = fract(sin(column * 12.9898 + 37.1) * 43758.5453);
          float streak = 1. - smoothstep(.055, .14, abs(fract(paneUv.x * 65.) - .51));
          float fall = fract(paneUv.y * (2. + seed) + rainTime * (.23 + seed * .15) + seed * 8.);
          droplets = rain * streak * smoothstep(.61, .97, fall) * (.035 + seed * .15);
        }
        float opacity = base + glow + droplets;
        vec3 color = (vec3(.25,.37,.53) * base + vec3(1.10,.69,.32) * glow
                     + vec3(.52,.64,.79) * droplets) / opacity;
        gl_FragColor = vec4(color, opacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  winScope.put(flag(windowPane, false, false), planeGeo(WIN_W, WIN_H), { p: [glassX, (WIN.y0 + WIN.y1) / 2, WIN_CZ], r: [0, Math.PI / 2, 0] });
  for (const fz of [1 / 3, 2 / 3]) {
    winScope.put(M.shelf, boxGeo(0.05, WIN_H, 0.05), { p: [-4.27, (WIN.y0 + WIN.y1) / 2, WIN.z0 + WIN_W * fz] });
  }
  for (const fy of [0.25, 0.5, 0.75]) {
    winScope.put(M.shelf, boxGeo(0.05, 0.05, WIN_W), { p: [-4.27, WIN.y0 + WIN_H * fy, WIN_CZ] });
  }

  // the night itself
  const sky = new THREE.Mesh(new THREE.SphereGeometry(45,128,64), M.sky);
  M.sky.side=THREE.BackSide;M.sky.color.set(0xffffff);M.sky.fog=false;
  sky.name = 'window:sky';
  sky.rotation.y = 2.5;
  sky.position.set(0,1.55,0);
  winScope.group.add(sky);

  // cold distant city glow (replaces the warm sun sprite)
  const cityGlow = glowSprite(textures.glowCool, 0xBFD4FF, 2.0, 0);
  cityGlow.position.set(-5.05, 0.95, WIN_CZ - 0.35);
  winScope.group.add(cityGlow);

  // curtain rod (only as long as the opening allows)
  const rodY = 3.42;
  const rodLen = 2.74;
  winScope.put(M.brass, cylGeo(0.018, 0.018, rodLen, 12), { p: [-4.02, rodY, WIN_CZ], r: [Math.PI / 2, 0, 0] });
  winScope.put(M.brass, sphGeo(0.035, 12), { p: [-4.02, rodY, WIN_CZ - rodLen / 2 - 0.02] });
  winScope.put(M.brass, sphGeo(0.035, 12), { p: [-4.02, rodY, WIN_CZ + rodLen / 2 + 0.02] });

  // Top is pinched into the rings, while wider folds pool slightly at the hem.
  const curtainHeight = rodY - .021;
  const curtain = (zCenter, width, flip) => {
    const g = planeGeo(width, curtainHeight, 56, 54);
    const pos = g.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      const u = x / width + .5, v = y / curtainHeight + .5;
      const phase = u * 6.8 * Math.PI + (flip ? 1.2 : 0)
        + .65*Math.sin(u*6.2+.4) + .39*Math.sin(v*3.8+u*5.1);
      const hem = (1-v) ** 22;
      const fold = (.058+.024*Math.sin(u*5.4+v*2.8)) * Math.sin(phase)
        + .021*Math.sin(phase*1.72+.6) + .026*Math.sin(v*Math.PI);
      pos.setXYZ(i, x * (1+.16*(1-v)+.052*hem) + Math.sin(v*5+u)*.022,
        y + hem*(.007+.024*Math.sin(phase)**2),
        fold + hem*(.049+.024*Math.cos(phase)));
      const edge = Math.exp(-(flip ? 1-u : u)*17);
      const shade = .92 + .08*Math.sin(phase);
      colors.set([shade-.085*edge,shade-.031*edge,shade+.11*edge],i*3);
    }
    g.setAttribute('color',new THREE.BufferAttribute(colors,3));
    g.computeVertexNormals();
    winScope.put(M.curtain, g, { p: [-4.02, curtainHeight / 2, zCenter], r: [0, Math.PI / 2, 0] });
  };
  curtain(WIN_CZ - 1.06, 0.62, false);
  curtain(WIN_CZ + 1.04, 0.66, true);

  /* ================================================================ */
  /*  bookcases: back wall + both side walls, floor to ceiling          */
  /* ================================================================ */

  const bookcases = [];
  let bookTotal = 0;

  /* ------------------------------------------------------------------ */
  /*  a pile of horizontally stacked books, page edges visible           */
  /* ------------------------------------------------------------------ */

  function bookPile(put, { x, y, z, r2, count = 3, w = .26, d = .34, coverA, coverB, topYaw, coverPlate }) {
    const A = coverA || M.bookStack;
    const B = coverB || M.bookStackAlt;
    let top = y;
    for (let i = 0; i < count; i++) {
      const h = (0.030 + r2() * 0.013) * (coverPlate===undefined?1:[1.13,.77,1.04,1.06][i%4]);
      const ww = w * (0.90 + r2() * 0.14) * (coverPlate===undefined?1:1-.028*i);
      const dd = d * (0.90 + r2() * 0.14) * (coverPlate===undefined?1:1-.021*i);
      const jitter = (r2() - .5) * .20;
      const yaw = i === count-1 && topYaw !== undefined ? topYaw : jitter;
      const px = x + (r2() - 0.5) * 0.02;
      const pz = z + (r2() - 0.5) * 0.02;
      const mat = i % 2 ? B : A;
      const r = [0, yaw, 0];
      const board=.0038+(i%3)*.00065;
      put(mat, boxGeo(ww,board,dd), { p: [px,top+board/2,pz],r });
      const paper=coverPlate!==undefined
        ? roundedGeo(ww-.012,h-2*board,dd-.013,.0008,1)
        : boxGeo(ww-.012,h-2*board,dd-.013);
      put(M.cutPaper,paper,{p:[px,top+h/2,pz],r});
      put(mat, boxGeo(ww,board,dd), { p: [px,top+h-board/2,pz],r });
      const spineDir=i%3===1?1:-1;
      put(mat,roundedGeo(ww-.003,h-.001,.013,.0037,1),{
        p:[px+Math.sin(yaw)*spineDir*(dd/2-.006),top+h/2,pz+Math.cos(yaw)*spineDir*(dd/2-.006)],r,
      });
      if(i===count-1 && coverPlate!==undefined){
        const cloth=planeGeo(ww-.0035,dd-.0035);
        const uv=cloth.attributes.uv;
        for(let j=0;j<uv.count;j++)uv.setXY(j,(coverPlate+.009+uv.getX(j)*.982)/4,.006+uv.getY(j)*.988);
        cloth.rotateX(-Math.PI/2);
        put(M.printedCover,cloth,{p:[px,top+h+.00045,pz],r});
      }
      top += h + .00022;
    }
    return top;
  }

  function buildBookcase(name, { x, z, ry, width, seed, enrich, bookMat, rhythm, led }) {
    const S = scope(name, { x, z, ry });
    const r2 = TX.mulberry32(seed);
    const halfW = width / 2;
    const backZ = -CASE_D / 2;
    const frontZ = CASE_D / 2;
    const BM = bookMat || M.books;
    const RHY = rhythm || [0.5, 0.34, 0.16];
    const caseIndex = Number(name.split('-').at(-1));
    const volumes = [];
    const tintRandom = TX.mulberry32(seed + 8000);
    const SW = M.shelf.clone();
    SW.name=`${name}:seasoned-walnut`;
    SW.color.setScalar([.98,1.035,.95,1.01,.965,.94,1.025][caseIndex]);
    SW.roughness=finishes.woodFinish?.94+(caseIndex%3)*.025:.68+(caseIndex%3)*.025;
    const rawPut=S.put;
    S.put=(mat,geo,opts={})=>{
      if(mat===M.shelf){
        geo.computeBoundingBox();
        const {min,max}=geo.boundingBox;
        const vertical=opts.vertical??(max.y-min.y>max.x-min.x);
        woodGrain(geo,vertical,1.94,.72,caseIndex*.17+(opts.p?.[1]||0)*.18);
        mat=SW;
      }
      return rawPut(mat,geo,opts);
    };
    // Two tall display bays, with their original collision envelope unchanged.
    const displayLevel=caseIndex===1?3:caseIndex===6?4:-1;

    // carcass
    S.put(M.shelf, boxGeo(width - 0.06, CASE_H - 0.06, 0.04), { p: [0, CASE_H / 2, backZ + 0.02] });
    S.put(M.shelfInside, boxGeo(width - 0.12, CASE_H - 0.12, 0.012), { p: [0, CASE_H / 2, backZ + 0.05] });
    S.put(M.shelf, boxGeo(0.05, CASE_H, CASE_D), { p: [-halfW + 0.025, CASE_H / 2, 0] });
    S.put(M.shelf, boxGeo(0.05, CASE_H, CASE_D), { p: [halfW - 0.025, CASE_H / 2, 0] });
    S.put(M.shelf, boxGeo(width, 0.05, CASE_D + 0.02), { p: [0, CASE_H - 0.025, 0.005] });
    S.put(M.shelf, boxGeo(width, 0.09, CASE_D + 0.02), { p: [0, 0.045, 0.005] });
    S.put(M.shelf, boxGeo(width + 0.06, 0.055, CASE_D + 0.08), { p: [0, CASE_H + 0.028, 0.02] });
    // Fine joinery: recessed face stiles, a stepped cornice and discreet brass details.
    for (const sign of [-1, 1]) {
      S.put(M.shelf, roundedGeo(0.022, CASE_H - 0.14, 0.025, 0.004), {
        p: [sign * (halfW - 0.055), CASE_H / 2, frontZ + 0.009] });
    }
    S.put(M.shelf, roundedGeo(width + 0.028,.023, CASE_D + 0.051,.004,1), {p:[0,CASE_H-.026,.015]});
    S.put(M.shelf, roundedGeo(width + .037,.027,.031,.004,1), {p:[0,.051,frontZ+.018]});
    S.put(M.brassDark, boxGeo(width - 0.10, 0.004, 0.006), { p: [0, CASE_H - 0.06, frontZ + 0.018] });
    const hasCabinet = enrich && width > 1.8;
    if (hasCabinet) {
      for (const sign of [-1, 1]) {
        const doorW = (width - 0.14) / 2 - 0.009;
        const doorX = sign * (width - 0.14) / 4;
        const frame=.035,doorH=.398;
        S.put(M.shelf,roundedGeo(doorW,doorH,.020,.004,1),{p:[doorX,.307,frontZ+.006],vertical:true});
        S.put(M.shelf,roundedGeo(doorW-2*frame-.007,doorH-2*frame-.007,.007,.002,1),
          {p:[doorX,.307,frontZ+.018],vertical:true});
        for(const side of [-1,1]){
          S.put(M.shelf,roundedGeo(frame,doorH,.013,.002,1),
            {p:[doorX+side*(doorW-frame)/2,.307,frontZ+.023],vertical:true});
          S.put(M.shelf,roundedGeo(doorW-2*frame,frame,.013,.002,1),
            {p:[doorX,.307+side*(doorH-frame)/2,frontZ+.023]});
        }
        for(const dy of [-.023,.023])S.put(M.brassDark,cylGeo(.0062,.0062,.011,12),
          {p:[sign*.044,.303+dy,frontZ+.033],r:[Math.PI/2,0,0]});
        S.put(M.brassDark,roundedGeo(.009,.068,.010,.0035,2),{p:[sign*.044,.303,frontZ+.043]});
      }
    }

    for (let li=0;li<LEVELS.length;li++) {
      if(li===displayLevel+1 && displayLevel>=0) continue;
      const board=quality==='high'?roundedGeo(width-.09,.035,CASE_D-.02,.0025,1):boxGeo(width-.09,.035,CASE_D-.02);
      S.put(M.shelf, board, { p: [0, LEVELS[li], 0.006] });
      S.put(M.shelf,roundedGeo(width-.101,.025,.028,.0035,1),
        {p:[0,LEVELS[li]-.001,frontZ+.001]});
      if(li>0 && li<LEVELS.length-1){
        for(const side of [-1,1]){
          const x=side*(halfW-.064);
          S.put(M.shelf,roundedGeo(.029,.014,.232,.0028,1),
            {p:[x,LEVELS[li]-.023,-.024]});
          if(quality!=='low')S.put(M.brassDark,cylGeo(.0042,.0042,.006,9),
            {p:[side*(halfW-.081),LEVELS[li]-.032,.060],r:[0,0,Math.PI/2]});
        }
      }
    }

    if (caseIndex === 1) {
      const y = LEVELS[displayLevel] + .61, z = backZ + .072;
      // The walnut frame, warm mat and print share the back wall of the niche.
      S.put(M.walnut, boxGeo(1.30, .48, .024), { p: [0, y, z] });
      S.put(M.paper, planeGeo(1.268, .448), { p: [0, y, z + .013] });
      const paper = new THREE.MeshStandardMaterial({ map: textures.mountainPrint, roughness: 1 });
      S.put(paper, planeGeo(1.16, .406), { p: [0, y, z + .014] });
    }

    // LED: a recessed warm slit under every other shelf, 6 cm behind the
    // front lip, completely inside the shelf's own shadow. No visible bar.
    if (led) {
      for (let i = 1; i < LEVELS.length; i += 2) {
        if(i===displayLevel+1 && displayLevel>=0)continue;
        S.put(M.ledStrip, boxGeo(width - 0.22, 0.008, 0.010), {
          p: [0, LEVELS[i] - 0.0215, frontZ - 0.062],
        });
      }
    }

    /* ---------------------------------------------------------------- */
    /*  three filling rhythms, mixed per level                           */
    /* ---------------------------------------------------------------- */

    const PLANS = {
      // dense rows, almost no seams: the "wall of books" shelf
      full: { stack: 0.0, blank: 0.015, packMin: 5, packMax: 9, gap: [0.0014, 0.0038], blankW: [0.03, 0.06], lean: 0.18, stop: 0 },
      // 30 % flat piles, real gaps, mixed run lengths
      mixed: { stack: 0.3, blank: 0.1, packMin: 2, packMax: 6, gap: [0.003, 0.012], blankW: [0.05, 0.13], lean: 0.26, stop: 0 },
      // half a shelf: a couple of piles, one object, the rest breathes
      sparse: { stack: 0.42, blank: 0.24, packMin: 2, packMax: 4, gap: [0.006, 0.022], blankW: [0.10, 0.2], lean: 0.2, stop: 0.42 },
    };

    const planSeq = [];
    {
      let prev = '';
      let run = 0;
      for (let li = 0; li < LEVELS.length - 1; li++) {
        const roll = r2();
        let plan = roll < RHY[0] ? 'full' : roll < RHY[0] + RHY[1] ? 'mixed' : 'sparse';
        if (caseIndex >= 5 && plan === 'sparse' && li > 2) plan = 'mixed';
        if (plan === prev && run >= 2) plan = plan === 'full' ? 'mixed' : 'full';
        run = plan === prev ? run + 1 : 1;
        prev = plan;
        planSeq.push(plan);
      }
    }

    /* 2–4 small objects per case (never one per shelf), each with its own
       reserved pocket so nothing is ever punched through a row of books */
    const decorPlan = [];
    {
      const n = width>1.8?2:1;
      const pool = [1, 2, 3, 4, 5, 6].filter(li=>li!==displayLevel && li!==displayLevel+1);
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(r2() * (i + 1));
        const tmp = pool[i];
        pool[i] = pool[j];
        pool[j] = tmp;
      }
      const kinds = ['camera', 'plant', 'compass', 'print', 'bowl', 'plant', 'print'];
      for (let i = 0; i < n; i++) {
        const kind=kinds[(caseIndex+i*3)%kinds.length];
        const w = kind==='camera'?.25:kind==='print'?.23:.22;
        const frac = n === 1 ? 0.5 : i / (n - 1);
        const xc = -halfW * 0.62 + frac * halfW * 1.24 + (r2() - 0.5) * 0.1;
        decorPlan.push({
          level: pool[i % pool.length],
          x: Math.max(-halfW + 0.15 + w / 2, Math.min(halfW - 0.15 - w / 2, xc)),
          w,
          kind,
        });
      }
      decorPlan.sort((a, b) => a.level - b.level || a.x - b.x);
      if(displayLevel>=0)decorPlan.push({level:displayLevel,x:0,w:.56,kind:'globe'});
    }

    for (let li = 0; li < LEVELS.length - 1; li++) {
      if (li === 0 && hasCabinet) continue;
      if(displayLevel>=0 && li===displayLevel+1)continue;
      const yBase = LEVELS[li] + 0.0175;
      const clear = LEVELS[li + 1] - 0.0175 - yBase;
      const maxH = Math.min(0.305, clear - 0.045);
      const P = PLANS[planSeq[li]];

      // a sparse level stops early: the rest of the board is left empty
      let xEnd = halfW - 0.075;
      if (P.stop) xEnd = halfW - 0.075 - width * P.stop * (0.5 + r2() * 0.85);

      // free spans on this board, split by the reserved decor pockets
      const spans = [];
      {
        let cx = -halfW + 0.075;
        const rs = decorPlan.filter((d) => d.level === li).sort((a, b) => a.x - b.x);
        for (const d of rs) {
          const x0 = d.x - d.w / 2 - 0.014;
          if (x0 > cx + 0.05) spans.push([cx, Math.min(x0, xEnd)]);
          cx = Math.max(cx, d.x + d.w / 2 + 0.014);
        }
        if (xEnd > cx + 0.05) spans.push([cx, xEnd]);
      }

      for (const span of spans) {
        const sBegin = span[0];
        const sEnd = span[1];
        let x = sBegin;
        while (x < sEnd - 0.035) {
          const roll = r2();

          /* --- a pile of flat books --- */
          if (roll < P.stack && x < sEnd - 0.38) {
            const pw = 0.19 + r2() * 0.07;
            const pd = 0.25 + r2() * 0.08;
            bookPile(S.put, {
              x: x + pw / 2,
              y: yBase,
              z: frontZ - 0.024 - pd / 2,
              r2,
              count: 2 + Math.floor(r2() * 3),
              w: pw,
              d: pd,
              coverPlate: caseIndex<3 && li===2 ? (caseIndex+2)%4 : undefined,
            });
            x += pw + 0.032 + r2() * 0.05;
            continue;
          }

          /* --- breathing room --- */
          if (roll < P.stack + P.blank) {
            x += P.blankW[0] + r2() * (P.blankW[1] - P.blankW[0]);
            continue;
          }

          /* --- one run: same hue family, same height band, tight packing --- */
                const runH = Math.max(0.155, Math.min(maxH, 0.165 + r2() * 0.11));
          const pack = P.packMin + Math.floor(r2() * (P.packMax - P.packMin + 1));
          const leanLast = r2() < P.lean;

          for (let k = 0; k < pack; k++) {
            if (x >= sEnd - 0.03) break;
            let bt = 0.021 + r2() * 0.030;
            if (x + bt > sEnd - 0.022) bt = Math.max(0.018, sEnd - 0.022 - x);
            const bh = Math.min(maxH, runH * (0.87 + r2() * 0.26));
            const bd = 0.117 + r2() * 0.083;
            const band=bookTotal * 7 % 20;
            const cells=atlas.toneGroups[band<13?0:band<17?1:band<19?2:3];
            const cell=cells[Math.floor(r2()*cells.length)];
            const volume={cell,w:bt,h:bh,d:bd,hue:(tintRandom()-.5)*12,value:.84+tintRandom()*.27};

            const last = k === pack - 1 || x + bt >= sEnd - 0.034;
            if (last && leanLast && x+bt+bh*.16+.05<sEnd) {
              // A leaning book is only allowed when it lands on a bookend:
              // the block is placed exactly where the tilted top edge ends, so
              // the book is supported and never floats or pierces its neighbour.
              const a = 0.085 + r2() * 0.07; // 4.9–8.9 deg
              const ca = Math.cos(a);
              const sa = Math.sin(a);
              const cx = x + (bt / 2) * ca + (bh / 2) * sa;
              const cy = yBase + (bh / 2) * ca + (bt / 2) * sa;
              volume.p=[cx, cy, frontZ - 0.012 - bd / 2];volume.r=[0,0,-a];
              const topX = x + bt * ca + bh * sa;
              S.put(M.brassDark, boxGeo(0.008, bh * 0.80, 0.105), {p:[topX+.005,yBase+bh*.4,frontZ-.072]});
              S.put(M.brassDark, boxGeo(.047,.005,.105), {p:[topX-.015,yBase+.0025,frontZ-.072]});
              x = topX + 0.022;
            } else {
              volume.p=[x+bt/2,yBase+bh/2,frontZ-.013-bd/2-tintRandom()*.024];
              volume.r=[0,(r2()-.5)*.018,0];
              // A couple of linen markers only at high quality, merged with stack covers.
              if(quality==='high' && volumes.length%131===17){
                S.put(M.bookStackAlt,boxGeo(.0035,.045,.0008),{p:[x+bt*.65,yBase+bh-.018,frontZ-.011],r:[0,0,-.08]});
              }
              x += bt + P.gap[0] + r2() * (P.gap[1] - P.gap[0]);
            }
            volumes.push(volume);
            bookTotal++;
          }

          // 3–20 mm seam between two groups
          x += 0.004 + r2() * 0.014;
        }
      }
    }

    /* ---------------------------------------------------------------- */
    /*  small objects, spread over different shelves                     */
    /* ---------------------------------------------------------------- */

    for (const d of decorPlan) {
      const yb = LEVELS[d.level] + 0.0175;
      const zc = frontZ - 0.135;
      // Baked contact shadows remain available without additional shadow lights.
      S.put(M.contactSoft,planeGeo(d.w*.95,.17),{p:[d.x,yb+.0008,zc],r:[-Math.PI/2,0,0]});
      switch (d.kind) {
        case 'camera': {
          S.put(M.wick,quality==='high'?roundedGeo(.145,.088,.057,.008,1):boxGeo(.145,.088,.057),{p:[d.x,yb+.051,zc]});
          S.put(M.brassDark,boxGeo(.148,.012,.059),{p:[d.x,yb+.09,zc]});
          S.put(M.brassDark,cylGeo(.026,.028,.024,16),{p:[d.x+.012,yb+.054,zc+.038],r:[Math.PI/2,0,0]});
          S.put(M.wick,cylGeo(.021,.021,.026,16),{p:[d.x+.012,yb+.054,zc+.042],r:[Math.PI/2,0,0]});
          S.put(M.glass,cylGeo(.014,.014,.001,12),{p:[d.x+.012,yb+.054,zc+.056],r:[Math.PI/2,0,0]});
          S.put(M.brassDark,cylGeo(.011,.011,.008,10),{p:[d.x-.052,yb+.101,zc]});
          if(quality==='high')S.put(M.scarf,torusGeo(.039,.003,4,16,Math.PI),{p:[d.x-.075,yb+.045,zc],r:[0,Math.PI/2,0]});
          break;
        }
        case 'compass': {
          S.put(M.brassDark,cylGeo(.047,.05,.017,20),{p:[d.x,yb+.0085,zc]});
          S.put(M.paper,cylGeo(.040,.040,.002,20),{p:[d.x,yb+.018,zc]});
          S.put(M.brass,torusGeo(.043,.003,5,20),{p:[d.x,yb+.020,zc],r:[Math.PI/2,0,0]});
          S.put(M.wick,boxGeo(.004,.001,.058),{p:[d.x,yb+.020,zc],r:[0,.38,0]});
          S.put(M.brass,boxGeo(.003,.001,.025),{p:[d.x-.004,yb+.021,zc+.01],r:[0,.38,0]});
          break;
        }
        case 'globe': {
          S.put(M.walnut,cylGeo(.065,.079,.025,20),{p:[d.x,yb+.0125,zc]});
          S.put(M.brassDark,cylGeo(.007,.009,.058,10),{p:[d.x,yb+.051,zc]});
          S.put(M.globe,sphGeo(.112,quality==='low'?12:24),{p:[d.x,yb+.19,zc],r:[0,.6,.25]});
          S.put(M.brassDark,torusGeo(.122,.0035,5,32),{p:[d.x,yb+.19,zc],r:[0,.1,-.25]});
          break;
        }
        case 'brassSphere':
          S.put(M.brass, sphGeo(0.057, 16), { p: [d.x, yb + 0.088, zc] });
          S.put(M.brassDark, cylGeo(0.019, 0.047, 0.03, 12), { p: [d.x, yb + 0.015, zc] });
          break;
        case 'plant': {
          const plant=createBotanicalPlant({materials:botanicalMaterials,small:true,seed:seed+Math.round(d.x*100),variant:caseIndex});
          plant.position.set(d.x,yb,zc);S.group.add(plant);break;
        }
        case 'candle':
          S.put(M.candle, cylGeo(0.031, 0.033, 0.145, 16), { p: [d.x, yb + 0.0725, zc] });
          S.put(M.wick, cylGeo(0.002, 0.002, 0.018, 4), { p: [d.x, yb + 0.154, zc] });
          break;
        case 'print':
          S.put(M.shelf, boxGeo(0.15, 0.2, 0.014), { p: [d.x, yb + 0.101, frontZ - 0.1], r: [-0.07, 0.1, 0] });
          S.put(M.art[caseIndex%3], planeGeo(0.124, 0.168), { p: [d.x, yb + 0.101, frontZ - 0.091], r: [-0.07, 0.1, 0] });
          break;
        case 'bowl':
        default:
          S.put(M.ceramic, sphGeo(0.054, 18), { p: [d.x, yb + 0.026, zc], s: [1, 0.6, 1] });
          break;
      }
    }

    S.flush();
    // Only one reachable row in the left rear case gets individual bindings.
    const sample = caseIndex===0 ? volumes.filter(v=>v.p[1]>1.04 && v.p[1]<1.40 && Math.abs(v.r[2])<.001).sort((a,b)=>Math.abs(a.p[0])-Math.abs(b.p[0])).slice(0,5).sort((a,b)=>a.p[0]-b.p[0]) : [];
    const sampleSet=new Set(sample);
    sample.forEach((v,i)=>S.group.add(createBoundVolume(v,i)));
    S.group.add(createShelfBooks(volumes.filter(v=>!sampleSet.has(v)),BM,atlas));
    S.group.userData.shelfStats={quality,volumes:volumes.length,displayLevel,titleCount:atlas.titleCount};
    bookcases.push(S.group);
    return S.group;
  }

  const backZ = -ROOM.hz + CASE_D / 2;

  // Deep walnut returns join the back run to both side walls.
  const shelfReturns = scope('bookcase-corner-returns');
  for (const side of [-1,1]) {
    shelfReturns.put(M.shelf,boxGeo(.87,CASE_H,.11),{p:[side*3.765,CASE_H/2,-3.51]});
    shelfReturns.put(M.walnut,boxGeo(.093,CASE_H,.46),{p:[side*3.38,CASE_H/2,backZ]});
    shelfReturns.put(M.shelf,boxGeo(.105,CASE_H,.39),{p:[side*4.115,CASE_H/2,-3.40]});
    shelfReturns.put(M.walnut,boxGeo(.89,.060,.22),{p:[side*3.76,3.428,-3.43]});
    shelfReturns.put(M.walnut,boxGeo(.13,CASE_H,.44),{p:[side*1.13,CASE_H/2,backZ]});
  }

  // Filling rhythms: the cases flanking the floor lamp and the hero wall keep
  // denser, warmer shelves; the far corners go sparse and cooler.
  buildBookcase('bookshelf-0', {
    x: -2.26, z: backZ, ry: 0, width: 2.14, seed: 101, enrich: true,
    bookMat: M.books, rhythm: [0.60, 0.30, 0.10], led: true,
  });
  buildBookcase('bookshelf-1', {
    x: 0, z: backZ, ry: 0, width: 2.14, seed: 202, enrich: true,
    bookMat: M.booksWarm, rhythm: [0.42, 0.40, 0.18], led: true,
  });
  buildBookcase('bookshelf-2', {
    x: 2.26, z: backZ, ry: 0, width: 2.14, seed: 303, enrich: true,
    bookMat: M.books, rhythm: [0.52, 0.32, 0.16], led: true,
  });
  // left wall: two narrow cases flanking the window
  buildBookcase('bookshelf-3', {
    x: -ROOM.hx + CASE_D / 2, z: -2.05, ry: Math.PI / 2, width: 2.60, seed: 404,
    bookMat: M.booksWarm, rhythm: [0.70, 0.22, 0.08], led: true,
  });
  buildBookcase('bookshelf-4', {
    x: -ROOM.hx + CASE_D / 2, z: 2.72, ry: Math.PI / 2, width: 1.30, seed: 505,
    bookMat: M.booksDim, rhythm: [0.30, 0.36, 0.34], led: false,
  });
  // right wall: two cases flanking the fireplace
  buildBookcase('bookshelf-5', {
    x: ROOM.hx - CASE_D / 2, z: -2.85, ry: -Math.PI / 2, width: 1.10, seed: 606,
    bookMat: M.booksDim, rhythm: [0.34, 0.34, 0.32], led: false,
  });
  buildBookcase('bookshelf-6', {
    x: ROOM.hx - CASE_D / 2, z: 1.55, ry: -Math.PI / 2, width: 2.35, seed: 707,
    bookMat: M.books, rhythm: [0.46, 0.38, 0.16], led: true,
  });

  /* ---------- rolling ladder ---------------------------------------- */

  const ladderTrack=scope('bookcase-ladder-track',{z:-3.093});
  ladderTrack.put(M.brassDark,cylGeo(.011,.011,6.55,16),{p:[0,3.08,0],r:[0,0,Math.PI/2]});
  for(const x of [-3.27,-1.14,1.14,3.27]){
    ladderTrack.put(M.iron,roundedGeo(.056,.064,.023,.006,2),{p:[x,3.08,-.111]});
    ladderTrack.put(M.brassDark,cylGeo(.009,.009,.105,12),{p:[x,3.08,-.056],r:[Math.PI/2,0,0]});
  }
  const ladderScope = scope('ladder', { x: 1.35, z: -2.95 });
  {
    const L = ladderScope;
    const lean = 0.16;
    const railZ=y=>.1-Math.tan(lean)*(y-1.56);
    for (const lx of [-0.24, 0.24]) {
      const rail=woodGrain(roundedGeo(.048,3.10,.066,.010,2),true,2.3,.32);
      L.put(M.walnut,rail,{p:[lx,1.56,.10],r:[-lean,0,0]});
      L.put(M.iron,roundedGeo(.053,.034,.072,.008,2),{p:[lx,.027,railZ(.027)],r:[-lean,0,0]});
      L.put(M.brassDark,roundedGeo(.040,.057,.081,.008,2),{p:[lx,3.045,railZ(3.045)+.008],r:[-lean,0,0]});
      L.put(M.iron,cylGeo(.024,.024,.031,20),{p:[lx,3.11,-.143],r:[0,0,Math.PI/2]});
      L.put(M.brass,cylGeo(.007,.007,.039,12),{p:[lx,3.11,-.143],r:[0,0,Math.PI/2]});
    }
    for (let i = 0; i < 9; i++) {
      const y=.24+i*.33;
      const tread=woodGrain(roundedGeo(.477,.025,.074,.006,2),false,.84,.37,i*.12);
      L.put(M.walnut,tread,{p:[0,y,railZ(y)]});
      for(const x of [-.24,.24]){
        L.put(M.brassDark,cylGeo(.0048,.0048,.0036,10),{p:[x,y,railZ(y)+.034],r:[Math.PI/2,0,0]});
      }
    }
    L.flush();
  }

  /* ---------- fairy lights along the back bookcases ----------------- */

  const fairy = new THREE.Group();
  fairy.name = 'fairy-lights';
  root.add(fairy);
  {
    const pts = [];
    for (let i = 0; i <= 7; i++) {
      const t = i / 7;
      const x = -3.2 + t * 6.4;
      const sag = Math.sin(t * Math.PI) * 0.13 + Math.sin(t * Math.PI * 3) * 0.032;
      pts.push(V3(x, 3.24 - sag, -3.14));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const wire = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 80, 0.004, 4, false),
      new THREE.MeshStandardMaterial({ color: 0x2A2118, roughness: 0.9 })
    );
    wire.castShadow = false;
    fairy.add(wire);

    const bulbPositions = [];
    for (let i = 0; i <= 38; i++) bulbPositions.push(curve.getPoint(i / 38));
    const bulbMesh = new THREE.InstancedMesh(sphGeo(0.017, 8), M.bulb, bulbPositions.length);
    bulbPositions.forEach((p, i) => {
      _m4.makeTranslation(p.x, p.y - 0.022, p.z);
      bulbMesh.setMatrixAt(i, _m4);
    });
    bulbMesh.castShadow = false;
    fairy.add(bulbMesh);

    var fairyGlow = new THREE.Points(
      new THREE.BufferGeometry().setFromPoints(bulbPositions.map((p) => V3(p.x, p.y - 0.02, p.z))),
      new THREE.PointsMaterial({
        map: textures.glow,
        color: 0xFFD9A0,
        size: 0.10,
        transparent: true,
        opacity: 0.42,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
        toneMapped: false,
      })
    );
    fairyGlow.frustumCulled = false;
    fairy.add(fairyGlow);
  }

  /* ================================================================ */
  /*  fireplace on the right wall                                      */
  /* ================================================================ */

  const fireScope = scope('fireplace', { x: ROOM.hx - 0.02, z: -0.95 });
  const logBasket = scope('firewood-basket',{x:3.005,z:.225,ry:-.20});
  const fireTools = scope('fireplace-tools',{x:3.17,z:-2.13});
  logBasket.group.scale.setScalar(1.35);
  fireTools.group.scale.setScalar(1.20);
  const flame = createHearthFlame(quality);
  let fireGlow;
  {
    const F = fireScope;
    const putStone=F.put;
    F.put=(mat,geo,opts={})=>putStone(mat,mat===M.stone?finishStoneGeometry(geo,opts.p):geo,opts);
    const stoneBlock=(w,h,d,lintel=false)=>new THREE.BoxGeometry(w,h,d,1,
      lintel ? 12 : quality==='high'?6:1,
      lintel ? 18 : quality==='high'?8:1);
    F.put(M.stone, stoneBlock(0.69, 1.86, 0.52), { p: [-0.345, 0.93, -0.82] });
    F.put(M.stone, stoneBlock(0.69, 1.86, 0.52), { p: [-0.345, 0.93, 0.82] });
    F.put(M.stone, stoneBlock(0.70, 0.5, 2.22, true), { p: [-0.35, 1.62, 0] });
    F.put(M.walnut, roundedGeo(0.76, 0.09, 2.36, 0.02), { p: [-0.38, 1.90, 0] });
    F.put(M.stoneDark, boxGeo(0.06, 1.31, 1.14), { p: [-0.12, 0.716, 0] });
    F.put(M.stoneDark, boxGeo(0.56, 1.30, 0.05), { p: [-0.42, 0.71, -0.57] });
    F.put(M.stoneDark, boxGeo(0.56, 1.30, 0.05), { p: [-0.42, 0.71, 0.57] });
    F.put(M.stoneDark, boxGeo(0.55, 0.04, 1.14), { p: [-0.415, 1.357, 0] });
    F.put(M.stone, stoneBlock(0.85, 0.07, 2.5), { p: [-0.425, 0.035, 0] });
    const firewood=buildFirebed(F,quality);
    buildWickerBasket(logBasket,M,.225,.206);
    addSpareFirewood(logBasket,firewood);
    addHearthTools(fireTools,M);
    logBasket.flush();
    fireTools.flush();

    addMantelArrangement(F,M);
    const frameTurn=[.07,-Math.PI/2+.16,-.10];
    const frameCenter=V3(-.23,2.091,.345);
    const frameNormal=V3(0,0,1).applyEuler(new THREE.Euler(...frameTurn));
    const faceAt=depth=>frameCenter.clone().addScaledVector(frameNormal,depth).toArray();
    F.put(M.walnut,boxGeo(.225,.273,.025),{p:faceAt(0),r:frameTurn});
    F.put(M.matboard,planeGeo(.193,.243),{p:faceAt(.0131),r:frameTurn});
    F.put(M.art[2],planeGeo(.157,.193),{p:faceAt(.0136),r:frameTurn});
    addMantelDetails(F,M,quality);
    F.flush();
  }
  fireScope.group.add(flame);
  fireGlow = glowSprite(textures.glow, 0xFF8A45, 1.25, .16);
  fireGlow.position.set(-0.42, 0.5, 0);
  fireScope.group.add(fireGlow);

  // Orange bounce reaches the right edge of the reading island; the grazing
  // spot shapes the hearth stone and the exposed ends of the stacked logs.
  const fireLight = new THREE.PointLight(0xff874c, 4.3, 4.65, 2.0);
  fireLight.name='fireplace-bounce';
  fireLight.position.set(ROOM.hx - 0.57, 0.55, -0.95);
  root.add(fireLight);

  // Grazing spill for the low stone tread and the basket-facing cut ends.
  const hearthSpill = new THREE.SpotLight(0xffa064,1.55,2.65,.71,.92,2);
  hearthSpill.name='hearth-spill';
  hearthSpill.position.set(3.51,.49,-.69);
  hearthSpill.target.position.set(logBasket.group.position.x,.125,logBasket.group.position.z);
  root.add(hearthSpill,hearthSpill.target);

  // cover poster above the fireplace
  const posterScope = scope('poster', { x: ROOM.hx - 0.06, z: -0.95, ry: -Math.PI / 2 });
  posterScope.put(M.shelf, boxGeo(0.92, 1.24, 0.05), { p: [0, 2.72, 0] });
  posterScope.put(M.trim, boxGeo(0.82, 1.14, 0.02), { p: [0, 2.72, 0.03] });
  posterScope.put(M.cover, planeGeo(0.75, 1.07), { p: [0, 2.72, 0.045] });
  posterScope.flush();

  /* ================================================================ */
  /*  rug: thick wool slab + fringe                                    */
  /* ================================================================ */

  const rug = new THREE.Mesh(boxGeo(RUG.width,RUG.height,RUG.depth), M.rug);
  rug.name = 'rug';
  rug.position.set(RUG.x,RUG.height/2,RUG.z);
  rug.receiveShadow = true;
  rug.castShadow = false;
  root.add(rug);

  {
    const RUG_TOP = RUG.height;
    const fringeGeo = boxGeo(0.046, 0.0032, 0.0074);
    const count = 256;
    const fringe = new THREE.InstancedMesh(fringeGeo, M.rugFringe, count);
    fringe.name = 'rug:fringe';
    fringe.castShadow = false;
    fringe.receiveShadow = true;
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const side = i % 2;
      const k = Math.floor(i / 2);
      const t = k / (count / 2 - 1);
      const z = RUG.z + (t-.5)*(RUG.depth-.12);
      const x = RUG.x + (side ? 1 : -1) * (RUG.width/2 + .016 + rnd() * .008);
      _e.set(0, (rnd() - .5) * .52, (rnd() - .5) * .16);
      _q.setFromEuler(_e);
      m4.compose(_v.set(x, RUG_TOP * .35, z), _q, _sv.set(.62 + rnd() * .64, 1, .7 + rnd() * .32));
      fringe.setMatrixAt(i, m4);
    }
    root.add(fringe);
  }

  /* ================================================================ */
  /*  Oatmeal linen and saddle leather upholstery                      */
  /* ================================================================ */

  const sofaScope = scope('sofa', SOFA);
  {
    const S = sofaScope;
    // legs
    for (const lx of [-0.94, 0.94]) {
      for (const lz of [-0.36, 0.36]) {
        const base=rugSurface(SOFA.x+lx,SOFA.z+lz)-SOFA.y;
        S.put(M.walnut,cylGeo(.032,.042,.10-base,10),{p:[lx,(.10+base)/2,lz]});
      }
    }
    const apron=S.put(M.sofaHide,workLeather(roundedGeo(2.14,.24,.94,.055,3),2.14,.24,.94),{p:[0,.22,0]});
    for(const x of [-.99,.99]){
      S.put(M.sofaHide,workLeather(roundedGeo(.26,.46,1,.105,5),.26,.46,1,true),{p:[x,.52,0]});
      S.put(M.leatherWelting,frontWelt(.26,.46,1,.105,.042,.00185),{p:[x,.52,0]});
    }
    S.put(M.sofaHide,workLeather(roundedGeo(1.76,.66,.22,.075,3),1.76,.66,.22),{p:[0,.58,-.37]});
    S.put(M.leatherWelting,frontWelt(2.14,.24,.94,.055,.019,.0016),{p:[0,.22,0]});

    const surfaces={seat:[],back:[],apron};
    const cushion=(geometry,pose,kind)=>{
      const g=S.put(M.sofaLinen,geometry,pose);
      shadeSofaFabric(g,kind);
      if(surfaces[kind])surfaces[kind].push(g);
    };
    for(const [x,y,width,pressure,shift] of [[-.50,.315,1.007,.022,.16],[.50,.313,1.013,.034,-.22]]){
      const {body,welt}=stuffedCushion(width,.21,.88,{pressure,shift,quality});
      const pose={p:[x,y,.02]};
      cushion(body,pose,'seat');
      S.put(M.linenWelting,welt,pose);
    }
    for(const [x,tilt,turn] of [[-.45,-.19,.02],[.45,-.17,-.03]]){
      const pose={p:[x,.66,-.27],r:[tilt,turn,0]};
      const {body,welt}=stuffedCushion(.866,.21,.52,{pressure:.022,shift:x*.51,quality});
      cushion(body.rotateX(Math.PI/2),pose,'back');
      S.put(M.linenWelting,welt.rotateX(Math.PI/2),pose);
    }
    cushion(cylGeo(.10,.10,1.52,24),{p:[0,.88,-.30],r:[0,0,Math.PI/2]},'bolster');
    for(const x of [-.5,.5])S.put(M.leatherDark,boxGeo(1.02,.014,.02),{p:[x,.245,.45]});

    const pillow=(mat,pose)=>{
      const {body,welt}=stuffedCushion(.44,.17,.42,{pressure:-.034,shift:pose.p[0]*.32,quality,loose:true});
      const g=S.put(mat,body.rotateX(Math.PI/2),pose);
      shadeSofaFabric(g,'pillow');
      const seam=mat.clone();
      seam.color.multiplyScalar(.77);
      seam.vertexColors=false;
      S.put(seam,welt.rotateX(Math.PI/2),pose);
    };
    pillow(M.sofaClay,{p:[-.704,.596,-.060],r:[-.37,.22,.18],s:[.91,.83,.68]});
    pillow(M.sofaSlate,{p:[.64,.610,-.074],r:[-.36,-.20,-.13],s:[1,.87,.64]});
    pillow(M.sofaCoffee,{p:[.419,.508,.122],r:[-.62,.22,-.18],s:[.87,.64,.77]});

    placeSeatThrow(S,M.sofaThrow,quality,surfaces);

    S.flush();
  }

  /* ================================================================ */
  /*  coffee table: walnut, brass inlay, tea, brass book stand         */
  /* ================================================================ */

  const tableScope = scope('coffee-table', TABLE);
  {
    const T = tableScope;
    const topLocal = TABLE.top - TABLE.y; // 0.327

    const boardMaterial=M.walnutTop.clone();
    boardMaterial.vertexColors=true;
    const widths=[.278,.303,TABLE.depth-.581];
    let boundary=-TABLE.depth/2;
    widths.forEach((depth,i)=>{
      const at=boundary+depth/2;
      boundary+=depth;
      const plank=woodGrain(roundedGeo(TABLE.width,.05,depth-.00036,.0026,2),false,1.57,.77,.08*i);
      const {position,normal}=plank.attributes;
      const colors=new Float32Array(position.count*3);
      for(let j=0;j<position.count;j++){
        const edge=Math.abs(position.getZ(j))*2/depth;
        const reach=Math.exp(-((position.getX(j)-.21)**2)/.31);
        const rubbed=THREE.MathUtils.smoothstep(edge,.52,1)*reach*.095;
        const tint=[.93,1.01,.966][i] + rubbed - .05*Math.abs(normal.getX(j));
        colors.set([tint,tint-rubbed*.10,tint-rubbed*.26],j*3);
      }
      plank.setAttribute('color',new THREE.BufferAttribute(colors,3));
      T.put(boardMaterial,plank,{p:[0,topLocal-.025,at]});
    });
    for(const z of [-.419,.419]){
      T.put(M.brassDark,boxGeo(1.46,.0024,.0036),{p:[0,topLocal-.019,z]});
    }
    for(const x of [-.749,.749]){
      T.put(M.brassDark,boxGeo(.0036,.0024,.790),{p:[x,topLocal-.019,0]});
    }
    // Open apron between tapered legs; each stretcher meets a real joint.
    for(const z of [-.32,.32]){
      T.put(M.walnut,woodGrain(roundedGeo(1.236,.057,.039,.005,2)),{p:[0,topLocal-.075,z]});
    }
    for(const x of [-.62,.62]){
      T.put(M.walnut,woodGrain(roundedGeo(.606,.057,.039,.005,2)),{p:[x,topLocal-.075,0],r:[0,Math.PI/2,0]});
    }
    for (const lx of [-0.62, 0.62]) {
      for (const lz of [-0.32, 0.32]) {
        const base=rugSurface(TABLE.x+lx,TABLE.z+lz)-TABLE.y;
        const underside=topLocal-.05;
        const leg=woodGrain(roundedGeo(.065,underside-base,.061,.007,2),true,.40,.30,lx+lz);
        const position=leg.attributes.position;
        for(let i=0;i<position.count;i++){
          const t=position.getY(i)/(underside-base)+.5;
          position.setX(i,position.getX(i)*(.67+.33*t));
          position.setZ(i,position.getZ(i)*(.70+.30*t));
        }
        T.put(M.walnut,leg,{p:[lx,(underside+base)/2,lz]});
        for(const dy of [-.009,.009])T.put(M.shelf,cylGeo(.0035,.0035,.003,12),
          {p:[lx,topLocal-.075+dy,lz+Math.sign(lz)*.031],r:[Math.PI/2,0,0]});
      }
    }
    T.put(M.walnut,woodGrain(roundedGeo(1.26,.028,.62,.007,2)),{p:[0,.075,0]});

    /* A supported easel whose lower edge faces the seated reader. */
    const standY = BOOK_TABLE.center.y - 0.012;
    const stand = scope('book-stand', { x: BOOK_TABLE.center.x, y: standY,
      z: BOOK_TABLE.center.z, ry: BOOK_TABLE.yaw });
    for (const sx of [-0.063, 0.063]) {
      stand.put(M.brass, boxGeo(0.065, 0.008, 0.292), { p: [sx, 0, 0], r: [STAND_TILT, 0, 0] });
      for (const z of [-0.11, 0.11]) {
        const supportH = standY - z * Math.sin(STAND_TILT) - 0.005 - TABLE_TOP_Y;
        stand.put(M.brassDark, cylGeo(0.010, 0.016, supportH, 12), {
          p: [sx, TABLE_TOP_Y + supportH / 2 - standY, z * Math.cos(STAND_TILT)] });
      }
      const lip = V3(sx, 0.010, 0.144).applyAxisAngle(V3(1, 0, 0), STAND_TILT);
      stand.put(M.brassDark, boxGeo(0.065, 0.018, 0.009), {
        p: lip.toArray(), r: [STAND_TILT, 0, 0] });
    }
    stand.flush();

    /* ---- ceramic cup + saucer + tea ---- */
    T.put(M.contactSoft,planeGeo(.206,.198),{p:[CUP.x,topLocal+.00065,CUP.z],r:[-Math.PI/2,0,0]});
    T.put(M.walnut,cylGeo(.078,.075,.009,36),{p:[CUP.x,topLocal+.0045,CUP.z]});
    T.put(M.stoneware,cylGeo(.066,.064,.005,36),{p:[CUP.x,topLocal+.0115,CUP.z]});

    T.put(M.contactSoft,planeGeo(.331,.354),{p:[-.50,topLocal+.00055,-.037],r:[-Math.PI/2,0,0]});
    bookPile(T.put, {
      x:-.50, y:topLocal+.001, z:-.037, r2:rnd, count:3, w:.26, d:.287,
      topYaw:.135,coverPlate:0,
    });
    addReadingTableDetails(T, M, topLocal, quality);

    T.flush();
  }

  /* ---------- steam above the cup (GPU animated) --------------------- */

  const steamMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSize: { value: 0.015 },
      uScale: { value: 900 },
      uColor: { value: new THREE.Color(0xFFF1DC) },
      uOpacity: { value: 0.055 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uSize;
      uniform float uScale;
      varying float vA;
      void main() {
        vec3 seed = position;
        float life = fract(seed.x + uTime * (0.20 + seed.y * 0.14));
        vec3 p = vec3(seed.z * 0.026, 0.0, (seed.y - 0.5) * 0.05);
        p.y += life * 0.30;
        p.x += sin(uTime * 0.6 + seed.x * 12.0 + life * 5.0) * 0.019 * life;
        p.z += cos(uTime * 0.5 + seed.z * 9.0 + life * 4.0) * 0.017 * life;
        p.x *= 1.0 + life * 0.8;
        p.z *= 1.0 + life * 0.8;
        vA = smoothstep(0.0, 0.16, life) * (1.0 - smoothstep(0.40, 1.0, life));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uSize * uScale * (0.6 + life * 1.4) / max(0.05, -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vA;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5) discard;
        float a = 1.0 - smoothstep(0.0, 0.5, d);
        a *= a;
        gl_FragColor = vec4(uColor, a * vA * uOpacity);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
  });

  const steamCount = quality==='high'?60:quality==='medium'?40:24;
  {
    const seeds = new Float32Array(steamCount * 3);
    for (let i = 0; i < steamCount; i++) {
      seeds[i * 3] = rnd();
      seeds[i * 3 + 1] = rnd();
      seeds[i * 3 + 2] = (rnd() - 0.5) * 2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(seeds, 3));
    var steam = new THREE.Points(g, steamMat);
    steam.name = 'steam';
    steam.frustumCulled = false;
    steam.renderOrder = 7;
    steam.position.set(TABLE.x+CUP.x,TABLE.top+CUP.coasterHeight+.085,TABLE.z+CUP.z);
    root.add(steam);
  }

  /* ================================================================ */
  /*  armchair + side table                                            */
  /* ================================================================ */

  const chairScope = scope('armchair', {...CHAIR,ry:CHAIR.yaw});
  {
    const C = chairScope;
    for (const lx of [-0.38, 0.38]) {
      for (const lz of [-.30,.30]){
        const x=CHAIR.x+lx*Math.cos(CHAIR.yaw)+lz*Math.sin(CHAIR.yaw);
        const z=CHAIR.z-lx*Math.sin(CHAIR.yaw)+lz*Math.cos(CHAIR.yaw);
        const base=rugSurface(x,z)-CHAIR.y;
        C.put(M.walnut,woodGrain(cylGeo(.036,.027,.17-base,12),true,.35,.31),
          {p:[lx,(.17+base)/2,lz]});
      }
    }
    C.put(M.leather,workLeather(roundedGeo(.94,.20,.86,.082,4),.94,.20,.86),{p:[0,.27,0]});
    C.put(M.leatherWelting,frontWelt(.94,.20,.86,.082,.020,.0016),{p:[0,.27,0]});
    M.chairLinen.vertexColors=true;
    const seatParts=stuffedCushion(.84,.18,.74,{pressure:.03,shift:-.16,quality});
    const seat=C.put(M.chairLinen,seatParts.body,{p:[0,.44,.02]});
    shadeSofaFabric(seat,'chair-seat');
    C.put(M.chairWelting,seatParts.welt,{p:[0,.44,.02]});
    const backPose={p:[0,.66,-.33],r:[-.17,0,.025]};
    const backParts=stuffedCushion(.88,.23,.59,{pressure:.018,shift:.14,quality});
    const back=C.put(M.chairLinen,backParts.body.rotateX(Math.PI/2),backPose);
    shadeSofaFabric(back,'chair-back');
    C.put(M.chairWelting,backParts.welt.rotateX(Math.PI/2),backPose);
    for(const side of [-1,1]){
      const pose={p:[side*.412,.463,-.02],r:[-.08,0,-side*.065]};
      C.put(M.leather,workLeather(roundedGeo(.17,.39,.81,.074,5),.17,.39,.81,true),pose);
      C.put(M.leatherWelting,frontWelt(.17,.39,.81,.074,.030,.0018),pose);
    }
    const pillowPose={p:[.09,.625,-.167],r:[-.31,.13,-.22],s:[1,.85,.78]};
    const pillowParts=stuffedCushion(.36,.15,.34,{pressure:-.024,shift:.16,quality,loose:true});
    C.put(M.pillowBone,pillowParts.body.rotateX(Math.PI/2),pillowPose);
    const seam=M.pillowBone.clone();
    seam.color.multiplyScalar(.82);
    C.put(seam,pillowParts.welt.rotateX(Math.PI/2),pillowPose);
    C.flush();
  }

  const sideScope = scope('side-table', {...SIDE_TABLE,y:.02});
  const sideFeet=[];
  {
    const S = sideScope;
    const lathe=(profile,segments=48)=>new THREE.LatheGeometry(profile.map(([r,y])=>new THREE.Vector2(r,y)),segments);
    S.put(M.walnutTop,woodGrain(lathe([
      [0,.537],[.272,.537],[.289,.541],[.298,.549],[.30,.563],[.298,.573],[.290,.578],[0,.578],
    ],64),false,.63,.63,.10));
    S.put(M.walnut,woodGrain(lathe([
      [0,.05],[.057,.050],[.055,.080],[.043,.109],[.048,.140],[.040,.169],
      [.026,.254],[.027,.352],[.038,.442],[.048,.482],[.044,.502],[.065,.534],[0,.538],
    ]),true,.68,.30,.15));
    for(let i=0;i<3;i++){
      const angle=i/3*Math.PI*2+.26,x=Math.sin(angle)*.206,z=Math.cos(angle)*.206;
      const base=rugSurface(SIDE_TABLE.x+x,SIDE_TABLE.z+z)-.02;
      sideFeet.push([SIDE_TABLE.x+x,SIDE_TABLE.z+z,base+.02]);
      const leg=new THREE.CatmullRomCurve3([V3(0,.118,0),V3(x*.40,.103,z*.40),V3(x*.78,base+.057,z*.78),V3(x,base+.019,z)]);
      const brace=woodGrain(new THREE.TubeGeometry(leg,13,.021,9,false),false,.38,.25,i*.16);
      S.put(M.walnut,brace);
      S.put(M.leatherDark,roundedGeo(.043,.013,.042,.004,2),{p:[x,base+.0065,z],r:[0,angle,0]});
    }
    bookPile(S.put, { x: -0.05, y: 0.578, z: 0.015, r2: rnd, count: 2, w: 0.20, d: 0.27, coverPlate:1 });
    const mugProfile=[[0,0],[.031,0],[.039,.005],[.044,.067],[.042,.073],[.038,.073],[.033,.012],[0,.012]].map(([x,y])=>new THREE.Vector2(x,y));
    S.put(M.ceramic,new THREE.LatheGeometry(mugProfile,56),{p:[.12,.578,-.06]});
    S.put(M.ceramic,new THREE.TorusGeometry(.021,.0045,8,36,Math.PI*1.5),{p:[.163,.615,-.06],r:[0,0,-Math.PI*.25]});
    S.put(M.soil,new THREE.CircleGeometry(.036,48),{p:[.12,.638,-.06],r:[-Math.PI/2,0,0]});
    const smallLamp = scope('side-reading-lamp', {x:SIDE_TABLE.x-.19, y:.597, z:SIDE_TABLE.z-.112});
    smallLamp.put(M.brassDark, cylGeo(.041,.05,.013,20), {p:[0,.0065,0]});
    smallLamp.put(M.brassDark, cylGeo(.006,.010,.16,12), {p:[0,.087,0]});
    addShadeDetail(smallLamp,M,.043,.083,.094,.201,.31);
    smallLamp.put(M.bulb, sphGeo(.016,12), {p:[0,.17,0]});
    const tableLight = new THREE.PointLight(0xffc18c,.20,1.4,2);
    tableLight.position.set(0,.154,0);
    smallLamp.group.add(tableLight);
    smallLamp.flush();
    S.flush();
  }

  const pouf = scope('woven-footstool',{...POUF,y:rugSurface(POUF.x,POUF.z),ry:.17});
  {
    const fabric = boucleMat(0x554437);
    const profile = [
      [0,.021],[.16,.021],[.213,.027],[.241,.049],[.256,.089],
      [.26,.153],[.248,.209],[.219,.237],[.151,.253],[.074,.257],[0,.251],
    ].map(([r,y])=>new THREE.Vector2(r*POUF.radius/.26,y));
    pouf.put(fabric,new THREE.LatheGeometry(profile,48));
    for (const [radius,height] of [[.244,.055],[.238,.221],[.229,.230]]) {
      pouf.put(M.leatherWelting,torusGeo(radius,.0029,6,48),{p:[0,height,0],r:[Math.PI/2,0,0]});
    }
    for (const [x,z] of [[-.12,.10],[.13,.10],[0,-.14]]) {
      pouf.put(M.walnut,cylGeo(.023,.029,.033,12),{p:[x,.017,z]});
    }
  }

  /* ================================================================ */
  /*  contact shadows: one merged decal mesh, nothing floats          */
  /* ================================================================ */

  {
    const SH = scope('contact-shadows');
    const RUG_Y = RUG.height + .0018;
    const FLOOR_Y = 0.0051;
    let k = 0;

    // each blob gets its own y jitter so overlapping decals can never z-fight
    const blob = (mat, x, z, sx, sz, y, yaw = 0) => {
      const off = k++ * 0.00035;
      SH.put(mat, planeGeo(sx, sz), { p: [x, y + off, z], r: [-Math.PI / 2, 0, yaw] });
    };

    // heavy pieces standing on the rug
    blob(M.contact,SOFA.x,SOFA.z,2.58,1.31,RUG_Y);
    blob(M.contact,TABLE.x,TABLE.z,1.82,1.08,RUG_Y);
    for(const [origin,x,z] of [[SOFA,.94,.36],[TABLE,.62,.32]]) {
      for(const sx of [-1,1]) for(const sz of [-1,1]){
        const footX=origin.x+sx*x, footZ=origin.z+sz*z;
        blob(M.contact,footX,footZ,.17,.17,rugSurface(footX,footZ)+.002);
      }
    }

    // Each foot receives a contact on the surface it actually touches.
    blob(M.contact,CHAIR.x,CHAIR.z,1.18,1.05,FLOOR_Y,CHAIR.yaw);
    blob(M.contact,CHAIR.x+.13,CHAIR.z-.09,.63,.68,RUG_Y,CHAIR.yaw);
    for(const x of [-.38,.38]) for(const z of [-.30,.30]){
      const footX=CHAIR.x+x*Math.cos(CHAIR.yaw)+z*Math.sin(CHAIR.yaw);
      const footZ=CHAIR.z-x*Math.sin(CHAIR.yaw)+z*Math.cos(CHAIR.yaw);
      blob(M.contact,footX,footZ,.16,.16,rugSurface(footX,footZ)+.002);
    }
    blob(M.contact,SIDE_TABLE.x,SIDE_TABLE.z,.74,.74,FLOOR_Y);
    for(const [x,z,y] of sideFeet)blob(M.contact,x,z,.13,.13,y+.002);
    blob(M.contact,POUF.x,POUF.z,.66,.61,RUG_Y);
    blob(M.contact,logBasket.group.position.x,logBasket.group.position.z,.82,.82,FLOOR_Y);
    blob(M.contactSoft,RECORD_CONSOLE.x,RECORD_CONSOLE.z,.92,.66,FLOOR_Y);
    for(const x of [-.36,.36]) for(const z of [-.22,.22]) {
      blob(M.contact,RECORD_CONSOLE.x+x,RECORD_CONSOLE.z+z,.16,.16,FLOOR_Y);
    }
    for(const side of [-1,1]){
      blob(M.contactSoft,RUG.x+side*RUG.width/2,RUG.z,.24,RUG.depth,FLOOR_Y);
      blob(M.contactSoft,RUG.x,RUG.z+side*RUG.depth/2,RUG.width,.24,FLOOR_Y);
    }
    blob(M.contactSoft,fireTools.group.position.x,fireTools.group.position.z,.456,.456,FLOOR_Y);
    blob(M.contactSoft,-1.53,-2.0,.57,.56,RUG_Y);
    blob(M.contact,.23,3.33,2.70,.55,FLOOR_Y);

    // bookcase plinths: a soft line where joinery meets the floor. The blob is
    // centred just behind the front face so the plinth gets a solid shade and
    // the gradient spills ~25 cm into the room.
    blob(M.contactSoft, -2.26, backZ + 0.15, 2.3, 0.62, FLOOR_Y);
    blob(M.contactSoft, 0, backZ + 0.15, 2.3, 0.62, FLOOR_Y);
    blob(M.contactSoft, 2.26, backZ + 0.15, 2.3, 0.62, FLOOR_Y);
    blob(M.contactSoft, -ROOM.hx + CASE_D - 0.05, -2.05, 0.62, 2.72, FLOOR_Y);
    blob(M.contactSoft, -ROOM.hx + CASE_D - 0.05, 2.72, 0.62, 1.44, FLOOR_Y);
    blob(M.contactSoft, ROOM.hx - CASE_D + 0.05, -2.85, 0.62, 1.24, FLOOR_Y);
    blob(M.contactSoft, ROOM.hx - CASE_D + 0.05, 1.55, 0.62, 2.5, FLOOR_Y);

    // planters
    blob(M.contactSoft,ENTRY_PLANT.x,ENTRY_PLANT.z,.89,.89,FLOOR_Y);
    blob(M.contactSoft,WINDOW_PLANT.x,WINDOW_PLANT.z,.85,.85,FLOOR_Y);

    SH.flush();
  }

  /* ================================================================ */
  /*  plants                                                           */
  /* ================================================================ */

  function buildPlant(x,z,s,seed){
    const plant=createBotanicalPlant({scale:s,seed,materials:botanicalMaterials,variant:seed%2});
    plant.position.set(x,0,z);root.add(plant);return plant;
  }
  buildPlant(ENTRY_PLANT.x,ENTRY_PLANT.z,.94,41);
  buildPlant(WINDOW_PLANT.x,WINDOW_PLANT.z,.85,55);

  /* ================================================================ */
  /*  door, coat rack, scarf, mat, wall print                          */
  /* ================================================================ */

  const doorScope = scope('door', { x: -2.3, z: ROOM.hz - 0.06,ry:Math.PI });
  doorScope.put(M.walnut, boxGeo(1.16, 2.3, 0.08), { p: [0, 1.15, -0.02] });
  doorScope.put(M.shelf, boxGeo(1.02, 2.18, 0.06), { p: [0, 1.09, 0.02] });
  doorScope.put(M.walnut, boxGeo(0.74, 0.82, 0.02), { p: [0, 1.55, 0.06] });
  doorScope.put(M.walnut, boxGeo(0.74, 0.82, 0.02), { p: [0, 0.62, 0.06] });
  doorScope.put(M.walnut, boxGeo(0.74, 0.04, 0.03), { p: [0, 1.12, 0.06] });

  for(const cy of [.62,1.55]){
    for(const [w,h,x,y]of [[.78,.016,0,cy+.422],[.78,.016,0,cy-.422],[.016,.83,-.382,cy],[.016,.83,.382,cy]])
      doorScope.put(M.walnut,roundedGeo(w,h,.010,.003,3),{p:[x,y,.078]});
  }
  doorScope.flush();

  const craftedRack=createBentwoodRack(M);craftedRack.position.set(-1.43,0,ROOM.hz-.28);root.add(craftedRack);

  const wovenMat=createWovenMat();wovenMat.position.set(-2.3,0,ROOM.hz-.42);root.add(wovenMat);

  const printScope=scope('entry-gallery',{x:.23,y:1.70,z:3.56,ry:Math.PI});
  addFramedPrint(printScope,M,M.starryNight,1.20,.95,[.50,0,0]);
  addFramedPrint(printScope,M,M.waterLilies,.82,.84,[-.68,0,0]);
  printScope.flush();

  const consoleScope=scope('entry-console',{x:.23,z:3.34});
  const consoleLamp=scope('entry-console-lamp',{x:1.31,y:.735,z:3.34});
  buildEntryConsole(consoleScope,consoleLamp,M,(put,x,y,z)=>bookPile(put,
    {x,y,z,w:.39,d:.282,r2:TX.mulberry32(114),count:4,topYaw:-.13,coverPlate:3}),textures.glow);
  consoleScope.flush();
  const throwBasket=scope('throw-basket',{x:-1.53,y:RUG.height,z:-2.0});
  buildWickerBasket(throwBasket,M,.207,.285,true);
  throwBasket.flush();

  /* ================================================================ */
  /*  pendant over the coffee table                                    */
  /* ================================================================ */

  const pendScope = scope('pendant', { x: 0, z: -0.02 });
  pendScope.put(M.black, cylGeo(0.008, 0.008, 0.40, 6), { p: [0, 3.30, 0] });
  pendScope.put(M.brass, cylGeo(0.06, 0.06, 0.03, 16), { p: [0, 3.10, 0] });
  addShadeDetail(pendScope,M,.07,.28,.25,2.96,.073);
  pendScope.put(M.brassDark,cylGeo(.071,.071,.014,32),{p:[0,3.086,0]});
  pendScope.put(M.bulb, sphGeo(0.03, 12), { p: [0, 2.875, 0] });
  pendScope.flush();
  const pendGlow = glowSprite(textures.glow, 0xFFD7A1, 0.29, 0.034);
  pendGlow.position.set(0, 2.86, -0.02);
  root.add(pendGlow);

  const pendLight = new THREE.SpotLight(0xffd2a6, 14.4, 4.5, .60, .95, 2);
  pendLight.name='pendant-reading-pool';
  pendLight.position.set(0, 2.80, -0.02);
  pendLight.target.position.set(TABLE.x,.27,(SOFA.z+TABLE.z)*.5);
  pendLight.castShadow = quality !== 'low';
  pendLight.shadow.mapSize.set(1024,1024);
  pendLight.shadow.camera.near = .25;
  pendLight.shadow.camera.far = 5;
  pendLight.shadow.bias = -.00016;
  pendLight.shadow.normalBias = .016;
  pendLight.shadow.radius = 4;
  root.add(pendLight,pendLight.target);

  /* ================================================================ */
  /*  floor lamp: 2700 K spot + volumetric cone + dust in the beam     */
  /* ================================================================ */

  addJoineryDetails(root,M);

  const lampScope = scope('floor-lamp', { x: LAMP.x, z: LAMP.z });
  lampScope.put(M.brassDark, cylGeo(0.20, 0.22, 0.035, 24), { p: [0, 0.0175, 0] });
  lampScope.put(M.brassDark, cylGeo(0.018, 0.018, 1.60, 8), { p: [0, 0.83, 0] });
  addShadeDetail(lampScope,M,.11,.30,.30,1.74,.125);
  lampScope.put(M.bulb, sphGeo(0.05, 12), { p: [0, 1.62, 0] });
  lampScope.flush();

  const lampGlow = glowSprite(textures.glow, 0xFFD7A1, 0.68, 0.115);
  lampGlow.position.set(LAMP.x, 1.62, LAMP.z);
  root.add(lampGlow);

  const lampAnchor = V3(LAMP.x+.07, 1.53, LAMP.z+.04);
  const lampTarget = V3(-1.4, 0.30, -1.65);
  const beamDir = lampTarget.clone().sub(lampAnchor).normalize();

  const lampSpot = new THREE.SpotLight(0xffcd9b, 3.25, 5.4, 0.78, 0.96, 2);
  lampSpot.name = 'lampSpot';
  lampSpot.position.copy(lampAnchor);
  lampSpot.target.position.copy(lampTarget);
  lampSpot.castShadow = quality!=='low';
  lampSpot.shadow.mapSize.set(quality==='medium'?1536:2048,quality==='medium'?1536:2048);
  lampSpot.shadow.bias = -0.00015;
  lampSpot.shadow.normalBias = 0.008;
  lampSpot.shadow.radius = 4;
  lampSpot.shadow.camera.near = 0.2;
  lampSpot.shadow.camera.far = 6;
  root.add(lampSpot);
  root.add(lampSpot.target);

  /* ---------------------------------------------------------------- */
  /*  volumetric glow — a faint haze, never a visible cone             */
  /*                                                                   */
  /*  Apex buried inside the shade, single-sided shell that reaches     */
  /*  exactly zero alpha at its own silhouette, peak alpha 0.072 (the    */
  /*  old cone peaked at 0.24 with two additive layers). The lit floor   */
  /*  and the shelves stay far brighter than the shaft.                 */
  /* ---------------------------------------------------------------- */

  const CONE_APEX_Y = 1.83;               // inside the shade (shade spans 1.59–1.89)
  const coneApex = V3(LAMP.x, CONE_APEX_Y, LAMP.z);
  const coneDir = lampTarget.clone().sub(coneApex).normalize();
  const CONE_LEN = 2.12;                  // runs a little past the floor plane
  const CONE_R_TOP = 0.012;
  const CONE_R_BOT = 1.12;
  const CONE_MOUTH = 0.125;               // t at which the shade mouth sits

  const coneMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uHeight: { value: CONE_LEN },
      uMouth: { value: CONE_MOUTH },
      uColor: { value: new THREE.Color(0xFFC98A) },
      uOpacity: { value: 0.035 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vPos = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vV = normalize(-mv.xyz);
        vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uHeight;
      uniform float uMouth;
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec3 vPos;
      varying vec3 vN;
      varying vec3 vV;

      void main() {
        // t = 0 at the hidden apex, 1 at the bottom of the shaft
        float t = clamp(-vPos.y / uHeight, 0.0, 1.0);

        // brightest exactly at the shade mouth, then a quick smooth falloff
        float rise = smoothstep(0.0, uMouth, t);
        float fall = 1.0 - smoothstep(uMouth, 0.56, t);
        float along = pow(rise * fall, 1.4);

        // radial softness: brightest where the shell faces the eye, and
        // exactly 0 at the silhouette -> no geometric edge, no seam
        float facing = abs(dot(normalize(vN), normalize(vV)));
        float radial = pow(facing, 1.9);

        // slow drift so the shaft is never a static solid
        float n1 = sin(vPos.y * 9.5 + uTime * 0.31 + vPos.x * 5.7) * 0.5 + 0.5;
        float n2 = sin(vPos.y * 4.1 - uTime * 0.19 + vPos.z * 4.3) * 0.5 + 0.5;
        float drift = 0.66 + 0.34 * (n1 * 0.62 + n2 * 0.38);

        float a = along * radial * drift * uOpacity;
        if (a < 0.0015) discard;
        gl_FragColor = vec4(uColor, a);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.FrontSide,   // one additive pass: no doubled silhouette
    toneMapped: false,
  });

  // truncated cone, apex buried inside the shade (no visible tip, no seam)
  const coneGeo = new THREE.CylinderGeometry(CONE_R_TOP, CONE_R_BOT, CONE_LEN, 48, 1, true);
  coneGeo.translate(0, -CONE_LEN / 2, 0);   // apex at local y = 0
  const lampCone = new THREE.Mesh(coneGeo, coneMat);
  lampCone.name = 'lampCone';
  lampCone.position.copy(coneApex);
  lampCone.quaternion.setFromUnitVectors(V3(0, -1, 0), coneDir);
  lampCone.renderOrder = 5;                 // after the opaque pass
  lampCone.frustumCulled = false;
  root.add(lampCone);
  lampCone.visible=quality==='high';

  /* ---- 220 motes, clamped inside the shaft core, barely there ----- */
  const beamDustMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uHeight: { value: CONE_LEN * 0.80 },
      uRadius: { value: CONE_R_BOT * 0.42 },
      uSize: { value: 0.008 },
      uScale: { value: 900 },
      uColor: { value: new THREE.Color(0xFFE3B8) },
      uOpacity: { value: 0.15 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uHeight;
      uniform float uRadius;
      uniform float uSize;
      uniform float uScale;
      varying float vA;
      void main() {
        vec3 seed = position;
        float life = fract(seed.x + uTime * seed.y * 0.45);
        float tt = life;                              // 0 apex, 1 bottom
        float maxR = uRadius * (0.15 + 0.85 * tt);    // hugs the core only
        float ang = seed.z * 6.2831853 + uTime * 0.12 + seed.x * 9.0;
        float rr = maxR * (0.10 + 0.90 * fract(seed.z * 7.31));
        vec3 p = vec3(cos(ang) * rr, -uHeight * tt, sin(ang) * rr);
        p.x += sin(uTime * 0.5 + seed.x * 11.0) * 0.007;
        p.z += cos(uTime * 0.43 + seed.z * 8.0) * 0.007;
        vA = smoothstep(0.0, 0.24, life) * (1.0 - smoothstep(0.46, 1.0, life));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uSize * uScale / max(0.05, -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vA;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5) discard;
        float a = 1.0 - smoothstep(0.0, 0.5, d);
        a *= a;
        gl_FragColor = vec4(uColor, a * vA * uOpacity);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
  });

  const beamDustCount = quality==='high'?80:0;
  {
    const seeds = new Float32Array(beamDustCount * 3);
    for (let i = 0; i < beamDustCount; i++) {
      seeds[i * 3] = rnd();
      seeds[i * 3 + 1] = 0.045 + rnd() * 0.09;
      seeds[i * 3 + 2] = rnd();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(seeds, 3));
    var beamDust = new THREE.Points(g, beamDustMat);
    beamDust.name = 'beam-dust';
    beamDust.frustumCulled = false;
    beamDust.renderOrder = 6;
    lampCone.add(beamDust); // inherits the cone transform
  }

  /* ================================================================ */
  /*  lights (10 total, including the room fill)                       */
  /* ================================================================ */

  const hemi = new THREE.HemisphereLight(0x96accc, 0x765443, 0.25);
  hemi.name='quiet-room-fill';
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xABC6E8, 0.049);
  sun.name='night-sky-fill';
  sun.position.set(-9.5, 3.7, 1.6);
  sun.target.position.set(1.4, 0.25, -0.35);
  sun.castShadow = false;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -7;
  sun.shadow.camera.right = 7;
  sun.shadow.camera.top = 7;
  sun.shadow.camera.bottom = -7;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 22;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.028;
  scene.add(sun);
  scene.add(sun.target);

  // Broad blue-hour pool from outside the glazing. Its soft falloff keeps
  // the far shelving in shadow without adding another shadow render.
  const windowLight=new THREE.SpotLight(0x7197c4,5.6,5.8,.64,.98,2);
  windowLight.name='window-twilight-light';
  windowLight.position.set(-4.69,2.37,WIN_CZ+.25);
  windowLight.target.position.set(-1.80,.26,.33);
  root.add(windowLight);root.add(windowLight.target);

  // reading spotlight (fades in during reading mode)
  const readingSpot = new THREE.SpotLight(0xfff3dc, 0, 2.6, 0.52, 0.75, 1.5);
  readingSpot.name='page-reading-light';
  readingSpot.position.set(0.15, 1.85, -1.65);
  readingSpot.target.position.copy(BOOK_TABLE.center);
  root.add(readingSpot);
  root.add(readingSpot.target);

  // gentle constant spot on the displayed book — the brightest thing in frame
  const displaySpot = new THREE.SpotLight(0xffe0b4, 2.55, 3.0, 0.34, 0.94, 1.5);
  displaySpot.name='book-display-light';
  displaySpot.position.set(.52, 1.69, TABLE.z+.95);
  displaySpot.target.position.copy(BOOK_TABLE.center);
  root.add(displaySpot);
  root.add(displaySpot.target);

  // three shelf washes (the recessed LED slits carry the rest)
  const shelfWashBack = new THREE.SpotLight(0xffd29a, 0.54, 5.0, 1.05, 1.0, 2);
  shelfWashBack.position.set(0, 2.45, -1.9);
  shelfWashBack.target.position.set(0, 1.75, -3.3);
  root.add(shelfWashBack);
  root.add(shelfWashBack.target);

  // the left case stands right next to the floor lamp: a touch warmer/brighter
  const shelfWashLeft = new THREE.SpotLight(0xffd29a, 0.38, 4.6, 1.0, 1.0, 2);
  shelfWashLeft.position.set(-2.7, 2.35, 0.55);
  shelfWashLeft.target.position.set(-4.0, 1.85, 0.55);
  root.add(shelfWashLeft);
  root.add(shelfWashLeft.target);

  // the far right case gets the least: it must sit back
  const shelfWashRight = new THREE.SpotLight(0xffd29a, 0.30, 4.2, 1.0, 1.0, 2);
  shelfWashRight.position.set(2.65, 2.35, -0.9);
  shelfWashRight.target.position.set(3.95, 1.9, -0.9);
  root.add(shelfWashRight);
  root.add(shelfWashRight.target);

  const shelfLights = [shelfWashBack, shelfWashLeft, shelfWashRight];

  /* ================================================================ */
  /*  ambient dust haze                                               */
  /* ================================================================ */

  const dustCount = quality==='high'?94:quality==='medium'?34:0;
  const dustPos = new Float32Array(dustCount * 3);
  const dustSeed = [];
  for (let i = 0; i < dustCount; i++) {
    dustPos[i * 3] = -2.65 + rnd() * 3.20;
    dustPos[i * 3 + 1] = .58 + rnd() * 1.92;
    dustPos[i * 3 + 2] = -1.11 + rnd() * 2.35;
    dustSeed.push({ speed: 0.006 + rnd() * 0.02, phase: rnd() * Math.PI * 2, amp: 0.06 + rnd() * 0.18 });
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dustMat = new THREE.PointsMaterial({
    map: textures.dust,
    size: .012,
    color: 0xFFE2B8,
    transparent: true,
    opacity: .079,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
    toneMapped: false,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.name = 'dust';
  dust.frustumCulled = false;
  root.add(dust);

  /* ================================================================ */
  /*  animation                                                        */
  /* ================================================================ */

  function update(t, dt, fireStrength = 1) {
    const time = reduceMotion?0:(t || 0);
    const d = reduceMotion?0:Math.min(Math.max(dt || 0.016, 0.001), 0.06);

    // shader clocks (no per-particle work on the CPU)
    coneMat.uniforms.uTime.value = time;
    beamDustMat.uniforms.uTime.value = time;
    steamMat.uniforms.uTime.value = time;

    const fireTime = t || 0;
    windowPane.uniforms.rainTime.value = reduceMotion ? 0 : fireTime;
    windowPane.uniforms.hearthGlow.value = Math.min(1,fireStrength);
    flame.material.uniforms.time.value = reduceMotion ? fireTime * .4 : fireTime;
    flame.material.uniforms.strength.value = fireStrength;
    const firePulse = (.032*Math.sin(1.6*fireTime) + .012*Math.sin(3.8*fireTime+.8)) * (reduceMotion ? .4 : 1);
    fireLight.intensity = 4.3 * fireStrength * (1 + firePulse);
    hearthSpill.intensity = 1.55 * fireStrength * (1 + firePulse);
    fireGlow.material.opacity = fireStrength * (.115 + .06*firePulse);

    // ambient dust drift
    const pos = dustGeo.attributes.position;
    for (let i = 0; i < dustCount; i++) {
      const sd = dustSeed[i];
      let y = pos.getY(i) + sd.speed * d * 0.8;
      if (y > 2.50) y = .58;
      pos.setY(i, y);
      pos.setX(i, pos.getX(i) + Math.sin(time * 0.35 + sd.phase) * sd.amp * d * 0.08);
      pos.setZ(i, pos.getZ(i) + Math.cos(time * 0.3 + sd.phase * 1.3) * sd.amp * d * 0.08);
    }
    pos.needsUpdate = true;

    // fairy lights: quieter than before, clearly below the reading table
    fairyGlow.material.opacity = 0.4 + Math.sin(time * 1.1) * 0.05 + Math.sin(time * 3.7) * 0.015;
  }

  /* ================================================================ */
  /*  dispose                                                          */
  /* ================================================================ */

  function dispose() {
    const geos = new Set();
    const mats = new Set();
    const texs = new Set();

    root.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      if (o.geometry) geos.add(o.geometry);
      const mm = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mm) mats.add(m);
    });

    for (const m of mats) {
      for (const key of ['map', 'normalMap', 'bumpMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap', 'aoMap']) {
        if (m[key] && m[key].dispose) texs.add(m[key]);
      }
      m.dispose();
    }
    for (const t of Object.values(textures)) {
      if (!t) continue;
      if (t.isTexture) texs.add(t);
      else if (t.texture && t.texture.isTexture) texs.add(t.texture);
      else if (Array.isArray(t)) for (const x of t) if (x && x.isTexture) texs.add(x);
    }
    for (const t of texs) t.dispose();
    for (const g of geos) g.dispose();

    for (const l of [
      hemi,
      sun,
      sun.target,
      windowLight,
      windowLight.target,
      fireLight,
      hearthSpill,
      hearthSpill.target,
      pendLight,
      pendLight.target,
      lampSpot,
      lampSpot.target,
      readingSpot,
      readingSpot.target,
      displaySpot,
      displaySpot.target,
      shelfWashBack,
      shelfWashLeft,
      shelfWashRight,
      shelfWashBack.target,
      shelfWashLeft.target,
      shelfWashRight.target,
    ]) {
      if (l.parent) l.parent.remove(l);
      if (l.dispose) l.dispose();
    }
    if (root.parent) root.parent.remove(root);
  }

  /* ================================================================ */
  /*  return                                                           */
  /* ================================================================ */

  for(const S of scopes)S.flush();

  return {
    root,
    sun,
    fireLight,
    readingSpot,
    displaySpot,
    update,
    BOOK_TABLE,
    READING_CAMERA,
    textures,

    // extra references added by the art-direction pass
    lampSpot,
    lampCone,
    beamDust,
    steam,
    dust,
    sofa: sofaScope.group,
    walkFurniture:[logBasket.group,fireTools.group,consoleScope.group,throwBasket.group,pouf.group],
    bookcases,
    table: tableScope.group,
    rug,
    windowGroup: winScope.group,
    shelfLights,
    materials: M,
    ceiling,
    floor,
    hemi,
    sky,
    windowPane,
    windowLight,
    armchair:chairScope.group,
    setReducedMotion(value){reduceMotion=!!value;dust.visible=!reduceMotion;beamDust.visible=quality==='high'&&!reduceMotion;steam.visible=!reduceMotion;},
    dispose,
  };
}
