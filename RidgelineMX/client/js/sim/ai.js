// =====================================================================
//  AI RIDER
//  Drives a Vehicle using the same controls a player has.
//  - A speed plan for the whole lap (corners, berms, jumps) is worked out
//    once per track + vehicle type and shared by every AI rider.
//  - Steering = "pure pursuit": aim at a point a little way down the track.
//  - Each AI has a skill (speed), a preferred line and picks a lane in
//    split sections. Crashed / stuck riders reset themselves.
// =====================================================================
import { sampleArr, pointAt, wrapS } from '../../../shared/trackgen.js';

const G = 9.81;
const DEG = Math.PI / 180;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const profiles = new Map();

// Speed (m/s) the AI aims for at every point of the lap
export function speedProfile(T, cfg) {
  const key = T.id + ':' + cfg.type + ':' + cfg.id;
  if (profiles.has(key)) return profiles.get(key);
  const n = T.n, v = new Float32Array(n), want = new Float32Array(n).fill(0);
  const mu = cfg.type === 'bike' ? 0.95 : 0.85;
  for (let i = 0; i < n; i++) {
    const k = Math.abs(T.kappa[i]);
    const b = T.bank[i] * 0.55;
    const a = (G * (mu + b)) / Math.max(0.2, 1 - mu * b);
    v[i] = k > 1e-4 ? Math.sqrt(a / k) : 40;
    v[i] = Math.min(v[i], 31);
  }
  // jumps: hit each one at the speed that lands on the downslope
  for (const f of T.features) {
    const iFace = Math.floor(f.s0 / T.step);
    if (f.type === 'whoops') {
      for (let s = f.s0 - 6; s < f.s1; s += T.step) { const i = Math.floor(s / T.step) % n; v[i] = Math.min(v[i], cfg.type === 'bike' ? 16.5 : 14); }
      continue;
    }
    if (f.type === 'rollers') {
      if (f.h >= 0.85) for (let s = f.s0 - 6; s < f.s1; s += T.step) { const i = Math.floor(s / T.step) % n; v[i] = Math.min(v[i], 17); }
      continue;
    }
    const kn = f.knots;
    const lip = kn[2]; // end of the lip crest
    const lipFace = kn[1];
    const theta = Math.atan(lipFace.m);
    let target; // landing point measured from the feature start
    if (f.type === 'table') target = { x: kn[3].x + 1.5, h: kn[3].h - 0.15 };
    else if (f.type === 'step') target = { x: kn[5].x + 2.0, h: f.h2 };
    else { const top = kn[kn.length - 2]; target = { x: top.x + 2.5, h: top.h * 0.82 }; }
    const D = target.x - lip.x, drop = lip.h - target.h;
    const v2 = (G * D * D) / (2 * Math.cos(theta) ** 2 * (D * Math.tan(theta) + drop));
    const vLip = Math.sqrt(Math.max(4, v2)) * 1.05;
    const vFace = Math.sqrt(vLip * vLip + 2 * G * f.h * 0.4);
    for (let s = f.s0 - 14; s <= f.s0 + lip.x; s += T.step) {
      const i = ((Math.floor(s / T.step) % n) + n) % n;
      v[i] = Math.min(v[i], vFace);
      want[i] = vFace;
    }
    // after the landing let it run
    void iFace;
  }
  // braking zones: work backwards so the AI slows down before corners
  const decel = cfg.type === 'bike' ? 7.0 : 6.0;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = n - 1; i >= 0; i--) {
      const j = (i + 1) % n;
      const lim = Math.sqrt(v[j] * v[j] + 2 * decel * T.step);
      if (v[i] > lim) v[i] = lim;
    }
  }
  const prof = { v, want };
  profiles.set(key, prof);
  return prof;
}

export class AIDriver {
  constructor(veh, opts = {}) {
    this.veh = veh;
    this.skill = opts.skill ?? 0.95;
    this.laneOffset = opts.lane ?? 0;
    this.splitLane = opts.splitLane ?? (this.skill > 0.93 ? 'L' : 'R');
    this.prof = speedProfile(veh.world.T, veh.cfg);
    this.enabled = true;
    this.resetDelay = opts.resetDelay ?? 2.2;
    this.wobble = Math.random() * 100;
    veh.assist.landing = 1;
    veh.isAI = true;
  }

