import * as THREE from 'three';

export const smoothMotion = value => {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

export function sampleBookTransfer(rest, held, value) {
  const t = smoothMotion(value);
  const position = rest.position.clone().lerp(held.position, t);
  position.y += Math.sin(Math.PI * t) * 0.105;
  position.x += Math.sin(Math.PI * t) * 0.025;
  return { position, quaternion: rest.quaternion.clone().slerp(held.quaternion, t) };
}

export function heldBookPose() {
  const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 1.14);
  return { position: new THREE.Vector3(0, 0.79, -1.20), quaternion: yaw.multiply(tilt) };
}
