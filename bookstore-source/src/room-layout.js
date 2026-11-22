// Room coordinates in metres. Furniture, camera seats and props use these positions.
const chairYaw = 2.08;
export const SOFA = {x:0, y:.02, z:-1.724};
export const TABLE = {x:0, y:.03, z:-.34, width:1.50, depth:.84, top:.357};
export const CUP = {x:-.425, z:.247, coasterHeight:.014};
export const RUG = {x:-.41, z:-.48, width:4.60, depth:3.36, height:.034};
export const CHAIR = {x:-2.40, y:.02, z:.71, yaw:chairYaw};
export const SIDE_TABLE = {
  x:CHAIR.x + .88 * Math.cos(chairYaw) + .035 * Math.sin(chairYaw),
  z:CHAIR.z - .88 * Math.sin(chairYaw) + .035 * Math.cos(chairYaw),
};
export const POUF = {x:1.03,z:.80,radius:.26};
export const RECORD_CONSOLE = {x:1.73,z:-1.95};

export const rugSurface = (x,z) => Math.abs(x-RUG.x) <= RUG.width/2 &&
  Math.abs(z-RUG.z) <= RUG.depth/2 ? RUG.height : 0;