  targetU(s) {
    const T = this.veh.world.T;
    const hw = sampleArr(T, T.width, s) / 2;
    // split lane sections
    const fl = sampleArr(T, T.fL, s + 20), fr = sampleArr(T, T.fR, s + 20);
    const fl2 = sampleArr(T, T.fL, s), fr2 = sampleArr(T, T.fR, s);
    if (fl + fr + fl2 + fr2 > 0.05) return this.splitLane === 'L' ? hw * 0.5 : -hw * 0.5;
    const k = sampleArr(T, T.kappa, s);
    const b = sampleArr(T, T.bank, s);
    let u = this.laneOffset * Math.min(1, hw / 6);
    if (Math.abs(k) > 0.01) {
      if (b > 0.15) u = -Math.sign(k) * hw * 0.45 + this.laneOffset * 0.3; // ride the berm
      else u = Math.sign(k) * Math.min(hw - 2.5, Math.abs(k) * 50) + this.laneOffset * 0.3;
    }
    return clamp(u, -hw + 1.5, hw - 1.5);
  }

  update(dt) {
    const v = this.veh, T = v.world.T, inp = v.input, cfg = v.cfg;
    if (!this.enabled) return;
    if (v.crashed) {
      inp.throttle = 0; inp.brake = 0; inp.steer = 0;
      if (v.crashTime > this.resetDelay) v.resetToTrack(v.safeS, this.laneOffset);
      return;
    }
    if (v.stuckTime > 3 || v.offTrack > 1.2) { v.resetToTrack(v.safeS, this.laneOffset); return; }
    const spd = Math.max(0, v.fwdSpeed);
    const s = v.trackS;
    // --- steering: pure pursuit on a point down the track
    const Ld = clamp(4.5 + spd * 0.42, 5, 17);
    const sAim = s + Ld;
    const p = pointAt(T, sAim, this.targetU(sAim));
    const dx = p.x - v.pos.x, dz = p.z - v.pos.z;
    const xl = dx * v.left.x + dz * v.left.z, zf = dx * v.fwd.x + dz * v.fwd.z;
    const dist2 = xl * xl + zf * zf;
    const kappa = (2 * xl) / Math.max(4, dist2);
    let steer;
    const L = cfg.wheelbase;
    if (cfg.type === 'bike') {
      const va = Math.max(spd, 1);
      const kmax = Math.min(Math.tan(cfg.steer.maxLow * DEG) / L, cfg.steer.latAcc / (va * va));
      steer = kappa / kmax;
    } else {
      const t = clamp(spd / cfg.steer.highSpeed, 0, 1);
      const maxDeg = cfg.steer.maxLow + (cfg.steer.maxHigh - cfg.steer.maxLow) * Math.sqrt(t);
      steer = Math.atan(kappa * L) / (maxDeg * DEG);
    }
    if (zf < 0) steer = Math.sign(xl || 1); // target behind us: full lock
    inp.steer = clamp(steer, -1, 1);
    // --- speed
    const look = s + clamp(spd * 0.35, 1, 8);
    let vt = sampleArr(T, this.prof.v, look);
    const want = sampleArr(T, this.prof.want, look);
    const skill = want > 0 ? Math.max(this.skill, 0.985) : this.skill;
    vt *= skill;
    if (!v.grounded) { inp.throttle = 0.3; inp.brake = 0; inp.lean = 0; inp.rearBrake = 0; return; }
    const err = vt - spd;
    if (err > 0) { inp.throttle = clamp(err * 0.5 + 0.35, 0, 1); inp.brake = 0; }
    else if (err > -1.2) { inp.throttle = 0.15; inp.brake = 0; }
    else { inp.throttle = 0; inp.brake = clamp(-err * 0.35, 0, 1); }
    inp.lean = 0; inp.rearBrake = 0; inp.clutch = false;
  }
}
