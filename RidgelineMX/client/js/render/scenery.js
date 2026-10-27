// =====================================================================
//  SCENERY: everything around the track.
//  Repeated things (trees, rocks, bushes, grass, fence stakes, people)
//  are drawn with InstancedMesh: one draw call per type and level of
//  detail. Each frame only the instances inside the camera view and
//  within range are written. Static buildings / gate / bleachers are
//  merged into one vertex-coloured mesh.
// =====================================================================
import * as THREE from 'three';
import { heightAt, groundAt } from '/shared/terrain.js';
import { pointAt, sampleArr, locate } from '/shared/trackgen.js';
import { rng, fbm } from '/shared/noise.js';
import { box, cyl, cone, sphere, tube, merge, jitter, colorize, clean, place, roundBox } from './geo.js';
import { makeBannerAtlas, BANNER_TEXTS, makeCheckerTexture, makeTextTexture } from './textures.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _sphere = new THREE.Sphere();
const _c = new THREE.Color();

// ---------------------------------------------------------------------
// Instanced scatter with distance bands (LOD) and frustum culling
// ---------------------------------------------------------------------
class Scatter {
  constructor(parent, items, lods, opts = {}) {
    this.items = items;
    this.radius = opts.radius || 3;
    this.meshes = lods.map((l) => {
      const m = new THREE.InstancedMesh(l.geometry, l.material, Math.max(1, items.length));
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = !!l.castShadow;
      m.receiveShadow = !!l.receiveShadow;
      if (opts.colors) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(items.length * 3), 3);
      parent.add(m);
      return { mesh: m, max: l.maxDist, max2: l.maxDist * l.maxDist };
    });
    this.matrices = new Float32Array(items.length * 16);
    items.forEach((it, i) => {
      _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, it.rot || 0);
      if (it.tilt) _q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(it.tilt[0], 0, it.tilt[1])));
      const sc = it.scale || 1;
      _m.compose(_p.set(it.x, it.y, it.z), _q, _s.set(it.sx || sc, it.sy || sc, it.sz || sc));
      _m.toArray(this.matrices, i * 16);
    });
    this.colors = opts.colors ? items.map((it) => it.color) : null;
    this.frame = 0;
    this.every = opts.every || 2;
    this.lastCam = new THREE.Vector3(1e9, 0, 0);
  }

  update(camera, frustum, force = false) {
    this.frame++;
    if (!force && this.frame % this.every !== 0) return;
    const cx = camera.position.x, cz = camera.position.z;
    for (const l of this.meshes) l.mesh.count = 0;
    const its = this.items;
    for (let i = 0; i < its.length; i++) {
      const it = its[i];
      const dx = it.x - cx, dz = it.z - cz;
      const d2 = dx * dx + dz * dz;
      let band = null;
      for (const l of this.meshes) if (d2 < l.max2) { band = l; break; }
      if (!band) continue;
      _sphere.center.set(it.x, it.y + this.radius * (it.scale || 1) * 0.5, it.z);
      _sphere.radius = this.radius * (it.scale || 1);
      if (!frustum.intersectsSphere(_sphere)) continue;
      const m = band.mesh;
      const k = m.count++;
      m.instanceMatrix.array.set(this.matrices.subarray(i * 16, i * 16 + 16), k * 16);
      if (this.colors && m.instanceColor) { _c.set(this.colors[i]); m.instanceColor.setXYZ(k, _c.r, _c.g, _c.b); }
    }
    for (const l of this.meshes) {
      l.mesh.instanceMatrix.needsUpdate = true;
      if (l.mesh.instanceColor) l.mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose() {
    for (const l of this.meshes) { l.mesh.removeFromParent(); l.mesh.dispose(); }
  }
}

// ---------------------------------------------------------------------
// Low-poly models
// ---------------------------------------------------------------------
function pineGeo(detail, r) {
  const parts = [cyl(0.12, 0.2, 2.2, 0x5a3d26, [0, 1.1, 0], [0, 0, 0], 5)];
  const greens = [0x2f5a2c, 0x376a31, 0x3f7537];
  const tiers = detail ? 3 : 1;
  for (let i = 0; i < tiers; i++) {
    const h = detail ? 3.4 - i * 0.7 : 6.5;
    const rad = detail ? 2.2 - i * 0.55 : 2.0;
    const y = detail ? 2.0 + i * 1.6 + h / 2 : 1.6 + h / 2;
    let g = cone(rad, h, greens[i % 3], [0, y, 0], detail ? 8 : 5);
    if (detail) g = jitter(g, 0.25, i + r);
    parts.push(g);
  }
  return merge(parts);
}

function leafyGeo(detail, r) {
  const parts = [cyl(0.15, 0.25, 2.6, 0x6b4a30, [0, 1.3, 0], [0, 0, 0], 5)];
  const greens = [0x4d7a2e, 0x5a8a34, 0x447029];
  if (detail) {
    parts.push(jitter(sphere(1.8, greens[0], [0, 3.6, 0], [1, 0.85, 1], 7, 5), 0.5, r));
    parts.push(jitter(sphere(1.3, greens[1], [0.9, 4.3, 0.4], [1, 0.9, 1], 6, 4), 0.4, r + 1));
    parts.push(jitter(sphere(1.2, greens[2], [-0.8, 4.1, -0.5], [1, 0.9, 1], 6, 4), 0.4, r + 2));
  } else {
    parts.push(sphere(2.1, greens[0], [0, 3.8, 0], [1, 0.95, 1], 5, 3));
  }
  return merge(parts);
}

function bushGeo() {
  return merge([
    jitter(sphere(0.9, 0x4f7a2c, [0, 0.45, 0], [1.2, 0.75, 1], 6, 4), 0.25, 3),
    jitter(sphere(0.6, 0x5c8a33, [0.6, 0.5, 0.2], [1, 0.8, 1], 5, 4), 0.2, 4),
  ]);
}

function rockGeo(detail, seed) {
  const g = clean(new THREE.DodecahedronGeometry(1, detail ? 1 : 0));
  colorize(g, 0x8a847b);
  return jitter(place(g, [0, 0.35, 0], [0, 0, 0], [1.2, 0.7, 1]), detail ? 0.35 : 0.2, seed);
}

function grassTuftGeo() {
  const parts = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI;
    const g = new THREE.PlaneGeometry(0.5, 0.45, 1, 2);
    g.translate(0, 0.22, 0);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      p.setX(i, p.getX(i) * (1 - y * 1.6));
      if (y > 0.3) p.setZ(i, 0.08);
    }
    g.rotateY(a);
    const cg = clean(g);
    const col = new Float32Array(cg.attributes.position.count * 3);
    for (let i = 0; i < cg.attributes.position.count; i++) {
      const y = cg.attributes.position.getY(i);
      const t = Math.min(1, y / 0.45);
      col[i * 3] = 0.2 + t * 0.2; col[i * 3 + 1] = 0.33 + t * 0.25; col[i * 3 + 2] = 0.1 + t * 0.06;
    }
    cg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(cg);
  }
  const g = merge(parts);
  // light every blade as if it faced the sky, so both sides look the same
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  g.scale(0.75, 0.7, 0.75);
  return g;
}

