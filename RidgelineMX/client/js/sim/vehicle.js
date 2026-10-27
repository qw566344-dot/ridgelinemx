// =====================================================================
//  VEHICLE PHYSICS CORE
//  A rigid body riding on raycast-style wheels: each wheel has a sprung,
//  damped suspension that finds the ground under it, and a tyre that
//  makes grip forces from slip. Bikes and quads share this core; what
//  makes them feel different lives in bike.js and atv.js.
//
//  Runs at a fixed 120 Hz (see FIXED_DT). No three.js scene objects
//  here - only math - so it also runs headless in Node for testing.
// =====================================================================
import * as THREE from '../../vendor/three.module.js';
import { groundAt, dirtAt } from '../../../shared/terrain.js';
import { prepareVehicle, getVehicle } from '../../../shared/vehicles.js';
import { locatePrecise, locate, sampleArr, pointAt, wrapS } from '../../../shared/trackgen.js';
import { BikeController } from './bike.js';
import { AtvController } from './atv.js';

export const FIXED_DT = 1 / 120;
export const GRAVITY = 9.81;

const V = () => new THREE.Vector3();
const g0 = { h: 0, nx: 0, ny: 1, nz: 0 };
const _t = [V(), V(), V(), V(), V(), V(), V(), V()];
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();

export class Vehicle {
  constructor(vehicleId, world, opts = {}) {
    this.def = getVehicle(vehicleId);
    this.cfg = prepareVehicle(this.def);
    this.world = world;
    this.id = opts.id ?? 0;
    this.isAI = !!opts.ai;
    this.pos = V(); this.vel = V(); this.angVel = V(); this.prevVel = V();
    this.landImpact = 0;
    this.quat = new THREE.Quaternion();
    this.prevPos = V(); this.prevQuat = new THREE.Quaternion();
    this.up = V(); this.fwd = V(); this.left = V();
    this.force = V(); this.torque = V();
    this.wheels = this.cfg.wheels.map((w) => ({
      cfg: w, comp: 0, prevComp: 0, compVel: 0, contact: false, ext: w.travel,
      spin: 0, spinVel: 0, load: 0, slipLong: 0, slipLat: 0, steer: 0,
      drive: 0, brake: 0, noLock: false, cp: V(), n: V(), centre: V(), surface: 1, wasContact: false,
      force: 0,
    }));
    this.input = { throttle: 0, brake: 0, steer: 0, rearBrake: 0, clutch: false, lean: 0 };
    this.engine = { rpm: this.cfg.engine.idle, gear: 1, shift: 0, reverse: false, reverseTimer: 0, dump: 0, prevClutch: false, limiter: false, load: 0 };
    this.assist = { landing: 0.6, traction: true, wheelie: true, ...(opts.assist || {}) };
    this.controller = this.cfg.type === 'bike' ? new BikeController(this) : new AtvController(this);
    this.speed = 0; this.fwdSpeed = 0;
    this.grounded = false; this.airTime = 0; this.groundTime = 0;
    this.crashed = false; this.crashTime = 0; this.crashReason = '';
    this.lean = 0; this.steerAngle = 0; this.pitchRel = 0;
    this.trackS = 0; this.trackU = 0; this.offTrack = 0; this.onFence = 0;
    this.stuckTime = 0; this.events = []; // landing / crash events for audio + camera
    this.lastLanding = 0; this.hardHit = 0;
    this.time = 0;
    this.safeS = 0;
  }

  // Put the vehicle on the ground at (x, z) facing (dx, dz)
  placeAt(x, z, dx, dz) {
    groundAt(this.world, x, z, g0);
    const up = _t[0].set(g0.nx, g0.ny, g0.nz);
    const fwd = _t[1].set(dx, 0, dz).normalize();
    fwd.addScaledVector(up, -fwd.dot(up)).normalize();
    const left = _t[2].crossVectors(up, fwd).normalize();
    _m.makeBasis(left, up, fwd);
    this.quat.setFromRotationMatrix(_m);
    this.pos.set(x, g0.h, z).addScaledVector(up, this.cfg.rideHeight + 0.02);
    this.vel.set(0, 0, 0); this.angVel.set(0, 0, 0);
    this.prevPos.copy(this.pos); this.prevQuat.copy(this.quat);
    for (const w of this.wheels) {
      w.comp = w.prevComp = w.cfg.sag * w.cfg.travel; w.contact = true; w.spinVel = 0; w.compVel = 0;
    }
    this.crashed = false; this.crashTime = 0; this.airTime = 0; this.groundTime = 1;
    this.lean = 0; this.offTrack = 0; this.stuckTime = 0;
    this.engine.gear = 1; this.engine.reverse = false; this.engine.rpm = this.cfg.engine.idle;
    this.controller.reset();
    const loc = locate(this.world.F, x, z);
    if (loc) { this.trackS = loc.s; this.trackU = loc.u; this.safeS = loc.s; }
  }

