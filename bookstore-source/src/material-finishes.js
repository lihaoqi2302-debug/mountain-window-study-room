import * as THREE from 'three';
import { canvasTexture, mulberry32 } from './textures.js';

// Shared, static Canvas maps. R = micro-height, G = roughness, B = metalness.
// Packed maps use linear colour; diffuse multipliers use sRGB.
function field(size, seed) {
  const rnd=mulberry32(seed), n=8, grid=Array.from({length:n*n},rnd);
  return (x,y)=>{
    const a=x/size*n,b=y/size*n,ix=Math.floor(a),iy=Math.floor(b);
    const u=a-ix,v=b-iy,s=u*u*(3-2*u),t=v*v*(3-2*v);
    const get=(i,j)=>grid[((j+n)%n)*n+(i+n)%n];
    return (get(ix,iy)*(1-s)+get(ix+1,iy)*s)*(1-t)+(get(ix,iy+1)*(1-s)+get(ix+1,iy+1)*s)*t;
  };
}

function dataMap(size, seed, sample) {
  const noise=field(size,seed),rnd=mulberry32(seed+1);
  return canvasTexture(size,size,(ctx,w,h)=>{
    const image=ctx.createImageData(w,h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const value=sample(x/w,y/h,noise(x,y),rnd());const i=(y*w+x)*4;
      for(let k=0;k<3;k++)image.data[i+k]=Math.round(THREE.MathUtils.clamp(value[k],0,1)*255);
      image.data[i+3]=255;
    }
    ctx.putImageData(image,0,0);
  },{linear:true,anisotropy:4});
}

export function createMaterialFinishes(quality='high') {
  if(quality==='low')return {};
  const size=quality==='high'?512:256, maps={};
  maps.woodFinish=dataMap(size,801,(x,y,n,r)=>{
    const grain=Math.sin(y*1200+Math.sin(x*24)*3)*.014+(r-.5)*.018;
    const rubbed=Math.exp(-(((y-.17)/.09)**2))*.045;
    return [.5+grain,.66+n*.16-rubbed,0];
  });
  maps.leatherFinish=dataMap(size,812,(x,y,n,r)=>{
    const center=Math.exp(-((x-.5)**2+(y-.52)**2)/.12);
    const crease=Math.exp(-((Math.sin(x*28+Math.sin(y*9)*1.4)/.085)**2))*.018;
    return [.5+(r-.5)*.045-crease,.72+n*.10-center*.16,0];
  });
  maps.leatherAge=canvasTexture(size,size,(ctx,w,h)=>{
    const rnd=mulberry32(813);ctx.fillStyle='#e8e4da';ctx.fillRect(0,0,w,h);
    const hand=ctx.createRadialGradient(w*.47,h*.52,0,w*.47,h*.52,w*.6);
    hand.addColorStop(0,'rgba(255,245,216,.12)');hand.addColorStop(.6,'rgba(70,43,24,.025)');hand.addColorStop(1,'rgba(247,234,205,.10)');
    ctx.fillStyle=hand;ctx.fillRect(0,0,w,h);
    for(let i=0;i<32;i++){
      const x=rnd()*w,y=rnd()*h;ctx.strokeStyle=`rgba(55,34,22,${.025+rnd()*.035})`;ctx.lineWidth=.4+rnd()*.65;
      ctx.beginPath();ctx.moveTo(x,y);ctx.bezierCurveTo(x+w*.04,y-3,x+w*.08,y+5,x+w*(.10+rnd()*.04),y+2);ctx.stroke();
    }
    ctx.strokeStyle='rgba(245,230,202,.16)';ctx.lineWidth=1.3;
    ctx.strokeRect(1,1,w-2,h-2);
  },{anisotropy:4});
  const brassSize=quality==='high'?256:128;
  maps.brassFinish=dataMap(brassSize,825,(x,y,n,r)=>{
    const brush=Math.sin(y*1600)*.012+(r-.5)*.012;
    return [.5+brush,.37+n*.08,.99-n*.04];
  });
  maps.brassPatina=canvasTexture(brassSize,brassSize,(ctx,w,h)=>{
    const rnd=mulberry32(826);ctx.fillStyle='#e9e4d8';ctx.fillRect(0,0,w,h);
    for(let i=0;i<16;i++){
      const x=rnd()*w,y=rnd()*h,r=w*(.07+rnd()*.16),g=ctx.createRadialGradient(x,y,0,x,y,r);
      g.addColorStop(0,'rgba(60,49,27,.16)');g.addColorStop(1,'rgba(60,49,27,0)');ctx.fillStyle=g;ctx.fillRect(x-r,y-r,r*2,r*2);
    }
  },{anisotropy:4});
  maps.stoneFinish=dataMap(size,834,(x,y,n,r)=>[.5+(n-.5)*.12+(r-.5)*.035,.85+n*.10,0]);
  return maps;
}

export function makeBrassMaterial(color,quality,maps,dark=false) {
  const properties={color,metalness:dark?.79:.83,roughness:quality==='low'?.42:1,
    map:maps.brassPatina||null,roughnessMap:maps.brassFinish||null,metalnessMap:maps.brassFinish||null};
  if(quality==='high')return new THREE.MeshPhysicalMaterial({...properties,anisotropy:.19,anisotropyRotation:Math.PI/2,
    bumpMap:maps.brassFinish,bumpScale:.00018});
  return new THREE.MeshStandardMaterial(properties);
}

// All stone faces share a metric projection, so the same block size continues
// across the piers, lintel and hearth. Soot is baked to vertices, not a new decal.
export function finishStoneGeometry(geometry,offset=[0,0,0]) {
  const p=geometry.attributes.position,n=geometry.attributes.normal,uv=geometry.attributes.uv;
  const colors=new Float32Array(p.count*3);
  for(let i=0;i<p.count;i++){
    const x=p.getX(i)+offset[0],y=p.getY(i)+offset[1],z=p.getZ(i)+offset[2];
    if(Math.abs(n.getX(i))>.5)uv.setXY(i,z/.95,y/.95);
    else if(Math.abs(n.getY(i))>.5)uv.setXY(i,z/.95,x/.95);
    else uv.setXY(i,x/.95,y/.95);
    const rise=THREE.MathUtils.smoothstep(y,1.36,1.417)
      * (1-THREE.MathUtils.smoothstep(y,1.457,1.691));
    const center=.027+.038*Math.sin(y*13);
    const plume=rise*Math.exp(-(((z-center)/.36)**2))*(.90+.10*Math.sin(z*23+y*41));
    const edge=Math.exp(-Math.abs(Math.abs(z)-.58)*19) * (1-THREE.MathUtils.smoothstep(y,1.36,1.52));
    const soot = Math.max(0,-n.getX(i)) * (.27*plume + .072*edge);
    const exposedSide = Math.max(0,n.getZ(i)) * .19;
    const front = Math.max(0,-n.getX(i)) * .10;
    const value = 1 - exposedSide - front;
    colors.set([value-soot,value-soot*1.025,value-soot*1.07],i*3);
  }
  geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
  return geometry;
}
