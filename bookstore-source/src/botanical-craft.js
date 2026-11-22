import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const V=(x,y,z)=>new THREE.Vector3(x,y,z);
function random(seed){return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
function map(size,draw,linear=false){const c=document.createElement('canvas');c.width=c.height=size;draw(c.getContext('2d'),size);const t=new THREE.CanvasTexture(c);if(!linear)t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;return t;}
function mesh(root,g,m,p=[0,0,0]){const o=new THREE.Mesh(g,m);o.position.fromArray(p);o.castShadow=true;o.receiveShadow=true;root.add(o);return o;}
function tube(root,points,r,mat,segments=28){return mesh(root,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>Array.isArray(p)?V(...p):p)),segments,r,8,false),mat);}
function batch(root){
 const groups=new Map();for(const o of [...root.children]){if(!o.isMesh||o.isInstancedMesh||Array.isArray(o.material))continue;o.updateMatrix();const g=(o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone()).applyMatrix4(o.matrix);if(!groups.has(o.material))groups.set(o.material,[]);groups.get(o.material).push(g);root.remove(o);o.geometry.dispose();}
 for(const [mat,gs] of groups){const g=mergeGeometries(gs);gs.forEach(g=>g.dispose());mesh(root,g,mat);}
}

export function createBotanicalMaterials(){
 const rnd=random(61731);
 const clay=map(512,(x,s)=>{x.fillStyle='#756154';x.fillRect(0,0,s,s);for(let i=0;i<50000;i++){const c=rnd()>.5?230:40;x.fillStyle=`rgba(${c},${c*.8},${c*.65},${.015+rnd()*.08})`;x.fillRect(rnd()*s,rnd()*s,1,1);}for(let y=0;y<s;y+=3){x.fillStyle=`rgba(38,21,14,${rnd()*.035})`;x.fillRect(0,y,s,1);}});
 const leaf=map(512,(x,s)=>{
  x.fillStyle='#9cab77';x.fillRect(0,0,s,s);const g=x.createLinearGradient(0,0,s,0);g.addColorStop(0,'#6b8255');g.addColorStop(.48,'#a8b881');g.addColorStop(.5,'#bdc998');g.addColorStop(.52,'#a6b67d');g.addColorStop(1,'#6b8255');x.fillStyle=g;x.fillRect(0,0,s,s);
  x.lineWidth=1;x.strokeStyle='rgba(197,207,141,.34)';for(let y=30;y<s-20;y+=27){for(const side of [-1,1]){x.beginPath();x.moveTo(s/2,y);x.bezierCurveTo(s/2+side*50,y+14,s/2+side*140,y+50,s/2+side*235,y+74);x.stroke();}}
  for(let i=0;i<12000;i++){x.fillStyle=`rgba(20,46,15,${rnd()*.035})`;x.fillRect(rnd()*s,rnd()*s,1,1);}
 });
 const barkMap=map(256,(x,s)=>{x.fillStyle='#74654c';x.fillRect(0,0,s,s);for(let i=0;i<1500;i++){x.fillStyle=rnd()>.6?'#6c5b43':'#8b7e61';x.fillRect(rnd()*s,rnd()*s,.5+rnd()*2,2+rnd()*14);}});
 const mats={
  clay:new THREE.MeshStandardMaterial({map:clay,roughness:.94,bumpMap:clay,bumpScale:.0006}),
  ceramic:new THREE.MeshPhysicalMaterial({color:0x8a7e72,roughness:.82,clearcoat:.047,clearcoatRoughness:.38,bumpMap:clay,bumpScale:.00015}),
  soil:new THREE.MeshStandardMaterial({color:0x30271d,roughness:1}),
  bark:new THREE.MeshStandardMaterial({map:barkMap,roughness:.96,bumpMap:barkMap,bumpScale:.00025}),
  leaf:new THREE.MeshPhysicalMaterial({color:0x627559,map:leaf,roughness:.78,side:THREE.DoubleSide,clearcoat:.12,clearcoatRoughness:.62,vertexColors:true}),
  vein:new THREE.MeshStandardMaterial({color:0x586543,roughness:.82}),
  stem:new THREE.MeshStandardMaterial({color:0x50613a,roughness:.8}),
  grit:new THREE.MeshStandardMaterial({color:0x9b8b6d,roughness:1}),
 };
 return mats;
}
function leafGeometry(length,width,variation){
 const geo=new THREE.PlaneGeometry(2,1,12,24),p=geo.attributes.position,uv=geo.attributes.uv,colors=[];
 for(let i=0;i<p.count;i++){
  const t=uv.getY(i),u=p.getX(i),outline=Math.pow(Math.max(.0001,Math.sin(Math.PI*t)),.76)*(1-.26*t);
  const x=u*width*.5*outline*(1+.018*Math.sin(t*46+variation));
  const y=t*length;const z=length*(.09*Math.sin(t*Math.PI)*(1-u*u)-.16*t*t*t)+.003*Math.sin(t*16+variation)*u*u;
  p.setXYZ(i,x,y,z);
  const hue=new THREE.Color().setHSL(.24+variation*.075,.16+variation*.09,.68+variation*.26-.12*Math.abs(u)+.042*Math.sin(t*3));colors.push(hue.r,hue.g,hue.b);
 }
 geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geo.computeVertexNormals();return geo;
}