  // Put the vehicle back on the track near lap position s (searching backwards for flat ground)
  resetToTrack(s = this.safeS, u = 0) {
    const T = this.world.T;
    let ss = wrapS(T, s);
    for (let k = 0; k < 200; k++) {
      const i = Math.floor(ss / T.step) % T.n;
      if (T.flatSpawn[i]) break;
      ss = wrapS(T, ss - 1);
    }
    const hw = sampleArr(T, T.width, ss) / 2;
    const uu = Math.max(-hw + 1.8, Math.min(hw - 1.8, u));
    const p = pointAt(T, ss, uu);
    this.placeAt(p.x, p.z, p.tx, p.tz);
    this.trackS = ss; this.trackU = uu; this.safeS = ss;
    this.events.push({ type: 'reset' });
  }

  addForceAt(f, p) {
    this.force.add(f);
    const r = _t[7].subVectors(p, this.pos);
    this.torque.x += r.y * f.z - r.z * f.y;
    this.torque.y += r.z * f.x - r.x * f.z;
    this.torque.z += r.x * f.y - r.y * f.x;
  }

  step(dt) {
    const cfg = this.cfg, W = this.world;
    this.time += dt;
    this.prevPos.copy(this.pos); this.prevQuat.copy(this.quat); this.prevVel.copy(this.vel);
    this.hardHit = 0;
    this.up.set(0, 1, 0).applyQuaternion(this.quat);
    this.fwd.set(0, 0, 1).applyQuaternion(this.quat);
    this.left.set(1, 0, 0).applyQuaternion(this.quat);
    this.fwdSpeed = this.vel.dot(this.fwd);
    this.speed = this.vel.length();
    this.force.set(0, -cfg.mass * GRAVITY, 0);
    this.torque.set(0, 0, 0);

    if (this.crashed) { this.input.throttle = 0; this.input.brake = 0.3; this.input.steer = 0; this.input.lean = 0; this.input.rearBrake = 0.5; }
    this.updateEngine(dt);
    this.controller.preStep(dt);

    // --- wheels: suspension + tyres
    let contacts = 0;
    for (const w of this.wheels) { this.wheelStep(w, dt); if (w.contact) contacts++; }
    this.controller.afterWheels(dt);

    // --- body collision probes (frame, bars, helmet...)
    this.probeHits = this.probes(dt);

    // --- air drag
    const sp = this.speed;
    if (sp > 0.01) this.force.addScaledVector(this.vel, -0.5 * 1.2 * cfg.cdA * sp);

    this.controller.torques(dt, contacts);
    this.trackBounds(dt);

    // --- integrate (semi-implicit Euler)
    this.vel.addScaledVector(this.force, dt / cfg.mass);
    const tb = _t[0].copy(this.torque).applyQuaternion(_q.copy(this.quat).invert());
    tb.x /= cfg.inertia[0]; tb.y /= cfg.inertia[1]; tb.z /= cfg.inertia[2];
    tb.applyQuaternion(this.quat);
    this.angVel.addScaledVector(tb, dt);
    const wl = this.angVel.length();
    if (wl > 25) this.angVel.multiplyScalar(25 / wl);
    this.pos.addScaledVector(this.vel, dt);
    const q = this.quat, w = this.angVel;
    const qx = q.x, qy = q.y, qz = q.z, qw = q.w, h = 0.5 * dt;
    q.x += h * (w.x * qw + w.y * qz - w.z * qy);
    q.y += h * (w.y * qw + w.z * qx - w.x * qz);
    q.z += h * (w.z * qw + w.x * qy - w.y * qx);
    q.w += h * (-w.x * qx - w.y * qy - w.z * qz);
    q.normalize();

    // --- safety: never below the ground, never NaN
    groundAt(W, this.pos.x, this.pos.z, g0);
    const minY = g0.h + 0.12;
    if (this.pos.y < minY) {
      this.pos.y = minY;
      if (this.vel.y < 0) this.vel.y *= 0.2;
    }
    if (!Number.isFinite(this.pos.x + this.pos.y + this.pos.z + q.x + q.y + q.z + q.w + this.vel.x + this.angVel.x)) {
      this.resetToTrack(this.safeS);
      return;
    }

    // --- bookkeeping
    const wasGrounded = this.grounded;
    this.grounded = contacts > 0;
    if (this.grounded) { this.groundTime += dt; } else { this.airTime += dt; this.groundTime = 0; }
    if (this.grounded && !wasGrounded) {
      this.events.push({ type: 'land', air: this.airTime, impact: this.hardHit });
      this.lastLanding = this.airTime;
    }
    if (this.grounded && this.groundTime > 0.15) this.airTime = 0;
    this.controller.postStep(dt, wasGrounded);

    if (this.crashed) this.crashTime += dt;
    // remember a safe place to reset to
    if (!this.crashed && this.grounded && this.offTrack === 0 && Math.abs(this.trackU) < sampleArr(W.T, W.T.width, this.trackS) / 2) {
      const i = Math.floor(this.trackS / W.T.step) % W.T.n;
      if (W.T.flatSpawn[i]) this.safeS = this.trackS;
    }
    // stuck detection (AI and players get a hint / auto reset)
    if (!this.crashed && this.speed < 0.7 && (this.input.throttle > 0.3 || this.isAI)) this.stuckTime += dt;
    else this.stuckTime = Math.max(0, this.stuckTime - dt * 2);
  }

