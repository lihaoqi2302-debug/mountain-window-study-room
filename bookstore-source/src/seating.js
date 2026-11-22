import * as THREE from 'three';
import { CHAIR, SOFA, TABLE } from './room-layout.js';

export const SEATS={
  sofa:{id:'sofa',label:'沙发',eye:[SOFA.x+.18,1.13,SOFA.z+.04],look:[TABLE.x,.55,TABLE.z+.16]},
  armchair:{id:'armchair',label:'扶手椅',eye:[CHAIR.x,1.20,CHAIR.z],look:[TABLE.x,.72,TABLE.z]},
};

export function createSeatLook(seat) {
  const eye=new THREE.Vector3(...seat.eye),target=new THREE.Vector3(...seat.look);
  const camera=new THREE.PerspectiveCamera();camera.position.copy(eye);camera.lookAt(target);
  const euler=new THREE.Euler().setFromQuaternion(camera.quaternion,'YXZ');
  let yaw=euler.y,pitch=euler.x;
  return {
    eye,
    look(dx,dy){yaw-=dx*.003;pitch=THREE.MathUtils.clamp(pitch-dy*.003,-1.10,1.10);},
    apply(camera){camera.position.copy(eye);camera.up.set(0,1,0);camera.quaternion.setFromEuler(euler.set(pitch,yaw,0,'YXZ'));},
    target(){return new THREE.Vector3(0,0,-1).applyEuler(euler.set(pitch,yaw,0,'YXZ')).multiplyScalar(1.8).add(eye);},
  };
}
