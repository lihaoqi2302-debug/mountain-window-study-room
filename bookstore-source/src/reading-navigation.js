import * as THREE from 'three';

const WORLD_UP = new THREE.Vector3(0, 1, 0);

/** Fit a real seated camera by changing the lens, rather than moving it above the table. */
export function fitSeatedReading({ corners, center, seat, yaw = 0, pitch = 0, rect, width, height }) {
  const bounds = new THREE.Box3().setFromPoints(corners);
  const focus = corners.length ? bounds.getCenter(new THREE.Vector3()) : center.clone();
  const offset = seat.clone().sub(focus);
  const spherical = new THREE.Spherical().setFromVector3(offset);
  spherical.theta += yaw;
  spherical.phi = THREE.MathUtils.clamp(spherical.phi + pitch, 0.12, 1.42);
  const dir = new THREE.Vector3().setFromSpherical(spherical).normalize();
  const distance = offset.length();
  const pos = focus.clone().addScaledVector(dir, distance);
  const right = new THREE.Vector3().crossVectors(WORLD_UP, dir).normalize();
  const up = new THREE.Vector3().crossVectors(dir, right).normalize();
  const probe = new THREE.PerspectiveCamera(30, width / height, 0.01, 60);
  probe.position.copy(pos);
  probe.up.copy(up);
  probe.lookAt(focus);
  probe.updateMatrixWorld(true);

  const extentAt = (fov) => {
    probe.fov = fov;
    probe.updateProjectionMatrix();
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const point of corners) {
      const p = point.clone().project(probe);
      const x = (p.x + 1) * width / 2;
      const y = (1 - p.y) * height / 2;
      l = Math.min(l, x); r = Math.max(r, x);
      t = Math.min(t, y); b = Math.max(b, y);
    }
    return { l, t, r, b, w: r - l, h: b - t };
  };

  let low = 4, high = 100;
  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2;
    const e = extentAt(mid);
    if (e.w <= rect.w * 0.96 && e.h <= rect.h * 0.96) high = mid;
    else low = mid;
  }
  const fov = high;
  const extent = extentAt(fov);
  const dx = corners.length ? rect.x + rect.w / 2 - (extent.l + extent.r) / 2 : 0;
  const dy = corners.length ? rect.y + rect.h / 2 - (extent.t + extent.b) / 2 : 0;
  return { center: focus, pos, dir, right, up, distance, fov, dx, dy, rect,
    worldPerPx: 2 * distance * Math.tan(THREE.MathUtils.degToRad(fov) / 2) / height };
}

export function readingPose(frame, zoom, pan) {
  const shift = frame.right.clone().multiplyScalar(pan.x).addScaledVector(frame.up, pan.y);
  return { ...frame, pos: frame.pos.clone().add(shift), look: frame.center.clone().add(shift),
    worldPerPx: frame.worldPerPx * zoom, lensZoom: 1 / zoom };
}

/** Anchor magnification to the point under the mouse / midpoint of a pinch. */
export function zoomReadingAt({ zoom, factor, pan, frame, x, y, width, height, depth = frame.distance }) {
  const next = THREE.MathUtils.clamp(zoom * factor, 0.18, 3.2);
  const pixelScale = frame.worldPerPx * depth / frame.distance;
  const oldScale = pixelScale * zoom;
  const newScale = pixelScale * next;
  pan.x += (x - (width / 2 + frame.dx)) * (oldScale - newScale);
  pan.y -= (y - (height / 2 + frame.dy)) * (oldScale - newScale);
  constrainReadingPan(pan);
  return next;
}

export function constrainReadingPan(pan) {
  pan.x = THREE.MathUtils.clamp(Number.isFinite(pan.x) ? pan.x : 0, -0.48, 0.48);
  pan.y = THREE.MathUtils.clamp(Number.isFinite(pan.y) ? pan.y : 0, -0.4, 0.4);
}