  crash(reason) {
    if (this.crashed) return;
    this.crashed = true; this.crashTime = 0; this.crashReason = reason;
    this.events.push({ type: 'crash', reason, speed: this.speed });
  }

  // --- Engine and gearbox ----------------------------------------------------
  updateEngine(dt) {
    const e = this.engine, ec = this.cfg.engine, inp = this.input;
    const driven = this.wheels.filter((w) => w.cfg.driven);
    const r = driven[0].cfg.r;
    const anyDrivenContact = driven.some((w) => w.contact);
    // reverse gear: hold brake at a standstill
    const v = this.fwdSpeed;
    if (!e.reverse && Math.abs(v) < 0.8 && inp.brake > 0.5 && inp.throttle < 0.1 && this.grounded) {
      e.reverseTimer += dt;
      if (e.reverseTimer > 0.35) { e.reverse = true; e.reverseTimer = 0; }
    } else if (!e.reverse) e.reverseTimer = 0;
    if (e.reverse && (inp.throttle > 0.1 || v > 1.5)) e.reverse = false;

    let throttle = inp.throttle;
    if (e.reverse) throttle = inp.brake;
    const ratio = e.reverse ? ec.ratios[0] * 1.2 : ec.ratios[e.gear - 1];
    const wheelRpm = (Math.abs(v) / r) * ratio * 9.5493;
    const clutchIn = inp.clutch;
    if (e.prevClutch && !clutchIn && e.rpm > ec.redline * 0.6) e.dump = 0.35;
    e.prevClutch = clutchIn;
    e.dump = Math.max(0, e.dump - dt);
    if (e.shift > 0) e.shift -= dt;

    let slip = 0;
    for (const w of driven) slip = Math.max(slip, w.slipLong);
    let target;
    if (clutchIn || !anyDrivenContact) {
      target = ec.idle + throttle * (ec.redline * 1.02 - ec.idle);
    } else if (wheelRpm < ec.idle * 1.3) {
      target = ec.idle + throttle * (ec.redline * 0.55 - ec.idle); // clutch slipping at launch
      target = Math.max(target, wheelRpm);
    } else {
      target = wheelRpm * (1 + slip * 0.35);
    }
    const rate = clutchIn || !anyDrivenContact ? 10 : 30;
    e.rpm += (target - e.rpm) * Math.min(1, rate * dt);
    e.limiter = e.rpm > ec.redline;
    if (e.rpm > ec.redline * 1.03) e.rpm = ec.redline * 1.03;

    // torque curve lookup
    const tc = ec.torque;
    let tq = tc[tc.length - 1][1];
    for (let i = 0; i < tc.length - 1; i++) {
      if (e.rpm <= tc[i + 1][0]) {
        const a = tc[i], b = tc[i + 1];
        const t = Math.max(0, (e.rpm - a[0]) / (b[0] - a[0]));
        tq = a[1] + (b[1] - a[1]) * t;
        break;
      }
    }
    let T = throttle * tq * (e.limiter ? 0.05 : 1);
    if (throttle < 0.05 && !e.reverse) T -= ec.engineBrake * (e.rpm / ec.redline);
    if (e.dump > 0) T *= 1.6;
    let force = (T * ratio * 0.9) / r;
    if (clutchIn || e.shift > 0) force = 0;
    if (e.reverse) {
      force = Math.abs(force);
      const over = -v - ec.reverseSpeed;
      force = over > 0 ? 0 : -force * Math.min(1, -over * 0.5 + 0.2);
    }
    if (!e.reverse && v < -0.5 && throttle > 0) force = Math.abs(force);
    e.load = throttle;
    e.force = force;

    // automatic gearbox
    if (!e.reverse && e.shift <= 0 && anyDrivenContact && !clutchIn) {
      if (e.rpm > ec.redline * ec.shiftUp && e.gear < ec.ratios.length && slip < 0.3) { e.gear++; e.shift = ec.shiftTime; }
      else if (e.gear > 1 && wheelRpm * (ec.ratios[e.gear - 2] / ratio) < ec.redline * 0.88 && e.rpm < ec.redline * ec.shiftDown) { e.gear--; e.shift = ec.shiftTime * 0.6; }
    }
    // share drive between driven wheels in contact
    const n = driven.filter((w) => w.contact).length || 1;
    for (const w of this.wheels) w.drive = w.cfg.driven && w.contact ? force / n : 0;
  }

