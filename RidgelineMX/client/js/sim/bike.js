// =====================================================================
//  DIRT BIKE HANDLING
//  - Steering is lean-driven: the input asks for a turn, the bike picks
//    a steering angle that gives that turn at the current speed, so it
//    turns tight when slow and leans into long arcs when fast.
//  - The rider keeps the bike upright (a balance torque), so it only
//    falls when you crash.
//  - In the air: Q / E rotate the bike, throttle lifts the nose (rear
//    wheel gyro), the rear brake drops it. Landing assist nudges the
//    bike toward the landing slope when you are not pressing Q / E.
// =====================================================================
import * as THREE from '../../vendor/three.module.js';
import { groundAt } from '../../../shared/terrain.js';

const DEG = Math.PI / 180;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const g0 = { h: 0, nx: 0, ny: 1, nz: 0 };
const _n = new THREE.Vector3(), _d = new THREE.Vector3(), _c = new THREE.Vector3(), _p = new THREE.Vector3();

export class BikeController {
  constructor(veh) {
    this.v = veh;
    this.rollCentre = 1.0; // tyre side forces act at the CoM: the lean balances them
    this.pitchCentre = 0.5; // the rider's body position soaks up half the wheelie / stoppie torque
    this.reset();
  }

  reset() {
    this.steer = 0; this.slideTime = 0; this.rollErr = 0; this.upsideTime = 0;
    this.landTarget = null; this.footDown = 0;
  }

  preStep(dt) {
    const v = this.v, c = v.cfg, inp = v.input;
    const rate = c.steer.rate * (Math.sign(inp.steer) !== Math.sign(this.steer) ? 1.6 : 1);
    this.steer += clamp(inp.steer - this.steer, -rate * dt, rate * dt);
    const spd = v.fwdSpeed;
    const L = c.wheelbase;
    const yawRate = v.angVel.dot(v.up);
    const front = v.wheels[0], rear = v.wheels[1];
    let delta;
    if (v.grounded) {
      const va = Math.max(Math.abs(spd), 1.0);
      const kLow = Math.tan(c.steer.maxLow * DEG) / L;
      const kmax = Math.min(kLow, c.steer.latAcc / (va * va));
      const kt = this.steer * kmax;
      this.yawTarget = kt * Math.max(0, spd);
      if (spd > -0.5) {
        delta = Math.atan(kt * L) + (c.steer.feedback * (kt * va - yawRate)) / Math.max(va, 4);
        const dmax = Math.min(c.steer.maxLow * DEG, Math.atan(kmax * L) * 2 + 4 * DEG);
        delta = clamp(delta, -dmax, dmax);
      } else delta = this.steer * c.steer.maxLow * DEG * 0.6;
    } else delta = this.steer * 14 * DEG;
    v.steerAngle += (delta - v.steerAngle) * Math.min(1, dt * 25);
    front.steer = v.grounded ? v.steerAngle : 0;

    // brakes: S = both (front can't lock - the rider modulates it), Space = rear only (locks)
    let fb = inp.brake, rb = Math.max(inp.brake * 0.65, inp.rearBrake);
    if (v.engine.reverse) { fb = inp.throttle; rb = inp.throttle * 0.6; }
    front.brake = fb * c.brakes.front; front.noLock = true;
    rear.brake = rb * c.brakes.rear * (inp.rearBrake > 0.1 ? 1.3 : 1); rear.noLock = inp.rearBrake < 0.1; rear.lockCap = 0.55;

    // wheelie / stoppie control: the rider eases off the throttle or the
    // front brake when one end lifts too far (hold Q to wheelie on purpose)
    if (v.assist.wheelie && v.grounded) {
      const p = v.groundPitch();
      if (!front.contact && inp.lean >= 0 && p > 4) rear.drive *= clamp(1 - (p - 4) / 9, 0.12, 1);
      if (p < -3) front.brake *= clamp(1 - (-p - 3) / 7, 0.1, 1);
      if (!rear.contact) front.brake *= 0.5;
    }
  }

  afterWheels() {}

