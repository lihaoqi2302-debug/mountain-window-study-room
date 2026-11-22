import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {canvasTexture, mulberry32} from './textures.js';
const V=(x,y,z)=>new THREE.Vector3(x,y,z);
// A front-panel welt follows the physical cross section of the rounded padding.
export function frontWelt(width,height,depth,radius,inset,thread){
  const corner=Math.sqrt(radius*radius-(radius-inset)**2);
  const x=width/2-radius,y=height/2-radius,z=depth/2-inset,points=[];
  for(const [cx,cy,start] of [[x,y,0],[-x,y,Math.PI/2],[-x,-y,Math.PI],[x,-y,Math.PI*1.5]]){
    for(let i=0;i<=12;i++){
      const angle=start+i*Math.PI/24;
      points.push(V(cx+corner*Math.cos(angle),cy+corner*Math.sin(angle),z));
    }
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points,true,'centripetal'),112,thread,5,true);
}

// Rings follow the cut fabric around the gusset, then close over the foam.
// The piping is picked from the same surface so it stays in the sewn groove.
export function stuffedCushion(width,height,depth,{pressure,shift,quality,loose=false}){
  const x=width/2,z=depth/2,corner=Math.min(x,z)*(loose?.43:.30);
  const outline=new THREE.Shape();
  outline.moveTo(-x+corner,-z);
  outline.lineTo(x-corner,-z);
  outline.quadraticCurveTo(x,-z,x,-z+corner);
  outline.lineTo(x,z-corner);
  outline.quadraticCurveTo(x,z,x-corner,z);
  outline.lineTo(-x+corner,z);
  outline.quadraticCurveTo(-x,z,-x,z-corner);
  outline.lineTo(-x,-z+corner);
  outline.quadraticCurveTo(-x,-z,-x+corner,-z);
  const segments=quality==='low'?36:quality==='medium'?48:72;
  const edge=outline.getSpacedPoints(segments).slice(0,-1);
  const profile=[
    [.34,-.48],[.69,-.49],[.89,-.44],[.968,-.30],[1,-.13],[.991,-.02],
    [1,.08],[.984,.25],[.945,.37],[.873,.45],[.73,.49],[.55,.50],[.35,.50],[.17,.50],
  ];
  const positions=[],uv=[],indices=[],seam=[];
  function surface(px,pz,level){
    const u=px/x,v=pz/z;
    const contact=Math.exp(-(((u-shift)/.56)**2+((v+.27)/.57)**2));
    const weight=THREE.MathUtils.smoothstep(level,-.08,.48);
    const foldEnvelope=Math.exp(-(((Math.abs(u)-.74)/.21)**2)) * Math.max(0,1-v*v);
    const fold=(Math.sin(16*v+u*7)+.4*Math.sin(24*v-u*7))*foldEnvelope*.0025;
    const taper=1-(loose?.065:.028)*(.45+.55*v*v);
    const ripple=.0028*Math.sin(v*13+shift*3)*Math.abs(u)**3;
    const sag=loose?.010*u*(1-v*v):0;
    return V(px*taper+ripple,height*level-pressure*contact*weight+fold*weight,pz+sag);
  }
  const add=p=>{
    const i=positions.length/3;
    positions.push(p.x,p.y,p.z);
    uv.push(.5+p.x/width+.10*p.z/depth,.5+p.z/depth+.25*p.y/height);
    return i;
  };
  profile.forEach(([scale,level],ring)=>{
    edge.forEach(point=>{
      const p=surface(point.x*scale,point.y*scale,level);
      add(p);
      if(ring===5)seam.push(p.clone().add(V(point.x/x*.0022,0,point.y/z*.0022)));
    });
    if(!ring)return;
    for(let i=0;i<segments;i++){
      const j=(i+1)%segments,a=(ring-1)*segments+i,b=(ring-1)*segments+j;
      indices.push(a,a+segments,b,b,a+segments,b+segments);
    }
  });
  const bottom=add(surface(0,0,-.48)),top=add(surface(0,0,.50));
  const last=segments*(profile.length-1);
  for(let i=0;i<segments;i++){
    const j=(i+1)%segments;
    indices.push(bottom,i,j,last+i,top,last+j);
  }
  const body=new THREE.BufferGeometry();
  body.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  body.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  body.setIndex(indices);
  body.computeVertexNormals();
  const welt=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(seam,true,'centripetal'),segments*2,.00165,5,true);
  return {body,welt};
}

