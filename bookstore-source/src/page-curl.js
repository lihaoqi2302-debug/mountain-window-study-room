/** Shared CPU geometry used by both rendering and collision regression checks. */
export function turningPagePoint(x, y, { width, side = 1, phi, curl, droop = 0, lift = 0 }) {
  const u = Math.min(1, Math.max(0, Math.abs(x) / width));
  const radius = width / Math.max(curl, 1e-5);
  const angle = u * curl;
  const qx = radius * Math.sin(angle);
  const qz = radius * (1 - Math.cos(angle));
  const sn = Math.max(0, Math.sin(phi));
  const cs = Math.cos(phi);
  return [side * (qx * cs - qz * sn), y - droop * u * u * sn,
    qx * sn + qz * Math.abs(cs) + lift * u * u * sn];
}

export function deformTurningPage(geometry, original, parameters) {
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const p = turningPagePoint(original[i * 3], original[i * 3 + 1], parameters);
    positions.setXYZ(i, p[0], p[1], p[2]);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
}