  // --- One wheel: find the ground, spring/damper, tyre grip ---------------------
  wheelStep(w, dt) {
    const c = w.cfg, W = this.world;
    const up = this.up;
    const mount = _t[1].set(c.x, c.y, c.z).applyQuaternion(this.quat).add(this.pos);
    const dX = -up.x, dY = -up.y, dZ = -up.z; // suspension travel direction
    // first guess: ground straight below the mount
    groundAt(W, mount.x, mount.z, g0);
    let dn = dX * g0.nx + dY * g0.ny + dZ * g0.nz;
    w.wasContact = w.contact;
    let ext = c.travel + 1;
    if (dn < -0.3) {
      ext = ((mount.y - g0.h) * g0.ny - c.r) / -dn;
      // refine: re-sample ground where the tyre actually touches
      for (let it = 0; it < 2; it++) {
        const cx = mount.x + dX * ext - g0.nx * c.r, cz = mount.z + dZ * ext - g0.nz * c.r;
        groundAt(W, cx, cz, g0);
        dn = dX * g0.nx + dY * g0.ny + dZ * g0.nz;
        if (dn >= -0.3) { ext = c.travel + 1; break; }
        // signed distance of mount from the plane through (cx, h, cz)
        const dist = (mount.x - cx) * g0.nx + (mount.y - g0.h) * g0.ny + (mount.z - cz) * g0.nz;
        ext = (dist - c.r) / -dn;
      }
    }
    if (ext > c.travel) {
      // wheel hanging in the air
      // wheel hanging in the air: spring pushes it out to full extension
      w.contact = false; w.load = 0; w.force = 0;
      w.ext = Math.min(c.travel, w.ext + dt * 2.5);
      w.prevComp = w.comp; w.comp = c.travel - w.ext; w.compVel = 0;
      w.slipLong = 0; w.slipLat = 0;
      if (w.cfg.driven) w.spinVel += ((this.engine.rpm / 9.5493 / this.cfg.engine.ratios[this.engine.gear - 1]) - w.spinVel) * Math.min(1, dt * 6) * (this.input.rearBrake > 0.2 ? 0 : 1);
      else w.spinVel *= 1 - dt * 0.4;
      if (this.input.rearBrake > 0.2 && w.cfg.brake === 'rear') w.spinVel *= 1 - dt * 15;
      w.spin += w.spinVel * dt;
      w.centre.set(c.x, c.y - w.ext, c.z).applyQuaternion(this.quat).add(this.pos);
      return;
    }
    w.contact = true;
    const n = w.n.set(g0.nx, g0.ny, g0.nz);
    const comp = c.travel - ext;
    w.prevComp = w.comp;
    w.comp = comp;
    w.ext = Math.max(0, ext);
    let cv = (comp - w.prevComp) / dt;
    if (!w.wasContact) cv = Math.min(cv, 6);
    cv = Math.max(-8, Math.min(8, cv));
    w.compVel = cv;
    const cc = Math.min(comp, c.travel);
    let F = c.preload + c.k * cc + c.k3 * cc * cc * cc;
    F += cv > 0 ? c.cBump * cv : c.cRebound * cv;
    if (comp > c.travel) {
      // bottomed out: hard bump stop
      const over = comp - c.travel;
      F += c.k * 25 * over + c.cBump * 4 * Math.max(0, cv);
      this.hardHit = Math.max(this.hardHit, cv);
      if (over > 0.06) {
        // never let the wheel sink into the ground
        this.pos.addScaledVector(up, (over - 0.06) * Math.max(0.2, up.dot(n)));
        const into = this.vel.dot(n);
        if (into < 0) this.vel.addScaledVector(n, -into * 0.6);
      }
    }
    F = Math.max(0, F);
    w.force = F;
    const centre = w.centre.set(mount.x + dX * w.ext, mount.y + dY * w.ext, mount.z + dZ * w.ext);
    this.addForceAt(_t[2].copy(up).multiplyScalar(F), centre);

    // --- tyre
    const N = F * Math.max(0, up.dot(n));
    w.load = N;
    const cp = w.cp.copy(centre).addScaledVector(n, -c.r);
    // wheel heading on the ground plane
    const fw = _t[3].copy(this.fwd);
    if (w.steer !== 0) fw.applyAxisAngle(up, w.steer);
    fw.addScaledVector(n, -fw.dot(n)).normalize();
    const side = _t[4].crossVectors(n, fw); // left
    const r = _t[5].subVectors(cp, this.pos);
    const vp = _t[6].crossVectors(this.angVel, r).add(this.vel);
    const vl = vp.dot(fw), vs = vp.dot(side);
    const dirt = dirtAt(W, cp.x, cp.z);
    w.surface = dirt;
    const surf = 0.8 + 0.2 * dirt;
    const loadRatio = N / c.staticLoad;
    const mu = c.mu * surf * Math.max(0.75, 1.08 - 0.08 * loadRatio) * (this.crashed ? 0.6 : 1);
    const Fmax = mu * N;
    // longitudinal
    let Fl = w.drive;
    if (this.assist.traction && w.drive !== 0) Fl = Math.sign(Fl) * Math.min(Math.abs(Fl), Fmax * 1.22);
    const brakeF = w.brake;
    if (brakeF > 0) {
      let b = brakeF * Math.max(-1, Math.min(1, vl / 0.6));
      if (w.noLock) b = Math.sign(b) * Math.min(Math.abs(b), Fmax * (w.lockCap || 0.82));
      Fl -= b;
    }
    Fl -= this.cfg.crr * N * Math.max(-1, Math.min(1, vl / 0.5)); // rolling resistance
    let excess = 0;
    const absFl = Math.abs(Fl);
    if (absFl > Fmax) {
      excess = Math.min(1, absFl / Math.max(1, Fmax) - 1);
      Fl = Math.sign(Fl) * Fmax * (1 - 0.15 * excess);
    }
    w.slipLong = excess;
    // lateral
    const alpha = Math.atan2(vs, Math.max(Math.abs(vl), 2.2));
    const avail = Math.sqrt(Math.max(0, Fmax * Fmax - Fl * Fl)) * (1 - 0.5 * excess);
    const x = Math.abs(alpha) / c.alphaPeak;
    const shape = x < 1 ? 2 * x - x * x : 1 - 0.2 * Math.min(1, (x - 1) / 2.5);
    const Fs = -Math.sign(vs) * avail * shape;
    w.slipLat = x;
    // apply: longitudinal at the contact patch, lateral raised toward the roll centre
    // drive / brake force: raised part-way toward the CoM by pitchCentre
    // (the rider shifting their weight keeps the bike from wheelie-ing / stoppie-ing at every touch of the controls)
    const below = r.dot(up); // negative: contact is below the CoM
    const longPt = _t[0].copy(cp).addScaledVector(up, -below * this.controller.pitchCentre);
    this.addForceAt(_t[2].copy(fw).multiplyScalar(Fl), longPt);
    const rc = this.controller.rollCentre;
    const lift = below * -rc;
    const latPt = _t[5].copy(cp).addScaledVector(up, lift);
    this.addForceAt(_t[2].copy(side).multiplyScalar(Fs), latPt);
    // wheel spin for visuals / effects
    let spinV = vl / c.r;
    if (excess > 0 && w.drive * vl >= 0 && w.cfg.driven && Math.abs(w.drive) > 0) spinV *= 1 + excess * 1.5 + 0.2;
    if (excess > 0 && brakeF > 0 && !w.cfg.driven) spinV *= 1 - excess;
    if (excess > 0.3 && brakeF > 0) spinV *= 0.1;
    w.spinVel = spinV;
    w.spin += spinV * dt;
  }

