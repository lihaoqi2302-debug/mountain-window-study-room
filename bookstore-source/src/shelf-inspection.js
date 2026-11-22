import * as THREE from 'three';
import { smoothMotion } from './book-motion.js';
export { createBoundVolume } from './bound-volume.js';

export function createShelfInspection({scene,camera,controls,volumes,onTake,onRestore}) {
  const panel=document.createElement('section');panel.id='shelfInspection';panel.hidden=true;
  panel.setAttribute('role','dialog');panel.setAttribute('aria-label','查看架上藏书');
  panel.innerHTML='<p style="color:#c9a86a;font-size:11px;letter-spacing:.18em">架上藏书</p><h2 style="margin:10px 0"></h2><p>拖动书本转动查看 · ← → 转动 · Esc 放回</p><p style="margin-top:8px;font-size:12px;opacity:.6">布面精装 · 弧形书脊 · 锁线装订</p><div style="display:flex;gap:10px;margin-top:16px"><button data-turn="-1">↶ 转动</button><button data-turn="1">转动 ↷</button><button id="returnShelfVolume">放回书架</button></div>';
  panel.style.cssText='position:fixed;z-index:45;bottom:94px;left:50%;transform:translateX(-50%);width:min(440px,calc(100vw - 28px));padding:20px;background:#15130feb;border:1px solid #c9a86a66;border-radius:3px;font:14px/1.6 Microsoft YaHei,sans-serif;color:#efe7d9;text-align:center';
  document.body.append(panel);
  for(const b of panel.querySelectorAll('button'))b.style.cssText='padding:10px;border:1px solid #c9a86a55;border-radius:3px;flex:1';
  let reducedMotion = false;
  let held=null,phase='idle',progress=0,angle=0,tilt=0,drag=null,wasEnabled=true,origin,exit,from,fromQ,homeQ,exitQ,homeParent,homePosition,homeRotation,returnRequested=false;
  const style=document.createElement('style');style.textContent='body[data-shelf-inspection=true] #brand,body[data-shelf-inspection=true] #toast,body[data-shelf-inspection=true] #btnRead,body[data-shelf-inspection=true] #worldInteractionHint{visibility:hidden}';document.head.append(style);
  const holdPosition=new THREE.Vector3(),holdQuaternion=new THREE.Quaternion(),rotation=new THREE.Quaternion();
  function target(){
    const depth=Math.max(.49,.24/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*camera.aspect)*1.3);
    holdPosition.set(0,.025,-depth).applyQuaternion(camera.quaternion).add(camera.position);
    rotation.setFromEuler(new THREE.Euler(tilt,-Math.PI/2+angle,0));holdQuaternion.copy(camera.quaternion).multiply(rotation);
  }
  function take(id){
    if(held)return false;
    const item=volumes.find(v=>v.userData.interaction===id);if(!item)return false;
    returnRequested=false;panel.querySelector('#returnShelfVolume').textContent='放回书架';onTake();wasEnabled=controls.enabled;controls.enabled=false;
    scene.updateMatrixWorld(true);homeParent=item.parent;homePosition=item.position.clone();homeRotation=item.quaternion.clone();held=item;origin=item.getWorldPosition(new THREE.Vector3());homeQ=item.getWorldQuaternion(new THREE.Quaternion());
    exit=new THREE.Vector3(0,0,.24).applyQuaternion(homeQ).add(origin);
    scene.attach(item);from=origin.clone();fromQ=homeQ.clone();exitQ=homeQ.clone();angle=0;tilt=0;progress=0;phase='out';
    panel.querySelector('h2').textContent='《'+item.userData.title+'》';panel.hidden=false;document.body.dataset.shelfInspection='true';return true;
  }
  function putBack(){if(!held)return;if(phase!=='held'){if(phase==='out'||phase==='present'){returnRequested=true;panel.querySelector('#returnShelfVolume').textContent='准备放回…';}return;}returnRequested=false;panel.querySelector('#returnShelfVolume').textContent='正在轻放…';phase=reducedMotion?'insert':'return';progress=0;from=held.position.clone();fromQ=held.quaternion.clone();drag=null;}
  function update(dt){
    if(!held)return;target();progress=reducedMotion ? 1 : Math.min(1,progress+Math.min(dt,.05)/({out:.95,present:1.45,return:1.5,insert:1.1}[phase]||1));
    const k=smoothMotion(progress);
    if(phase==='held'){held.position.copy(holdPosition);held.quaternion.copy(holdQuaternion);return;}
    const end=!reducedMotion&&(phase==='out'||phase==='return')?exit:phase==='insert'?origin:holdPosition;
    const q=!reducedMotion&&(phase==='out'||phase==='return')?exitQ:phase==='insert'?homeQ:holdQuaternion;
    held.position.lerpVectors(from,end,k);held.quaternion.slerpQuaternions(fromQ,q,k);
    if(progress===1){
      if(phase==='insert'){held.position.copy(origin);held.quaternion.copy(homeQ);homeParent.attach(held);held.position.copy(homePosition);held.quaternion.copy(homeRotation);panel.hidden=true;document.body.dataset.shelfInspection='false';held=null;phase='idle';controls.enabled=wasEnabled;onRestore();}
      else {phase=phase==='out'?(reducedMotion?'held':'present'):phase==='return'?'insert':'held';if(reducedMotion&&phase==='held'){held.position.copy(holdPosition);held.quaternion.copy(holdQuaternion);}progress=0;from=held.position.clone();fromQ=held.quaternion.clone();if(phase==='held'&&returnRequested)putBack();}
    }
  }
  panel.querySelector('#returnShelfVolume').onclick=putBack;
  panel.querySelectorAll('[data-turn]').forEach(b=>b.onclick=()=>{angle+=Number(b.dataset.turn)*Math.PI/4;});
  return {take,putBack,update,setReducedMotion(value){reducedMotion=!!value;},pickRoots:volumes,get active(){return !!held;},get held(){return held;},get phase(){return phase;},
    key(ev){if(!held)return false;if(ev.key==='Escape')putBack();if(ev.key==='ArrowLeft')angle-=.14;if(ev.key==='ArrowRight')angle+=.14;return true;},
    down(ev){if(!held)return false;if(phase==='held'){drag={x:ev.clientX,y:ev.clientY};}return true;},
    move(ev){if(!held)return false;if(drag){angle+=(ev.clientX-drag.x)*.012;tilt=THREE.MathUtils.clamp(tilt+(ev.clientY-drag.y)*.008,-.7,.7);drag={x:ev.clientX,y:ev.clientY};}return true;},
    up(){if(!held)return false;drag=null;return true;},
    cancelDrag(){drag=null;}
  };
}
