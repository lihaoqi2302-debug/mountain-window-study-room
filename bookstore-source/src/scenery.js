import * as THREE from 'three';

export const SCENERY={mountain:'阿尔卑斯雪山',aurora:'极光夜空',forest:'晨雾松林',snow:'冬日雪林'};
export const normalizeSceneryKey=key=>key==='night'?'mountain':key==='rain'?'aurora':key;
// Photographed lat-long panoramas, embedded at build time. Attribution lives in assets/scenery.
const PROFILES={
 mountain:{yaw:1.23,tilt:.17,brightness:.64,tint:0xb8d4ff,night:.71,light:5.6,color:0x7197c4,ibl:.25},
 aurora:{yaw:-.6,tilt:.98,brightness:.84,night:1,light:2.35,color:0x8f99bc,ibl:.23},
 forest:{yaw:1.15,brightness:.85,night:.16,light:4.5,color:0xb5c6bc,ibl:.27},
 snow:{yaw:-.55,brightness:.90,tint:0xe2edff,night:.26,light:4.6,color:0x9cb7d7,ibl:.26},
};

export async function landscapeTexture(kind,quality='high'){
 const assets=window.__ASSETS__;
 const source=(quality==='low'?assets?.sceneryMobile?.[kind]:null)||assets?.scenery?.[kind];
 if(!source)throw new Error('缺少内嵌摄影素材 '+kind);
 const texture=await new THREE.TextureLoader().loadAsync(source);
 const maxWidth=quality==='low'?1536:quality==='medium'?4096:8192;
 if(texture.image.width>maxWidth){
  const c=document.createElement('canvas');c.width=maxWidth;c.height=maxWidth/2;
  const ctx=c.getContext('2d');ctx.drawImage(texture.image,0,0,c.width,c.height);texture.image=c;
 }
 texture.name='photographic-panorama:'+kind;texture.colorSpace=THREE.SRGBColorSpace;
 texture.wrapS=THREE.RepeatWrapping;texture.wrapT=THREE.ClampToEdgeWrapping;
 texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;
 texture.generateMipmaps=true;texture.anisotropy=quality==='low'?4:8;texture.needsUpdate=true;
 return texture;
}

