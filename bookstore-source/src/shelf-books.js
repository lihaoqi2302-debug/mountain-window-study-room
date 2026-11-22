import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Display titles only; no downloaded typefaces, artwork or publisher trademarks.
export const BOOK_TITLES = [
  '瓦尔登湖','小王子','沉思录','人类群星闪耀时','看不见的城市','百年孤独','局外人','夜航',
  '草叶集','飞鸟集','园丁集','月亮与六便士','一间自己的房间','远大前程','傲慢与偏见','老人与海',
  '山海经','诗经','楚辞','庄子','论语','道德经','史记','世说新语',
  '浮生六记','陶庵梦忆','闲情偶寄','人间词话','朝花夕拾','野草','边城','湘行散记',
  '谈美','美学散步','艺术的故事','观看之道','建筑的永恒之道','空间的诗学','设计中的设计','阴翳礼赞',
  '中国建筑史','园冶','长物志','木工手记','版式的秩序','摄影的艺术','光与影','地图的历史',
  '时间简史','宇宙','物种起源','自然史','寂静的春天','植物的生活','森林笔记','岩石与河流',
  '数学之美','几何原本','什么是数学','微积分的力量','理论力学','材料力学','结构力学','弹性力学',
  '费曼物理学讲义','力学的历程','概率论沉思','统计与真相','逻辑的引擎','科学革命的结构','复杂','系统之美',
  '思考，快与慢','有限与无限的游戏','深度工作','原子习惯','心流','学会提问','禅与摩托车维修艺术','地球 Online',
  'WALDEN','THE LITTLE PRINCE','MEDITATIONS','A ROOM OF ONE’S OWN','INVISIBLE CITIES','THE ART OF SEEING','ON PHOTOGRAPHY','WAYS OF SEEING',
  'THE POETICS OF SPACE','A PATTERN LANGUAGE','THE STORY OF ART','THE NATURE OF ORDER','DEEP WORK','THINKING IN SYSTEMS','COSMOS','THE ORIGIN OF SPECIES',
  'A BRIEF HISTORY OF TIME','SILENT SPRING','LEAVES OF GRASS','THE OLD MAN AND THE SEA','FIELD NOTES','BOTANICAL STUDIES','LETTERS FROM HOME','THE NIGHT SKY',
  '山居札记','旅行速写','旧书与时光','咖啡与阅读','声音的记忆','四季物候','海边的房间','私人藏书目录',
];

// The twenty slots encode thirteen neutral, four cool, two warm and one foil.
const PALETTE = [
  ['#c8b99f','#4a4036'],['#a79780','#41382e'],['#7d6956','#e4d3b3'],
  ['#958672','#3f392f'],['#b8ac95','#504437'],['#675448','#d7c5a9'],
  ['#a69b86','#3f3930'],['#927d62','#4b4034'],['#d1c4ad','#534539'],
  ['#aa9682','#44382c'],['#6d5b4e','#d3c7b1'],['#bca789','#4a4237'],
  ['#8b7e6e','#e4d7bd'],
  ['#556354','#cfc9ad'],['#444746','#d9cdb8'],['#465864','#d2cabb'],['#384c5a','#c7bdab'],
  ['#854e40','#d6baa0'],['#9a774f','#3f3530'],['#50463b','#c4a16b'],
];
const colorSlot = index => ((index - 1) * 47 % 127) % PALETTE.length;

