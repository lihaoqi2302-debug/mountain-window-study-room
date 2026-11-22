import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CUP, RECORD_CONSOLE, TABLE } from './room-layout.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { woodGrain } from './interior-craft.js';

export function createInteractiveProps(scene, room) {
  const root = new THREE.Group(); root.name = 'interactive-props'; scene.add(root);
  const walnut = room.materials.walnut;
  const brass = room.materials.brass;
  const black = new THREE.MeshStandardMaterial({ color: 0x171b21, roughness: 0.6 });
  const vinyl = new THREE.MeshStandardMaterial({ color: 0x080a0e, roughness: 0.28, metalness: 0.08 });
  const label = new THREE.MeshStandardMaterial({ color: 0x354e68, roughness: 0.75 });
  const led = new THREE.MeshStandardMaterial({ color: 0xc9a86a, emissive: 0xc9a86a, emissiveIntensity: 0.30 });
  const ceramic = room.materials.cupStoneware.clone();
  const coffeeMat = new THREE.MeshStandardMaterial({ color: 0x291508, roughness: 0.20 });
  const mesh = (parent, geometry, material, position = [0,0,0], rotation = [0,0,0]) => {
    const object = new THREE.Mesh(geometry, material);
    object.position.fromArray(position); object.rotation.fromArray([...rotation, 'XYZ']);
    object.castShadow = true; object.receiveShadow = true; parent.add(object); return object;
  };
  const box = (w,h,d) => new RoundedBoxGeometry(w,h,d,2,Math.min(0.015,w/6,h/6,d/6));
  const cylinder = (r,h) => new THREE.CylinderGeometry(r,r,h,48);

  const player = new THREE.Group(); player.name = 'record-player'; player.position.set(RECORD_CONSOLE.x,0,RECORD_CONSOLE.z);
  player.userData.interaction = 'music'; root.add(player);
  // A small walnut console beside the sofa, with sleeves and a fabric speaker.
  mesh(player,woodGrain(box(.78,.045,.55),false,.83,.56),walnut,[0,.67,0]);
  mesh(player,woodGrain(box(.78,.04,.55),false,.84,.57,.24),walnut,[0,.16,0]);
  for (const x of [-0.36,0.36]) {
    mesh(player,woodGrain(box(.04,.48,.52),true,.54,.57,x),walnut,[x,.42,0]);
    for (const z of [-0.22,0.22]) mesh(player,cylinder(0.025,0.15),brass,[x,0.075,z]);
  }
  mesh(player,box(0.70,0.43,0.025),walnut,[0,0.42,-0.255]);
  mesh(player,box(.25,.32,.308),black,[-.19,.35,.03]);
  for (const [y,r] of [[0.40,0.068],[0.28,0.035]]) {
    // The cone and its rolled surround sit behind the cabinet's trim ring.
    const profile=[[r,.010],[r*.86,.007],[r*.32,-.002],[r*.22,.003],[0,.003]]
      .map(([radius,depth])=>new THREE.Vector2(radius,depth));
    const speaker=mesh(player,new THREE.LatheGeometry(profile,36).rotateX(Math.PI/2),black,[-.19,y,.190]);
    speaker.castShadow=false;
    mesh(player,new THREE.TorusGeometry(r,.003,8,36),vinyl,[-.19,y,.199]);
    mesh(player,new THREE.TorusGeometry(r+.006,.0015,6,36),brass,[-.19,y,.198]);
  }
  for (let i=0;i<7;i++) mesh(player,box(0.018,0.28,0.30),
    i%2 ? label : black,[0.04+i*0.027,0.32,0.01],[0,0,(i-3)*0.015]);
  mesh(player,box(0.69,0.052,0.46),black,[0,0.72,0]);
  mesh(player,woodGrain(box(.682,.010,.012),false,.78,.16),walnut,[0,.706,.226]);
  for(const x of [.208,.263]){
    mesh(player,cylinder(.014,.009),black,[x,.749,.157]);
    mesh(player,cylinder(.010,.0015),brass,[x,.754,.157]);
  }
  const disc = new THREE.Group(); disc.name='record-vinyl'; disc.position.set(-0.08,0.753,0); player.add(disc);
  mesh(disc,cylinder(0.16,0.014),brass);
  mesh(disc,cylinder(0.153,0.006),vinyl,[0,0.011,0]);
  for(let i=0;i<10;i++) mesh(disc,new THREE.TorusGeometry(0.068+i*0.008,0.00055,4,64),black,[0,0.0145,0],[Math.PI/2,0,0]);
  mesh(disc,cylinder(0.047,0.0008),label,[0,0.0145,0]);
  mesh(disc,cylinder(0.003,0.017),brass,[0,0.023,0]);
  mesh(disc,box(0.005,0.001,0.028),brass,[0.020,0.0155,0]);
  const arm = new THREE.Group(); arm.name='record-tonearm'; arm.position.set(0.22,0.774,-0.15); player.add(arm);
  mesh(arm,cylinder(0.022,0.025),brass,[0,0,0]);
  const tube = new THREE.CatmullRomCurve3([new THREE.Vector3(0,0.02,0),new THREE.Vector3(-0.025,0.025,0.05),new THREE.Vector3(-0.07,0.015,0.22)]);
  mesh(arm,new THREE.TubeGeometry(tube,20,0.006,8,false),brass);
  mesh(arm,box(0.027,0.017,0.038),black,[-0.07,0.006,0.22]);
  const lamp = mesh(player,new THREE.SphereGeometry(0.008,10,8),led,[0.29,0.752,0.17]);
  const glass = new THREE.MeshStandardMaterial({color:0xc5d3df,transparent:true,opacity:0.12,roughness:0.12,depthWrite:false});
  const lid = mesh(player,box(0.70,0.006,0.45),glass,[0,0.92,-0.12],[-0.85,0,0]);
  lid.castShadow = false;

  const cup = new THREE.Group(); cup.name = 'interactive-coffee'; cup.userData.interaction = 'coffee'; root.add(cup);
  const cupRest = new THREE.Vector3(TABLE.x+CUP.x,TABLE.top+CUP.coasterHeight,TABLE.z+CUP.z);
  cup.position.copy(cupRest);
  const profile = [[0,0],[0.032,0],[0.040,0.007],[0.047,0.071],[0.045,0.080],
    [0.040,0.080],[0.034,0.016],[0,0.016]].map(([x,y])=>new THREE.Vector2(x,y));
  mesh(cup,new THREE.LatheGeometry(profile,40),ceramic);
  mesh(cup,new THREE.TorusGeometry(0.026,0.006,8,24,Math.PI*1.35),ceramic,[0.046,0.046,0],[0,0,-Math.PI*0.35]);
  const liquid = mesh(cup,new THREE.CircleGeometry(0.038,40),coffeeMat,[0,0.065,0],[-Math.PI/2,0,0]);
  liquid.castShadow = false;
  const rim = mesh(cup,new THREE.TorusGeometry(0.042,0.0017,6,40),room.materials.bowlsLip,[0,0.079,0],[Math.PI/2,0,0]);
  rim.castShadow = false;
  // Keep articulation groups separate, but batch their static pieces by material.
  function batchParts(parent) {
    const buckets=new Map();
    for(const part of parent.children) {
      if(!part.isMesh)continue;
      const key=part.material.uuid+'|'+part.castShadow+'|'+part.receiveShadow;
      if(!buckets.has(key))buckets.set(key,[]);
      buckets.get(key).push(part);
    }
    for(const parts of buckets.values()) {
      if(parts.length<2)continue;
      const geometries=parts.map(part=>{
        part.updateMatrix();
        const geometry=part.geometry.index?part.geometry.toNonIndexed():part.geometry.clone();
        return geometry.applyMatrix4(part.matrix);
      });
      const merged=mergeGeometries(geometries,false);
      geometries.forEach(geometry=>geometry.dispose());
      if(!merged)continue;
      const combined=new THREE.Mesh(merged,parts[0].material);
      combined.name=parent.name+':batched';combined.castShadow=parts[0].castShadow;combined.receiveShadow=parts[0].receiveShadow;
      parts.forEach(part=>{parent.remove(part);part.geometry.dispose();});
      parent.add(combined);
    }
  }
  [player,disc,arm,cup].forEach(batchParts);
  let coffeeTime = -1, sips = 0, playing = false, speed = 0, hover = '', coffeePath = null;

  let reducedMotion = false;

  function sip(camera) {
    if (coffeeTime >= 0) return false;
    if (reducedMotion) return true;
    coffeePath = null;
    if (camera) {
      const right=new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion);
      const up=new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion);
      const forward=camera.getWorldDirection(new THREE.Vector3());
      const target=camera.position.clone().addScaledVector(right,0.15).addScaledVector(up,-0.20).addScaledVector(forward,0.35);
      coffeePath=new THREE.CubicBezierCurve3(cupRest.clone(),
        new THREE.Vector3(cupRest.x+.11,1.24,cupRest.z-.14),new THREE.Vector3(0.53,1.20,-1.58),target);
    }
    coffeeTime = 0; return true;
  }
  function update(time, dt) {
    const targetSpeed = playing ? 33 * Math.PI / 30 : 0;
    speed = reducedMotion ? 0 : THREE.MathUtils.damp(speed, targetSpeed, playing ? 8 : 22, dt);
    disc.rotation.y += speed*dt;
    const armTarget = playing ? -.45 : -1.10;
    arm.rotation.y = reducedMotion ? armTarget : THREE.MathUtils.damp(arm.rotation.y,armTarget,4,dt);
    led.emissiveIntensity = playing ? 0.65 : hover === 'music' ? 0.45 : 0.15;
    ceramic.emissive.setHex(0xb49361); ceramic.emissiveIntensity = hover === 'coffee' ? 0.10 : 0;
    if (coffeeTime >= 0) {
      if (reducedMotion) coffeeTime = 2.6;
      coffeeTime += dt;
      const p = Math.min(1,coffeeTime/2.6);
      const lift = THREE.MathUtils.smoothstep(p,0,0.28)*(1-THREE.MathUtils.smoothstep(p,0.67,1));
      if(coffeePath)cup.position.copy(coffeePath.getPoint(lift));
      else cup.position.copy(cupRest).add(new THREE.Vector3(-0.035*Math.sin(p*Math.PI),0.22*lift,0.018*lift));
      cup.rotation.z = -0.24*Math.sin(Math.PI*p)**2;
      cup.rotation.x = 0.08*Math.sin(Math.PI*p);
      if(p>=1) { coffeeTime=-1;cup.position.copy(cupRest);cup.rotation.set(0,0,0);
        sips=(sips+1)%5;liquid.position.y=0.065-sips*0.003; }
    }
    room.steam.position.copy(cup.position).add(new THREE.Vector3(0,0.085,0));
    liquid.scale.setScalar(1 + (coffeeTime>=0 ? Math.sin(time*12)*0.015 : 0));
  }
  return { root,player,cup,disc,arm,pickRoots:[player,cup],update,sip,
    setReducedMotion(value){reducedMotion=!!value;},
    setPlaying(value){playing=!!value;},setHover(value){hover=value||'';},
    get busy(){return coffeeTime>=0;},
    collisionBoxes: [new THREE.Box3(new THREE.Vector3(1.30,0,-2.24),new THREE.Vector3(2.16,0.98,-1.66))],
    dispose(){
      const gs=new Set(),ms=new Set();root.traverse(o=>{if(o.geometry)gs.add(o.geometry);if(o.material)ms.add(o.material);});
      gs.forEach(g=>g.dispose());ms.forEach(m=>{if(!Object.values(room.materials).flat().includes(m))m.dispose();});scene.remove(root);
    } };
}
