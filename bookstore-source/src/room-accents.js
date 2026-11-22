import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import { addShadeDetail, woodGrain } from './interior-craft.js';

const box = (width,height,depth,radius=.004) => new RoundedBoxGeometry(width,height,depth,2,radius);
const cylinder = (top,bottom,height,sides=24) => new THREE.CylinderGeometry(top,bottom,height,sides);
const torus = (radius,wire,sides=40) => new THREE.TorusGeometry(radius,wire,5,sides);
const v = (x,y,z) => new THREE.Vector3(x,y,z);

// Local contact shading baked into the upholstery vertices. A brighter panel
// stays readable while its edges and the pillow footprints pick up occlusion.
export function shadeSofaFabric(geometry, kind) {
  const pos=geometry.attributes.position;
  const color=new Float32Array(pos.count*3);
  const halo=(value,center,width)=>Math.exp(-(((value-center)/width)**2));
  geometry.computeBoundingBox();
  const {min,max}=geometry.boundingBox;
  for(let i=0;i<pos.count;i++){
    const x=pos.getX(i), y=pos.getY(i), z=pos.getZ(i);
    const arm=halo(Math.abs(x),.93,.107);
    let shade=.04;
    if(kind==='seat'){
      const crease=halo(x,0,.064) * halo(z,.06,.42);
      const back=halo(z,-.282,.128);
      const footprints=.085*halo(x,-.69,.21)*halo(z,-.065,.08)
        + .087*halo(x,.65,.19)*halo(z,-.06,.078)
        + .109*halo(x,.411,.175)*halo(z,.128,.087);
      const front=1-THREE.MathUtils.smoothstep(y,.267,.367);
      shade=.092*crease+.146*back+.082*arm+footprints+.106*front;
    } else if(kind==='back'){
      const bottom=1-THREE.MathUtils.smoothstep(y,.475,.633);
      const pillows=.064*halo(x,-.67,.229)*halo(y,.581,.17)
        + .073*halo(x,.64,.21)*halo(y,.579,.169);
      shade=.137*bottom+.081*arm+.057*halo(x,0,.068)+pillows;
    } else if(kind==='chair-seat'){
      shade=.16*halo(z,-.26,.135)+.085*halo(Math.abs(x),.38,.096)
        +.085*halo(x,.08,.18)*halo(z,-.14,.10);
    } else if(kind==='chair-back'){
      const t=(y-min.y)/(max.y-min.y);
      shade=.16*(1-THREE.MathUtils.smoothstep(t,.04,.49))+.048*halo(Math.abs(x),.40,.09);
    } else if(kind==='pillow'){
      const t=(y-min.y)/(max.y-min.y);
      shade=.18*(1-THREE.MathUtils.smoothstep(t,.025,.43));
    }
    const v=Math.max(.64,1-shade);
    color.set([v, v*.991+.009, v*.974+.026],i*3);
  }
  geometry.setAttribute('color',new THREE.BufferAttribute(color,3));
}

export function workLeather(geometry,width,height,depth,handled=false){
  const {position,normal}=geometry.attributes;
  const colors=new Float32Array(position.count*3);
  for(let i=0;i<position.count;i++){
    const u=position.getX(i)*2/width,v=position.getY(i)*2/height,t=position.getZ(i)*2/depth;
    const top=Math.max(0,normal.getY(i));
    const polish=handled?Math.exp(-((t-.24)**2*3.6+u*u*1.45))*top:0;
    const shoulder=Math.exp(-((v-.42)**2*11+(t-.50)**2*12));
    const folds=(.48+.52*Math.sin(t*26+u*3+v*5))**3*shoulder;
    const bite=handled?folds*.0018*Math.abs(normal.getX(i)):0;
    position.setXYZ(i,position.getX(i)-bite*normal.getX(i),
      position.getY(i)-bite*normal.getY(i),position.getZ(i)-bite*normal.getZ(i));
    const dark=.11*(1-THREE.MathUtils.smoothstep(v,-.82,.45))+.055*folds;
    colors.set([1-dark+.13*polish,1-dark+.095*polish,1-dark+.066*polish],i*3);
  }
  geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
  return geometry;
}