function random(seed) {
  return () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

function drawSpine(ctx, index) {
  const rnd = random(4242 + index * 163);
  const binding = Math.floor((index - 1) / 16) % 4;
  const slot = colorSlot(index);
  const [bg, fg] = PALETTE[slot];
  ctx.fillStyle=bg;ctx.fillRect(0,0,128,384);
  const side=ctx.createLinearGradient(0,0,128,0);
  side.addColorStop(0,'rgba(24,17,10,.28)');side.addColorStop(.15,'rgba(255,242,214,.065)');
  side.addColorStop(.55,'rgba(255,242,214,.015)');side.addColorStop(1,'rgba(24,17,10,.24)');
  ctx.fillStyle=side;ctx.fillRect(0,0,128,384);
  if(binding===0) { // Woven cloth, restrained foil and an embossed border.
    ctx.strokeStyle='rgba(235,222,194,.065)';ctx.lineWidth=.55;
    for(let x=3;x<128;x+=2.8){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,384);ctx.stroke();}
    for(let y=1;y<384;y+=3.2){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(128,y);ctx.stroke();}
  } else if(binding===2) { // Worn leather grain and shallow raised headbands.
    for(let i=0;i<500;i++){ctx.fillStyle=`rgba(19,13,8,${rnd()*.08})`;ctx.fillRect(rnd()*128,rnd()*384,1+rnd()*3,.7);}
    for(const y of [27,47,327,347]){ctx.fillStyle='rgba(0,0,0,.16)';ctx.fillRect(7,y,114,2);ctx.fillStyle='rgba(231,207,158,.12)';ctx.fillRect(7,y+2,114,1);}
  } else if(binding===3) { // Hand-labelled kraft binding, label stays inside the thinnest crop.
    for(let i=0;i<180;i++){ctx.fillStyle='rgba(60,42,24,.065)';ctx.fillRect(rnd()*128,rnd()*384,1+rnd()*4,.5);}
    ctx.fillStyle='#d2c4a5';ctx.fillRect(54,83,20,213);
    ctx.strokeStyle='rgba(66,48,29,.25)';ctx.lineWidth=.5;ctx.strokeRect(54,83,20,213);
  }
  if(binding!==3 || slot===19) {
    ctx.strokeStyle=slot===19?'rgba(202,175,119,.61)':'rgba(142,129,108,.24)';ctx.lineWidth=slot===19?1.25:.7;
    for(const y of [54,320]){ctx.beginPath();ctx.moveTo(55,y);ctx.lineTo(73,y);ctx.stroke();}
  }
  const title=BOOK_TITLES[(index-1)%BOOK_TITLES.length];
  ctx.fillStyle=fg;ctx.textAlign='center';ctx.textBaseline='middle';
  if(/^[\x00-\x7F’]+$/.test(title)) {
    ctx.save();ctx.translate(64,187);ctx.rotate(Math.PI/2);
    let size=binding===1?12:13;
    ctx.font=`${binding===0?600:400} ${size}px Georgia,serif`;
    const measured=ctx.measureText(title).width;
    if(measured>218){size*=218/measured;ctx.font=`400 ${size}px Georgia,serif`;}
    ctx.fillText(title,0,0);ctx.restore();
  } else {
    const chars=[...title];const size=Math.min(binding===3?14:17,220/chars.length);
    ctx.font=`${binding===0?500:400} ${size}px ${binding===3?'KaiTi':'SimSun'},serif`;
    chars.forEach((ch,i)=>ctx.fillText(ch,64,184+(i-(chars.length-1)/2)*(size+3)));
  }
  // Small abstract colophons, never an invented real publisher attribution.
  ctx.strokeStyle=fg;ctx.lineWidth=.7;ctx.globalAlpha=.6;
  if(index%3===0){ctx.beginPath();ctx.arc(64,339,3,0,Math.PI*2);ctx.stroke();}
  else{ctx.strokeRect(61,336,6,6);if(index%3===1){ctx.beginPath();ctx.moveTo(64,336);ctx.lineTo(64,342);ctx.stroke();}}
  ctx.font='7px Georgia,serif';ctx.fillText(String(1904+index%108),64,355);ctx.globalAlpha=1;
  // Faded head, thumb polish and tiny edge scuffs; broad mottling stays low contrast.
  const fade=ctx.createLinearGradient(0,0,0,384);fade.addColorStop(0,'rgba(230,216,185,.13)');fade.addColorStop(.3,'rgba(230,216,185,0)');fade.addColorStop(1,'rgba(20,14,7,.10)');
  ctx.fillStyle=fade;ctx.fillRect(0,0,128,384);
  for(let i=0;i<40;i++){ctx.fillStyle=`rgba(230,215,182,${.025+rnd()*.1})`;ctx.fillRect(rnd()<.5?rnd()*12:116+rnd()*12,rnd()*384,1+rnd()*4,.8);}
  // Wear follows the head and tail, within the crop used by slim volumes.
  for(const y of [5,374]){
    const wear=ctx.createLinearGradient(0,y,0,y+(y<20?22:-18));
    wear.addColorStop(0,'rgba(230,211,177,.22)');
    wear.addColorStop(1,'rgba(230,211,177,0)');
    ctx.fillStyle=wear;ctx.fillRect(43,y-18,42,40);
  }
}