export function createBotanicalPlant({scale=1,seed=41,materials,small=false,variant=0}={}){
 const root=new THREE.Group();root.name='plant';root.scale.setScalar(scale);const rnd=random(seed),M=materials;
 const r=small?.060:.22,h=small?.09:.34;
 const profile=[[0,0],[r*.73,0],[r*.79,.009],[r*.82,h*.1],[r*.96,h*.88],[r,h*.94],[r,h],[r*.91,h],[r*.88,h*.94],[r*.81,.023],[0,.023]].map(([x,y])=>new THREE.Vector2(x,y));
 mesh(root,new THREE.LatheGeometry(profile,small?40:80),variant%2?M.ceramic:M.clay,[0,.015,0]);
 const saucer=[[0,0],[r*.93,0],[r*1.03,.007],[r*1.06,.021],[r*1.00,.027],[r*.98,.016],[0,.016]].map(([x,y])=>new THREE.Vector2(x,y));
 mesh(root,new THREE.LatheGeometry(saucer,64),variant%2?M.ceramic:M.clay);
 mesh(root,new THREE.CylinderGeometry(r*.88,r*.87,.012,48),M.soil,[0,h-.011,0]);
 // Potting mix: bark chips, stones and perlite embedded into the soil surface.
 const gritGeo=new THREE.IcosahedronGeometry(1,0);const dirt=new THREE.InstancedMesh(gritGeo,M.grit,small?45:180),o=new THREE.Object3D();
 for(let i=0;i<dirt.count;i++){const a=rnd()*Math.PI*2,rad=Math.sqrt(rnd())*r*.85,s=(small?.0011:.003)+rnd()*(small?.0015:.005);o.position.set(Math.cos(a)*rad,h-.004+rnd()*.003,Math.sin(a)*rad);o.rotation.set(rnd()*3,rnd()*3,rnd()*3);o.scale.set(s,s*.45,s*.7);o.updateMatrix();dirt.setMatrixAt(i,o.matrix);dirt.setColorAt(i,new THREE.Color().setHSL(.10,.12,.15+rnd()*.35));}dirt.castShadow=true;dirt.receiveShadow=true;root.add(dirt);
 const trunks=small?3:3,leafCount=small?4:12;
 for(let branch=0;branch<trunks;branch++){
  const a=branch*2.4+seed*.1,reach=small?.16:.76+branch*.13;
  const base=V(Math.cos(a)*r*.22,h-.010,Math.sin(a)*r*.22),tip=V(Math.cos(a)*(small?.018:.11),h+reach+.015,Math.sin(a)*(small?.018:.11));
  const curve=new THREE.CatmullRomCurve3([base,V(base.x*1.3,h+reach*.35+.015,base.z*1.3),V(tip.x*.9,h+reach*.75+.015,tip.z*.9),tip]);
  const trunkGeometry=new THREE.TubeGeometry(curve,28,small?.0017:.0065-branch*.0009,8,false),tp=trunkGeometry.attributes.position;
  for(let ring=0;ring<=28;ring++){const t=ring/28,center=curve.getPointAt(t);for(let k=0;k<=8;k++){const i=ring*9+k;tp.setXYZ(i,center.x+(tp.getX(i)-center.x)*(1-t*.68),center.y+(tp.getY(i)-center.y)*(1-t*.68),center.z+(tp.getZ(i)-center.z)*(1-t*.68));}}
  trunkGeometry.computeVertexNormals();mesh(root,trunkGeometry,small?M.stem:M.bark);
  for(let j=0;j<leafCount;j++){
   const t=.17+j/(leafCount-1)*.81,origin=curve.getPoint(t),angle=a+j*2.399+(rnd()-.5)*.35;
   const radial=V(Math.cos(angle),0,Math.sin(angle));const stemLen=small?.019:.045+rnd()*.035;
   const leafBase=origin.clone().addScaledVector(radial,stemLen).add(V(0,stemLen*.4,0));
   tube(root,[origin,origin.clone().lerp(leafBase,.5).add(V(0,stemLen*.12,0)),leafBase],small?.0007:.0013,M.stem,8);
   const len=(small?.065:.18)*(0.8+rnd()*.45)*(j===leafCount-1?.72:1),width=len*(small?.55:.49);
   const leaf=mesh(root,leafGeometry(len,width,rnd()),M.leaf);leaf.position.copy(leafBase);
   const direction=radial.clone().multiplyScalar(.85).add(V(0,.18+(t-.5)*.7,0)).normalize();
   leaf.quaternion.setFromUnitVectors(V(0,1,0),direction);leaf.rotateY((rnd()-.5)*.8);
   // Vein attached to the same curved midrib, never floating above the blade.
   const points=[];for(let k=0;k<=12;k++){const u=k/12;points.push(V(0,u*len,len*(.09*Math.sin(u*Math.PI)-.16*u*u*u)+.00025).applyQuaternion(leaf.quaternion).add(leafBase));}
   mesh(root,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),12,small?.00012:.00032,3,false),M.vein);
  }
 }
 root.userData.craft='curved botanical leaves, branching petioles, hollow pot and soil';batch(root);return root;
}

