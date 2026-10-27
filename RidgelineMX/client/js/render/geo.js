// Geometry helpers: build low-poly parts with vertex colours and merge
// them into as few meshes (= draw calls) as possible.
import * as THREE from 'three';
import { mergeGeometries } from '../../vendor/addons/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export function colorize(geo, color) {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

// strip everything except position / normal / color so geometries merge cleanly
export function clean(geo) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

export function place(geo, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
  _q.setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]));
  _m.compose(_p.set(pos[0], pos[1], pos[2]), _q, _s.set(scale[0], scale[1], scale[2]));
  geo.applyMatrix4(_m);
  return geo;
}

export function box(w, h, d, color, pos, rot, bevel = 0) {
  let g = new THREE.BoxGeometry(w, h, d, 1, 1, 1);
  if (bevel > 0) g = roundBox(w, h, d, bevel);
  return place(colorize(clean(g), color), pos, rot);
}

// a box with rounded edges (looks much less "blocky" than a BoxGeometry)
export function roundBox(w, h, d, r, seg = 2) {
  const g = new THREE.BoxGeometry(w, h, d, 4, 4, 4);
  const p = g.attributes.position;
  const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const cx = Math.max(-hx, Math.min(hx, v.x)), cy = Math.max(-hy, Math.min(hy, v.y)), cz = Math.max(-hz, Math.min(hz, v.z));
    const dx = v.x - cx, dy = v.y - cy, dz = v.z - cz;
    const l = Math.hypot(dx, dy, dz) || 1;
    p.setXYZ(i, cx + (dx / l) * r, cy + (dy / l) * r, cz + (dz / l) * r);
  }
  g.computeVertexNormals();
  return g;
}

export function cyl(rTop, rBot, h, color, pos, rot, seg = 10) {
  return place(colorize(clean(new THREE.CylinderGeometry(rTop, rBot, h, seg, 1)), color), pos, rot);
}

// cylinder from point a to point b
export function tube(a, b, r, color, seg = 8, r2 = r) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const d = new THREE.Vector3().subVectors(B, A);
  const len = d.length();
  const g = clean(new THREE.CylinderGeometry(r2, r, len, seg, 1));
  colorize(g, color);
  _q.setFromUnitVectors(UP, d.normalize());
  _m.compose(A.add(B).multiplyScalar(0.5), _q, _s.set(1, 1, 1));
  g.applyMatrix4(_m);
  return g;
}

export function sphere(r, color, pos, scale = [1, 1, 1], ws = 12, hs = 8) {
  const g = clean(new THREE.SphereGeometry(r, ws, hs));
  return place(colorize(g, color), pos, [0, 0, 0], scale);
}

export function cone(r, h, color, pos, seg = 8, rot) {
  return place(colorize(clean(new THREE.ConeGeometry(r, h, seg, 1)), color), pos, rot);
}

export function torus(r, t, color, pos, rot, rs = 8, ts = 24, arc = Math.PI * 2) {
  return place(colorize(clean(new THREE.TorusGeometry(r, t, rs, ts, arc)), color), pos, rot);
}

// tube along a smooth path of points
export function pipe(points, r, color, seg = 24, radial = 8) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  return colorize(clean(new THREE.TubeGeometry(curve, seg, r, radial, false)), color);
}

// extruded flat shape (side panels, plates)
export function plate(shapePts, depth, color, pos, rot, bevel = 0.01) {
  const s = new THREE.Shape(shapePts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1 });
  g.translate(0, 0, -depth / 2);
  return place(colorize(clean(g), color), pos, rot);
}

export function merge(list) {
  const g = mergeGeometries(list.filter(Boolean), false);
  for (const x of list) if (x) x.dispose();
  return g;
}

// move each vertex by a random amount that depends only on where it is,
// so the copies of a shared corner all move together (no cracks)
export function jitter(geo, amount, seed = 1) {
  const p = geo.attributes.position;
  const h = (x, y, z, k) => {
    let n = Math.round(x * 1000) * 73856093 ^ Math.round(y * 1000) * 19349663 ^ Math.round(z * 1000) * 83492791 ^ (seed + k) * 2654435761;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296 - 0.5;
  };
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    p.setXYZ(i, x + h(x, y, z, 1) * amount, y + h(x, y, z, 2) * amount, z + h(x, y, z, 3) * amount);
  }
  geo.computeVertexNormals();
  return geo;
}
