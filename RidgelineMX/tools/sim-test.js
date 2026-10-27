// Headless physics tests: runs the real vehicle code in Node.
//   node tools/sim-test.js            all checks
//   node tools/sim-test.js laps       only the AI lap test
import { TRACKS } from '../shared/tracks.js';
import { makeWorld } from '../shared/terrain.js';
import { VEHICLES } from '../shared/vehicles.js';
import { Vehicle, FIXED_DT } from '../client/js/sim/vehicle.js';
import { AIDriver } from '../client/js/sim/ai.js';
import { pointAt } from '../shared/trackgen.js';

const only = process.argv[2];
const worlds = {};
for (const d of TRACKS) worlds[d.id] = makeWorld(d);
// a flat test oval with 600 m straights, for clean acceleration / braking / turning numbers
const OVAL = {
  id: 'oval', name: 'Test Oval', worldSize: 900, seed: 1, start: { x: -300, z: 120, heading: 0 }, defaultWidth: 30,
  terrain: { hills: 0, hillScale: 100, rim: 0, rimStart: 999, bumps: [] },
  segments: [{ len: 600, free: true }, { turn: 180, r: 120, berm: 0 }, { len: 600, free: true }, { turn: 180, r: 120, berm: 0 }],
  gateAt: 10, finishAt: 50,
};
const W = makeWorld(OVAL);

function spawn(vid, world = W, s = world.T.gateS + 20, u = 0) {
  const v = new Vehicle(vid, world);
  const p = pointAt(world.T, s, u);
  v.placeAt(p.x, p.z, p.tx, p.tz);
  return v;
}
const f1 = (x) => x.toFixed(1), f2 = (x) => x.toFixed(2);
// simple lane keeping so straight-line tests stay straight
function keepLane(v, u = 0) {
  const p = pointAt(v.world.T, v.trackS + 12, u);
  const dx = p.x - v.pos.x, dz = p.z - v.pos.z;
  const xl = dx * v.left.x + dz * v.left.z, zf = dx * v.fwd.x + dz * v.fwd.z;
  v.input.steer = Math.max(-1, Math.min(1, Math.atan2(xl, zf) * 3));
}

if (!only || only === 'basic') {
  for (const vd of VEHICLES) {
    const v = spawn(vd.id);
    const y0 = v.pos.y;
    for (let i = 0; i < 240; i++) v.step(FIXED_DT);
    const settle = v.wheels.map((w) => f2(w.comp / w.cfg.travel)).join('/');
    console.log(`\n== ${vd.name}: rest drop ${f2(y0 - v.pos.y)} m, sag ${settle}, up.y ${f2(v.up.y)}, crashed ${v.crashed}`);
    // acceleration
    let t60 = null, maxP = -99;
    const marks = [];
    for (let i = 0; i < 120 * 7; i++) {
      v.input.throttle = 1; keepLane(v);
      v.step(FIXED_DT);
      maxP = Math.max(maxP, v.groundPitch());
      if (t60 === null && v.speed > 26.8) t60 = i / 120;
      if (i % 120 === 119) marks.push(`${(i + 1) / 120}s:${f1(v.speed * 2.237)}mph g${v.engine.gear}`);
    }
    console.log('  accel', marks.join(' '), '0-60', t60 ? f1(t60) + 's' : '-', 'max pitch', f1(maxP), 'crashed', v.crashed, v.crashReason);
    // braking from current speed
    const vb = v.speed; let tb = 0;
    while (v.speed > 1 && tb < 10) { v.input.throttle = 0; v.input.brake = 1; keepLane(v); v.step(FIXED_DT); tb += FIXED_DT; }
    console.log(`  brake ${f1(vb * 2.237)}->0 mph in ${f1(tb)} s (${f1(vb / tb)} m/s2) crashed ${v.crashed} ${v.crashReason}`);
  }
}

if (!only || only === 'turn') {
  // steady turning on the flat start straight
  for (const vd of VEHICLES) {
    const out = [];
    for (const target of [6, 10, 15, 20]) {
      const v = spawn(vd.id, W, W.T.gateS + 5, 0);
      v.input.brake = 0;
      // get up to speed then hold full lock
      let i = 0;
      while (v.speed < target && i < 2000) { v.input.throttle = 1; keepLane(v); v.step(FIXED_DT); i++; }
      let yaw = 0, n = 0, crashed = false, lean = 0, slip = 0;
      for (let k = 0; k < 120; k++) {
        v.input.throttle = v.speed < target ? 0.6 : 0.1; v.input.steer = 1;
        v.step(FIXED_DT);
        if (k > 60) { yaw += v.angVel.dot(v.up); n++; lean = Math.max(lean, v.lean); slip = Math.max(slip, v.wheels[v.wheels.length - 1].slipLat); }
        if (v.crashed) crashed = true;
      }
      const yr = yaw / n;
      out.push(`${target}m/s: r=${f1(v.speed / Math.max(1e-3, yr))}m lean ${f1(lean * 57.3)} slip ${f2(slip)}${crashed ? ' CRASH ' + v.crashReason : ''}`);
    }
    console.log(`  turn ${vd.name}: ${out.join(' | ')}`);
  }
}

if (!only || only === 'laps') {
  for (const tid of Object.keys(worlds)) {
    const world = worlds[tid];
    for (const vd of VEHICLES) {
      const v = spawn(vd.id, world, world.T.gateS, 0);
      const ai = new AIDriver(v, { skill: 1.0, lane: 0 });
      let dist = 0, lastS = v.trackS, crashes = [], maxAir = 0, maxSpeed = 0, resets = 0, t = 0;
      const reasons = {};
      let wasCrashed = false;
      const maxT = 300;
      while (dist < world.T.L * 2 && t < maxT) {
        ai.update(FIXED_DT);
        v.step(FIXED_DT);
        t += FIXED_DT;
        let d = v.trackS - lastS;
        if (d < -world.T.L / 2) d += world.T.L; if (d > world.T.L / 2) d -= world.T.L;
        if (Math.abs(d) < 30) dist += d; else resets++;
        lastS = v.trackS;
        maxAir = Math.max(maxAir, v.airTime);
        maxSpeed = Math.max(maxSpeed, v.speed);
        if (v.crashed && !wasCrashed) { crashes.push(`${v.crashReason}@${f1(v.trackS)}`); reasons[v.crashReason] = (reasons[v.crashReason] || 0) + 1; }
        wasCrashed = v.crashed;
        for (const e of v.events) if (e.type === 'reset') resets++;
        v.events.length = 0;
      }
      console.log(`${tid} ${vd.id}: 2 laps ${dist >= world.T.L * 2 ? f1(t) + 's' : 'DNF dist ' + f1(dist)} avg ${f1(dist / t * 2.237)}mph top ${f1(maxSpeed * 2.237)}mph air ${f2(maxAir)}s crashes ${crashes.length} ${crashes.slice(0, 6).join(', ')}`);
    }
  }
}
