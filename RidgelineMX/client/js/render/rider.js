// =====================================================================
//  RIDER
//  A motocross rider in full gear, drawn as ONE skinned mesh (one draw
//  call). Every body part is rigidly attached to its own bone; each
//  frame the joints are placed procedurally:
//   - hands are pinned to the grips and feet to the pegs with 2-bone IK
//   - the rider sits in corners, stands over jumps / whoops / straights,
//     shifts weight with Q / E, braking and throttle, soaks up landings,
//     sticks the inside leg out in tight bike turns and dabs a foot
//     when nearly stopped
//   - on a crash the rider comes off and tumbles to a stop (ragdoll-lite)
// =====================================================================
import * as THREE from 'three';
import { box, cyl, sphere, torus, merge, colorize, clean, place, roundBox } from './geo.js';
import { heightAt } from '/shared/terrain.js';

const B = { root: 0, pelvis: 1, torso: 2, head: 3, uaL: 4, faL: 5, hL: 6, uaR: 7, faR: 8, hR: 9, thL: 10, shL: 11, ftL: 12, thR: 13, shR: 14, ftR: 15 };
const BONES = 16;
const LEN = { ua: 0.29, fa: 0.27, th: 0.44, sh: 0.43, torso: 0.52 };
const geoCache = new Map();
let riderMat = null;

function capsule(r, len, color) {
  const g = clean(new THREE.CapsuleGeometry(r, Math.max(0.001, len - 2 * r), 4, 10));
  g.translate(0, len / 2, 0);
  return colorize(g, color);
}

function partGeo(scheme) {
  const [jersey, pants, accent] = scheme.gear;
  const boot = 0xf2f2f2, glove = accent, dark = 0x1d1f24;
  const parts = []; // [geometry, boneIndex]
  const add = (g, b) => parts.push([g, b]);
  // pelvis / hips (pants)
  add(roundBoxC(0.34, 0.2, 0.25, 0.07, pants, [0, 0.03, 0]), B.pelvis);
  add(box(0.36, 0.05, 0.26, dark, [0, 0.12, 0]), B.pelvis);
  // torso: jersey + chest protector + shoulders + neck brace + back number plate
  add(roundBoxC(0.34, 0.5, 0.23, 0.09, jersey, [0, 0.27, 0]), B.torso);
  add(roundBoxC(0.37, 0.26, 0.26, 0.08, accent, [0, 0.36, 0.01]), B.torso);
  add(roundBoxC(0.38, 0.12, 0.27, 0.05, jersey, [0, 0.21, 0]), B.torso);
  for (const s of [1, -1]) add(sphere(0.075, jersey, [s * 0.19, 0.45, -0.01], [1, 0.9, 1], 10, 8), B.torso);
  add(torus(0.085, 0.035, dark, [0, 0.52, -0.01], [Math.PI / 2, 0, 0], 6, 14), B.torso);
  add(box(0.22, 0.2, 0.012, 0xffffff, [0, 0.3, -0.125]), B.torso);
  add(box(0.08, 0.12, 0.014, dark, [-0.03, 0.31, -0.13]), B.torso);
  add(box(0.08, 0.12, 0.014, dark, [0.05, 0.31, -0.13]), B.torso);
  // head: helmet shell, chin bar, peak, goggles + strap
  add(sphere(0.155, jersey, [0, 0.13, 0.0], [1.0, 1.04, 1.13], 16, 12), B.head);
  add(sphere(0.157, 0xffffff, [0, 0.14, -0.005], [0.35, 1.05, 1.13], 12, 10), B.head);
  add(torus(0.12, 0.04, accent, [0, 0.04, 0.06], [-0.35, 0, 0], 8, 14, Math.PI), B.head);
  add(box(0.13, 0.05, 0.06, dark, [0, 0.03, 0.18], [0.3, 0, 0]), B.head);
  add(box(0.24, 0.018, 0.17, accent, [0, 0.27, 0.15], [-0.32, 0, 0]), B.head);
  add(roundBoxC(0.2, 0.075, 0.05, 0.02, 0xd97706, [0, 0.15, 0.165]), B.head);
  add(box(0.17, 0.05, 0.02, 0x7c2d12, [0, 0.15, 0.188]), B.head);
  add(torus(0.158, 0.012, dark, [0, 0.15, 0.0], [Math.PI / 2, 0, 0], 4, 20), B.head);
  // arms
  for (const [ua, fa, h] of [[B.uaL, B.faL, B.hL], [B.uaR, B.faR, B.hR]]) {
    add(capsule(0.058, LEN.ua, jersey), ua);
    add(capsule(0.05, LEN.fa, jersey), fa);
    add(sphere(0.055, dark, [0, 0.0, 0.0], [1, 0.8, 1], 8, 6), fa);     // elbow guard
    add(cyl(0.053, 0.05, 0.06, accent, [0, LEN.fa - 0.03, 0]), fa);     // cuff
    add(roundBoxC(0.085, 0.12, 0.055, 0.025, glove, [0, 0.05, 0]), h);
  }
  // legs: thigh, knee brace + boot, foot
  for (const [th, sh, ft] of [[B.thL, B.shL, B.ftL], [B.thR, B.shR, B.ftR]]) {
    add(capsule(0.078, LEN.th, pants), th);
    add(roundBoxC(0.13, 0.17, 0.13, 0.04, dark, [0, 0.03, 0.01]), sh);       // knee brace
    add(roundBoxC(0.13, 0.34, 0.14, 0.04, boot, [0, 0.24, 0.0]), sh);        // boot shaft
    for (let k = 0; k < 3; k++) add(box(0.135, 0.025, 0.145, dark, [0, 0.14 + k * 0.08, 0]), sh); // buckles
    add(roundBoxC(0.12, 0.27, 0.1, 0.035, boot, [0, 0.1, 0.0]), ft);
    add(box(0.125, 0.27, 0.025, dark, [0, 0.1, -0.05]), ft);                // sole
  }
  // merge, tagging every vertex with its bone
  const geos = parts.map(([g, b]) => {
    const n = g.attributes.position.count;
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { si[i * 4] = b; sw[i * 4] = 1; }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    return g;
  });
  return merge(geos);
}