// The fold path runs over the left third. Test the laid sections against
// the built cushions once so the drape clears the dished seat and backrest.
export function placeSeatThrow(scope, fabric, quality, surfaces) {
  const path = new THREE.CatmullRomCurve3([
    v(-.527,.952,-.386),v(-.535,.997,-.307),v(-.506,.956,-.215),
    v(-.472,.820,-.137),v(-.442,.654,-.150),v(-.416,.509,-.130),
    v(-.373,.422,-.034),v(-.321,.418,.20),v(-.277,.417,.416),v(-.251,.304,.503),
  ],false,'centripetal');
  const mesh = new THREE.PlaneGeometry(1,1,quality==='low'?18:36,quality==='low'?36:90);
  const pos = mesh.attributes.position, uv = mesh.attributes.uv;
  const center = new THREE.Vector3(), tangent = new THREE.Vector3(), normal = new THREE.Vector3();
  const origin = new THREE.Vector3(), down=v(0,-1,0), towardBack=v(0,0,-1);
  const ray = new THREE.Raycaster();
  const hits=[];
  const shell=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
  const seat=surfaces.seat.map(geometry=>new THREE.Mesh(geometry,shell));
  const back=surfaces.back.map(geometry=>new THREE.Mesh(geometry,shell));
  const front=[...seat,new THREE.Mesh(surfaces.apron,shell)];
  const clearance = (p,parts,isSeat) => {
    const direction=isSeat?down:towardBack;
    origin.set(p.x,isSeat ? .75 : p.y,isSeat ? p.z : .65);
    ray.set(origin,direction);
    hits.length=0;
    ray.intersectObjects(parts,false,hits);
    if(!hits.length) return;
    if(isSeat) p.y=Math.max(p.y,hits[0].point.y+.0046);
    else p.z=Math.max(p.z,hits[0].point.z+.0046);
  };
  const point = (u,t) => {
    path.getPoint(t,center);
    path.getTangent(t,tangent);
    normal.set(0,tangent.z,-tangent.y).normalize();
    const gather=Math.exp(-(((t-.653)/.11)**2));
    const hem=THREE.MathUtils.smoothstep(t,.80,1);
    const width=.536+.083*gather-.156*hem+.031*Math.sin(t*11.3);
    const shoulder=THREE.MathUtils.smoothstep(t,.20,.38)*(1-THREE.MathUtils.smoothstep(t,.49,.65));
    const nudge=.188*shoulder*THREE.MathUtils.smoothstep(-u,-.03,.49);
    const edge=Math.abs(u)**2*.018*Math.sin(t*26+u*8);
    const folds=(.010*Math.sin(u*10+t*5)+.0075*Math.sin(u*20-t*9))*(.66+.61*hem);
    const bunch=gather*(.018+.017*Math.sin(t*87-u*9)**2+.019*Math.sin(u*15+t*41)**2);
    center.set(
      center.x + u*width + nudge + .046*shoulder + edge,
      center.y + u*(.028-.066*hem) + hem**4*.018*Math.sin(u*11+1.1),
      center.z - u*.137*(1-hem) + hem*.017*Math.sin(u*10-.8)
    ).addScaledVector(normal,folds+bunch);
    if(t<.32 && Math.abs(center.x)<.762) {
      const dy=center.y-.88,dz=center.z+.30;
      const radius=Math.hypot(dy,dz);
      if(radius>.001 && radius<.105) {
        center.y=.88+dy*.105/radius;
        center.z=-.30+dz*.105/radius;
      }
    }
    if(t>.13 && t<.71) clearance(center,back,false);
    if(t>.53 && t<.98 && center.y>=.398) clearance(center,seat,true);
    if(t>.82 && center.z>.38 && center.y<.421) clearance(center,front,false);
    return center;
  };
  const shades=new Float32Array(pos.count*3);
  for(let i=0;i<pos.count;i++){
    const u=uv.getX(i)-.5,t=1-uv.getY(i);
    const p=point(u,t);
    pos.setXYZ(i,p.x,p.y,p.z);
    const crease=Math.exp(-(((t-.64)/.079)**2))*(.09+.09*Math.sin(t*73-u*11)**2);
    const tone=.97-crease-.037*Math.abs(u);
    shades.set([tone,tone,tone],i*3);
  }
  mesh.computeVertexNormals();
  mesh.setAttribute('color',new THREE.BufferAttribute(shades,3));
  scope.put(fabric,mesh);
  for(let i=0;i<36;i++) {
    const u=(i+.18*Math.sin(i*1.83))/35-.5;
    const p=point(u,1).clone();
    const len=.017+.013*(.5+.5*Math.sin(i*1.79));
    const wave=Math.sin(i*2.36)*.008;
    const strand=new THREE.CatmullRomCurve3([
      p,p.clone().add(v(wave*.46,-len*.51,.003)),
      p.clone().add(v(wave,-len,.003+.003*Math.cos(i))),
    ]);
    const yarn=new THREE.TubeGeometry(strand,4,.00116,4,false);
    const tint=new Float32Array(yarn.attributes.position.count*3).fill(i%6 ? .83 : 1);
    yarn.setAttribute('color',new THREE.BufferAttribute(tint,3));
    scope.put(fabric,yarn);
  }
  shell.dispose();
}

