// =====================================================================
//  EFFECTS: dust clouds, roost (thrown dirt), landing puffs, tyre marks.
//  All particles live in ONE pooled Points object (one draw call) and all
//  tyre marks in ONE ring-buffer mesh; nothing is created per frame.
//  The particle budget scales with the Particles setting and drops
//  automatically when the frame rate does.
// =====================================================================
import * as THREE from 'three';
import { makeDustSprite } from './textures.js';
import { dirtAt, heightAt } from '/shared/terrain.js';

const VERT = `
attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
uniform float uScale;
varying float vAlpha; varying vec3 vColor;
#include <fog_pars_vertex>
void main() {
  vAlpha = aAlpha; vColor = aColor;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.5, -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FRAG = `
uniform sampler2D uMap;
varying float vAlpha; varying vec3 vColor;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(uMap, gl_PointCoord);
  gl_FragColor = vec4(vColor, t.a * vAlpha);
  if (gl_FragColor.a < 0.01) discard;
  #include <fog_fragment>
}`;

export class Effects {
  constructor(scene, world, quality) {
    this.scene = scene;
    this.world = world;
    this.max = 3000;
    this.budget = quality.particles;
    const n = this.max;
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3);
    this.size = new Float32Array(n); this.alpha = new Float32Array(n); this.color = new Float32Array(n * 3);
    this.life = new Float32Array(n); this.age = new Float32Array(n); this.grow = new Float32Array(n);
    this.grav = new Float32Array(n); this.drag = new Float32Array(n); this.a0 = new Float32Array(n);
    this.alive = 0;
    this.cursor = 0;
    const g = new THREE.BufferGeometry();
    this.attrPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.attrSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.attrAlpha = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    this.attrColor = new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.attrPos); g.setAttribute('aSize', this.attrSize);
    g.setAttribute('aAlpha', this.attrAlpha); g.setAttribute('aColor', this.attrColor);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.sprite = makeDustSprite();
    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMap: { value: null }, uScale: { value: 400 } }]);
    this.uniforms.uMap.value = this.sprite;
    this.mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, transparent: true, depthWrite: false, fog: true });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.geo = g;
    scene.add(this.points);
    this.marks = new TyreMarks(scene, quality.tireMarks);
    this.emitAcc = new Map();
  }

  setQuality(q) { this.budget = q.particles; this.marks.setEnabled(q.tireMarks); }

  spawn(x, y, z, vx, vy, vz, size, grow, life, alpha, r, g, b, grav, drag) {
    if (this.budget <= 0) return;
    const cap = Math.floor(this.max * this.budget);
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % cap;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.size[i] = size; this.grow[i] = grow; this.life[i] = life; this.age[i] = 0;
    this.a0[i] = alpha; this.alpha[i] = alpha;
    this.color[i * 3] = r; this.color[i * 3 + 1] = g; this.color[i * 3 + 2] = b;
    this.grav[i] = grav; this.drag[i] = drag;
    this.alive = Math.max(this.alive, i + 1);
  }

  // per vehicle per frame: dust behind the rear tyre, roost under throttle
  vehicle(veh, dt, key) {
    if (this.budget <= 0) return;
    const spd = veh.speed;
    let acc = this.emitAcc.get(key) || 0;
    for (const w of veh.wheels) {
      if (!w.contact) continue;
      const dirt = w.surface;
      const slip = Math.min(1.5, w.slipLong * 1.5 + Math.max(0, w.slipLat - 0.8) * 0.4);
      const rate = (dirt * (spd * 0.6 + slip * 30) + slip * 8) * this.budget * (w.cfg.driven ? 1 : 0.35);
      acc += rate * dt;
      const cp = w.cp;
      while (acc > 1) {
        acc -= 1;
        const t = Math.random();
        const shade = 0.55 + Math.random() * 0.12;
        // drifting dust cloud
        this.spawn(cp.x + (Math.random() - 0.5) * 0.5, cp.y + 0.15, cp.z + (Math.random() - 0.5) * 0.5,
          -veh.vel.x * 0.1 + (Math.random() - 0.5) * 1.2, 0.6 + Math.random() * 0.8, -veh.vel.z * 0.1 + (Math.random() - 0.5) * 1.2,
          0.6 + t * 0.6, 1.6 + spd * 0.06, 1.4 + Math.random() * 1.4, 0.32 * Math.min(1, 0.3 + dirt), shade, shade * 0.86, shade * 0.7, -0.15, 0.9);
        // roost: clods thrown back when the rear spins / accelerates hard
        if (w.cfg.driven && (slip > 0.15 || veh.input.throttle > 0.7) && Math.random() < 0.55 * dirt) {
          const back = 3 + slip * 6;
          this.spawn(cp.x, cp.y + 0.1, cp.z,
            -veh.fwd.x * back + (Math.random() - 0.5) * 2, 1.8 + Math.random() * 2.5, -veh.fwd.z * back + (Math.random() - 0.5) * 2,
            0.09 + Math.random() * 0.08, 0, 0.6 + Math.random() * 0.4, 0.95, 0.34, 0.25, 0.17, 9.8, 0.2);
        }
      }
      if (dirt > 0.4 && spd > 1) this.marks.add(key, w, 0.18 + Math.min(0.5, slip * 0.5));
      else this.marks.break(key, w);
    }
    if (!veh.grounded) for (const w of veh.wheels) this.marks.break(key, w);
    this.emitAcc.set(key, acc);
  }

  landing(pos, strength) {
    const n = Math.floor(18 * strength * this.budget);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 1.5 + Math.random() * 3 * strength;
      const shade = 0.6 + Math.random() * 0.1;
      this.spawn(pos.x, pos.y + 0.1, pos.z, Math.cos(a) * s, 0.4 + Math.random(), Math.sin(a) * s,
        0.8, 2.2, 1.5 + Math.random(), 0.4, shade, shade * 0.86, shade * 0.7, -0.1, 1.4);
    }
  }

  crash(pos, vel) {
    for (let i = 0; i < 40 * this.budget; i++) {
      const shade = 0.55 + Math.random() * 0.1;
      this.spawn(pos.x, pos.y, pos.z, vel.x * 0.3 + (Math.random() - 0.5) * 4, Math.random() * 3, vel.z * 0.3 + (Math.random() - 0.5) * 4,
        0.9, 2.5, 1.8 + Math.random(), 0.45, shade, shade * 0.86, shade * 0.7, -0.05, 1.2);
    }
  }

  update(dt, camera, renderer) {
    const n = this.alive;
    for (let i = 0; i < n; i++) {
      if (this.life[i] <= 0) continue;
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { this.life[i] = 0; this.alpha[i] = 0; continue; }
      const k = 1 - Math.min(1, this.drag[i] * dt);
      this.vel[i * 3] *= k; this.vel[i * 3 + 2] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.grav[i] > 1) {
        const gy = heightAt(this.world, this.pos[i * 3], this.pos[i * 3 + 2]);
        if (this.pos[i * 3 + 1] < gy) { this.pos[i * 3 + 1] = gy; this.vel[i * 3] *= 0.3; this.vel[i * 3 + 1] = 0; this.vel[i * 3 + 2] *= 0.3; }
      }
      this.size[i] += this.grow[i] * dt;
      const t = this.age[i] / this.life[i];
      this.alpha[i] = this.a0[i] * (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85);
    }
    this.geo.setDrawRange(0, n);
    this.attrPos.needsUpdate = true; this.attrSize.needsUpdate = true; this.attrAlpha.needsUpdate = true; this.attrColor.needsUpdate = true;
    const h = renderer.domElement.height;
    this.uniforms.uScale.value = (h * 0.5) / Math.tan((camera.fov * Math.PI) / 360);
    this.marks.flush();
  }

  dispose() {
    this.points.removeFromParent();
    this.geo.dispose(); this.mat.dispose(); this.sprite.dispose();
    this.marks.dispose();
  }
}

// ---------------------------------------------------------------------
class TyreMarks {
  constructor(scene, enabled) {
    this.max = 4000;
    this.enabled = enabled;
    const n = this.max * 4;
    this.posArr = new Float32Array(n * 3);
    this.colArr = new Float32Array(n * 4);
    const idx = new Uint32Array(this.max * 6);
    for (let i = 0; i < this.max; i++) {
      const v = i * 4;
      idx.set([v, v + 1, v + 2, v, v + 2, v + 3], i * 6);
    }
    const g = new THREE.BufferGeometry();
    this.pa = new THREE.BufferAttribute(this.posArr, 3).setUsage(THREE.DynamicDrawUsage);
    this.ca = new THREE.BufferAttribute(this.colArr, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pa); g.setAttribute('color', this.ca);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.visible = enabled;
    scene.add(this.mesh);
    this.geo = g;
    this.cursor = 0;
    this.last = new Map();
    this.dirty0 = Infinity; this.dirty1 = -1;
    this.count = 0;
  }

  setEnabled(on) { this.enabled = on; this.mesh.visible = on; }

  break(key, w) { this.last.delete(key + ':' + w.cfg.id); }

  add(key, w, alpha) {
    if (!this.enabled) return;
    const k = key + ':' + w.cfg.id;
    const p = w.cp;
    const prev = this.last.get(k);
    if (!prev) { this.last.set(k, { x: p.x, y: p.y, z: p.z }); return; }
    const dx = p.x - prev.x, dz = p.z - prev.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.5) return;
    if (d > 3) { this.last.set(k, { x: p.x, y: p.y, z: p.z }); return; }
    const width = w.cfg.x !== 0 ? 0.11 : 0.06;
    const nx = (-dz / d) * width, nz = (dx / d) * width;
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const o = i * 12;
    const y0 = prev.y + 0.02, y1 = p.y + 0.02;
    this.posArr.set([prev.x + nx, y0, prev.z + nz, prev.x - nx, y0, prev.z - nz, p.x - nx, y1, p.z - nz, p.x + nx, y1, p.z + nz], o);
    const c = i * 16;
    for (let v = 0; v < 4; v++) this.colArr.set([0.16, 0.11, 0.07, alpha], c + v * 4);
    this.dirty0 = Math.min(this.dirty0, i); this.dirty1 = Math.max(this.dirty1, i);
    this.count = Math.min(this.max, this.count + 1);
    this.last.set(k, { x: p.x, y: p.y, z: p.z });
  }

  flush() {
    if (this.dirty1 < 0) return;
    this.pa.clearUpdateRanges(); this.ca.clearUpdateRanges();
    this.pa.addUpdateRange(this.dirty0 * 12, (this.dirty1 - this.dirty0 + 1) * 12);
    this.ca.addUpdateRange(this.dirty0 * 16, (this.dirty1 - this.dirty0 + 1) * 16);
    this.pa.needsUpdate = true; this.ca.needsUpdate = true;
    this.dirty0 = Infinity; this.dirty1 = -1;
  }

  dispose() { this.mesh.removeFromParent(); this.geo.dispose(); this.mat.dispose(); }
}