// Reproject stock along its long axis before placement. On front-facing
// parts this keeps stiles vertical and rails horizontal with the same map.
export function woodGrain(geometry,vertical=false,length=1.5,crossWidth=.66,offset=0){
  const {position,normal,uv}=geometry.attributes;
  for(let i=0;i<position.count;i++){
    const along=vertical?position.getY(i):position.getX(i);
    const across=vertical
      ? Math.abs(normal.getX(i))>Math.abs(normal.getZ(i)) ? position.getZ(i) : position.getX(i)
      : Math.abs(normal.getY(i))>Math.abs(normal.getZ(i)) ? position.getZ(i) : position.getY(i);
    uv.setXY(i,.5+along/length+offset,.5+across/crossWidth);
  }
  return geometry;
}
export function addShadeDetail(S,M,rt,rb,h,cy,emissive=.16){
 const profile=[[rt,-h/2+h],[rt+.002,h/2],[rb+.002,-h/2],[rb,-h/2-.002],[rb-.0015,-h/2],[rt-.0015,h/2],[rt,h/2]].map(([r,y])=>new THREE.Vector2(r,y));
 const fabric=M.shadeWarm.clone();fabric.emissiveIntensity=emissive;fabric.roughness=.91;
 const linen=document.createElement('canvas');linen.width=linen.height=256;const ctx=linen.getContext('2d');ctx.fillStyle='#888';ctx.fillRect(0,0,256,256);
 for(let i=0;i<256;i+=2){ctx.fillStyle=i%4?'#858585':'#939393';ctx.fillRect(i,0,1,256);ctx.fillStyle='rgba(40,40,40,.08)';ctx.fillRect(0,i,256,1);}
 const linenMap=new THREE.CanvasTexture(linen);linenMap.wrapS=linenMap.wrapT=THREE.RepeatWrapping;linenMap.repeat.set(8,2);linenMap.anisotropy=8;fabric.bumpMap=linenMap;fabric.bumpScale=.00012;
 S.put(fabric,new THREE.LatheGeometry(profile,96),{p:[0,cy,0]});
 for(const [r,y]of [[rt,h/2],[rb,-h/2]])S.put(M.brassDark,new THREE.TorusGeometry(r,.0017,6,96),{p:[0,cy+y,0],r:[Math.PI/2,0,0]});
 for(let i=0;i<3;i++){
  const a=i*Math.PI*2/3;const points=[V(Math.cos(a)*rt,cy+h/2-.009,Math.sin(a)*rt),V(0,cy+h/2-.04,0),V(0,cy-.04,0)];
  S.put(M.brassDark,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),16,.0017,5,false));
 }
 const ribs=M.shadeWarm.clone();ribs.color.multiplyScalar(.83);ribs.emissiveIntensity=emissive*.92;
 for(let i=0;i<16;i++){
  const a=i*Math.PI/8,pts=[];
  for(let n=0;n<6;n++){const t=n/5,r=rt+(rb-rt)*t;pts.push(V(Math.cos(a)*r,cy+h/2-h*t,Math.sin(a)*r));}
  S.put(ribs,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),12,.0007,4,false));
 }
}
export function createWovenMat(){
 const group=new THREE.Group();group.name='doormat';
 const c=document.createElement('canvas');c.width=1024;c.height=640;const x=c.getContext('2d');x.fillStyle='#87775b';x.fillRect(0,0,1024,640);
 for(let y=0;y<640;y+=4)for(let u=0;u<1024;u+=6){x.fillStyle=(Math.floor(y/4)+Math.floor(u/6))%2?'#a28e6b':'#726348';x.fillRect(u,y,5,3);}
 x.strokeStyle='#3c352b';x.lineWidth=26;x.strokeRect(20,20,984,600);x.strokeStyle='#af9b77';x.lineWidth=2;x.strokeRect(41,41,942,558);
 const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=8;
 const m=new THREE.MeshStandardMaterial({map:tex,bumpMap:tex,bumpScale:.001,roughness:1});
 const mat=new THREE.Mesh(new RoundedBoxGeometry(.9,.013,.55,3,.006),new THREE.MeshStandardMaterial({color:0x4c4436,roughness:1}));mat.position.y=.012;mat.receiveShadow=true;group.add(mat);
 const face=new THREE.Mesh(new THREE.PlaneGeometry(.89,.54),m);face.rotation.x=-Math.PI/2;face.position.y=.019;face.receiveShadow=true;group.add(face);return group;
}
export function addJoineryDetails(root,M){
 const g=new THREE.Group();g.name='joinery-details';root.add(g);const buckets=new Map();
 const put=(geo,mat,p,r=[0,0,0])=>{geo.rotateX(r[0]);geo.rotateY(r[1]);geo.rotateZ(r[2]);geo.translate(...p);if(!buckets.has(mat))buckets.set(mat,[]);buckets.get(mat).push(geo.index?geo.toNonIndexed():geo.clone());geo.dispose();};
 // Door hinges and real escutcheon are on the room-facing side of the door.
 for(const y of [.28,1.14,1.98]){
  put(new THREE.CylinderGeometry(.009,.009,.082,24),M.brassDark,[-2.79,y,3.408]);
  for(const dx of [-.016,.016])put(new RoundedBoxGeometry(.025,.074,.003,2,.002),M.brassDark,[-2.79+dx,y,3.415]);
 }
 put(new RoundedBoxGeometry(.045,.14,.009,3,.007),M.brassDark,[-2.68,1.02,3.418]);
 put(new THREE.CylinderGeometry(.012,.012,.036,24),M.brass,[-2.68,1.03,3.39],[Math.PI/2,0,0]);
 put(new RoundedBoxGeometry(.10,.016,.018,3,.007),M.brass,[-2.64,1.03,3.37]);
 for(const [mat,geos]of buckets){const merged=mergeGeometries(geos);geos.forEach(g=>g.dispose());const o=new THREE.Mesh(merged,mat);o.castShadow=true;o.receiveShadow=true;g.add(o);}
 return g;
}

