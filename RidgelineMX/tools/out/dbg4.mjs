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
for (let i=0;i<120*9.5 && !v.crashed;i++){ const br = i>=120*6.5; v.input.throttle=br?0:1; v.input.brake=br?1:0; keepLane(v); v.step(FIXED_DT);
 if (i%12==0 && i>120*6) { const beta = Math.atan2(v.vel.dot(v.left), v.vel.dot(v.fwd))*57.3; console.log(' t',(i/120).toFixed(2),'spd',v.speed.toFixed(1),'g',v.engine.gear,'beta',beta.toFixed(1),'yawR',v.angVel.dot(v.up).toFixed(2),'pitch',v.groundPitch().toFixed(1),'steerIn',v.input.steer.toFixed(2),'d',(v.steerAngle*57.3).toFixed(1),'u',v.trackU.toFixed(1),'s',v.trackS.toFixed(0), v.wheels.map(w=>(w.contact?'C':'-')+w.slipLat.toFixed(1)+'/'+w.slipLong.toFixed(1)+'/'+w.load.toFixed(0)).join(' ')); }
}
console.log(' crashed', v.crashed, v.crashReason);