export function createBentwoodRack(M){
 const root=new THREE.Group();root.name='coat-rack';const wood=M.walnut.clone();wood.roughness=.48;
 const brass=M.brassDark;const shadow=new THREE.MeshStandardMaterial({color:0x291c12,roughness:.9});
 // Turned central spindle; curved legs have real contact pads and a broad stance.
 const profile=[[.025,.055],[.032,.12],[.030,.22],[.023,.35],[.021,1.50],[.028,1.61],[.023,1.76],[.028,1.88],[.020,1.94],[0,1.955]].map(([r,y])=>new THREE.Vector2(r,y));
 mesh(root,new THREE.LatheGeometry(profile,64),wood);
 for(let i=0;i<4;i++){
  const a=i*Math.PI/2+.35,point=(r,y)=>V(Math.cos(a)*r,y,Math.sin(a)*r);
  tube(root,[point(.025,.34),point(.055,.21),point(.15,.08),point(.265,.027)],.018,wood,36);
  const foot=mesh(root,new THREE.CylinderGeometry(.027,.029,.008,24),shadow,point(.265,.006).toArray());
 }
 for(const y of [.40,1.61,1.78])mesh(root,new THREE.TorusGeometry(y===.4?.024:.028,.002,8,64),brass,[0,y,0]).rotation.x=Math.PI/2;
 // Six steam-bent hooks, alternating lengths; knobs are part of each hooked end.
 for(let i=0;i<6;i++){
  const a=i*Math.PI/3,point=(r,y)=>V(Math.cos(a)*r,y,Math.sin(a)*r),y=i%2?1.73:1.83;
  tube(root,[point(.015,y-.17),point(.10,y-.04),point(.19,y+.035),point(.23,y+.03),point(.244,y-.025)],.0115,wood,40);
  mesh(root,new THREE.SphereGeometry(.018,20,16),wood,point(.244,y-.025).toArray());
 }
 const weave=map(512,(x,s)=>{x.fillStyle='#b2a086';x.fillRect(0,0,s,s);for(let i=0;i<s;i+=2){x.strokeStyle=i%4?'#ae9c83':'#b7a78d';x.beginPath();x.moveTo(i,0);x.lineTo(i,s);x.stroke();x.strokeStyle='rgba(61,44,25,.09)';x.beginPath();x.moveTo(0,i);x.lineTo(s,i);x.stroke();}});
 const textile=new THREE.MeshStandardMaterial({color:0xada087,map:weave,bumpMap:weave,bumpScale:.0003,roughness:.98,side:THREE.DoubleSide});
 // A continuous scarf goes up, over a front hook, then falls in two unequal ends.
 const scarfGeo=new THREE.PlaneGeometry(.17,1,22,100),p=scarfGeo.attributes.position,uv=scarfGeo.attributes.uv;
 const hemPts=[[],[]];
 for(let i=0;i<p.count;i++){
  const u=p.getX(i)/.085,t=uv.getY(i);let y,z;
  if(t<.43){const f=t/.43;y=.93+.77*f;z=-.246-.018*Math.sin(f*3.14);}
  else if(t<.55){const f=(t-.43)/.12,theta=Math.PI*f;y=1.70+.035*Math.sin(theta);z=-.211-.035*Math.cos(theta);}
  else{const f=(t-.55)/.45;y=1.70-.63*f;z=-.176+.025*f;}
  const folds=.009*Math.sin(u*8+t*4)+.003*Math.sin(u*17-t*8);p.setXYZ(i,.122+u*.085+(1.78-y)*.008,y,z+folds);
 }
 scarfGeo.computeVertexNormals();mesh(root,scarfGeo,textile);
 // Fringes follow the two actual ends, with uneven fibre bundles.
 const fringes=[];
 for(const end of [0,1])for(let n=0;n<30;n++){
  const u=-1+2*n/29,y=end?1.07:.93,z=end?-.151:-.246;
  const fold=.009*Math.sin(u*8+end*4)+.003*Math.sin(u*17-end*8);
  const curve=new THREE.CatmullRomCurve3([V(.122+u*.085,y,z+fold),V(.122+u*.085+.001,y-.018,z+fold+.002),V(.122+u*.085+.002*Math.sin(n),y-.035-.005*Math.sin(n*3),z+fold+.004)]);
  fringes.push(new THREE.TubeGeometry(curve,6,.00065,3,false));
 }
 const fringe=mergeGeometries(fringes);fringes.forEach(g=>g.dispose());mesh(root,fringe,textile);
 // Canvas tote: curved handle with both ends anchored to the bag's reinforced rim.
 const canvasMat=new THREE.MeshStandardMaterial({color:0xf0e6d0,map:weave,bumpMap:weave,bumpScale:.0002,roughness:.95,side:THREE.DoubleSide});
 // A sewn open shell instead of a solid rounded cuboid: front, back and folded gussets.
 const bagProfile=(x,t,side)=>side*(.034+.004*Math.sin(t*Math.PI))+.003*Math.sin(x*88+t*5)*Math.sin(t*Math.PI);
 for(const side of [-1,1]){
  const panel=new THREE.PlaneGeometry(.25,.30,24,32),pos=panel.attributes.position,uv=panel.attributes.uv;
  for(let i=0;i<pos.count;i++){const t=uv.getY(i),x=pos.getX(i)*(1-.08*t);pos.setXYZ(i,x,pos.getY(i),bagProfile(x,t,side));}
  panel.computeVertexNormals();mesh(root,panel,canvasMat,[-.14,1.21,-.15]);
 }
 for(const side of [-1,1]){
  const panel=new THREE.PlaneGeometry(.068,.30,12,28),pos=panel.attributes.position,uv=panel.attributes.uv;
  for(let i=0;i<pos.count;i++){const u=uv.getX(i)*2-1,t=uv.getY(i);pos.setXYZ(i,side*(.125*(1-.08*t)-.008*(1-u*u)*Math.sin(t*Math.PI)),pos.getY(i),u*(.034+.004*Math.sin(t*Math.PI)));}
  panel.computeVertexNormals();mesh(root,panel,canvasMat,[-.14,1.21,-.15]);
 }
 const bottom=mesh(root,new THREE.PlaneGeometry(.25,.068,8,4),canvasMat,[-.14,1.06,-.15]);bottom.rotation.x=Math.PI/2;
 const strapMat=canvasMat.clone();strapMat.color.set(0xc4b493);
 for(const z of [-.184,-.116]){
  const path=new THREE.CatmullRomCurve3([V(-.23,1.35,z),V(-.21,1.62,z-.025),V(-.122,1.835,-.211+(z+.15)*.2),V(-.07,1.64,z-.025),V(-.05,1.35,z)]);
  const g=new THREE.PlaneGeometry(1,1,2,64),pos=g.attributes.position,uv=g.attributes.uv;
  for(let i=0;i<pos.count;i++){const t=uv.getY(i),u=uv.getX(i)*2-1,c=path.getPoint(t),tangent=path.getTangent(t),across=V(-tangent.y,tangent.x,0).normalize();pos.setXYZ(i,c.x+across.x*u*.0065,c.y+across.y*u*.0065,c.z);}
  g.computeVertexNormals();mesh(root,g,strapMat);
 }
 for(const side of [-1,1]){
  const z=-.15+side*.035;
  tube(root,[[-.255,1.36,z],[-.256,1.20,z],[-.261,1.065,z],[-.02,1.065,z],[-.024,1.2,z],[-.025,1.36,z]],.0007,strapMat,64);
  tube(root,[[-.255,1.355,z],[-.14,1.355,z],[-.025,1.355,z]],.0011,strapMat,40);
 }
 mesh(root,new RoundedBoxGeometry(.10,.075,.001,2,.005),strapMat,[-.14,1.20,-.190]);
 // A wool coat on a free hook, with a weighted hem and two hanging sleeves.
 const coat = textile.clone();
 coat.color.set(0x665f53);
 const coatInside = textile.clone();
 coatInside.color.set(0x3e3b33);
 const coatFront = new THREE.PlaneGeometry(1,1,24,36);
 const coatPos = coatFront.attributes.position, coatUv = coatFront.attributes.uv;
 for(let i=0;i<coatPos.count;i++){
  const u=coatUv.getX(i)*2-1,t=1-coatUv.getY(i);
  const shoulder=THREE.MathUtils.smoothstep(t,0,.19);
  const width=.023+.16*shoulder+.049*t;
  const folds=(Math.sin(u*10+t*4)*.013+Math.sin(u*23-t*5)*.005)*shoulder;
  coatPos.setXYZ(i,.226+u*width+.07*t,
    1.844-t*.80-.017*shoulder*u+.017*t**6*Math.cos(u*8),
    .082+(.034+folds)*shoulder);
 }
 coatFront.computeVertexNormals();
 mesh(root,coatFront,coat);
 const reverse=coatFront.clone();
 reverse.translate(0,0,.011);
 mesh(root,reverse,coatInside);
 for(const side of [-1,1]){
  const sleeve=new THREE.CapsuleGeometry(.049,.49,6,22);
  const p=sleeve.attributes.position;
  for(let i=0;i<p.count;i++){
   const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
   const t=THREE.MathUtils.clamp((.294-y)/.588,0,1);
   const fold=1+.055*Math.sin(y*112+x*19);
   p.setXYZ(i,x*(1-.41*t)*fold+side*(.164+t*.048),y,
     z*(1-.48*t)*fold-.016*Math.sin(t*Math.PI));
  }
  sleeve.computeVertexNormals();
  mesh(root,sleeve,coat,[.267,1.394,.115]);
 }
 for(const y of [1.52,1.43,1.34,1.25,1.16]){
  mesh(root,new THREE.SphereGeometry(.0064,9,7),brass,[.265+(1.52-y)*.092,y,.089]);
 }
 root.userData.craft='turned walnut spindle, steam-bent hooks, draped scarf, wool coat and canvas tote';batch(root);return root;
}