function sculptedVase(scope, material, x,y,z, height, width) {
  const profile = [[0,0],[.66,0],[.88,.055],[1,.36],[.93,.65],[.48,.83],
    [.39,.95],[.42,1],[.30,1],[.27,.91],[.67,.64],[.70,.22],[0,.12]]
    .map(([r,h]) => new THREE.Vector2(r*width,h*height));
  scope.put(material,new THREE.LatheGeometry(profile,32),{p:[x,y,z]});
}

export function buildEntryConsole(scope, lamp, materials, stackBooks, glowTexture) {
  const { put } = scope, W=2.68, D=.35, surface=.735;
  put(materials.walnutTop,woodGrain(box(W,.047,D,.012),false,1.86,.40),{p:[0,surface-.0235,0]});
  for(const z of [-.119,.119]){
    put(materials.walnut,woodGrain(box(2.39,.070,.033,.005)),{p:[0,.652,z]});
    put(materials.shelf,woodGrain(box(2.35,.012,.018,.003)),{p:[0,.622,z+Math.sign(z)*.014]});
  }
  for(const x of [-1.20,1.20]){
    put(materials.walnut,woodGrain(box(.050,.070,.234,.005)),{p:[x,.652,0]});
    put(materials.walnut,box(.034,.054,.026,.004),{p:[x,.217,0]});
  }
  for (const x of [-1.20,1.20]) for(const z of [-.119,.119]){
    put(materials.walnut,woodGrain(box(.063,.673,.059,.008),true,.83,.34,x+z),{p:[x,.3365,z]});
    put(materials.shelf,box(.014,.013,.003,.0011),{p:[x,.652,z+Math.sign(z)*.03]});
  }
  put(materials.walnut,woodGrain(box(W-.22,.035,D-.05,.008)),{p:[0,.198,0]});
  stackBooks(put,-.74,surface,.005);
  put(materials.brass, cylinder(.035,.046,.012),{p:[-.76,surface+.153,.008]});
  put(materials.brass,new THREE.SphereGeometry(.037,14,9),{p:[-.76,surface+.194,.008],s:[1,.78,1]});
  sculptedVase(lamp,materials.stoneware,0,0,0,.185,.082);
  lamp.put(materials.brass,cylinder(.012,.012,.071),{p:[0,.211,0]});
  addShadeDetail(lamp,materials,.064,.135,.130,.30,.22);
  const wash = new THREE.MeshBasicMaterial({
    map:glowTexture,color:0xffb57e,transparent:true,opacity:.19,depthWrite:false,
    blending:THREE.AdditiveBlending,
  });
  const wallPool = new THREE.Mesh(new THREE.PlaneGeometry(.76,.65),wash);
  wallPool.position.set(0,.264,.251);
  wallPool.rotation.y=Math.PI;
  lamp.group.add(wallPool);
  const light=new THREE.SpotLight(0xffc48f,.065,.64,.66,.9,2);
  light.position.set(0,.244,.01);
  light.target.position.set(0,.03,-.05);
  lamp.group.add(light,light.target);
  lamp.flush();
}

export function addFramedPrint(scope, materials, art, width, height, center) {
  const {put}=scope, [x,y,z]=center;
  put(materials.walnut,box(width,height,.046,.009),{p:[x,y,z]});
  put(materials.matboard,box(width-.065,height-.065,.006),{p:[x,y,z+.024]});
  const ratio=art.map.image.width/art.map.image.height;
  const imageWidth=Math.min(width-.13,(height-.13)*ratio);
  const imageHeight=imageWidth/ratio;
  put(art,new THREE.PlaneGeometry(imageWidth,imageHeight),{p:[x,y,z+.029]});
  for (const sign of [-1,1]) {
    put(materials.frameBrass,box(imageWidth+.009,.003,.0014,.0005),{p:[x,y+sign*(imageHeight/2+.004),z+.028]});
    put(materials.frameBrass,box(.003,imageHeight+.008,.0014,.0005),{p:[x+sign*(imageWidth/2+.004),y,z+.028]});
  }
}