function roundBoxC(w, h, d, r, color, pos) {
  return place(colorize(clean(roundBox(w, h, d, r)), color), pos);
}

// --- 2-bone IK ---------------------------------------------------------
const _d = new THREE.Vector3(), _p = new THREE.Vector3();
function ik(A, T, l1, l2, pole, outMid, outEnd) {
  _d.subVectors(T, A);
  let d = _d.length();
  const maxD = l1 + l2 - 0.002, minD = Math.abs(l1 - l2) + 0.01;
  d = Math.max(minD, Math.min(maxD, d));
  _d.normalize();
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  _p.subVectors(pole, A);
  _p.addScaledVector(_d, -_p.dot(_d)).normalize();
  outMid.copy(A).addScaledVector(_d, a).addScaledVector(_p, h);
  outEnd.copy(A).addScaledVector(_d, d);
}

// orient a bone so +Y runs from a to b, with +Z toward `hint`
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4();
function setBone(bone, a, b, hint) {
  _y.subVectors(b, a).normalize();
  _z.copy(hint).addScaledVector(_y, -hint.dot(_y));
  if (_z.lengthSq() < 1e-6) _z.set(0, 0, 1).addScaledVector(_y, -_y.z);
  _z.normalize();
  _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z);
  bone.quaternion.setFromRotationMatrix(_m);
  bone.position.copy(a);
}

const V = () => new THREE.Vector3();