  // --- Body collision points ----------------------------------------------------
  probes(dt) {
    const W = this.world, m = this.cfg.mass;
    let hit = null;
    for (const p of this.cfg.probes) {
      if (p.hit === 'rider' && this.crashed) continue; // the rider has already come off
      const pw = _t[1].set(p.p[0], p.p[1], p.p[2]).applyQuaternion(this.quat).add(this.pos);
      groundAt(W, pw.x, pw.z, g0);
      const pen = p.r - (pw.y - g0.h) * g0.ny;
      if (pen <= 0) continue;
      const n = _t[2].set(g0.nx, g0.ny, g0.nz);
      const r = _t[3].subVectors(pw, this.pos);
      const vp = _t[4].crossVectors(this.angVel, r).add(this.vel);
      const vn = vp.dot(n);
      const k = m * 320, c = m * 22;
      const Fn = Math.max(0, k * pen - c * vn);
      const vt = _t[5].copy(vp).addScaledVector(n, -vn);
      const vtl = vt.length();
      const fr = p.hit === 'skid' ? 0.35 : 0.65;
      const Ff = vt.multiplyScalar(-(fr * Fn) / Math.max(vtl, 0.5));
      const f = _t[6].copy(n).multiplyScalar(Fn).add(Ff);
      this.addForceAt(f, pw);
      if (pen > 0.12) {
        this.pos.addScaledVector(n, (pen - 0.12) * 0.5);
        if (vn < 0) this.vel.addScaledVector(n, -vn * 0.3);
      }
      if (!hit || (p.hit !== 'skid' && p.hit !== 'soft')) hit = { type: p.hit, impact: -vn, pen };
    }
    return hit;
  }