export function spineAtlas({ quality='high' }={}) {
  const scale=quality==='low'?.25:quality==='medium'?.5:1;
  const cols=32,rows=4,cellW=128*scale,cellH=384*scale;
  const canvas=document.createElement('canvas');canvas.width=cols*cellW;canvas.height=rows*cellH;
  const ctx=canvas.getContext('2d');
  for(let i=0;i<cols*rows;i++){
    ctx.save();ctx.translate((i%cols)*cellW,Math.floor(i/cols)*cellH);ctx.scale(scale,scale);
    ctx.beginPath();ctx.rect(0,0,128,384);ctx.clip();
    if(i===0){
      ctx.fillStyle='#d2c7ae';ctx.fillRect(0,0,128,384);ctx.strokeStyle='rgba(85,66,40,.13)';ctx.lineWidth=.65;
      for(let y=0;y<384;y+=3){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(128,y);ctx.stroke();}
      const edge=ctx.createLinearGradient(0,0,128,0);edge.addColorStop(0,'rgba(131,93,49,.16)');edge.addColorStop(.25,'rgba(255,249,225,.04)');edge.addColorStop(1,'rgba(99,71,35,.11)');ctx.fillStyle=edge;ctx.fillRect(0,0,128,384);
    }else drawSpine(ctx,i);
    ctx.restore();
  }
  const toneGroups = [[],[],[],[]];
  for(let cell=1;cell<cols*rows;cell++){
    const slot=colorSlot(cell);
    toneGroups[slot<13?0:slot<17?1:slot<19?2:3].push(cell);
  }
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  texture.wrapS=texture.wrapT=THREE.ClampToEdgeWrapping;texture.anisotropy=quality==='high'?8:4;
  texture.name='procedural-library-spines';
  return {texture,cols,rows,cellW,cellH,cellCount:cols*rows,titleCount:BOOK_TITLES.length,toneGroups,quality};
}

export function spineUVRect(atlas, index, width, height) {
  const col=index%atlas.cols,row=Math.floor(index/atlas.cols);
  const pixelInset=2*(atlas.cellH/384);
  const usableH=atlas.cellH-2*pixelInset;
  // One physical millimetre samples the same texel span in both axes.
  const usableW=Math.min(atlas.cellW-2*pixelInset,usableH*width/height);
  const cx=(col+.5)*atlas.cellW;
  return [(cx-usableW/2)/(atlas.cols*atlas.cellW),1-((row+1)*atlas.cellH-pixelInset)/(atlas.rows*atlas.cellH),
    (cx+usableW/2)/(atlas.cols*atlas.cellW),1-(row*atlas.cellH+pixelInset)/(atlas.rows*atlas.cellH)];
}

