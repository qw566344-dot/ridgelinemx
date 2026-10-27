import { getTrack } from '../../shared/tracks.js';
import { makeWorld, heightAt } from '../../shared/terrain.js';
import { Vehicle, FIXED_DT } from '../../client/js/sim/vehicle.js';
import { AIDriver } from '../../client/js/sim/ai.js';
import { pointAt } from '../../shared/trackgen.js';
const W = makeWorld(getTrack('ridgeline'));
const T = W.T;
const v = new Vehicle(process.argv[2]||'atv450', W);
const s0 = Number(process.argv[3]||1380);
const p = pointAt(T, s0, 0); v.placeAt(p.x, p.z, p.tx, p.tz);
const ai = new AIDriver(v, { skill: 1, lane: 0 });
for (let i = 0; i < 120*8; i++) {
  ai.update(FIXED_DT); v.step(FIXED_DT);
  for (const e of v.events) console.log('   EVENT', e.type, e.reason||'', (e.air||0).toFixed?.(2));
  v.events.length = 0;
  if (i % 12 == 0) console.log((i/120).toFixed(1), 's', v.trackS.toFixed(1), 'u', v.trackU.toFixed(1), 'spd', v.speed.toFixed(1), 'y-h', (v.pos.y - heightAt(W, v.pos.x, v.pos.z)).toFixed(2), 'pitch', v.groundPitch().toFixed(1), 'roll', (Math.atan2(v.left.y, v.up.y)*57.3).toFixed(1), 'thr', v.input.throttle.toFixed(2), 'br', v.input.brake.toFixed(2), 'st', v.input.steer.toFixed(2), v.wheels.map(w=>w.contact?'C':'-').join(''), v.crashed?'CRASHED':'');
}