export class Rider {
  constructor(scheme) {
    const key = scheme.id;
    if (!geoCache.has(key)) geoCache.set(key, partGeo(scheme));
    if (!riderMat) riderMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.02, envMapIntensity: 0.6 });
    this.group = new THREE.Group();
    this.group.name = 'rider';
    this.bones = [];
    for (let i = 0; i < BONES; i++) {
      const b = new THREE.Bone();
      if (i > 0) this.bones[0].add(b);
      this.bones.push(b);
    }
    this.group.add(this.bones[0]);
    this.mesh = new THREE.SkinnedMesh(geoCache.get(key), riderMat);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);
    this.mesh.bind(new THREE.Skeleton(this.bones, this.bones.map(() => new THREE.Matrix4())), new THREE.Matrix4());
    // pose state
    this.j = {
      pelvis: V(), neck: V(), head: V(), shL: V(), shR: V(), elL: V(), elR: V(), haL: V(), haR: V(),
      hipL: V(), hipR: V(), knL: V(), knR: V(), anL: V(), anR: V(), toeL: V(), toeR: V(),
    };
    this.s = { stand: 0, crouch: 0, fore: 0, leanBody: 0, footL: 0, footR: 0, legOutL: 0, legOutR: 0, bob: 0, air: 0 };
    this.attached = true;
    this.rag = null;
    this.tmp = { a: V(), b: V(), c: V(), up: V(), fwd: V(), left: V() };
  }

  // --- riding pose (vehicle-local coordinates) ---------------------------
  updateRiding(dt, veh, vis) {
    const s = this.s, A = vis.attach, isBike = vis.isBike;
    const inp = veh.input || {};
    const spd = veh.speed || 0;
    const air = !veh.grounded && (veh.airTime || 0) > 0.08;
    const steer = veh.controller ? veh.controller.steer || 0 : inp.steer || 0;
    // targets
    let stand = 0;
    if (air) stand = 1;
    else if (spd > 9 && Math.abs(steer) < 0.35) stand = 0.85;
    else if (spd > 5 && Math.abs(steer) < 0.2) stand = 0.5;
    if (!isBike) stand *= 0.75;
    const compAvg = veh.wheels ? veh.wheels.reduce((a, w) => a + w.comp / w.cfg.travel, 0) / veh.wheels.length : 0.3;
    const crouch = Math.max(0, compAvg - 0.35) * 1.6 + (air ? 0.15 : 0);
    let fore = (inp.lean || 0) * 0.8 + (inp.brake || 0) * -0.25 + (inp.throttle || 0) * 0.2;
    if (air) fore = (inp.lean || 0) * 1.0;
    const k = Math.min(1, dt * 6);
    s.stand += (stand - s.stand) * Math.min(1, dt * 3.5);
    s.crouch += (Math.min(0.6, crouch) - s.crouch) * Math.min(1, dt * 12);
    s.fore += (Math.max(-1, Math.min(1, fore)) - s.fore) * k;
    s.leanBody += ((isBike ? -0.25 : 0.9) * (veh.lean || 0) - s.leanBody) * k;
    // inside leg out in tight, slow-ish bike turns; foot dab when nearly stopped
    const legOut = isBike && !air && spd > 2.5 && spd < 16 && Math.abs(steer) > 0.45 && s.stand < 0.4 ? 1 : 0;
    s.legOutL += ((legOut && steer > 0 ? 1 : 0) - s.legOutL) * k;
    s.legOutR += ((legOut && steer < 0 ? 1 : 0) - s.legOutR) * k;
    const dab = isBike && !air && spd < 1.2 ? 1 : 0;
    s.footL += ((dab ? 1 : 0) - s.footL) * Math.min(1, dt * 5);
    s.bob += dt * (2 + spd * 0.2);

    const J = this.j, t = this.tmp;
    const seat = A.seat, standH = isBike ? 0.78 : 0.7;
    // pelvis
    const pegY = (A.pegL.y + A.pegR.y) / 2, pegZ = (A.pegL.z + A.pegR.z) / 2;
    J.pelvis.set(0, seat.y + 0.08, seat.z + 0.02);
    t.a.set(0, pegY + standH, pegZ - 0.04);
    J.pelvis.lerp(t.a, s.stand);
    J.pelvis.z += s.fore * 0.14 * (0.5 + s.stand);
    J.pelvis.y -= s.crouch * 0.22 * (0.4 + s.stand);
    J.pelvis.x += Math.sin(s.leanBody) * 0.1;
    // torso direction (forward lean + side lean)
    const pitch = (isBike ? 0.32 : 0.25) + s.stand * 0.38 + s.fore * 0.25 + s.crouch * 0.35;
    t.up.set(Math.sin(s.leanBody) * 0.9, Math.cos(pitch), Math.sin(pitch)).normalize();
    J.neck.copy(J.pelvis).addScaledVector(t.up, LEN.torso);
    // shoulders
    t.fwd.set(0, -Math.sin(pitch), Math.cos(pitch));
    t.left.crossVectors(t.up, t.fwd).normalize();
    J.shL.copy(J.neck).addScaledVector(t.left, 0.19).addScaledVector(t.up, -0.07);
    J.shR.copy(J.neck).addScaledVector(t.left, -0.19).addScaledVector(t.up, -0.07);
    J.head.copy(J.neck).addScaledVector(t.up, 0.04);
    // arms to the grips, elbows up and out
    for (const [sh, el, ha, grip, sx] of [[J.shL, J.elL, J.haL, A.gripL, 1], [J.shR, J.elR, J.haR, A.gripR, -1]]) {
      t.b.copy(grip).add(t.c.set(0, 0.0, -0.03));
      t.a.copy(sh).add(t.c.set(sx * 0.5, 0.12, -0.25));
      ik(sh, t.b, LEN.ua, LEN.fa, t.a, el, ha);
    }
    // legs to the pegs (or out / down)
    J.hipL.copy(J.pelvis).addScaledVector(t.left, 0.1);
    J.hipR.copy(J.pelvis).addScaledVector(t.left, -0.1);
    for (const [hip, kn, an, toe, peg, sx, out, dabK] of [
      [J.hipL, J.knL, J.anL, J.toeL, A.pegL, 1, s.legOutL, s.footL], [J.hipR, J.knR, J.anR, J.toeR, A.pegR, -1, s.legOutR, 0]]) {
      t.b.copy(peg).add(t.c.set(0, 0.08, -0.02));
      if (out > 0.01) t.b.lerp(t.c.set(sx * 0.42, -0.42, 0.55), out);
      if (dabK > 0.01) t.b.lerp(t.c.set(sx * 0.45, -0.8, 0.05), dabK);
      t.a.copy(hip).add(t.c.set(sx * 0.18, 0.05, 0.6));
      ik(hip, t.b, LEN.th, LEN.sh, t.a, kn, an);
      toe.copy(an).add(t.c.set(0, -0.06, 0.24));
    }
    this.applyBones(t.up, t.fwd);
  }

  applyBones(up, fwd) {
    const J = this.j, b = this.bones, t = this.tmp;
    setBone(b[B.pelvis], J.pelvis, t.c.copy(J.pelvis).add(up), fwd);
    setBone(b[B.torso], J.pelvis, J.neck, fwd);
    setBone(b[B.head], J.head, t.c.copy(J.head).add(t.a.set(0, 1, 0).lerp(up, 0.3)), t.b.set(0, 0, 1).lerp(fwd, 0.2));
    const back = t.b.copy(fwd).negate();
    setBone(b[B.uaL], J.shL, J.elL, back); setBone(b[B.faL], J.elL, J.haL, fwd);
    setBone(b[B.hL], J.haL, t.c.copy(J.haL).addScaledVector(_y.subVectors(J.haL, J.elL).normalize(), 0.1), fwd);
    setBone(b[B.uaR], J.shR, J.elR, back); setBone(b[B.faR], J.elR, J.haR, fwd);
    setBone(b[B.hR], J.haR, t.c.copy(J.haR).addScaledVector(_y.subVectors(J.haR, J.elR).normalize(), 0.1), fwd);
    setBone(b[B.thL], J.hipL, J.knL, fwd); setBone(b[B.shL], J.knL, J.anL, fwd);
    setBone(b[B.ftL], J.anL, J.toeL, t.a.set(0, 1, 0));
    setBone(b[B.thR], J.hipR, J.knR, fwd); setBone(b[B.shR], J.knR, J.anR, fwd);
    setBone(b[B.ftR], J.anR, J.toeR, t.a.set(0, 1, 0));
  }

  // --- crash: come off the vehicle and tumble -----------------------------
  detach(scene, vel) {
    if (!this.attached) return;
    const wm = this.group.matrixWorld.clone();
    this.attached = false;
    scene.attach(this.group); // keeps the world transform
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), sc = new THREE.Vector3();
    wm.decompose(pos, quat, sc);
    // body centre in world space
    const centre = this.j.pelvis.clone().applyMatrix4(wm);
    this.rag = {
      pos: centre, vel: vel.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 2.2 + Math.random(), (Math.random() - 0.5) * 2)),
      quat: quat.clone(), ang: new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 8),
      t: 0, settle: 0, phase: Math.random() * 10,
    };
    this.group.position.set(0, 0, 0);
    this.group.quaternion.identity();
    this.group.updateMatrixWorld();
  }

  attachTo(parent) {
    this.attached = true;
    this.rag = null;
    parent.add(this.group);
    this.group.position.set(0, 0, 0);
    this.group.quaternion.identity();
  }

  updateRagdoll(dt, world) {
    const R = this.rag;
    if (!R) return;
    R.t += dt;
    const sub = 4;
    const h = dt / sub;
    for (let i = 0; i < sub; i++) {
      R.vel.y -= 9.81 * h;
      R.pos.addScaledVector(R.vel, h);
      const gy = heightAt(world, R.pos.x, R.pos.z) + 0.16;
      if (R.pos.y < gy) {
        R.pos.y = gy;
        if (R.vel.y < 0) R.vel.y *= -0.25;
        R.vel.x *= 1 - 3.5 * h; R.vel.z *= 1 - 3.5 * h;
        R.ang.multiplyScalar(1 - 4 * h);
        R.settle += h;
      }
      const w = R.ang.length();
      if (w > 1e-4) R.quat.premultiply(new THREE.Quaternion().setFromAxisAngle(_x.copy(R.ang).divideScalar(w), w * h));
    }
    // once slow, roll onto the back
    const slow = Math.min(1, Math.max(0, R.settle - 0.4) * 1.5) * (R.vel.length() < 2 ? 1 : 0);
    if (slow > 0) {
      const target = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, Math.atan2(R.vel.x, R.vel.z) || 0, 0));
      R.quat.slerp(target, Math.min(1, dt * 3 * slow));
    }
    // limbs flail in the air, splay out on the ground
    const J = this.j, t = this.tmp;
    const fl = Math.max(0, 1 - R.settle * 1.2);
    const ph = R.phase + R.t * 9;
    J.pelvis.set(0, 0, 0);
    t.up.set(0, 1, 0); t.fwd.set(0, 0, 1);
    J.neck.set(0, LEN.torso, 0.05);
    J.head.copy(J.neck).add(t.c.set(0, 0.04, 0));
    J.shL.set(0.19, LEN.torso - 0.07, 0); J.shR.set(-0.19, LEN.torso - 0.07, 0);
    J.elL.set(0.35 + Math.sin(ph) * 0.1 * fl, LEN.torso - 0.05 + Math.cos(ph) * 0.2 * fl, 0.05);
    J.haL.set(0.55 + Math.sin(ph + 1) * 0.1 * fl, LEN.torso + 0.1 + Math.cos(ph * 1.3) * 0.25 * fl, 0.1);
    J.elR.set(-0.35 - Math.sin(ph + 2) * 0.1 * fl, LEN.torso - 0.08 + Math.sin(ph) * 0.2 * fl, 0.05);
    J.haR.set(-0.55, LEN.torso - 0.2 + Math.sin(ph * 1.1) * 0.3 * fl, 0.12);
    J.hipL.set(0.1, 0, 0); J.hipR.set(-0.1, 0, 0);
    J.knL.set(0.18, -0.42, 0.08 + Math.sin(ph * 0.8) * 0.2 * fl); J.anL.set(0.24, -0.84, 0.0);
    J.knR.set(-0.16, -0.4, 0.15 + Math.cos(ph * 0.9) * 0.2 * fl); J.anR.set(-0.22, -0.82, 0.05);
    J.toeL.copy(J.anL).add(t.c.set(0, 0.02, 0.24)); J.toeR.copy(J.anR).add(t.c.set(0, 0.02, 0.24));
    this.applyBones(t.up, t.fwd);
    this.group.position.copy(R.pos);
    this.group.quaternion.copy(R.quat);
  }

  dispose() {
    this.group.removeFromParent();
    this.mesh.skeleton.dispose();
  }
}