function personGeo() {
  // simple spectator: legs, body, arms, head. 'tint' marks the shirt (gets a per-person colour)
  const g = merge([
    box(0.32, 0.8, 0.2, 0x2d3a52, [0, 0.4, 0]),
    box(0.42, 0.6, 0.26, 0xffffff, [0, 1.1, 0], undefined, 0.06),
    box(0.1, 0.55, 0.12, 0xffffff, [0.26, 1.15, 0], [0, 0, 0.15]),
    box(0.1, 0.55, 0.12, 0xffffff, [-0.26, 1.15, 0], [0, 0, -0.15]),
    sphere(0.14, 0xe0b090, [0, 1.56, 0], [1, 1.1, 1], 8, 6),
  ]);
  const p = g.attributes.position, tint = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) tint[i] = p.getY(i) > 0.79 && p.getY(i) < 1.43 ? 1 : 0;
  g.setAttribute('tint', new THREE.BufferAttribute(tint, 1));
  return g;
}

// ---------------------------------------------------------------------
export class Scenery {
  constructor(world, renderer, quality) {
    this.world = world;
    this.renderer = renderer;
    this.group = new THREE.Group();
    this.group.name = 'scenery';
    this.scatters = [];
    this.disposables = [];
    this.occupied = [];
    this.quality = quality;
    this.r = rng(world.def.seed * 7 + 3);
    this.frustum = new THREE.Frustum();
    this.projScreen = new THREE.Matrix4();
    this.time = 0;
    this.gate = null;

    this.matLow = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.matSmooth = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.disposables.push(this.matLow, this.matSmooth);

    this.buildFences();
    this.buildStartFinish();
    this.buildPaddock();
    this.buildSpectators();
    this.buildTrees();
    this.buildRocksAndBushes();
    this.buildGrass();
  }

  // --- helpers ---
  fenceU(s, side) { const T = this.world.T; return side > 0 ? sampleArr(T, T.fenceL, s) : sampleArr(T, T.fenceR, s); }