export function createScenery(room,{scene,quality='high',reducedMotion=false}={}){
 const sky=room.sky,base=sky.material;
 base.fog=false;sky.visible=false;
 const overlay=sky.clone();overlay.material=new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false,fog:false,side:THREE.BackSide,toneMapped:false});
 overlay.scale.setScalar(.9998);overlay.name='window:changing-scenery';overlay.visible=false;sky.parent.add(overlay);
 const cache=new Map(),inflight=new Map();room.textures.scenery=[];
 let current=null,pending=null,requested=null,mix=0,queued=null,reduced=reducedMotion,version=0,loading=false,activePromise;
 const nightReflection = room.windowPane.uniforms.night;
 let fromNight = 0, toNight = 0, fromIBL = scene?.environmentIntensity ?? .25;
 const tintPanorama = (material, key) => material.color.setHex(PROFILES[key].tint ?? 0xffffff).multiplyScalar(PROFILES[key].brightness);
 const light=room.windowLight;let fromLight=light.intensity,toLight=light.intensity;
 const fromColor=light.color.clone(),toColor=light.color.clone();
 const panel=document.getElementById('sceneryPanel');
 const status=document.createElement('p');status.id='sceneryPhotoStatus';status.setAttribute('role','status');status.style.cssText='font:11px/1.7 Microsoft YaHei,sans-serif;opacity:.6;margin-top:12px';panel?.append(status);
 const sync=()=>{room.textures.scenery=[...cache.values()];panel?.setAttribute('aria-busy',String(loading));};
 const prune=()=>{for(const [key,texture]of cache){if(key!==current&&key!==pending&&key!==requested&&key!==queued?.key){texture.dispose();cache.delete(key);}}sync();};
 function load(key){
  if(cache.has(key))return Promise.resolve(cache.get(key));
  if(!inflight.has(key))inflight.set(key,landscapeTexture(key,quality).then(texture=>{cache.set(key,texture);inflight.delete(key);prune();return texture;}).catch(error=>{inflight.delete(key);throw error;}));
  return inflight.get(key);
 }
 function setPose(mesh,profile){mesh.rotation.set(0,profile.yaw,0);if(profile.tilt)mesh.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),profile.tilt));}
 function begin(key,texture){
  if(key===current){pending=null;queued=null;overlay.visible=false;status.textContent='360° 全景 · '+SCENERY[key];prune();return;}
  pending=key;mix=0;overlay.material.map=texture;overlay.material.needsUpdate=true;tintPanorama(overlay.material,key);
  setPose(overlay,PROFILES[key]);overlay.material.opacity=0;overlay.visible=true;
  fromIBL=scene?.environmentIntensity ?? .25;
  fromNight=nightReflection.value;toNight=PROFILES[key].night;
  fromLight=light.intensity;toLight=PROFILES[key].light;fromColor.copy(light.color);toColor.set(PROFILES[key].color);
 }
 function commit(key,texture){
  nightReflection.value=PROFILES[key].night;
  const p=PROFILES[key];if(scene)scene.environmentIntensity=p.ibl;
  base.map=texture;tintPanorama(base,key);base.needsUpdate=true;setPose(sky,p);sky.visible=true;overlay.material.map=null;
  light.intensity=p.light;light.color.set(p.color);current=key;pending=null;overlay.visible=false;
  status.textContent='360° 全景 · '+SCENERY[key];prune();
 }
 function choose(key){
  key=normalizeSceneryKey(key);
  if(!Object.hasOwn(SCENERY,key))return Promise.resolve(false);
  if(key===requested&&(loading||pending===key||queued?.key===key))return activePromise||Promise.resolve(false);
  if(key===current&&!pending&&!loading)return Promise.resolve(false);
  const token=++version;requested=key;queued=null;loading=true;status.textContent='正在打开全景…';sync();
  // Let an in-progress fade finish before blending the latest ready panorama.
  activePromise=load(key).then(texture=>{
   if(token!==version){prune();return false;}
   loading=false;
   if(!current||reduced)commit(key,texture);
   else if(pending)queued={key,texture};
   else begin(key,texture);
   sync();return true;
  }).catch(error=>{if(token===version){loading=false;queued=null;requested=pending||current;status.textContent='实景载入失败，请重试';sync();}throw error;});
  return activePromise;
 }
 let initial='mountain';try{const saved=normalizeSceneryKey(localStorage.getItem('sanctuary-scenery'));if(Object.hasOwn(SCENERY,saved))initial=saved;}catch{}
 const ready=choose(initial).catch(async()=>{
  // A damaged panorama must never block entry to the room.
  if(initial!=='mountain') {
   try { return await choose('mountain'); } catch {}
  }
  sky.visible=true;
  status.textContent='实景暂不可用，正在显示内置窗景';
  return false;
 });
 return {choose,ready,get current(){return requested||pending||current;},get changing(){return loading||!!pending||!!queued;},
  setReducedMotion(value){reduced=!!value;},
  update(dt){
   if(pending){mix=reduced?1:Math.min(1,mix+Math.min(dt,.1)/1.5);const t=mix*mix*(3-2*mix);overlay.material.opacity=t;nightReflection.value=THREE.MathUtils.lerp(fromNight,toNight,t);light.intensity=THREE.MathUtils.lerp(fromLight,toLight,t);light.color.lerpColors(fromColor,toColor,t);if(scene)scene.environmentIntensity=THREE.MathUtils.lerp(fromIBL,PROFILES[pending].ibl,t);if(mix>=1){commit(pending,cache.get(pending));if(queued){const next=queued;queued=null;begin(next.key,next.texture);}}}
  },
 };
}
