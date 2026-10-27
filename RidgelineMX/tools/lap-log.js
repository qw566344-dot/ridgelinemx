// Detailed AI lap log: every jump, landing and crash with where it happened.
//   node tools/lap-log.js ridgeline atv450 [laps]
import { getTrack } from '../shared/tracks.js';
import { makeWorld } from '../shared/terrain.js';
import { Vehicle, FIXED_DT } from '../client/js/sim/vehicle.js';
import { AIDriver } from '../client/js/sim/ai.js';
import { pointAt, sampleArr } from '../shared/trackgen.js';

const [tid = 'ridgeline', vid = 'mx450', laps = '1'] = process.argv.slice(2);
const W = makeWorld(getTrack(tid));
const T = W.T;
const v = new Vehicle(vid, W);
const p = pointAt(T, T.gateS, 0);
v.placeAt(p.x, p.z, p.tx, p.tz);
const ai = new AIDriver(v, { skill: 1, lane: 0 });
const where = (s) => {
  const f = T.features.find((f) => s >= f.s0 - 3 && s <= f.s1 + 3);
  const sec = T.sections.find((x) => s >= x.s0 && s < x.s1);
  return (f ? f.type + '@' + f.segName : sec ? sec.name : 'turn') + ' s=' + s.toFixed(0);
};
let dist = 0, last = v.trackS, t = 0, takeoff = null;
const f1 = (x) => x.toFixed(1);
while (dist < T.L * Number(laps) && t < 400) {
  ai.update(FIXED_DT);
  const wasG = v.grounded;
  v.step(FIXED_DT);
  t += FIXED_DT;
  let d = v.trackS - last; if (d < -T.L / 2) d += T.L; if (d > T.L / 2) d -= T.L;
  if (Math.abs(d) < 30) dist += d;
  last = v.trackS;
  if (wasG && !v.grounded) takeoff = { s: v.trackS, v: v.speed, t };
  for (const e of v.events) {
    if (e.type === 'land' && e.air > 0.35 && takeoff) {
      console.log(`  jump ${where(takeoff.s)} at ${f1(takeoff.v * 2.237)}mph  air ${e.air.toFixed(2)}s  dist ${f1(v.trackS - takeoff.s)}m  land pitch ${f1(v.groundPitch())} impact ${f1(v.landImpact)}`);
    }
    if (e.type === 'crash') {
      const roll = Math.atan2(v.left.y, v.up.y) * 57.3;
      console.log(`CRASH ${e.reason} ${where(v.trackS)} u=${f1(v.trackU)} spd ${f1(v.speed * 2.237)}mph air ${v.airTime.toFixed(2)} pitch ${f1(v.groundPitch())} roll ${f1(roll)} bank ${sampleArr(T, T.bank, v.trackS).toFixed(2)}`);
    }
    if (e.type === 'reset') console.log(`  reset -> s=${v.trackS.toFixed(0)}`);
  }
  v.events.length = 0;
}
console.log(`${tid} ${vid}: ${f1(dist)} m in ${f1(t)} s`);