  // is (x,z) clear of the track (by `margin` past the fence) and of props?
  isFree(x, z, radius, margin = 6) {
    const W = this.world;
    if (Math.abs(x) > W.half - 4 || Math.abs(z) > W.half - 4) return false;
    const loc = locate(W.F, x, z);
    if (loc) {
      const side = loc.u > 0 ? 1 : -1;
      if (Math.abs(loc.u) < this.fenceU(loc.s, side) + margin + radius) return false;
    }
    for (const o of this.occupied) {
      const dx = o.x - x, dz = o.z - z;
      if (dx * dx + dz * dz < (o.r + radius) ** 2) return false;
    }
    return true;
  }

  occupy(x, z, r) { this.occupied.push({ x, z, r }); }

  slopeAt(x, z) { const g = groundAt(this.world, x, z, {}); return 1 - g.ny; }

  addScatter(items, lods, opts) {
    const s = new Scatter(this.group, items, lods, opts);
    this.scatters.push(s);
    for (const l of lods) this.disposables.push(l.geometry);
    return s;
  }

  // --- fences: wooden stakes + plastic tape along both edges of the track
  buildFences() {
    const T = this.world.T, W = this.world;
    const posts = [];
    const tapePos = [], tapeCol = [], tapeIdx = [];
    const spacing = 3.2;
    const tapeColors = [new THREE.Color(0x2563eb), new THREE.Color(0xf4f4f4), new THREE.Color(0xe11d48), new THREE.Color(0xf4f4f4)];
    for (const side of [1, -1]) {
      let prev = null;
      let k = 0;
      for (let s = 0; s < T.L; s += spacing) {
        const u = this.fenceU(s, side) * side;
        const p = pointAt(T, s, u);
        // skip where this fence would cut through another part of the track
        const loc = locate(W.F, p.x, p.z);
        const ok = loc && Math.abs(((loc.s - s + T.L * 1.5) % T.L) - T.L / 2) < 20;
        const y = heightAt(W, p.x, p.z);
        if (!ok) { prev = null; continue; }
        posts.push({ x: p.x, y, z: p.z, rot: Math.atan2(p.tx, p.tz), scale: 1 });
        if (prev) {
          const col = tapeColors[Math.floor(k / 6) % 4];
          for (const hgt of [0.95]) {
            const b = tapePos.length / 3;
            tapePos.push(prev.x, prev.y + hgt, prev.z, p.x, y + hgt, p.z, p.x, y + hgt - 0.09, p.z, prev.x, prev.y + hgt - 0.09, prev.z);
            for (let q = 0; q < 4; q++) tapeCol.push(col.r, col.g, col.b);
            tapeIdx.push(b, b + 1, b + 2, b, b + 2, b + 3);
          }
        }
        prev = { x: p.x, y, z: p.z };
        k++;
      }
    }
    const postGeo = merge([cyl(0.04, 0.05, 1.15, 0xc8a878, [0, 0.55, 0], [0, 0, 0], 5), box(0.07, 0.1, 0.07, 0xf2f2f2, [0, 1.05, 0])]);
    this.addScatter(posts, [{ geometry: postGeo, material: this.matLow, maxDist: 220 }], { radius: 1, every: 3 });
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(tapePos, 3));
    tg.setAttribute('color', new THREE.Float32BufferAttribute(tapeCol, 3));
    tg.setIndex(tapeIdx);
    tg.computeVertexNormals();
    const tm = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const tape = new THREE.Mesh(tg, tm);
    tape.matrixAutoUpdate = false;
    this.group.add(tape);
    this.disposables.push(tg, tm);