export function prepareBookMaterial(material, atlas) {
  // InstancedMesh enables USE_INSTANCING_COLOR itself. USE_COLOR would also
  // multiply an absent per-vertex color attribute, blackening every volume.
  material.vertexColors=false;
  material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader
      .replace('#include <common>',`#include <common>
        attribute vec4 instanceSpineRect;
        attribute float bookFace;
        attribute vec4 spineNeighbours;
        attribute vec3 bindingFinish;
        varying vec4 vNeighbours;
        varying vec3 vBookFace;
        varying vec2 vBindingWear;`)
      .replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
        if (bookFace > .5 && bookFace < 1.5) objectNormal.x *= bindingFinish.x;`)
      .replace('#include <begin_vertex>',`#include <begin_vertex>
        transformed.z -= max(0.0, position.z - .443) * (1.0 - bindingFinish.x);`);
    const paper=spineUVRect(atlas,0,.03,.23);
    shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>',`#include <uv_vertex>
      vNeighbours = spineNeighbours;
      vBookFace = vec3(uv, bookFace);
      vBindingWear = bindingFinish.yz;
      vec2 spineUv = mix(instanceSpineRect.xy, instanceSpineRect.zw, uv);
      vec2 coverUv = mix(instanceSpineRect.xy, instanceSpineRect.zw, vec2(0.12, 0.99));
      vec2 paperUv = mix(vec2(${paper[0]},${paper[1]}),vec2(${paper[2]},${paper[3]}),uv);
      #ifdef USE_MAP
        vMapUv = bookFace > 1.5 ? coverUv : (bookFace > 0.5 ? spineUv : paperUv);
      #endif
      #ifdef USE_EMISSIVEMAP
        vEmissiveMapUv = bookFace > 1.5 ? coverUv : (bookFace > 0.5 ? spineUv : paperUv);
      #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vNeighbours;\nvarying vec3 vBookFace;\nvarying vec2 vBindingWear;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (vBookFace.z < .5) {
          diffuseColor.rgb *= mix(vec3(.97, .97, .95), vec3(.82, .74, .58), vBindingWear.x);
        } else if (vBookFace.z < 1.5) {
          vec2 spine = vBookFace.xy;
          float end = exp(-14.0 * min(spine.y, 1.0-spine.y));
          float rubbed = exp(-11.0 * abs(spine.x - .26 - .14 * vBindingWear.y))
                       * smoothstep(.06,.35,spine.y) * (1.0 - smoothstep(.66,.95,spine.y));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.45,.32,.22),
            (end * .12 + rubbed * .14) * vBindingWear.x);
        }`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        if (vBookFace.z > .5 && vBookFace.z < 1.5) {
          float left = (1.0 - smoothstep(0.0, .16, vBookFace.x)) * vNeighbours.x *
            (1.0 - smoothstep(vNeighbours.z, vNeighbours.z + .05, vBookFace.y));
          float right = smoothstep(.84, 1.0, vBookFace.x) * vNeighbours.y *
            (1.0 - smoothstep(vNeighbours.w, vNeighbours.w + .05, vBookFace.y));
          float hinge = smoothstep(0.32, 0.49, abs(vBookFace.x - .5));
          float foot = 1.0 - smoothstep(0.0, .085, vBookFace.y);
          float occlusion = 1.0 - .30 * max(left, right) - .13 * foot - .10 * hinge;
          reflectedLight.indirectDiffuse *= occlusion;
          reflectedLight.directDiffuse *= mix(1.0, occlusion, .43);
        } else if (vBookFace.z < .5) {
          float gutter = smoothstep(.26, .5, abs(vBookFace.x - .5));
          reflectedLight.indirectDiffuse *= 1.0 - .15 * gutter;
        }`)
      .replace('#include <opaque_fragment>', `
        // Matte bindings do not produce HDR lamp highlights on their edges.
        float shelfLuma = luminance(outgoingLight);
        float shelfExcess = max(0.0, shelfLuma - .82);
        float shelfWhite = .82 + shelfExcess / (1.0 + shelfExcess / .32);
        outgoingLight *= min(1.0, shelfWhite / max(shelfLuma, .001));
        #include <opaque_fragment>`);
  };
  material.customProgramCacheKey=()=>`shelf-instancing-v3-${atlas.quality}`;
}

