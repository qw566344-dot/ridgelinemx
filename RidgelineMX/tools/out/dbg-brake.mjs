import { TRACKS } from '../../shared/tracks.js';
import { makeWorld } from '../../shared/terrain.js';
import { Vehicle, FIXED_DT } from '../../client/js/sim/vehicle.js';
import { pointAt } from '../../shared/trackgen.js';
const W = makeWorld(TRACKS[0]);
for (const id of ['mx250','atv450']) {
const v = new Vehicle(id, W); const p = pointAt(W.T, W.T.gateS+20, 0); v.placeAt(p.x,p.z,p.tx,p.tz);
for (let i=0;i<120*7;i++){ v.input.throttle=1; v.step(FIXED_DT); }
console.log(id, 'start brake at', v.speed.toFixed(1), 'trackU', v.trackU.toFixed(1), 's', v.trackS.toFixed(0));
for (let i=0;i<120*5 && !v.crashed;i++){ v.input.throttle=0; v.input.brake=1; v.step(FIXED_DT);
 if (i%15==0) { const beta = Math.atan2(v.vel.dot(v.left), v.vel.dot(v.fwd))*57.3; console.log(' t',(i/120).toFixed(2),'spd',v.speed.toFixed(1),'beta',beta.toFixed(1),'yawR',v.angVel.dot(v.up).toFixed(2),'pitch',v.groundPitch().toFixed(1),'roll',(Math.atan2(v.left.y,v.up.y)*57.3).toFixed(1),'u',v.trackU.toFixed(1), v.wheels.map(w=>(w.contact?'C':'-')+w.slipLat.toFixed(1)+'/'+w.slipLong.toFixed(1)+'/'+w.load.toFixed(0)).join(' ')); }
}
console.log(' crashed', v.crashed, v.crashReason, 'u', v.trackU.toFixed(1));
}
