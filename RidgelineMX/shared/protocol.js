// =====================================================================
//  NETWORK PROTOCOL (shared by client and server)
//  Messages are small JSON objects with a type field `t`.
//  Rider state is packed into a flat array to keep packets small.
// =====================================================================
export const PROTOCOL_VERSION = 1;
export const SEND_RATE = 20;          // rider state updates per second
export const SNAPSHOT_RATE = 20;      // server snapshots per second
export const INTERP_DELAY = 120;      // ms remote riders are drawn "in the past" for smoothness
export const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
export const CODE_LENGTH = 6;
export const MODES = ['freeride', 'race', 'timetrial'];

// flags bitfield
export const F_CRASHED = 1, F_AIR = 2, F_REVERSE = 4;

const r3 = (x) => Math.round(x * 1000) / 1000;
const r2 = (x) => Math.round(x * 100) / 100;

// [x, y, z, qx, qy, qz, qw, vx, vy, vz, lean, steer, s, rpm, thr, flags, susp0..3, spinF, spinR]
export function packState(v) {
  const flags = (v.crashed ? F_CRASHED : 0) | (!v.grounded ? F_AIR : 0) | (v.engine.reverse ? F_REVERSE : 0);
  const w = v.wheels;
  return [
    r3(v.pos.x), r3(v.pos.y), r3(v.pos.z),
    r3(v.quat.x), r3(v.quat.y), r3(v.quat.z), r3(v.quat.w),
    r2(v.vel.x), r2(v.vel.y), r2(v.vel.z),
    r3(v.lean), r3(v.steerAngle), r2(v.trackS), Math.round(v.engine.rpm), r2(v.input.throttle), flags,
    r3(w[0].comp), r3(w[1].comp), r3(w[2] ? w[2].comp : 0), r3(w[3] ? w[3].comp : 0),
  ];
}

export const STATE_LEN = 20;

export function validCode(code) {
  if (typeof code !== 'string' || code.length !== CODE_LENGTH) return false;
  for (const c of code) if (!CODE_CHARS.includes(c)) return false;
  return true;
}

export function cleanName(name) {
  const s = String(name || '').replace(/[^\w \-.]/g, '').trim().slice(0, 16);
  return s || 'Rider';
}