export function createPlankFloor(width,depth){
 const c=document.createElement('canvas');c.width=2048;c.height=256;const x=c.getContext('2d');let seed=81561;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 x.fillStyle='#73583d';x.fillRect(0,0,2048,256);
 for(let i=0;i<1600;i++){
  const y=rnd()*256,a=.5+rnd()*3,phase=rnd()*6;
  x.strokeStyle=rnd()>.52?`rgba(49,30,17,${.025+rnd()*.09})`:`rgba(220,185,125,${.02+rnd()*.055})`;x.lineWidth=.25+rnd()*.8;x.beginPath();
  for(let u=0;u<=2048;u+=12){const v=y+Math.sin(u*.003+phase)*a+Math.sin(u*.009+phase)*a*.35;if(u===0)x.moveTo(u,v);else x.lineTo(u,v);}x.stroke();
 }
 // Small elliptical knots, kept rare and quiet rather than a tiled wood photograph.
 for(const [cx,cy]of [[612,82],[1510,197]])for(let n=0;n<13;n++){x.strokeStyle=`rgba(54,33,18,${.10-n*.005})`;x.lineWidth=.7;x.beginPath();x.ellipse(cx,cy,7+n*5,1+n*.75,.015,0,Math.PI*2);x.stroke();}
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;t.wrapS=THREE.RepeatWrapping;
 const mat=new THREE.MeshStandardMaterial({map:t,bumpMap:t,bumpScale:.00022,roughness:.68,vertexColors:true,metalness:0});
 const geos=[],bw=.18,gap=.00085;
 for(let row=0;row<Math.ceil(depth/bw);row++){
  const z0=-depth/2+row*bw,z1=Math.min(depth/2,z0+bw);let start=-width/2;
  let first=true;
  while(start<width/2-.01){const length=Math.min(width/2-start,first?.45+(row%4)*.43:1.35+rnd()*.85);first=false;
   const g=new RoundedBoxGeometry(length-gap,.018,z1-z0-gap,2,.00065);g.translate(start+length/2,-.009,(z0+z1)/2);
   const uv=g.attributes.uv,p=g.attributes.position,normal=g.attributes.normal,colors=[];const tint=.83+rnd()*.25,offset=rnd()*.6;
   for(let i=0;i<p.count;i++){
    if(Math.abs(normal.getY(i))>.5)uv.setXY(i,(p.getX(i)-start)/2.1+offset,(p.getZ(i)-z0)/(z1-z0));
    const shade=normal.getY(i)>.5?tint:tint*.7;colors.push(shade,shade,shade);
   }
   g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geos.push(g);start+=length;
  }
 }
 const merged=mergeGeometries(geos);geos.forEach(g=>g.dispose());const floor=new THREE.Mesh(merged,mat);floor.name='floor';floor.receiveShadow=true;
 const ground=new THREE.Mesh(new THREE.PlaneGeometry(width,depth),new THREE.MeshStandardMaterial({color:0x2f251b,roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-.002;ground.receiveShadow=true;floor.add(ground);return floor;
}

export function addReadingTableDetails(scope, materials, top, quality) {
  const {put} = scope;
  const yaw = -.21;
  const angle = new THREE.Matrix4().makeRotationY(yaw);
  const notebook = V(-.145, top, -.157);
  const place = (material, geometry, x,y,z) => {
    geometry.translate(x,y,z).applyMatrix4(angle).translate(...notebook);
    put(material,geometry);
  };

  // A short open notebook and a soft page dip next to the stitched spine.
  place(materials.bookStackAlt,new RoundedBoxGeometry(.28,.008,.204,2,.003),0,.005,0);
  place(materials.paper,new RoundedBoxGeometry(.267,.008,.194,2,.0025),0,.012,0);
  const notes = canvasTexture(384,288,(ctx,w,h) => {
    ctx.fillStyle='#ddd3be';
    ctx.fillRect(0,0,w,h);
    const shade=ctx.createLinearGradient(w*.46,0,w*.54,0);
    shade.addColorStop(0,'#ddd3be');
    shade.addColorStop(.5,'#b7ab95');
    shade.addColorStop(1,'#ddd3be');
    ctx.fillStyle=shade;
    ctx.fillRect(w*.44,0,w*.12,h);
    const rnd=mulberry32(71);
    for (const x of [22,210]) {
      for (let y=38;y<h-24;y+=15) {
        ctx.fillStyle='rgba(104,102,94,.19)';
        ctx.fillRect(x,y,148,.7);
        if (x===210 && y>174) continue;
        const count=19+Math.floor(rnd()*22);
        ctx.fillStyle='rgba(91,89,82,.38)';
        let pen=x+3;
        for(let n=0;n<count && pen<x+140;n++){
          ctx.fillRect(pen,y-4-rnd()*2.6,1+rnd()*1.6,2.8+rnd()*1.8);
          pen+=2.4+rnd()*2.25+(n%5===0?2:0);
        }
      }
    }
  },{clamp:true});
  const ruledPaper=new THREE.MeshStandardMaterial({map:notes,roughness:.89});
  const spread=new THREE.PlaneGeometry(.265,.192,34,6);
  spread.rotateX(-Math.PI/2);
  const sheet=spread.attributes.position;
  for(let i=0;i<sheet.count;i++){
    const x=sheet.getX(i);
    const f=Math.abs(x)/.1325;
    const rise=Math.sin(Math.PI*f**.53)*(1-.45*f);
    sheet.setY(i,(x<0?.0070:.0082)*rise*(1-.17*Math.abs(sheet.getZ(i))/.096));
  }
  spread.computeVertexNormals();
  place(ruledPaper,spread,0,.017,0);

  if(quality==='low') return;

  // One temple is partly folded, with the frames just beyond the open pages.
  const glassX=.048, glassZ=-.305, glassY=top+.006;
  for(const dx of [-.034,.034]){
    put(materials.brassDark,new THREE.TorusGeometry(.026,.0018,5,25),
      {p:[glassX+dx,glassY,glassZ+dx*.21],r:[Math.PI/2,.21,0],s:[1,.84,1]});
  }
  put(materials.brassDark,new RoundedBoxGeometry(.018,.003,.003,2,.001),
    {p:[glassX,glassY,glassZ],r:[0,-.21,0]});
  for (const side of [-1,1]){
    const x=glassX+side*.058, z=glassZ+side*.012;
    const path=new THREE.CatmullRomCurve3([
      V(x,glassY,z),V(x+side*.003,glassY+.005,z-.018),
      V(x-side*(side===1?.043:.022),glassY+.002,z-.063)
    ]);
    put(materials.brassDark,new THREE.TubeGeometry(path,12,.0016,5,false));
  }
  const pen=new THREE.CylinderGeometry(.0041,.0038,.113,10);
  place(materials.iron,pen.rotateZ(Math.PI/2).rotateY(.33),-.045,.005,.131);
  const capRing=new THREE.CylinderGeometry(.00435,.00435,.005,10);
  place(materials.brass,capRing.rotateZ(Math.PI/2).rotateY(.33),-.078,.005,.142);
}

export function addMantelDetails(scope, materials, quality) {
  if(quality==='low') return;
  const {put}=scope;
  const rnd=mulberry32(82);
  for (const [y,z,scale,yaw] of [[1.965,.51,1.0,.3],[1.958,.595,.72,-.45]]) {
    const axis=new THREE.Vector3(Math.sin(yaw),0,Math.cos(yaw));
    const side=new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw));
    const origin=new THREE.Vector3(-.49,y,z);
    const position=new THREE.Vector3();
    for (let row=0;row<5;row++) {
      const radius=(.014+.014*Math.sin((row+.5)/5*Math.PI))*scale;
      for (let i=0;i<6;i++) {
        const a=(i+row*.42)*Math.PI/3;
        position.copy(origin).addScaledVector(axis,(row-2)*.014*scale);
        position.addScaledVector(side,Math.sin(a)*radius);
        position.y+=Math.cos(a)*radius*.78;
        const lobe=new THREE.IcosahedronGeometry((.009+rnd()*.003)*scale,1);
        put((row+i)%3?materials.walnut:materials.bookStackAlt,lobe,
          {p:position.toArray(),r:[a,0,yaw],s:[1,.55,1.48]});
      }
    }
  }
}