export function addMantelArrangement(scope, materials) {
  const {put}=scope;
  const top=1.945;
  for(const [z,x,r,h] of [[-.76,-.30,.043,.228],[-.60,-.37,.036,.145],[-.47,-.23,.028,.173]]) {
    put(materials.candle,cylinder(r*.94,r,h,18),{p:[x,top+h/2,z]});
    put(materials.wick,cylinder(.0018,.0018,.014,6),{p:[x,top+h+.006,z]});
  }
  put(materials.brass,cylinder(.040,.049,.016),{p:[-.46,top+.008,-.51]});
  put(materials.brass,cylinder(.017,.022,.054),{p:[-.46,top+.038,-.51]});
  put(materials.brass,cylinder(.033,.020,.012),{p:[-.46,top+.066,-.51]});
  sculptedVase(scope,materials.stoneware,-.34,top,.76,.190,.0725);
  for(const [dx,dz,dy] of [[-.025,.123,.36],[-.077,-.027,.317],[-.02,-.125,.28]]) {
    const start=v(-.34,top+.150,.76), end=v(start.x+dx,top+dy,start.z+dz);
    const branch=new THREE.CatmullRomCurve3([
      start,start.clone().lerp(end,.48).add(v(.012,.012,-dz*.27)),end,
    ]);
    put(materials.wicker,new THREE.TubeGeometry(branch,12,.0017,5,false));
    for(let i=1;i<=4;i++){
      const p=branch.getPoint(.37+i*.13);
      const side=i%2 ? 1 : -1;
      put(materials.driedLeaves,new THREE.SphereGeometry(1,9,6),{
        p:[p.x+.013*side,p.y,p.z+.011*side],s:[.027,.008,.0045],r:[.8,side*.60,side*.46]});
    }
  }
}

export function addHearthTools(scope, materials) {
  const {put}=scope, iron=materials.iron, brass=materials.frameBrass;
  put(iron,cylinder(.115,.125,.026),{p:[0,.013,0]});
  put(iron,cylinder(.009,.012,.59),{p:[0,.313,0]});
  put(brass,new THREE.SphereGeometry(.018,12,8),{p:[0,.616,0]});
  put(iron,torus(.077,.0045),{p:[0,.558,0],r:[Math.PI/2,0,0]});
  for (const [i,angle] of [-.3,1.78,3.9].entries()){
    const x=Math.cos(angle)*.077,z=Math.sin(angle)*.077;
    put(iron,cylinder(.0045,.005,.425,8),{p:[x,.285,z]});
      put(brass,cylinder(.0095,.0075,.079,14),{p:[x,.506,z]});
    for(const y of [.473,.531,.542]){
      put(brass,cylinder(.0102,.0102,.0035,14),{p:[x,y,z]});
    }
    put(iron,torus(.012,.002,16),{p:[x,.548,z],r:[0,-angle,0]});
    if(i===0)put(iron,box(.071,.010,.069),{p:[x,.073,z],r:[.29,angle,0]});
    if(i===1)put(iron,new THREE.TorusGeometry(.018,.004,5,18,Math.PI),{p:[x,.088,z]});
    if(i===2)put(iron,box(.080,.034,.025),{p:[x,.088,z],r:[0,angle,0]});
  }
}

export function buildWickerBasket(scope, materials, radius, height, holdsThrow=false) {
  const {put}=scope, wicker=materials.wicker;
  const foot=radius*.80;
  put(wicker,cylinder(radius*.87,foot,.026,36),{p:[0,.014,0]});
  put(wicker,torus(radius,.010),{p:[0,height,0],r:[Math.PI/2,0,0]});
  const courses = holdsThrow ? 12 : 19;
  for(let j=0;j<courses;j++){
    const row=j/(courses-1), r=foot+(radius-foot)*row;
    const points=Array.from({length:73},(_,i)=>{
      const a=i/72*2*Math.PI, wave=.0029*Math.sin(a*24+Math.PI*(j%2));
      return v(Math.cos(a)*(r+wave),.018+row*(height-.019)+wave*.46,Math.sin(a)*(r+wave));
    });
    put(j%3? wicker : materials.wickerEdge,new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(points.slice(0,-1),true),72,.0041,5,true));
  }
  for(let i=0;i<24;i++){
    const a=i*Math.PI/12, x=Math.cos(a),z=Math.sin(a);
    const stake=new THREE.LineCurve3(v(x*foot,.018,z*foot),v(x*radius,height,z*radius));
    put(materials.wickerEdge,new THREE.TubeGeometry(stake,1,.003,5,false));
  }
  if(!holdsThrow) {
    for(const side of [-1,1]){
      const handle = new THREE.CatmullRomCurve3([
        v(-radius*.31,height-.035,side*radius*.91),
        v(-radius*.21,height+.039,side*radius*.99),
        v(radius*.22,height+.039,side*radius*.99),
        v(radius*.31,height-.035,side*radius*.91),
      ]);
      put(materials.wickerEdge,new THREE.TubeGeometry(handle,20,.007,6,false));
    }
  }
  if(holdsThrow) {
    put(materials.woolThrow,box(radius*1.28,.103,radius*1.21,.04),{p:[-.011,height-.041,0],r:[.13,0,-.07]});
    put(materials.sofaWelting,box(radius*1.2,.069,radius*.56,.028),{p:[.004,height+.026,-.041],r:[.06,.20,-.12]});
  }
}
