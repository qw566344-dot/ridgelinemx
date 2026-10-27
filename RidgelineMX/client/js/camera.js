// =====================================================================
//  CAMERA
//  Modes (press C): Chase, Close chase, Helmet cam, Trackside (TV) cam.
//  The chase cams follow where the vehicle is GOING (velocity), ease
//  in behind it, pull back and widen the view with speed, look ahead,
//  never dip into the ground, and shake on hard landings.
//  Hold the right mouse button and drag to look around.
// =====================================================================
import * as THREE from 'three';
import { heightAt } from '/shared/terrain.js';
import { pointAt } from '/shared/trackgen.js';

export const CAMERA_MODES = ['Chase', 'Close Chase', 'Helmet', 'Trackside'];

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 0;
    this.pos = new THREE.Vector3(0, 10, -10);
    this.look = new THREE.Vector3();
    this.heading = new THREE.Vector3(0, 0, 1);
    this.fov = 65;
    this.shake = 0;
    this.shakeT = 0;
    this.orbitYaw = 0; this.orbitPitch = 0; this.orbitHold = 0;
    this.sensitivity = 1; this.mouseSens = 1; this.shakeScale = 1;
    this.tvPoint = null; this.tvTimer = 0;
    this.snapNext = true;
    this.orbit = { yaw: 0, t: 0 };
  }

  cycle() { this.mode = (this.mode + 1) % CAMERA_MODES.length; this.snapNext = true; this.tvPoint = null; return CAMERA_MODES[this.mode]; }
  setMode(i) { this.mode = i % CAMERA_MODES.length; this.snapNext = true; this.tvPoint = null; }
  addShake(a) { this.shake = Math.min(1.2, this.shake + a * this.shakeScale); }

  mouseLook(dx, dy) {
    this.orbitYaw -= dx * 0.005 * this.mouseSens;
    this.orbitPitch = Math.max(-0.5, Math.min(0.9, this.orbitPitch + dy * 0.004 * this.mouseSens));
    this.orbitHold = 1.5;
  }

  // target: { pos, quat, vel, speed, grounded } (interpolated render state)
  update(dt, target, world, riderHead) {
    const cam = this.camera;
    const spd = target.speed;
    // heading follows travel direction when moving, the vehicle's nose when slow
    const fwd = _v.set(0, 0, 1).applyQuaternion(target.quat);
    const vel = _v2.copy(target.vel);
    vel.y *= 0.25;
    const want = spd > 3 ? vel.normalize().lerp(fwd, 0.35) : fwd.clone();
    want.y = Math.max(-0.5, Math.min(0.5, want.y));
    want.normalize();
    const turnRate = (target.grounded ? 3.2 : 1.4) * this.sensitivity;
    this.heading.lerp(want, this.snapNext ? 1 : Math.min(1, dt * turnRate)).normalize();
    if (this.orbitHold > 0) this.orbitHold -= dt;
    else { this.orbitYaw *= 1 - Math.min(1, dt * 2.5); this.orbitPitch *= 1 - Math.min(1, dt * 2.5); }

    const mode = CAMERA_MODES[this.mode];
    let fovTarget = 62 + Math.min(16, spd * 0.45);
    const shake = this.shake;
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.shakeT += dt * 32;

    if (mode === 'Chase' || mode === 'Close Chase') {
      const close = mode === 'Close Chase';
      const dist = (close ? 3.6 : 5.6) + Math.min(close ? 1.0 : 2.2, spd * (close ? 0.04 : 0.08));
      const height = (close ? 1.45 : 2.2) + Math.min(0.6, spd * 0.02);
      const h = this.heading.clone();
      // mouse orbit
      h.applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.orbitYaw);
      const desired = target.pos.clone().addScaledVector(h, -dist);
      desired.y = target.pos.y + height + this.orbitPitch * 3 - h.y * dist * 0.5;
      // never inside the ground (check along the line to the bike too)
      for (let i = 0; i <= 4; i++) {
        const p = target.pos.clone().lerp(desired, i / 4);
        const gy = heightAt(world, p.x, p.z) + 0.6 + (i / 4) * 0.6;
        if (desired.y < gy) desired.y = gy;
      }
      const follow = this.snapNext ? 1 : Math.min(1, dt * (target.grounded ? 9 : 5) * this.sensitivity);
      this.pos.lerp(desired, follow);
      // vertical: softer so landings don't jerk the view
      const look = target.pos.clone().addScaledVector(h, close ? 3 : 5 + spd * 0.15);
      look.y = target.pos.y + (close ? 0.75 : 0.9);
      this.look.lerp(look, this.snapNext ? 1 : Math.min(1, dt * 10));
      cam.position.copy(this.pos);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.look);
    } else if (mode === 'Helmet') {
      // first person from the rider's eyes, follows the head (lean and all)
      const eye = riderHead ? riderHead.clone() : target.pos.clone().add(_v2.set(0, 0.9, 0));
      cam.position.copy(eye);
      const upv = new THREE.Vector3(0, 1, 0).applyQuaternion(target.quat).lerp(new THREE.Vector3(0, 1, 0), 0.4).normalize();
      if (target.lean) upv.applyAxisAngle(fwd, -target.lean * 0.6);
      const look = eye.clone().addScaledVector(fwd, 10).addScaledVector(this.heading, 4);
      look.y -= 1.2;
      look.applyAxisAngle(THREE.Object3D.DEFAULT_UP, 0);
      cam.up.copy(upv);
      cam.lookAt(look);
      fovTarget = 78 + Math.min(10, spd * 0.25);
      this.pos.copy(cam.position);
      this.look.copy(look);
    } else {
      // trackside TV camera: a fixed spot beside the track, zooming to follow
      const T = world.T;
      if (!this.tvPoint || this.tvTimer <= 0 || this.tvPoint.distanceTo(target.pos) > 70) {
        const s = (target.trackS || 0) + 30 + spd * 1.2;
        const side = Math.random() < 0.5 ? 1 : -1;
        const p = pointAt(T, s, side * (11 + Math.random() * 8));
        this.tvPoint = new THREE.Vector3(p.x, heightAt(world, p.x, p.z) + 2.5 + Math.random() * 3, p.z);
        this.tvTimer = 7;
      }
      this.tvTimer -= dt;
      cam.position.copy(this.tvPoint);
      cam.up.set(0, 1, 0);
      this.look.lerp(target.pos.clone().add(_v2.set(0, 0.6, 0)), this.snapNext ? 1 : Math.min(1, dt * 8));
      cam.lookAt(this.look);
      const d = this.tvPoint.distanceTo(target.pos);
      fovTarget = Math.max(14, Math.min(60, 1400 / Math.max(10, d)));
      this.pos.copy(cam.position);
    }
    if (shake > 0.01) {
      const a = shake * shake * 0.12;
      cam.position.x += Math.sin(this.shakeT * 1.3) * a;
      cam.position.y += Math.sin(this.shakeT * 1.7 + 1) * a;
      cam.rotation.z += Math.sin(this.shakeT * 2.1) * a * 0.15;
    }
    this.fov += (fovTarget - this.fov) * (this.snapNext ? 1 : Math.min(1, dt * 3));
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    this.snapNext = false;
  }

  // slow orbit around a point (main menu background)
  updateOrbit(dt, centre, world) {
    this.orbit.t += dt;
    const a = this.orbit.t * 0.05;
    const r = 70 + Math.sin(this.orbit.t * 0.07) * 20;
    const x = centre.x + Math.cos(a) * r, z = centre.z + Math.sin(a) * r;
    const y = Math.max(heightAt(world, x, z) + 12, centre.y + 18 + Math.sin(this.orbit.t * 0.11) * 6);
    this.camera.position.set(x, y, z);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(centre);
    if (this.camera.fov !== 55) { this.camera.fov = 55; this.camera.updateProjectionMatrix(); }
  }
}
