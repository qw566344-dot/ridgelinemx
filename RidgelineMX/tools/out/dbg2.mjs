import { makeWorld } from '../../shared/terrain.js';
import { Vehicle, FIXED_DT } from '../../client/js/sim/vehicle.js';
import { pointAt } from '../../shared/trackgen.js';
const OVAL = { id: 'oval', name: 'Test Oval', worldSize: 900, seed: 1, start: { x: -300, z: 120, heading: 0 }, defaultWidth: 30,
  terrain: { hills: 0, hillScale: 100, rim: 0, rimStart: 999, bumps: [] },
  segments: [{ len: 600, free: true }, { turn: 180, r: 120, berm: 0 }, { len: 600, free: true }, { turn: 180, r: 120, berm: 0 }], gateAt: 10, finishAt: 50 };
const W = makeWorld(OVAL);
const v = new Vehicle('mx450', W); const p = pointAt(W.T, 30, 0); v.placeAt(p.x,p.z,p.tx,p.tz);
for (let i=0;i<120*9;i++){ const br = i>=120*7; v.input.throttle=br?0:1; v.input.brake=br?1:0; v.step(FIXED_DT);
 if (i%15==0 && (i>120*4.5) && !v.crashed) { const beta = Math.atan2(v.vel.dot(v.left), v.vel.dot(v.fwd))*57.3; console.log(' t',(i/120).toFixed(2),'spd',v.speed.toFixed(1),'g',v.engine.gear,'rpm',v.engine.rpm.toFixed(0),'beta',beta.toFixed(1),'yawR',v.angVel.dot(v.up).toFixed(2),'pitch',v.groundPitch().toFixed(1),'roll',(Math.atan2(v.left.y,v.up.y)*57.3).toFixed(1),'u',v.trackU.toFixed(1),'s',v.trackS.toFixed(0),'y',v.pos.y.toFixed(2), 'fence',v.onFence.toFixed(2), 'probe', v.probeHits&&v.probeHits.type, v.wheels.map(w=>(w.contact?'C':'-')+w.slipLat.toFixed(1)+'/'+w.slipLong.toFixed(1)+'/'+w.load.toFixed(0)).join(' ')); }
}
console.log(' crashed', v.crashed, v.crashReason);
