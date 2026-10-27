import { makeWorld } from '../../shared/terrain.js';
import { Vehicle, FIXED_DT } from '../../client/js/sim/vehicle.js';
import { pointAt } from '../../shared/trackgen.js';
const OVAL = { id: 'oval', name: 'Test Oval', worldSize: 900, seed: 1, start: { x: -300, z: 120, heading: 0 }, defaultWidth: 30,
  terrain: { hills: 0, hillScale: 100, rim: 0, rimStart: 999, bumps: [] },
  segments: [{ len: 600, free: true }, { turn: 180, r: 120, berm: 0 }, { len: 600, free: true }, { turn: 180, r: 120, berm: 0 }], gateAt: 10, finishAt: 50 };
const W = makeWorld(OVAL);
function keepLane(v, u = 0) { const p = pointAt(v.world.T, v.trackS + 12, u); const dx = p.x - v.pos.x, dz = p.z - v.pos.z;
  const xl = dx * v.left.x + dz * v.left.z, zf = dx * v.fwd.x + dz * v.fwd.z; v.input.steer = Math.max(-1, Math.min(1, Math.atan2(xl, zf) * 3)); }
const v = new Vehicle(process.argv[2]||'mx450', W); const p = pointAt(W.T, 30, 0); v.placeAt(p.x,p.z,p.tx,p.tz);
let i=0; while (v.speed < 20 && i<3000) { v.input.throttle=1; keepLane(v); v.step(FIXED_DT); i++; }
for (let k=0;k<180;k++){ v.input.throttle = v.speed<20?0.6:0.1; v.input.steer=1; v.step(FIXED_DT);
 if (k%20==0) console.log('spd',v.speed.toFixed(1),'delta',(v.steerAngle*57.3).toFixed(2),'yawR',v.angVel.dot(v.up).toFixed(3),'tgt',(v.controller.yawTarget||0).toFixed(3),'u',v.trackU.toFixed(1), v.wheels.map(w=>`a=${(w.slipLat*w.cfg.alphaPeak*57.3).toFixed(1)} N=${w.load.toFixed(0)}`).join(' | '), 'lean', (v.lean*57.3).toFixed(1));
}