// Each copy shares the same small binding mesh: a recessed text block, two
// boards and a gently rounded spine. All extents fit inside the old book box.
function bindingGeometry(quality) {
  const parts=[];
  const add=(geometry,face)=>{
    const g=geometry.toNonIndexed();
    geometry.dispose();
    g.setAttribute('bookFace',new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(face),1));
    parts.push(g);
  };
  const addBox=(geometry,face,exposed)=>{
    const indices=geometry.index.array;
    geometry.setIndex(geometry.groups.filter(group=>exposed.includes(group.materialIndex))
      .flatMap(group=>Array.from(indices.subarray(group.start,group.start+group.count))));
    geometry.clearGroups();
    add(geometry,face);
  };
  // No enclosed front paper face or inner board faces to redraw on each copy.
  addBox(new THREE.BoxGeometry(.86,.959,.922).translate(0,0,-.023),0,[2,3,5]);
  for(const side of [-1,1]){
    addBox(new THREE.BoxGeometry(.067,.988,.944).translate(side*.4665,0,-.028),2,[side<0?1:0,2,3,5]);
  }
  const segments=quality==='low'?2:quality==='medium'?3:4;
  const spine=new THREE.PlaneGeometry(1,1,segments);
  const pos=spine.attributes.position;
  for(let i=0;i<pos.count;i++){
    const x=pos.getX(i);
    pos.setZ(i,.443+.057*(1-4*x*x));
  }
  spine.computeVertexNormals();
  add(spine,1);
  // Slim folded headcaps close the shoulders where the paper is inset.
  for(const side of [-1,1]){
    const cap=new THREE.PlaneGeometry(1,1,segments);
    const p=cap.attributes.position;
    for(let i=0;i<p.count;i++){
      const x=p.getX(i);
      const z=p.getY(i)*side>0?.428:.443+.057*(1-4*x*x);
      p.setXYZ(i,x,side*.50,z);
    }
    cap.computeVertexNormals();
    add(cap,2);
  }
  const geometry=mergeGeometries(parts,false);
  parts.forEach(part=>part.dispose());
  return geometry;
}

export function createShelfBooks(volumes, material, atlas) {
  const geometry=bindingGeometry(atlas.quality);
  // Volumes arrive in shelf-row order. Record actual left/right contacts and
  // neighbour heights once, so a free edge or the top of a short book stays lit.
  const neighbours = new Float32Array(volumes.length * 4);
  for (let i = 1; i < volumes.length; i++) {
    const left = volumes[i - 1], right = volumes[i];
    const floorDelta = (left.p[1] - left.h / 2) - (right.p[1] - right.h / 2);
    const gap = right.p[0] - left.p[0] - (left.w + right.w) / 2;
    if (Math.abs(floorDelta) > .004 || gap < -.002 || gap > .018 ||
        Math.abs(left.r[2]) > .02 || Math.abs(right.r[2]) > .02) continue;
    const strength = 1 - THREE.MathUtils.smoothstep(gap, .002, .018);
    neighbours[(i - 1) * 4 + 1] = neighbours[i * 4] = strength;
    neighbours[(i - 1) * 4 + 3] = right.h / left.h;
    neighbours[i * 4 + 2] = left.h / right.h;
  }
  geometry.setAttribute('spineNeighbours', new THREE.InstancedBufferAttribute(neighbours, 4));
  const rects=new Float32Array(volumes.length*4);
  const finishes=new Float32Array(volumes.length*3);
  const mesh=new THREE.InstancedMesh(geometry,material,volumes.length);
  const object=new THREE.Object3D(),color=new THREE.Color();
  volumes.forEach((v,i)=>{
    rects.set(spineUVRect(atlas,v.cell,v.w,v.h),i*4);
    const edition=Math.floor((v.cell-1)/16)%4;
    const wear=((v.cell*73+i*29)%101)/100;
    const curve=[.90,.13,1,.42][edition] * (.81+wear*.19);
    finishes.set([curve,.16+.82*wear,((v.cell*27+i)%37)/36],i*3);
    object.position.fromArray(v.p);object.rotation.fromArray([...v.r,'XYZ']);object.scale.set(v.w,v.h,v.d);object.updateMatrix();
    mesh.setMatrixAt(i,object.matrix);
    const bg=PALETTE[colorSlot(v.cell)][0];
    const base=new THREE.Color(bg);
    color.copy(base).offsetHSL(v.hue/360,0,0);
    color.setRGB(color.r/base.r*v.value,color.g/base.g*v.value,color.b/base.b*v.value);
    mesh.setColorAt(i,color);
  });
  geometry.setAttribute('instanceSpineRect',new THREE.InstancedBufferAttribute(rects,4));
  geometry.setAttribute('bindingFinish',new THREE.InstancedBufferAttribute(finishes,3));
  mesh.name='books:instanced';mesh.castShadow=false;mesh.receiveShadow=true;
  mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
  mesh.computeBoundingSphere();
  return mesh;
}