    // banners on the outside of straights
    const atlas = makeBannerAtlas(this.renderer.renderer);
    this.disposables.push(atlas);
    const bannerItems = BANNER_TEXTS.map(() => []);
    let bi = 0;
    for (const sec of T.sections) {
      for (let s = sec.s0 + 10; s < sec.s1 - 12; s += 26) {
        const side = (bi % 3 === 0) ? 1 : -1;
        const u = (this.fenceU(s, side) + 1.2) * side;
        const p = pointAt(T, s, u);
        const loc = locate(W.F, p.x, p.z);
        if (!loc || Math.abs(((loc.s - s + T.L * 1.5) % T.L) - T.L / 2) > 15) continue;
        const y = Math.min(heightAt(W, p.x - p.tx * 2, p.z - p.tz * 2), heightAt(W, p.x + p.tx * 2, p.z + p.tz * 2));
        // face the track
        const rot = Math.atan2(p.tx, p.tz) + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
        bannerItems[bi % BANNER_TEXTS.length].push({ x: p.x, y: y + 0.05, z: p.z, rot, scale: 1 });
        bi++;
      }
    }
    bannerItems.forEach((items, i) => {
      if (!items.length) return;
      const g = new THREE.PlaneGeometry(4, 0.8);
      g.translate(0, 0.55, 0);
      const uv = g.attributes.uv;
      const v0 = 1 - (i + 1) / BANNER_TEXTS.length, v1 = 1 - i / BANNER_TEXTS.length;
      for (let k = 0; k < uv.count; k++) uv.setY(k, uv.getY(k) > 0.5 ? v1 : v0), uv.setX(k, uv.getX(k) * 0.5);
      const frame = merge([cyl(0.03, 0.03, 1.0, 0x777777, [-1.95, 0.5, -0.02], [0, 0, 0], 4), cyl(0.03, 0.03, 1.0, 0x777777, [1.95, 0.5, -0.02], [0, 0, 0], 4)]);
      const mat = new THREE.MeshLambertMaterial({ map: atlas, side: THREE.DoubleSide });
      this.disposables.push(mat);
      this.addScatter(items, [{ geometry: g, material: mat, maxDist: 260 }], { radius: 2.5, every: 4 });
      this.addScatter(items, [{ geometry: frame, material: this.matLow, maxDist: 160 }], { radius: 2.5, every: 4 });
    });
  }

  // --- start gate, finish line, flagger tower
  buildStartFinish() {
    const T = this.world.T, W = this.world;
    const parts = [];
    // start gate: a long steel frame with one drop-down gate per slot
    const gs = T.gateS;
    const g = pointAt(T, gs, 0);
    const hw = sampleArr(T, T.width, gs) / 2;
    const yaw = Math.atan2(g.tx, g.tz);
    const gy = heightAt(W, g.x, g.z);
    const gateParts = [];
    const slots = Math.floor((hw * 2 - 1) / 1.6);
    this.gateSlots = slots;
    gateParts.push(box(hw * 2 + 0.6, 0.12, 0.35, 0x3a3f46, [0, 0.06, 0.2]));
    for (let i = 0; i <= slots; i++) {
      const x = -hw + 0.5 + i * ((hw * 2 - 1) / slots);
      gateParts.push(box(0.08, 0.62, 0.08, 0x9aa1a8, [x, 0.31, 0.12]));
    }
    const frame = merge(gateParts);
    _m.compose(_p.set(g.x, gy, g.z), _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw), _s.set(1, 1, 1));
    frame.applyMatrix4(_m);
    parts.push(frame);
    // gate plates (animated)
    const plateGeo = merge([box(1.4, 0.55, 0.05, 0xf4f4f4, [0, 0.28, 0]), box(1.4, 0.12, 0.06, 0xd8261c, [0, 0.42, 0.005])]);
    const plateMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.disposables.push(plateGeo, plateMat);
    const plates = new THREE.InstancedMesh(plateGeo, plateMat, slots);
    plates.castShadow = true;
    this.group.add(plates);
    this.gate = { mesh: plates, slots, g, gy, yaw, hw, angle: 0, target: 0 };
    this.setGate(0);
    this.occupy(g.x, g.z, 0.1);

    // finish line: checkered strip draped on the ground + two towers and a banner
    const fs = T.finishS;
    const fhw = sampleArr(T, T.width, fs) / 2 + 1.5;
    const strip = [], uvs = [], idx = [];
    const segs = 16;
    for (let i = 0; i <= segs; i++) {
      const u = -fhw + (i / segs) * fhw * 2;
      for (const ds of [-0.6, 0.6]) {
        const p = pointAt(T, fs + ds, u);
        strip.push(p.x, heightAt(W, p.x, p.z) + 0.04, p.z);
        uvs.push(i / segs * 12, ds > 0 ? 1 : 0);
      }
    }
    for (let i = 0; i < segs; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(strip, 3));
    sg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    sg.setIndex(idx); sg.computeVertexNormals();
    const checker = makeCheckerTexture(this.renderer.renderer, 2);
    const sm = new THREE.MeshLambertMaterial({ map: checker, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide });
    const stripMesh = new THREE.Mesh(sg, sm);
    stripMesh.receiveShadow = true;
    this.group.add(stripMesh);
    this.disposables.push(sg, sm, checker);
    const f = pointAt(T, fs, 0);
    const fyaw = Math.atan2(f.tx, f.tz);
    const towerH = 6.5;
    const tw = [];
    for (const side of [1, -1]) {
      const p = pointAt(T, fs, (fhw + 1.2) * side);
      const y = heightAt(W, p.x, p.z);
      tw.push(place(merge([box(0.8, towerH, 0.8, 0x23272e, [0, towerH / 2, 0]), box(1.0, 0.3, 1.0, 0xd8261c, [0, towerH, 0])]), [p.x, y, p.z], [0, fyaw, 0]));
      this.occupy(p.x, p.z, 1.5);
    }
    parts.push(...tw);
    const fy = heightAt(W, f.x, f.z) + towerH - 0.6;
    const bannerTex = makeTextTexture('FINISH', '#111', '#fff', 1024, 128);
    const bm = new THREE.MeshLambertMaterial({ map: bannerTex, side: THREE.DoubleSide });
    const bannerMesh = new THREE.Mesh(new THREE.PlaneGeometry(fhw * 2 + 2.4, 1.4), bm);
    bannerMesh.position.set(f.x, fy, f.z);
    bannerMesh.rotation.y = fyaw + Math.PI; // face the riders coming down the straight
    this.group.add(bannerMesh);
    this.disposables.push(bannerTex, bm, bannerMesh.geometry);
    const checkTex = makeCheckerTexture(this.renderer.renderer, 8);
    checkTex.repeat.set(6, 1);
    const cm = new THREE.MeshLambertMaterial({ map: checkTex, side: THREE.DoubleSide });
    const checkMesh = new THREE.Mesh(new THREE.PlaneGeometry(fhw * 2 + 2.4, 0.35), cm);
    checkMesh.position.set(f.x, fy + 0.88, f.z);
    checkMesh.rotation.y = fyaw + Math.PI;
    this.group.add(checkMesh);
    this.disposables.push(checkTex, cm, checkMesh.geometry);
    this.staticParts = parts;
  }

  setGate(angle) {
    const G = this.gate;
    if (!G) return;
    G.angle = angle;
    const step = (G.hw * 2 - 1) / G.slots;
    for (let i = 0; i < G.slots; i++) {
      const lx = -G.hw + 0.5 + step * (i + 0.5);
      // pivot at the bottom front of the gate, tips forward onto the track
      const local = new THREE.Vector3(lx, 0.1, 0.0).applyAxisAngle(THREE.Object3D.DEFAULT_UP, G.yaw);
      _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, G.yaw).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle));
      _m.compose(_p.set(G.g.x + local.x, G.gy + local.y, G.g.z + local.z), _q, _s.set(1, 1, 1));
      G.mesh.setMatrixAt(i, _m);
    }
    G.mesh.instanceMatrix.needsUpdate = true;
  }

  // gate slot positions (lap distance + side offset) for the starting grid
  gridSlots(count) {
    const T = this.world.T;
    const hw = sampleArr(T, T.width, T.gateS) / 2;
    const slots = this.gateSlots || Math.floor((hw * 2 - 1) / 1.6);
    const step = (hw * 2 - 1) / slots;
    const order = [];
    const mid = (slots - 1) / 2;
    for (let i = 0; i < slots; i++) order.push(i);
    order.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
    const out = [];
    for (let k = 0; k < count; k++) {
      const i = order[k % slots];
      const row = Math.floor(k / slots);
      // the gate's local +x axis points to the rider's left (= +u)
      const lx = -hw + 0.5 + step * (i + 0.5);
      out.push({ s: T.gateS - 1.3 - row * 3.5, u: lx });
    }
    return out;
  }

  // --- paddock: trailers, canopies, bleachers next to the start straight
  buildPaddock() {
    const T = this.world.T, W = this.world;
    const parts = this.staticParts;
    const r = this.r;
    const colors = [0xffffff, 0xd8261c, 0x1d4ed8, 0x111111, 0xf06a0f, 0x46b11c, 0xf2c21b, 0x6b7280];
    const s0 = T.finishS - 60, s1 = T.finishS + 40;
    // bleachers along the outside of the start straight
    for (const side of [-1, 1]) {
      for (let s = s0; s < s1; s += 14) {
        const u = (this.fenceU(s, side) + 5) * side;
        const p = pointAt(T, s, u);
        if (!this.isFree(p.x, p.z, 4, 2)) continue;
        const y = heightAt(W, p.x, p.z);
        const yaw = Math.atan2(p.tx, p.tz) + (side > 0 ? -Math.PI / 2 : Math.PI / 2); // local -z points away from the track
        const b = [];
        for (let k = 0; k < 4; k++) b.push(box(10, 0.35 + k * 0.45, 1.0, k % 2 ? 0x9ca3af : 0x6b7280, [0, (0.35 + k * 0.45) / 2, -k * 1.0]));
        b.push(box(10, 0.1, 0.1, 0x374151, [0, 2.4, -3.5]));
        parts.push(place(merge(b), [p.x, y - 0.1, p.z], [0, yaw, 0]));
        this.occupy(p.x, p.z, 6);
        // crowd on the bleacher
        for (let k = 0; k < 4; k++) for (let c = 0; c < 9; c++) {
          if (r() < 0.25) continue;
          const lx = -4.5 + c * 1.1 + (r() - 0.5) * 0.3, lz = -k * 1.0;
          const lp = new THREE.Vector3(lx, 0.35 + k * 0.45, lz).applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
          this.crowd = this.crowd || [];
          this.crowd.push({ x: p.x + lp.x, y: y - 0.1 + lp.y, z: p.z + lp.z, rot: yaw + (r() - 0.5) * 0.4, scale: 0.95 + r() * 0.1, color: colors[Math.floor(r() * colors.length)] });
        }
      }
    }
    // paddock behind: trailers and canopies
    let placed = 0;
    for (let tries = 0; tries < 400 && placed < 22; tries++) {
      const s = T.finishS - 80 + r() * 160;
      const side = r() < 0.6 ? -1 : 1;
      const u = (this.fenceU(s, side) + 16 + r() * 40) * side;
      const p = pointAt(T, s, u);
      const kind = r() < 0.55 ? 'trailer' : 'canopy';
      const rad = kind === 'trailer' ? 6 : 3.2;
      if (!this.isFree(p.x, p.z, rad, 6) || this.slopeAt(p.x, p.z) > 0.12) continue;
      const y = heightAt(W, p.x, p.z);
      const yaw = Math.atan2(p.tx, p.tz) + (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 0.3;
      const c = colors[Math.floor(r() * colors.length)];
      const g = [];
      if (kind === 'trailer') {
        g.push(box(2.5, 2.6, 8, c, [0, 1.6, 0], undefined, 0.12));
        g.push(box(2.52, 0.4, 8.02, 0x222222, [0, 0.55, 0]));
        g.push(box(2.4, 2.0, 2.4, 0xe5e7eb, [0, 1.3, 5.4], undefined, 0.15));
        g.push(box(2.2, 0.8, 0.05, 0x1f2937, [0, 1.8, 6.6]));
        for (const wz of [-2.5, -1.4, 4.8]) for (const wx of [1.15, -1.15]) g.push(cyl(0.42, 0.42, 0.3, 0x111111, [wx, 0.42, wz], [0, 0, Math.PI / 2], 10));
      } else {
        for (const [px, pz] of [[1.4, 1.4], [-1.4, 1.4], [1.4, -1.4], [-1.4, -1.4]]) g.push(cyl(0.03, 0.03, 2.2, 0x9ca3af, [px, 1.1, pz], [0, 0, 0], 4));
        g.push(cone(2.2, 0.9, c, [0, 2.55, 0], 4, [0, Math.PI / 4, 0]));
        g.push(box(1.6, 0.75, 0.7, 0x6b7280, [0, 0.38, 0]));
      }
      parts.push(place(merge(g), [p.x, y, p.z], [0, yaw, 0]));
      this.occupy(p.x, p.z, rad);
      placed++;
    }
    // merge every static prop into one mesh
    const all = merge(parts);
    const mesh = new THREE.Mesh(all, this.matSmooth);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
    this.disposables.push(all);
  }

  // --- people standing on the hillsides by the big jumps
  buildSpectators() {
    const T = this.world.T, W = this.world, r = this.r;
    const colors = [0xffffff, 0xd8261c, 0x1d4ed8, 0x111111, 0xf06a0f, 0x46b11c, 0xf2c21b, 0x6b21a8, 0x0d9488, 0xe5e7eb];
    const crowd = this.crowd || [];
    for (const f of T.features) {
      if (!(f.h >= 1.6) || f.type === 'whoops' || f.type === 'rollers') continue;
      const side = r() < 0.5 ? 1 : -1;
      const count = 26 + Math.floor(r() * 22);
      for (let i = 0; i < count; i++) {
        const s = f.s0 + r() * (f.s1 - f.s0);
        const u = (this.fenceU(s, side) + 2.5 + r() * 9) * side;
        const p = pointAt(T, s, u);
        if (!this.isFree(p.x, p.z, 0.3, 1.5)) continue;
        const y = heightAt(W, p.x, p.z);
        const yaw = Math.atan2(p.tx, p.tz) + (side > 0 ? -Math.PI / 2 : Math.PI / 2) + (r() - 0.5) * 0.8;
        crowd.push({ x: p.x, y, z: p.z, rot: yaw, scale: 0.92 + r() * 0.16, color: colors[Math.floor(r() * colors.length)] });
      }
    }
    if (!crowd.length) return;
    const geo = personGeo();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    // gentle cheering bob, per instance, in the shader
    this.crowdUniforms = { uTime: { value: 0 } };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.crowdUniforms.uTime;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float tint;')
        .replace('#include <color_vertex>', `vColor = vec3(1.0);
          #ifdef USE_COLOR
            vColor *= color;
          #endif
          #ifdef USE_INSTANCING_COLOR
            vColor = mix(vColor, vColor * instanceColor.xyz, tint);
          #endif`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float ph = float(gl_InstanceID) * 1.7;
          float bob = max(0.0, sin(uTime * 3.0 + ph)) * 0.08;
          transformed.y += bob * smoothstep(0.7, 1.2, position.y);
          transformed.x += sin(uTime * 4.0 + ph) * 0.12 * smoothstep(1.2, 1.7, position.y) * step(0.2, abs(position.x));`);
    };
    this.disposables.push(mat);
    // the white body colour gets tinted per person by the instance colour
    this.addScatter(crowd, [{ geometry: geo, material: mat, maxDist: 180, castShadow: false }], { radius: 1, colors: true, every: 3 });
  }

  // --- trees around the facility and on the hills
  buildTrees() {
    const W = this.world, r = this.r, half = W.half;
    const pines = [], leafy = [];
    const target = W.def.terrain.rimSharp ? 700 : 2600;
    let tries = 0;
    while (pines.length + leafy.length < target && tries < target * 12) {
      tries++;
      const x = (r() * 2 - 1) * (half - 6), z = (r() * 2 - 1) * (half - 6);
      const dens = fbm(x / 70, z / 70, W.def.seed + 21, 3);
      const edge = Math.max(Math.abs(x), Math.abs(z)) / half;
      if (dens + edge * 0.6 < 0.15 + r() * 0.2) continue;
      if (W.def.terrain.rimSharp && edge < 0.8) continue;
      if (!this.isFree(x, z, 2, 9)) continue;
      if (this.slopeAt(x, z) > 0.45) continue;
      const y = heightAt(W, x, z) - 0.1;
      const it = { x, y, z, rot: r() * 6.28, scale: 0.75 + r() * 0.7 };
      if (fbm(x / 120, z / 120, W.def.seed + 99, 2) + (W.def.terrain.rimSharp ? 0.3 : 0) > 0) pines.push(it); else leafy.push(it);
    }
    const pine0 = pineGeo(true, 1), pine1 = pineGeo(false, 1);
    const leaf0 = leafyGeo(true, 2), leaf1 = leafyGeo(false, 2);
    const q = this.quality;
    const near = q.detail === 'low' ? 90 : q.detail === 'high' ? 200 : 140;
    const far = q.viewDistance;
    this.addScatter(pines, [
      { geometry: pine0, material: this.matLow, maxDist: near, castShadow: q.shadows === 'high' },
      { geometry: pine1, material: this.matLow, maxDist: far },
    ], { radius: 4, every: 2 });
    this.addScatter(leafy, [
      { geometry: leaf0, material: this.matLow, maxDist: near, castShadow: q.shadows === 'high' },
      { geometry: leaf1, material: this.matLow, maxDist: far },
    ], { radius: 4, every: 2 });
    this.treeCount = pines.length + leafy.length;
  }

  buildRocksAndBushes() {
    const W = this.world, r = this.r, half = W.half;
    const rocks = [], bushes = [];
    const nR = W.def.terrain.rimSharp ? 900 : 450, nB = W.def.terrain.rimSharp ? 250 : 1100;
    for (let t = 0; t < nR * 8 && rocks.length < nR; t++) {
      const x = (r() * 2 - 1) * (half - 4), z = (r() * 2 - 1) * (half - 4);
      if (!this.isFree(x, z, 1, 4)) continue;
      const sl = this.slopeAt(x, z);
      if (!W.def.terrain.rimSharp && sl < 0.08 && r() < 0.7) continue;
      const y = heightAt(W, x, z);
      const sc = 0.3 + r() * r() * (W.def.terrain.rimSharp ? 2.6 : 1.6);
      rocks.push({ x, y: y - sc * 0.2, z, rot: r() * 6.28, scale: sc, tilt: [(r() - 0.5) * 0.5, (r() - 0.5) * 0.5] });
    }
    for (let t = 0; t < nB * 8 && bushes.length < nB; t++) {
      const x = (r() * 2 - 1) * (half - 4), z = (r() * 2 - 1) * (half - 4);
      if (!this.isFree(x, z, 1, 3)) continue;
      if (this.slopeAt(x, z) > 0.4) continue;
      bushes.push({ x, y: heightAt(W, x, z) - 0.1, z, rot: r() * 6.28, scale: 0.6 + r() * 0.9 });
    }
    this.addScatter(rocks, [
      { geometry: rockGeo(true, 5), material: this.matLow, maxDist: 120, castShadow: false },
      { geometry: rockGeo(false, 6), material: this.matLow, maxDist: this.quality.viewDistance * 0.7 },
    ], { radius: 1.5, every: 3 });
    this.addScatter(bushes, [{ geometry: bushGeo(), material: this.matLow, maxDist: 230 }], { radius: 1.5, every: 3 });
  }

  // --- grass tufts: only around the camera, rebuilt as it moves
  buildGrass() {
    const q = this.quality;
    const density = q.grass; // tufts per 100 m^2
    this.grassRange = q.detail === 'low' ? 35 : q.detail === 'high' ? 70 : 52;
    this.grassCell = 12;
    const cap = Math.ceil(((Math.PI * this.grassRange * this.grassRange) / 100) * density * 1.3) + 50;
    this.grassMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.grassGeo = grassTuftGeo();
    this.grass = new THREE.InstancedMesh(this.grassGeo, this.grassMat, Math.max(1, cap));
    this.grass.count = 0;
    this.grass.frustumCulled = false;
    this.grass.visible = density > 0;
    this.group.add(this.grass);
    this.disposables.push(this.grassGeo, this.grassMat);
    this.grassDensity = density;
    this.grassCap = cap;
    this.grassCenter = new THREE.Vector2(1e9, 1e9);
    this.grassCache = new Map();
  }

  grassForCell(ci, cj) {
    const key = ci * 100000 + cj;
    if (this.grassCache.has(key)) return this.grassCache.get(key);
    const W = this.world, cs = this.grassCell;
    const r = rng((ci * 73856093) ^ (cj * 19349663) ^ W.def.seed);
    const n = Math.round(((cs * cs) / 100) * this.grassDensity);
    const out = new Float32Array(n * 4);
    let k = 0;
    for (let i = 0; i < n; i++) {
      const x = ci * cs + r() * cs, z = cj * cs + r() * cs;
      if (Math.abs(x) > W.half - 2 || Math.abs(z) > W.half - 2) continue;
      const gi = Math.round((x + W.half) / W.res), gj = Math.round((z + W.half) / W.res);
      if (W.DIRT[gj * W.cells + gi] > 60) continue;
      out[k * 4] = x; out[k * 4 + 1] = heightAt(W, x, z) - 0.03; out[k * 4 + 2] = z; out[k * 4 + 3] = r() * 6.28 + r();
      k++;
    }
    const res = out.subarray(0, k * 4);
    if (this.grassCache.size > 600) this.grassCache.clear();
    this.grassCache.set(key, res);
    return res;
  }

  updateGrass(camera) {
    if (!this.grass.visible) return;
    const cx = camera.position.x, cz = camera.position.z;
    if (Math.hypot(cx - this.grassCenter.x, cz - this.grassCenter.y) < 4) return;
    this.grassCenter.set(cx, cz);
    const cs = this.grassCell, R = this.grassRange, R2 = R * R;
    const c0 = Math.floor((cx - R) / cs), c1 = Math.floor((cx + R) / cs);
    const d0 = Math.floor((cz - R) / cs), d1 = Math.floor((cz + R) / cs);
    let k = 0;
    const arr = this.grass.instanceMatrix.array;
    for (let cj = d0; cj <= d1; cj++) for (let ci = c0; ci <= c1; ci++) {
      const pts = this.grassForCell(ci, cj);
      for (let i = 0; i < pts.length; i += 4) {
        const dx = pts[i] - cx, dz = pts[i + 2] - cz;
        if (dx * dx + dz * dz > R2 || k >= this.grassCap) continue;
        const a = pts[i + 3], s = 0.8 + (a % 1) * 0.7;
        const c = Math.cos(a) * s, sn = Math.sin(a) * s;
        const o = k * 16;
        arr[o] = c; arr[o + 1] = 0; arr[o + 2] = -sn; arr[o + 3] = 0;
        arr[o + 4] = 0; arr[o + 5] = s; arr[o + 6] = 0; arr[o + 7] = 0;
        arr[o + 8] = sn; arr[o + 9] = 0; arr[o + 10] = c; arr[o + 11] = 0;
        arr[o + 12] = pts[i]; arr[o + 13] = pts[i + 1]; arr[o + 14] = pts[i + 2]; arr[o + 15] = 1;
        k++;
      }
    }
    this.grass.count = k;
    this.grass.instanceMatrix.needsUpdate = true;
  }

  update(dt, camera) {
    this.time += dt;
    if (this.crowdUniforms) this.crowdUniforms.uTime.value = this.time;
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    for (const s of this.scatters) s.update(camera, this.frustum);
    this.updateGrass(camera);
    if (this.gate && Math.abs(this.gate.angle - this.gate.target) > 1e-3) {
      const a = this.gate.angle + (this.gate.target - this.gate.angle) * Math.min(1, dt * 9);
      this.setGate(a);
    }
  }

  forceUpdate(camera) {
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    for (const s of this.scatters) s.update(camera, this.frustum, true);
    this.grassCenter.set(1e9, 1e9);
    this.updateGrass(camera);
  }

  // the gates fall backwards, toward the riders, and they ride over them
  dropGate(down) { if (this.gate) this.gate.target = down ? -Math.PI / 2 * 0.96 : 0; }

  dispose() {
    for (const s of this.scatters) s.dispose();
    for (const d of this.disposables) d.dispose && d.dispose();
    this.grass.removeFromParent(); this.grass.dispose();
    this.gate.mesh.dispose();
    this.group.removeFromParent();
  }
}