  // --- Track fences keep riders on the course -----------------------------------
  trackBounds(dt) {
    const W = this.world, T = W.T;
    let loc = locatePrecise(T, W.F, this.pos.x, this.pos.z, this.trackS);
    if (!loc || Math.abs(loc.u) > 40) loc = locatePrecise(T, W.F, this.pos.x, this.pos.z, null);
    this.onFence = 0;
    if (!loc) { this.offTrack += dt; return; }
    this.trackS = loc.s; this.trackU = loc.u;
    const limL = sampleArr(T, T.fenceL, loc.s) - 0.7;
    const limR = sampleArr(T, T.fenceR, loc.s) - 0.7;
    const p = pointAt(T, loc.s, 0);
    // left normal (tz, 0, -tx)
    let over = 0, nx = 0, nz = 0;
    if (loc.u > limL) { over = loc.u - limL; nx = -p.tz; nz = p.tx; }
    else if (loc.u < -limR) { over = -limR - loc.u; nx = p.tz; nz = -p.tx; }
    if (over > 0) {
      const m = this.cfg.mass;
      const vin = this.vel.x * nx + this.vel.z * nz;
      const push = m * 80 * Math.min(over, 3) + m * 7 * Math.max(0, -vin);
      this.force.x += nx * push; this.force.z += nz * push;
      // the tape drags along the rider
      const tx = this.vel.x - nx * vin, tz = this.vel.z - nz * vin;
      this.force.x -= tx * m * 1.4; this.force.z -= tz * m * 1.4;
      this.onFence = Math.min(1, over);
      if (over > 4) this.offTrack += dt; else this.offTrack = 0;
    } else this.offTrack = 0;
  }

  // Pitch of the body relative to the ground under it, degrees (nose up = positive)
  groundPitch() {
    groundAt(this.world, this.pos.x, this.pos.z, g0);
    const d = this.fwd.x * g0.nx + this.fwd.y * g0.ny + this.fwd.z * g0.nz;
    return Math.asin(Math.max(-1, Math.min(1, d))) * 57.2958;
  }

  // Snapshot used by networking and replays
  snapshot() {
    const w = this.wheels;
    return {
      p: [this.pos.x, this.pos.y, this.pos.z], q: [this.quat.x, this.quat.y, this.quat.z, this.quat.w],
      v: [this.vel.x, this.vel.y, this.vel.z], lean: this.lean, steer: this.steerAngle,
      susp: w.map((x) => x.comp), rpm: this.engine.rpm, thr: this.input.throttle, crashed: this.crashed,
    };
  }
}