  torques(dt, contacts) {
    const v = this.v, c = v.cfg, inp = v.input, I = c.inertia;
    const fwd = v.fwd, up = v.up, left = v.left;
    const rollW = v.angVel.dot(fwd);
    const pitchW = v.angVel.dot(left); // + = nose dropping
    const yawW = v.angVel.dot(up);

    // visual lean (and what the rider's body does)
    let leanTarget;
    if (v.grounded) {
      const aLat = v.fwdSpeed * yawW;
      leanTarget = clamp(Math.atan(aLat / 9.81), -c.lean.max * DEG, c.lean.max * DEG);
      if (Math.abs(v.fwdSpeed) < 2.5) leanTarget *= Math.abs(v.fwdSpeed) / 2.5;
    } else leanTarget = this.steer * 0.45;
    v.lean += (leanTarget - v.lean) * Math.min(1, dt * c.lean.rate);
    this.footDown += ((v.speed < 1.2 && v.grounded && !v.crashed ? 1 : 0) - this.footDown) * Math.min(1, dt * 5);

    if (v.crashed) return;

    if (contacts > 0) {
      // keep the bike square to the ground under it (the rider balances it)
      _n.set(0, 0, 0);
      for (const w of v.wheels) if (w.contact) _n.add(w.n);
      _n.normalize();
      const e = Math.atan2(_n.dot(left), _n.dot(up));
      this.rollErr = e;
      let tr = -c.balance.rollK * e - c.balance.rollC * rollW;
      tr = clamp(tr, -9000, 9000);
      v.torque.addScaledVector(fwd, tr);
      // stability: the rider steers to hold the line they asked for, so the
      // rear only steps out when you make it (rear brake / big throttle)
      const front = v.wheels[0], rear = v.wheels[1];
      const sliding = inp.rearBrake > 0.1 || rear.slipLong > 0.4;
      if (v.speed < 2.5) {
        v.torque.addScaledVector(up, -yawW * I[1] * 6);
      } else {
        // beta = how far the bike points away from where it is going
        const vf = v.vel.dot(fwd), vlat = v.vel.dot(left);
        const beta = Math.atan2(vlat, Math.abs(vf));
        const yawKin = (vf * Math.tan(v.steerAngle)) / c.wheelbase;
        const ka = sliding ? 3 : 14 + 10 * inp.brake, kd = sliding ? 0.6 : 2.5;
        v.torque.addScaledVector(up, (ka * beta - kd * (yawW - yawKin)) * I[1]);
      }
      // rider weight shift (E forward / Q back)
      let tp = inp.lean * 330;
      // on one wheel the rider moves their weight to bring it back down
      if (v.assist.wheelie && front.contact !== rear.contact) {
        const p = v.groundPitch();
        if (p > 3 && inp.lean >= 0) tp += ((p - 3) * DEG * 60 + pitchW * -4) * I[0];
        if (p < -4) tp -= ((-p - 4) * DEG * 30 + pitchW * 3) * I[0];
      }
      v.torque.addScaledVector(left, tp);
    } else {
      // --- in the air
      let tp = inp.lean * c.air.pitchAccel * I[0];
      tp -= inp.throttle * c.air.gyro * I[0] * 0.45;
      tp += inp.rearBrake * c.air.gyro * I[0] * 1.1;
      tp -= pitchW * c.air.damping * I[0];
      if (Math.abs(inp.lean) < 0.1 && v.assist.landing > 0 && v.airTime > 0.08) {
        const desired = this.landingDirection();
        if (desired) {
          _c.crossVectors(fwd, desired);
          const e = Math.atan2(_c.dot(left), fwd.dot(desired));
          tp += (e * 16 - pitchW * 3.2) * I[0] * v.assist.landing;
        }
      }
      v.torque.addScaledVector(left, tp);
      // level the bike sideways (relative to the sky)
      const e = Math.atan2(left.y, up.y);
      this.rollErr = 0;
      v.torque.addScaledVector(fwd, -c.air.rollLevel * c.balance.airRollK / 6 * e - c.balance.airRollC * rollW);
      // a little whip / scrub with the steering
      v.torque.addScaledVector(up, (this.steer * c.steer.airYaw - yawW * 1.4) * I[1]);
    }
  }

  // Predict where the bike lands and return the slope direction there
  landingDirection() {
    const v = this.v, W = v.world;
    _p.copy(v.pos); _d.copy(v.vel);
    const dt = 0.05;
    for (let i = 0; i < 60; i++) {
      _p.addScaledVector(_d, dt); _d.y -= 9.81 * dt;
      groundAt(W, _p.x, _p.z, g0);
      if (_p.y - v.cfg.rideHeight * 0.8 <= g0.h) break;
    }
    _n.set(g0.nx, g0.ny, g0.nz);
    _d.copy(v.vel); _d.y = 0;
    if (_d.lengthSq() < 1) _d.copy(v.fwd);
    _d.addScaledVector(_n, -_d.dot(_n)).normalize();
    return _d;
  }

  postStep(dt, wasGrounded) {
    const v = this.v, c = v.cfg.crash;
    if (v.crashed) return;
    const fwd = v.fwd;
    // landing
    if (v.grounded && !wasGrounded && v.airTime > 0.3) {
      const p = v.groundPitch();
      groundAt(v.world, v.pos.x, v.pos.z, g0);
      const vin = -(v.prevVel.x * g0.nx + v.prevVel.y * g0.ny + v.prevVel.z * g0.nz);
      v.landImpact = vin;
      if (p > c.landPitch) return v.crash('Looped out on the landing');
      if (p < -c.landPitch) return v.crash('Nose-dived the landing');
      if (vin > c.impact) return v.crash('Landed way too hard');
    }
    const hit = v.probeHits;
    if (hit) {
      if (hit.type === 'rider' && (hit.impact > 1.0 || hit.pen > 0.08)) return v.crash('Went over the bars');
      if (hit.type === 'hard' && hit.impact > 3.5) return v.crash('Clipped the ground');
      if (hit.type === 'hard' && v.airTime > 0.25 && hit.impact > 2) return v.crash('Clipped the ground');
    }
    if (Math.abs(this.rollErr) > c.roll * DEG) return v.crash('Lost the balance');
    if (v.grounded && v.speed > 6) {
      const beta = Math.atan2(v.vel.dot(v.left), v.vel.dot(fwd)) / DEG;
      if (Math.abs(beta) > c.slide) { this.slideTime += dt; if (this.slideTime > 0.2) return v.crash('Low-sided'); }
      else this.slideTime = 0;
    }
    if (v.grounded) {
      const p = v.groundPitch();
      if (p > c.loop) return v.crash('Looped it out');
    }
    if (v.up.y < 0.15) { this.upsideTime += dt; if (v.grounded || this.upsideTime > 1.5) return v.crash('Upside down'); }
    else this.upsideTime = 0;
  }
}
