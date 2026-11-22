import * as THREE from 'three';

/** Grounded first-person body. Axis-separated circle/AABB sweeps slide along furniture. */
export function createWalker({ bounds, obstacles = [], eyeHeight = 1.60, radius = 0.19 }) {
  const position = new THREE.Vector3();
  const velocity = new THREE.Vector3();
  let yaw = 0, pitch = 0, vertical = 0, grounded = true, bob = 0, landingTime = .2;
  const floor = Math.max(.05, bounds.min.y);
  let targetYaw = 0, targetPitch = 0, jumpQueued = false, jumpHeld = false;
  const orientation = new THREE.Quaternion();
  const body = {position, quaternion:orientation, bob:0, grounded:true, landingDip:0};
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');

  const blocked = (x, z) => obstacles.some(box => {
    if (box.max.y <= position.y - eyeHeight + 0.055 || box.min.y >= position.y + 0.12) return false;
    const px = THREE.MathUtils.clamp(x, box.min.x, box.max.x);
    const pz = THREE.MathUtils.clamp(z, box.min.z, box.max.z);
    return (x - px) ** 2 + (z - pz) ** 2 < radius * radius;
  });

  function place(eye, quaternion) {
    position.copy(eye);
    position.y = floor + eyeHeight;
    euler.setFromQuaternion(quaternion, 'YXZ');
    yaw = euler.y; pitch = THREE.MathUtils.clamp(euler.x, -1.40, 1.40);
    targetYaw = yaw; targetPitch = pitch;
    velocity.set(0, 0, 0); vertical = 0; grounded = true;
    jumpQueued = false; jumpHeld = false; bob = 0; landingTime = .2;
    position.x = THREE.MathUtils.clamp(position.x, bounds.min.x + radius, bounds.max.x - radius);
    position.z = THREE.MathUtils.clamp(position.z, bounds.min.z + radius, bounds.max.z - radius);
    // Entering from an orbit camera can start inside a chair: choose a nearby free position.
    if (blocked(position.x, position.z)) {
      const origin = position.clone();
      search: for (let r = 0.25; r <= 2.0; r += 0.2) {
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
          const x = origin.x + Math.cos(a) * r, z = origin.z + Math.sin(a) * r;
          if (x > bounds.min.x + radius && x < bounds.max.x - radius &&
              z > bounds.min.z + radius && z < bounds.max.z - radius && !blocked(x, z)) {
            position.x = x; position.z = z; break search;
          }
        }
      }
    }
  }

  function look(dx, dy) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    // Bound a recenter/coalescing spike, while ordinary relative motion stays 1:1.
    const gain = .0022;
    targetYaw = yaw + THREE.MathUtils.clamp(targetYaw - yaw - gain * THREE.MathUtils.clamp(dx,-120,120), -.48,.48);
    targetPitch = THREE.MathUtils.clamp(targetPitch - gain * THREE.MathUtils.clamp(dy,-120,120), -1.4,1.4);
  }

  function requestJump() {
    if (grounded) jumpQueued = true;
  }

  function update(delta, input = {}) {
    const dt = Math.min(0.05, Math.max(0, delta));
    const blend = -Math.expm1(-36 * dt);
    const maxStep = Math.min(6.3 * dt, .11);
    yaw += THREE.MathUtils.clamp((targetYaw - yaw) * blend, -maxStep, maxStep);
    pitch += THREE.MathUtils.clamp((targetPitch - pitch) * blend, -maxStep, maxStep);
    const forward = Number(!!input.forward) - Number(!!input.backward);
    const strafe = Number(!!input.right) - Number(!!input.left);
    const length = Math.max(1, Math.hypot(forward, strafe));
    const speed = input.sprint ? 2.65 : 1.45;
    const tx = (strafe * Math.cos(yaw) - forward * Math.sin(yaw)) / length * speed;
    const tz = (-strafe * Math.sin(yaw) - forward * Math.cos(yaw)) / length * speed;
    velocity.x = THREE.MathUtils.damp(velocity.x, tx, 12, dt);
    velocity.z = THREE.MathUtils.damp(velocity.z, tz, 12, dt);
    const steps = Math.max(1, Math.ceil(velocity.length() * dt / 0.06));
    for (let i = 0; i < steps; i++) {
      const x = THREE.MathUtils.clamp(position.x + velocity.x * dt / steps,
        bounds.min.x + radius, bounds.max.x - radius);
      if (!blocked(x, position.z)) position.x = x;
      const z = THREE.MathUtils.clamp(position.z + velocity.z * dt / steps,
        bounds.min.z + radius, bounds.max.z - radius);
      if (!blocked(position.x, z)) position.z = z;
    }
    const previousFeet = position.y - eyeHeight;
    if (input.jump && !jumpHeld) requestJump();
    jumpHeld = !!input.jump;
    if (jumpQueued && grounded) { vertical = Math.sqrt(2 * 9.8 * .60); grounded = false; }
    jumpQueued = false;
    vertical -= 9.8 * dt;
    let nextY = position.y + vertical * dt;
    let landing = floor;
    for (const box of obstacles) {
      if (position.x < box.min.x - radius * 0.45 || position.x > box.max.x + radius * 0.45 ||
          position.z < box.min.z - radius * 0.45 || position.z > box.max.z + radius * 0.45) continue;
      if (vertical <= 0 && previousFeet >= box.max.y - 0.025 && nextY - eyeHeight <= box.max.y)
        landing = Math.max(landing, box.max.y);
    }
    landingTime = Math.min(.2, landingTime + dt);
    if (nextY <= landing + eyeHeight) {
      if (!grounded) landingTime = 0;
      nextY = landing + eyeHeight;
      vertical = 0;
      grounded = true;
    }
    else grounded = false;
    if (nextY > bounds.max.y - 0.12) { nextY = bounds.max.y - 0.12; vertical = Math.min(0, vertical); }
    position.y = nextY;
    bob = THREE.MathUtils.damp(bob, grounded && length > 0 && (forward || strafe) ? 1 : 0, 8, dt);
    orientation.setFromEuler(euler.set(pitch, yaw, 0, 'YXZ'));
    body.bob = bob;
    body.landingDip = .04 * Math.sin(Math.PI * landingTime / .2); body.grounded = grounded;
    return body;
  }

  function stop() {
    velocity.set(0,0,0);
    jumpQueued = false; jumpHeld = false;
    targetYaw = yaw; targetPitch = pitch;
  }

  return { place, look, requestJump, update, position, stop,
    get direction() { return new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)); } };
}
