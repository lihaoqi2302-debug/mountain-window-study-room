import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BOOK_TITLES } from './shelf-books.js';

// Full bindings only for the five experimental volumes. Dimensions remain metres.
export function createBoundVolume(v,index){
 const root=new THREE.Group();root.name=`sample-volume-${index}`;
 root.position.fromArray(v.p);root.rotation.fromArray([...v.r,'XYZ']);
 const title=BOOK_TITLES[(v.cell-1)%BOOK_TITLES.length];
 Object.assign(root.userData,{interaction:`shelf-volume-${index}`,title,binding:'rounded-back sewn cloth',detailRevision:2});
 const color=['#46574b','#794f3c','#3f4f61','#a28c67','#635064'][index%5];
 let seed=1427+index*71;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const canvas=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return [c,c.getContext('2d')];};
 const tex=(c,color=false)=>{const t=new THREE.CanvasTexture(c);if(color)t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;return t;};
 // A separate height field keeps printed letters from becoming oversized bumps.
 const [weave,wc]=canvas(256,256);wc.fillStyle='#888';wc.fillRect(0,0,256,256);
 for(let y=0;y<256;y+=2){wc.fillStyle=y%4?'#989898':'#737373';wc.fillRect(0,y,256,1);}
 for(let x=0;x<256;x+=3){wc.fillStyle='rgba(30,30,30,.14)';wc.fillRect(x,0,1,256);}
 for(let n=0;n<3600;n++){wc.fillStyle=`rgba(255,255,255,${rnd()*.12})`;wc.fillRect(rnd()*256,rnd()*256,1,1);}
 const weaveMap=tex(weave);weaveMap.wrapS=weaveMap.wrapT=THREE.RepeatWrapping;weaveMap.repeat.set(4,6);
 const cloth=new THREE.MeshStandardMaterial({color,roughness:.88,bumpMap:weaveMap,bumpScale:.000065});
 const darkCloth=cloth.clone();darkCloth.color.multiplyScalar(.68);
 function print(kind){
  const [c,x]=canvas(kind==='spine'?192:640,1024);const [mask,m]=canvas(c.width,c.height);
  x.fillStyle=color;x.fillRect(0,0,c.width,c.height);m.fillStyle='#000';m.fillRect(0,0,c.width,c.height);
  const draw=(ctx,foil)=>{
   ctx.fillStyle=foil;ctx.strokeStyle=foil;ctx.textAlign='center';ctx.textBaseline='middle';
   if(kind==='back'){
    ctx.lineWidth=1;ctx.strokeRect(38,48,c.width-76,928);ctx.font='22px SimSun,serif';
    for(const [i,line] of ['藏书札记','留一点时间，给阅读。','PRIVATE LIBRARY'].entries()){ctx.font=i===2?'13px Georgia':'22px SimSun,serif';ctx.fillText(line,c.width/2,600+i*60);}
    ctx.beginPath();ctx.arc(c.width/2,310,32,0,Math.PI*2);ctx.stroke();return;
   }
   const spine=kind==='spine';ctx.lineWidth=spine?1.2:1.8;
   if(spine){for(const y of [105,122,830,847]){ctx.beginPath();ctx.moveTo(27,y);ctx.lineTo(c.width-27,y);ctx.stroke();}}
   else {ctx.strokeRect(32,40,c.width-64,944);ctx.globalAlpha=.45;ctx.strokeRect(40,48,c.width-80,928);ctx.globalAlpha=1;}
   const chars=[...title];const size=Math.min(spine?38:58,500/chars.length);
   ctx.font=`${size}px SimSun,serif`;chars.forEach((ch,i)=>ctx.fillText(ch,c.width/2,445+(i-(chars.length-1)/2)*(size+16)));
   ctx.font=`${spine?15:17}px Georgia`;ctx.fillText('PRIVATE LIBRARY',c.width/2,spine?902:878);
   if(!spine){ctx.beginPath();ctx.moveTo(c.width/2-25,780);ctx.lineTo(c.width/2+25,780);ctx.stroke();}
  };
  draw(x,index===3?'#493b28':'#d3bc86');draw(m,index===3?'#555':'#ddd');
  // Restrained wear at the edges; avoid an evenly repeated distressed pattern.
  for(let i=0;i<190;i++){x.fillStyle=`rgba(223,208,174,${.035+rnd()*.08})`;x.fillRect(rnd()<.5?rnd()*9:c.width-rnd()*9,rnd()*1024,1+rnd()*2,1+rnd()*4);}
  const [rough,rc]=canvas(c.width,c.height);rc.fillStyle='#e8e8e8';rc.fillRect(0,0,c.width,c.height);draw(rc,'#999');
  const map=tex(c,true),metal=tex(mask),roughnessMap=tex(rough);
  return new THREE.MeshStandardMaterial({map,roughness:.91,roughnessMap,bumpMap:weaveMap,bumpScale:.000065,metalness:.42,metalnessMap:metal});
 }
 const front=print('front'),back=print('back'),spineMat=print('spine');
 function paperTexture(top=false){
  const [c,x]=canvas(768,512);x.fillStyle='#e1d6bf';x.fillRect(0,0,768,512);
  // Page boundaries run across the book thickness, not down its height.
  for(let u=0;u<768;u+=2+rnd()*2){const tone=125+Math.floor(rnd()*45);x.fillStyle=`rgba(${tone},${tone-14},${tone-35},${.12+rnd()*.18})`;x.fillRect(u,0,.45+rnd()*.65,512);}
  const shade=x.createLinearGradient(0,0,0,512);shade.addColorStop(0,'rgba(91,62,29,.15)');shade.addColorStop(.18,'rgba(255,252,231,.025)');shade.addColorStop(1,top?'rgba(127,91,43,.10)':'rgba(117,79,35,.07)');x.fillStyle=shade;x.fillRect(0,0,768,512);
  for(let i=0;i<1200;i++){x.fillStyle='rgba(82,58,28,.035)';x.fillRect(rnd()*768,rnd()*512,.6,.6);}
  return tex(c,true);
 }
 const cutMap=paperTexture(),topMap=paperTexture(true);
 const cut=new THREE.MeshStandardMaterial({map:cutMap,roughness:.98,bumpMap:cutMap,bumpScale:.000035});
 const topPaper=new THREE.MeshStandardMaterial({map:topMap,roughness:.98,bumpMap:topMap,bumpScale:.000035});
 const endpaper=new THREE.MeshStandardMaterial({color:0xc9b895,roughness:.98});
 function mesh(geo,mat,p=[0,0,0],r=[0,0,0],name=''){const m=new THREE.Mesh(geo,mat);m.position.fromArray(p);m.rotation.fromArray([...r,'XYZ']);m.castShadow=true;m.receiveShadow=true;m.name=name;root.add(m);return m;}
 const box=(w,h,d,rad=.0006)=>new RoundedBoxGeometry(w,h,d,3,Math.min(rad,w/3,h/3,d/3));
 const board=.00165,pw=v.w-2*board-.001,ph=v.h-.0055,pd=v.d-.010;
 // Slightly concave fore-edge; bevel the corners of the whole page block.
 const block=box(pw,ph,pd,.00065);const pos=block.attributes.position;
 for(let i=0;i<pos.count;i++)if(pos.getZ(i)<-pd*.40){const t=pos.getX(i)/(pw/2);pos.setZ(i,pos.getZ(i)+.0013*(1-t*t));}
 block.computeVertexNormals();
 mesh(block,[endpaper,endpaper,topPaper,topPaper,cut,cut],[0,0,-.0008],[0,0,0],'sewn-page-block');
 for(const side of [-1,1]){
  mesh(box(board,v.h,v.d,.00065),cloth,[side*(v.w-board)/2,0,0],[0,0,0],'rounded-cover-board');
  mesh(new THREE.PlaneGeometry(v.d-.0035,v.h-.0035),side===1?front:back,[side*(v.w/2+.000035),0,0],[0,side*Math.PI/2,0],'printed-cloth-cover');
  mesh(box(.00045,ph+.001,pd+.001,.00012),endpaper,[side*(pw/2+.0002),0,-.0008],[0,0,0],'pasted-endpaper');
  // Narrow hinge trough at the shoulder, physically recessed beside the spine.
  mesh(box(.0005,v.h-.004,.0015,.0002),darkCloth,[side*(v.w/2+.00003),0,v.d/2-.009],[0,0,0],'hinge-groove');
 }
 // Convex spine with continuous UVs; it stays inside the original shelf footprint.
 const spineGeo=new THREE.PlaneGeometry(v.w,v.h,24,8);const sp=spineGeo.attributes.position;
 for(let i=0;i<sp.count;i++){const t=sp.getX(i)/(v.w/2);sp.setZ(i,v.d/2-.0026+.0026*Math.sqrt(Math.max(0,1-t*t)));}
 spineGeo.computeVertexNormals();mesh(spineGeo,spineMat,[0,0,0],[0,0,0],'rounded-spine');
 // Turned-in cloth closes both spine ends, avoiding an open single-surface shell.
 for(const side of [-1,1]){
  const points=[];
  for(let n=0;n<24;n++){
   const a=-1+n/12,b=-1+(n+1)/12;
   const x0=a*v.w/2,x1=b*v.w/2;
   const z0=v.d/2-.0026+.0026*Math.sqrt(Math.max(0,1-a*a));
   const z1=v.d/2-.0026+.0026*Math.sqrt(Math.max(0,1-b*b));
   const y=side*(v.h/2-.0001),inner=v.d/2-.0032;
   points.push(x0,y,inner,x1,y,inner,x1,y,z1,x0,y,inner,x1,y,z1,x0,y,z0);
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(points,3));geo.computeVertexNormals();
  const mat=cloth.clone();mat.side=THREE.DoubleSide;mesh(geo,mat,[0,0,0],[0,0,0],'cloth-spine-turn-in');
 }

 // Sewn headbands: individual thread turns, merged to two draw calls.
 const threads=[[],[]];
 for(const side of [-1,1])for(let n=0;n<28;n++){
  const x=-pw/2+.001+(pw-.002)*(n+.5)/28;
  const path=new THREE.CatmullRomCurve3([new THREE.Vector3(x,side*(ph/2-.001),v.d/2-.0075),new THREE.Vector3(x,side*(ph/2+.0005),v.d/2-.0057),new THREE.Vector3(x,side*(ph/2-.001),v.d/2-.0045)]);
  threads[n%2].push(new THREE.TubeGeometry(path,6,.00032,4,false));
 }
 for(let i=0;i<2;i++){const g=mergeGeometries(threads[i]);threads[i].forEach(g=>g.dispose());mesh(g,new THREE.MeshStandardMaterial({color:i?0x927246:0xd8c8a3,roughness:.97}),[0,0,0],[0,0,0],'woven-headband');}
 // Slightly staggered folded signatures visible along head and tail.
 const sections=[];
 for(let i=0;i<12;i++)for(const side of [-1,1]){
  const g=new THREE.BoxGeometry(.00022,.00013,pd-.006);g.translate(-pw/2+(i+.5)*pw/12,side*(ph/2+.00003),-.0006+(i%3)*.00014);sections.push(g);
 }
 const signatureGeo=mergeGeometries(sections);sections.forEach(g=>g.dispose());mesh(signatureGeo,new THREE.MeshStandardMaterial({color:0xc6b89b,roughness:1}),[0,0,0],[0,0,0],'folded-signatures');
 // Silk marker curves under gravity, with a notched tail instead of a straight bar.
 const ribbonMat=new THREE.MeshStandardMaterial({color:0x8a4035,roughness:.64,side:THREE.DoubleSide});
 const rg=new THREE.PlaneGeometry(.0028,.027,2,12),rp=rg.attributes.position;
 for(let i=0;i<rp.count;i++){const t=(.0135-rp.getY(i))/.027;rp.setZ(i,.0015*Math.sin(t*3.5));if(t>.99 && Math.abs(rp.getX(i))<.0001)rp.setY(i,rp.getY(i)+.0018);}
 rg.computeVertexNormals();mesh(rg,ribbonMat,[pw*.19,-v.h/2-.009,-v.d*.16],[0,0,.08],'silk-marker');
 root.userData.dimensions={width:v.w,height:v.h,depth:v.d};
 return root;
}
