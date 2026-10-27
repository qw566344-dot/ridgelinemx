// =====================================================================
//  VEHICLE VISUALS
//  Draws a bike or quad that follows the physics: wheels spin, forks and
//  swingarm move with the suspension, bars turn with the steering, and
//  the bike leans into corners.
//
//  YOUR MODELS: drop a .glb into client/models/ with the file name given
//  in shared/vehicles.js (e.g. models/dirtbike_450.glb). Name the wheel
//  objects so they can spin - see MODELS.md. If the file is missing, a
//  detailed placeholder with the same dimensions is built instead.
// =====================================================================
import * as THREE from 'three';
import { GLTFLoader } from '../../vendor/addons/loaders/GLTFLoader.js';
import { box, cyl, tube, sphere, torus, pipe, plate, merge, colorize, clean, place, roundBox } from './geo.js';
import { prepareVehicle } from '/shared/vehicles.js';

const DEG = Math.PI / 180;
const loader = new GLTFLoader();
const glbCache = new Map();     // url -> Promise<gltf|null>
const placeholderCache = new Map();

export function loadGLB(url) {
  if (!glbCache.has(url)) {
    glbCache.set(url, new Promise((resolve) => {
      fetch(url, { method: 'HEAD' }).then((r) => {
        if (!r.ok) return resolve(null);
        loader.load(url, (g) => resolve(g), undefined, (e) => { console.warn('Could not load model', url, e); resolve(null); });
      }).catch(() => resolve(null));
    }));
  }
  return glbCache.get(url);
}

// shared materials (vertex colours carry the actual colours)
const MATS = {};
function mats() {
  if (!MATS.paint) {
    MATS.paint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.05, envMapIntensity: 0.9 });
    MATS.metal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.85, envMapIntensity: 1.0 });
    MATS.rubber = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.0, envMapIntensity: 0.3 });
  }
  return MATS;
}

// build meshes for a part list grouped by material
function meshGroup(lists) {
  const g = new THREE.Group();
  const M = mats();
  for (const key of ['paint', 'metal', 'rubber']) {
    const l = lists[key];
    if (!l || !l.length) continue;
    const geo = merge(l);
    const m = new THREE.Mesh(geo, M[key]);
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

function cloneGroup(g) {
  // geometry and materials are shared between copies
  return g.clone(true);
}

// --- wheel ------------------------------------------------------------
function wheelParts(r, width, rim = 0x1a1a1a, hub = 0xb8bcc4, atv = false) {
  const paint = [], metal = [], rubber = [];
  const tyreR = atv ? width * 0.5 : r * 0.17;
  const core = r - tyreR;
  if (atv) {
    // balloon tyre: a lathe with a rounded profile, axis along x
    const pts = [];
    const hw = width / 2;
    for (let i = 0; i <= 12; i++) {
      const a = -Math.PI / 2 + (i / 12) * Math.PI;
      pts.push(new THREE.Vector2(r - 0.08 + Math.cos(a) * 0.08, Math.sin(a) * hw));
    }
    pts.unshift(new THREE.Vector2(r * 0.55, -hw * 0.95)); pts.push(new THREE.Vector2(r * 0.55, hw * 0.95));
    const lg = clean(new THREE.LatheGeometry(pts, 24));
    lg.rotateZ(Math.PI / 2);
    rubber.push(colorize(lg, 0x1b1b1b));
    // knobs
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      for (const s of [-1, 1]) {
        rubber.push(place(colorize(clean(new THREE.BoxGeometry(width * 0.32, 0.03, 0.05)), 0x161616), [s * width * 0.22, Math.cos(a + s * 0.08) * (r - 0.005), Math.sin(a + s * 0.08) * (r - 0.005)], [a, 0, 0]));
      }
    }
    metal.push(cyl(r * 0.56, r * 0.56, width * 0.8, rim, [0, 0, 0], [0, 0, Math.PI / 2], 16));
    metal.push(cyl(r * 0.2, r * 0.2, width * 0.9, hub, [0, 0, 0], [0, 0, Math.PI / 2], 8));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      metal.push(place(colorize(clean(new THREE.BoxGeometry(width * 0.1, r * 0.4, 0.05)), hub), [width * 0.38, Math.cos(a) * r * 0.32, Math.sin(a) * r * 0.32], [a, 0, 0]));
    }
  } else {
    rubber.push(torus(core + tyreR * 0.1, tyreR, 0x1b1b1b, [0, 0, 0], [0, Math.PI / 2, 0], 8, 32));
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      const rr = r - 0.008;
      rubber.push(place(colorize(clean(new THREE.BoxGeometry(width * 0.95, 0.022, 0.035)), 0x141414), [((i % 2) - 0.5) * width * 0.25, Math.cos(a) * rr, Math.sin(a) * rr], [a, 0, 0]));
    }
    metal.push(torus(core - 0.01, 0.014, rim, [0, 0, 0], [0, Math.PI / 2, 0], 6, 32));
    metal.push(cyl(0.045, 0.045, width * 1.3, hub, [0, 0, 0], [0, 0, Math.PI / 2], 10));
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const side = i % 2 ? 1 : -1;
      metal.push(tube([side * 0.035, Math.cos(a) * 0.04, Math.sin(a) * 0.04], [0, Math.cos(a + 0.3) * (core - 0.015), Math.sin(a + 0.3) * (core - 0.015)], 0.0035, 0xc9ccd2, 3));
    }
    metal.push(cyl(r * 0.36, r * 0.36, 0.006, 0x8a8f96, [0.05, 0, 0], [0, 0, Math.PI / 2], 16)); // brake disc
  }
  return { paint, metal, rubber };
}

// --- placeholder dirt bike ----------------------------------------------
function buildBike(cfg, scheme, number) {
  const body = scheme.body, acc = scheme.accent;
  const blk = 0x1c1c1f, alu = 0xb9bec6, gold = 0xc9a03a;
  const front = cfg.wheels[0], rear = cfg.wheels[1];
  const fy = front.y - (front.travel - front.sag * front.travel), ry = rear.y - (rear.travel - rear.sag * rear.travel);
  const axF = new THREE.Vector3(0, fy, front.z), axR = new THREE.Vector3(0, ry, rear.z);
  const rake = 27 * DEG;
  const forkDir = new THREE.Vector3(0, -Math.cos(rake), Math.sin(rake)); // down the fork
  const head = axF.clone().addScaledVector(forkDir, -0.92);  // top clamp
  const pivot = new THREE.Vector3(0, -0.28, -0.16);           // swingarm pivot

  // ---- chassis (does not move)
  const C = { paint: [], metal: [], rubber: [] };
  const H = [head.x, head.y, head.z];
  C.metal.push(tube(H, [0, -0.36, 0.28], 0.024, alu), tube(H, [0, 0.12, -0.18], 0.022, alu));
  for (const s of [1, -1]) {
    C.metal.push(tube([s * 0.07, 0.1, -0.15], [s * 0.08, -0.32, -0.2], 0.02, alu));
    C.metal.push(tube([s * 0.07, 0.12, -0.15], [s * 0.06, 0.12, -0.75], 0.014, alu));
    C.metal.push(tube([s * 0.06, -0.1, -0.2], [s * 0.06, 0.1, -0.7], 0.012, alu));
  }
  // engine + cases
  C.metal.push(box(0.22, 0.36, 0.42, 0x3b3f45, [0, -0.25, 0.06], undefined, 0.05));
  C.metal.push(box(0.17, 0.22, 0.22, 0x50555c, [0, 0.0, 0.1], [0.3, 0, 0], 0.04));
  C.metal.push(cyl(0.12, 0.12, 0.27, 0x2e3238, [0, -0.32, -0.02], [0, 0, Math.PI / 2], 14));
  C.metal.push(box(0.26, 0.05, 0.42, alu, [0, -0.45, 0.06])); // bash plate
  // radiators + shrouds
  for (const s of [1, -1]) {
    C.metal.push(box(0.03, 0.26, 0.2, 0x2a2d31, [s * 0.11, 0.0, 0.32], [0, 0, 0]));
    C.paint.push(plate([[0, 0], [0.34, 0.06], [0.3, 0.26], [0.02, 0.22]], 0.012, body, [s * 0.14, -0.08, 0.15], [0, -Math.PI / 2, 0]));
    C.paint.push(plate([[0.04, 0.04], [0.22, 0.08], [0.2, 0.16], [0.06, 0.14]], 0.006, acc, [s * 0.15, -0.06, 0.17], [0, -Math.PI / 2, 0]));
  }
  // tank + seat
  C.paint.push(box(0.24, 0.17, 0.36, body, [0, 0.16, 0.15], [-0.12, 0, 0], 0.07));
  C.rubber.push(box(0.21, 0.09, 0.95, 0x17171a, [0, 0.16, -0.3], [0.04, 0, 0], 0.04));
  C.paint.push(box(0.2, 0.03, 0.85, acc, [0, 0.112, -0.32], [0.04, 0, 0]));
  // side number plates + airbox
  for (const s of [1, -1]) {
    C.paint.push(plate([[0, 0], [0.42, 0.1], [0.4, 0.3], [0.03, 0.24]], 0.012, 0xf4f4f4, [s * 0.13, -0.08, -0.25], [0, Math.PI / 2, 0]));
  }
  // rear fender
  C.paint.push(plate([[0, 0], [0.55, 0.12], [0.5, 0.17], [0, 0.07]], 0.2, body, [0, 0.09, -0.45], [0, Math.PI / 2, 0], 0.02));
  // exhaust (right side = -x)
  C.metal.push(pipe([[-0.04, -0.12, 0.25], [-0.12, -0.3, 0.32], [-0.17, -0.38, 0.12], [-0.17, -0.18, -0.25], [-0.16, 0.0, -0.5]], 0.03, 0x9a7b55, 24, 8));
  C.metal.push(cyl(0.055, 0.055, 0.45, 0xc9ccd2, [-0.16, 0.05, -0.7], [Math.PI / 2 - 0.25, 0, 0], 12));
  C.metal.push(cyl(0.035, 0.035, 0.05, 0x222222, [-0.16, 0.11, -0.93], [Math.PI / 2 - 0.25, 0, 0], 10));
  // pegs + shock
  for (const s of [1, -1]) C.metal.push(box(0.11, 0.025, 0.05, alu, [s * 0.17, -0.38, -0.12]));
  C.metal.push(tube([0, 0.08, -0.15], [0, -0.3, -0.42], 0.03, 0xd9b232));
  const chassis = meshGroup(C);

  // ---- steering assembly: bars, top clamp, fork tubes, number plate, fender
  const S = { paint: [], metal: [], rubber: [] };
  // built around the top clamp at origin, fork axis along -forkDir
  const toLocal = (v) => v.clone().sub(head);
  const bars = [[0.4, 0.13, -0.06], [0.2, 0.1, -0.03], [-0.2, 0.1, -0.03], [-0.4, 0.13, -0.06]];
  S.metal.push(pipe(bars, 0.012, 0x2a2a2a, 16, 6));
  for (const s of [1, -1]) S.rubber.push(cyl(0.018, 0.018, 0.12, 0x111111, [s * 0.36, 0.125, -0.055], [0, 0, Math.PI / 2], 8));
  S.metal.push(box(0.26, 0.04, 0.12, alu, [0, 0, 0]));
  S.metal.push(box(0.26, 0.05, 0.12, alu, [0, -0.2, 0.09]));
  for (const s of [1, -1]) {
    const a = new THREE.Vector3(s * 0.085, 0.02, 0), b = a.clone().addScaledVector(forkDir, 0.5);
    S.metal.push(tube([a.x, a.y, a.z], [b.x, b.y, b.z], 0.026, 0xd8b04a));
  }
  S.paint.push(plate([[-0.14, 0], [0.14, 0], [0.12, 0.22], [-0.12, 0.22]], 0.012, 0xf4f4f4, [0, -0.16, 0.13], [-0.35, 0, 0]));
  S.paint.push(plate([[0, 0], [0.5, -0.05], [0.48, 0.02], [0.02, 0.06]], 0.14, body, [0, -0.3, 0.05], [0, -Math.PI / 2, -0.35], 0.02));
  const steer = meshGroup(S);
  // fork lowers + front wheel (slide along the fork)
  const L = { paint: [], metal: [], rubber: [] };
  for (const s of [1, -1]) {
    const a = new THREE.Vector3(s * 0.085, 0, 0), b = a.clone().addScaledVector(forkDir, -0.38);
    L.metal.push(tube([a.x, a.y, a.z], [b.x, b.y, b.z], 0.032, 0x26282c));
    L.paint.push(box(0.012, 0.18, 0.05, 0xe5e7eb, [s * 0.12, 0.12, -0.03], [-rake, 0, 0]));
  }
  const forkLower = meshGroup(L);
  const fw = wheelParts(front.r, 0.1);
  const frontWheel = meshGroup(fw);

  // ---- swingarm + rear wheel
  const A = { paint: [], metal: [], rubber: [] };
  const armLen = pivot.distanceTo(axR);
  for (const s of [1, -1]) A.metal.push(box(0.035, 0.06, armLen, alu, [s * 0.08, 0, -armLen / 2], undefined, 0.012));
  A.metal.push(box(0.2, 0.05, 0.08, alu, [0, 0, -0.05]));
  A.metal.push(box(0.018, 0.04, armLen * 0.95, 0x1a1a1a, [0.115, 0.02, -armLen / 2])); // chain guide
  const swingarm = meshGroup(A);
  const rw = wheelParts(rear.r, 0.13);
  const rearWheel = meshGroup(rw);

  return { chassis, steer, forkLower, frontWheel, swingarm, rearWheel, head, forkDir, pivot, axF, axR, armLen, rake };
}

// --- placeholder quad -------------------------------------------------
function buildAtv(cfg, scheme) {
  const body = scheme.body, acc = scheme.accent;
  const blk = 0x1c1c1f, alu = 0xa7adb5;
  const [fl, fr, rl, rr] = cfg.wheels;
  const restY = (w) => w.y - (w.travel - w.sag * w.travel);
  const C = { paint: [], metal: [], rubber: [] };
  // frame
  for (const s of [1, -1]) {
    C.metal.push(tube([s * 0.2, -0.28, 0.75], [s * 0.2, -0.28, -0.65], 0.022, 0x2f3338));
    C.metal.push(tube([s * 0.2, -0.28, 0.75], [s * 0.18, 0.12, 0.45], 0.02, 0x2f3338));
    C.metal.push(tube([s * 0.18, 0.12, 0.45], [s * 0.16, 0.1, -0.7], 0.02, 0x2f3338));
    // nerf bars
    C.metal.push(pipe([[s * 0.2, -0.24, 0.42], [s * 0.45, -0.3, 0.3], [s * 0.47, -0.3, -0.3], [s * 0.2, -0.24, -0.42]], 0.018, 0x26282c, 16, 6));
    C.metal.push(box(0.2, 0.02, 0.5, 0x3a3d42, [s * 0.38, -0.3, 0.0]));
  }
  // front bumper + rear grab bar
  C.metal.push(pipe([[0.25, -0.15, 0.92], [0.2, 0.05, 1.05], [-0.2, 0.05, 1.05], [-0.25, -0.15, 0.92]], 0.02, 0x26282c, 16, 6));
  C.metal.push(pipe([[0.22, 0.2, -0.78], [0.2, 0.22, -0.98], [-0.2, 0.22, -0.98], [-0.22, 0.2, -0.78]], 0.018, 0x26282c, 16, 6));
  // engine
  C.metal.push(box(0.3, 0.34, 0.45, 0x3b3f45, [0, -0.18, 0.02], undefined, 0.05));
  C.metal.push(cyl(0.11, 0.11, 0.32, 0x2e3238, [0, -0.26, -0.08], [0, 0, Math.PI / 2], 12));
  // plastics: front fenders/hood, rear fenders
  C.paint.push(box(1.12, 0.06, 0.62, body, [0, 0.12, 0.72], [0.12, 0, 0], 0.03));
  for (const s of [1, -1]) C.paint.push(box(0.36, 0.05, 0.6, body, [s * 0.44, 0.07, 0.66], [0.1, 0, s * 0.18], 0.025));
  C.paint.push(box(0.5, 0.22, 0.42, body, [0, 0.22, 0.42], [-0.2, 0, 0], 0.08));
  C.paint.push(box(1.08, 0.06, 0.6, body, [0, 0.16, -0.66], [-0.06, 0, 0], 0.03));
  for (const s of [1, -1]) C.paint.push(box(0.34, 0.05, 0.62, body, [s * 0.43, 0.1, -0.65], [-0.05, 0, s * 0.16], 0.025));
  C.paint.push(box(0.46, 0.04, 0.42, acc, [0, 0.25, 0.45], [-0.2, 0, 0]));
  // number plate on the front
  C.paint.push(plate([[-0.16, 0], [0.16, 0], [0.14, 0.2], [-0.14, 0.2]], 0.012, 0xf4f4f4, [0, 0.17, 0.98], [-0.25, 0, 0]));
  // seat
  C.rubber.push(box(0.3, 0.1, 0.8, 0x17171a, [0, 0.28, -0.25], [0.02, 0, 0], 0.05));
  // exhaust
  C.metal.push(pipe([[-0.06, -0.08, 0.2], [-0.2, -0.05, 0.05], [-0.22, 0.05, -0.4], [-0.2, 0.12, -0.6]], 0.03, 0x9a7b55, 20, 8));
  C.metal.push(cyl(0.06, 0.06, 0.35, 0xc9ccd2, [-0.2, 0.15, -0.75], [Math.PI / 2 - 0.12, 0, 0], 12));
  // rear axle carrier
  C.metal.push(box(0.12, 0.12, 0.12, alu, [0, restY(rl) + 0.02, -0.4]));
  const chassis = meshGroup(C);
  // steering: handlebar on a post
  const S = { paint: [], metal: [], rubber: [] };
  S.metal.push(pipe([[0.44, 0.08, -0.06], [0.2, 0.05, 0], [-0.2, 0.05, 0], [-0.44, 0.08, -0.06]], 0.012, 0x2a2a2a, 16, 6));
  for (const s of [1, -1]) S.rubber.push(cyl(0.019, 0.019, 0.12, 0x111111, [s * 0.4, 0.075, -0.05], [0, 0, Math.PI / 2], 8));
  S.metal.push(cyl(0.02, 0.02, 0.35, 0x2a2a2a, [0, -0.15, 0.04], [0.25, 0, 0], 8));
  S.paint.push(box(0.2, 0.06, 0.08, acc, [0, 0.06, 0.02], undefined, 0.02));
  const steer = meshGroup(S);
  const wheelsF = [fl, fr].map((w) => meshGroup(wheelParts(w.r, 0.2, 0x1a1a1a, alu, true)));
  const wheelsR = [rl, rr].map((w) => meshGroup(wheelParts(w.r, 0.24, 0x1a1a1a, alu, true)));
  // rear axle (a bar between the rear wheels, tilts with them)
  const axle = meshGroup({ metal: [cyl(0.03, 0.03, Math.abs(rl.x - rr.x) + 0.1, 0x2a2d31, [0, 0, 0], [0, 0, Math.PI / 2], 8)] });
  // a-arm (unit length along +z, scaled each frame)
  const arm = meshGroup({ metal: [box(0.05, 0.03, 1, 0x2f3338, [0, 0, 0.5], undefined, 0.01)] });
  const shock = meshGroup({ metal: [cyl(0.025, 0.025, 1, 0xd9b232, [0, 0.5, 0], [0, 0, 0], 8)] });
  return { chassis, steer, wheelsF, wheelsR, axle, arm, shock, restY };
}

// ---------------------------------------------------------------------
export class VehicleVisual {
  constructor(def, scheme, number = 1) {
    this.def = def;
    this.cfg = prepareVehicle(def);
    this.scheme = scheme;
    this.root = new THREE.Group();          // follows the physics body (CoM)
    this.ground = new THREE.Group();        // pivot at the ground for leaning
    this.lean = new THREE.Group();
    this.model = new THREE.Group();         // vehicle-local space (origin = CoM)
    this.root.add(this.ground); this.ground.add(this.lean); this.lean.add(this.model);
    this.ground.position.y = -this.cfg.rideHeight;
    this.model.position.y = this.cfg.rideHeight;
    this.attach = {
      seat: new THREE.Vector3(), gripL: new THREE.Vector3(), gripR: new THREE.Vector3(),
      pegL: new THREE.Vector3(), pegR: new THREE.Vector3(),
    };
    this.isBike = this.cfg.type === 'bike';
    this.usingGLB = false;
    this.buildPlaceholder(number);
  }

  buildPlaceholder(number) {
    const key = this.def.id + ':' + this.scheme.id;
    let parts = placeholderCache.get(key);
    if (!parts) {
      parts = this.isBike ? buildBike(this.cfg, this.scheme, number) : buildAtv(this.cfg, this.scheme);
      placeholderCache.set(key, parts);
    }
    this.parts = parts;
    const P = parts;
    this.placeholder = new THREE.Group();
    this.model.add(this.placeholder);
    if (this.isBike) {
      this.placeholder.add(cloneGroup(P.chassis));
      // steering pivot sits at the top clamp, rotates about the fork axis
      this.steerPivot = new THREE.Group();
      this.steerPivot.position.copy(P.head);
      this.placeholder.add(this.steerPivot);
      this.steerPivot.add(cloneGroup(P.steer));
      this.forkLower = new THREE.Group();
      this.steerPivot.add(this.forkLower);
      this.forkLower.add(cloneGroup(P.forkLower));
      this.forkRest = 0.92; // top clamp -> axle at rest
      this.forkLower.position.copy(P.forkDir).multiplyScalar(0.54);
      this.frontWheel = cloneGroup(P.frontWheel);
      this.frontWheelHolder = new THREE.Group();
      this.steerPivot.add(this.frontWheelHolder);
      this.frontWheelHolder.add(this.frontWheel);
      this.swingarm = new THREE.Group();
      this.swingarm.position.copy(P.pivot);
      this.placeholder.add(this.swingarm);
      this.swingarm.add(cloneGroup(P.swingarm));
      this.rearWheel = cloneGroup(P.rearWheel);
      this.rearWheel.position.set(0, 0, -P.armLen);
      this.swingarm.add(this.rearWheel);
    } else {
      this.placeholder.add(cloneGroup(P.chassis));
      this.steerPivot = new THREE.Group();
      this.steerPivot.position.set(0, 0.36, 0.36);
      this.steerPivot.rotation.x = -0.25;
      this.placeholder.add(this.steerPivot);
      this.steerPivot.add(cloneGroup(P.steer));
      this.atvWheels = this.cfg.wheels.map((w, i) => {
        const holder = new THREE.Group();
        const steer = new THREE.Group();
        const spin = cloneGroup(i < 2 ? P.wheelsF[i] : P.wheelsR[i - 2]);
        holder.add(steer); steer.add(spin);
        holder.position.set(w.x + Math.sign(w.x) * 0.02, P.restY(w), w.z);
        this.placeholder.add(holder);
        return { holder, steer, spin };
      });
      this.axle = cloneGroup(P.axle);
      this.placeholder.add(this.axle);
      this.arms = [0, 1].map(() => [cloneGroup(P.arm), cloneGroup(P.arm)]);
      for (const a of this.arms) for (const m of a) this.placeholder.add(m);
      this.shocks = [0, 1].map(() => cloneGroup(P.shock));
      for (const s of this.shocks) this.placeholder.add(s);
    }
  }

  // Swap the placeholder for the player's GLB model (if one is available)
  async tryLoadModel() {
    const gltf = await loadGLB(this.def.model);
    if (!gltf) return false;
    try {
      this.integrateGLB(gltf.scene);
      return true;
    } catch (e) {
      console.warn('Model integration failed, keeping placeholder:', e);
      return false;
    }
  }

  integrateGLB(src) {
    const scene = src.clone(true);
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const nodes = [];
    scene.traverse((o) => nodes.push(o));
    const find = (tests) => nodes.find((o) => tests.some((t) => t.test(norm(o.name))));
    const isBike = this.isBike;
    const wheelNodes = isBike
      ? { f: find([/^wheelf/, /wheelfront/, /frontwheel/, /fwheel/, /tirefront/, /fronttire/]), r: find([/^wheelr/, /wheelrear/, /rearwheel/, /wheelback/, /backwheel/, /rwheel/, /tirerear/, /reartire/]) }
      : {
        fl: find([/wheelfl/, /flwheel/, /wheelfrontleft/, /frontleftwheel/, /wheelleftfront/]),
        fr: find([/wheelfr$/, /wheelfr[^o]/, /frwheel/, /wheelfrontright/, /frontrightwheel/, /wheelrightfront/]),
        rl: find([/wheelrl/, /rlwheel/, /wheelrearleft/, /rearleftwheel/, /wheelbackleft/, /wheelleftrear/]),
        rr: find([/wheelrr/, /rrwheel/, /wheelrearright/, /rearrightwheel/, /wheelbackright/, /wheelrightrear/]),
      };
    const steerNode = find([/handlebar/, /handle/, /steer/, /^bars?$/]);
    const forkNode = isBike ? find([/forklower/, /^fork/, /frontfork/]) : null;
    const swingNode = isBike ? find([/swingarm/, /swing/]) : null;

    scene.updateMatrixWorld(true);
    const centre = (o) => new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
    const size = (o) => new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
    const W = this.cfg.wheels;
    let fwd, scale, offset;
    const haveWheels = isBike ? wheelNodes.f && wheelNodes.r : wheelNodes.fl && wheelNodes.fr && wheelNodes.rl && wheelNodes.rr;
    const holder = new THREE.Group();
    holder.add(scene);
    if (haveWheels) {
      const cF = isBike ? centre(wheelNodes.f) : centre(wheelNodes.fl).add(centre(wheelNodes.fr)).multiplyScalar(0.5);
      const cR = isBike ? centre(wheelNodes.r) : centre(wheelNodes.rl).add(centre(wheelNodes.rr)).multiplyScalar(0.5);
      fwd = cF.clone().sub(cR); fwd.y = 0;
      const wbModel = fwd.length();
      scale = this.cfg.wheelbase / wbModel;
      // rotate so the model's front points along +z
      const yaw = Math.atan2(fwd.x, fwd.z);
      scene.rotation.y = -yaw;
      scene.scale.setScalar(scale);
      scene.updateMatrixWorld(true);
      const nF = isBike ? centre(wheelNodes.f) : centre(wheelNodes.fl).add(centre(wheelNodes.fr)).multiplyScalar(0.5);
      const restY = (w) => w.y - (w.travel - w.sag * w.travel);
      const target = new THREE.Vector3(0, restY(W[0]), W[0].z);
      offset = target.sub(nF);
      scene.position.add(offset);
      scene.updateMatrixWorld(true);
    } else {
      // no named wheels: fit the whole model to the expected length and sit it on the ground
      const s = size(scene);
      const len = Math.max(s.x, s.z);
      scale = (isBike ? 2.15 : 1.9) / len;
      if (s.x > s.z) scene.rotation.y = Math.PI / 2;
      scene.scale.setScalar(scale);
      scene.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(scene);
      const c = bb.getCenter(new THREE.Vector3());
      scene.position.set(-c.x, -this.cfg.rideHeight - bb.min.y, -c.z);
    }
    scene.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true;
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of ms) if (m && /paint|body|plastic|color|colour|livery/i.test(m.name || '')) { m.color = new THREE.Color(this.scheme.body); }
      }
    });
    // build spin / steer pivots around the named parts
    const pivotAt = (node, parent) => {
      const p = new THREE.Group();
      parent.add(p);
      p.updateMatrixWorld(true);
      const c = centre(node);
      p.parent.updateMatrixWorld(true);
      p.position.copy(p.parent.worldToLocal(c.clone()));
      p.updateMatrixWorld(true);
      p.attach(node);
      return p;
    };
    this.model.add(holder);
    this.model.updateMatrixWorld(true);
    this.glb = { holder, scene, haveWheels };
    if (haveWheels) {
      this.placeholder.visible = false;
      if (isBike) {
        this.glb.front = pivotAt(wheelNodes.f, this.model);
        this.glb.rear = pivotAt(wheelNodes.r, this.model);
        this.glb.frontRest = this.glb.front.position.clone();
        this.glb.rearRest = this.glb.rear.position.clone();
        if (steerNode && steerNode !== wheelNodes.f) { this.glb.steer = pivotAt(steerNode, this.model); }
        if (forkNode) { this.glb.fork = forkNode; this.glb.forkRest = forkNode.position.clone(); }
        if (swingNode) { this.glb.swing = swingNode; }
      } else {
        this.glb.wheels = ['fl', 'fr', 'rl', 'rr'].map((k) => {
          const p = pivotAt(wheelNodes[k], this.model);
          return { pivot: p, rest: p.position.clone() };
        });
        if (steerNode) this.glb.steer = pivotAt(steerNode, this.model);
      }
    } else {
      // keep the placeholder's wheels / forks / bars, hide its body
      this.placeholder.children[0].visible = false;
    }
    this.usingGLB = true;
  }

  // state: { lean, steer, wheels:[{comp, spin, steer}], crashed }
  update(state) {
    const cfg = this.cfg;
    this.lean.rotation.z = this.isBike ? -state.lean : 0;
    const A = this.attach;
    if (this.isBike) {
      const [wf, wr] = cfg.wheels;
      const extF = wf.travel - state.wheels[0].comp, extR = wr.travel - state.wheels[1].comp;
      const restF = wf.travel - wf.sag * wf.travel, restR = wr.travel - wr.sag * wr.travel;
      // front: steer about the fork axis, slide the lowers along it
      const P = this.parts;
      const axis = P.forkDir;
      this.steerPivot.quaternion.setFromAxisAngle(_v.copy(axis).negate(), state.steer * 1.0);
      const slide = (extF - restF) / Math.cos(P.rake);
      this.forkLower.position.copy(axis).multiplyScalar(0.54 + slide);
      this.frontWheelHolder.position.copy(axis).multiplyScalar(0.92 + slide);
      this.frontWheel.rotation.x = state.wheels[0].spin;
      // rear: swingarm points at the axle
      const axY = wr.y - extR, axZ = wr.z;
      const ang = Math.atan2(axY - P.pivot.y, -(axZ - P.pivot.z));
      this.swingarm.rotation.x = ang;
      this.rearWheel.rotation.x = state.wheels[1].spin;
      // attachment points (vehicle-local, before lean)
      A.seat.set(0, 0.2, -0.22);
      A.pegL.set(0.18, -0.36, -0.12); A.pegR.set(-0.18, -0.36, -0.12);
      const gL = _v.set(0.36, 0.125, -0.055).applyQuaternion(this.steerPivot.quaternion).add(P.head);
      A.gripL.copy(gL);
      const gR = _v.set(-0.36, 0.125, -0.055).applyQuaternion(this.steerPivot.quaternion).add(P.head);
      A.gripR.copy(gR);
      if (this.usingGLB && this.glb.haveWheels) {
        const g = this.glb;
        g.front.position.copy(g.frontRest); g.front.position.y += restF - extF;
        g.front.rotation.set(state.wheels[0].spin, 0, 0);
        g.rear.position.copy(g.rearRest); g.rear.position.y += restR - extR;
        g.rear.rotation.set(state.wheels[1].spin, 0, 0);
        if (g.steer) g.steer.rotation.y = state.steer;
        if (g.fork && g.forkRest) { g.fork.position.copy(g.forkRest); }
      }
    } else {
      const P = this.parts;
      const W = cfg.wheels;
      this.steerPivot.rotation.y = state.steer * 0.9;
      this.atvWheels.forEach((w, i) => {
        const c = W[i];
        const ext = c.travel - state.wheels[i].comp;
        w.holder.position.y = c.y - ext;
        w.steer.rotation.y = state.wheels[i].steer || 0;
        w.spin.rotation.x = state.wheels[i].spin;
      });
      // rear axle sits between the two rear wheels
      const yl = this.atvWheels[2].holder.position.y, yr = this.atvWheels[3].holder.position.y;
      this.axle.position.set(0, (yl + yr) / 2, W[2].z);
      this.axle.rotation.z = Math.atan2(yl - yr, W[2].x - W[3].x);
      // front a-arms + shocks
      for (let k = 0; k < 2; k++) {
        const wh = this.atvWheels[k].holder.position;
        const sx = Math.sign(W[k].x);
        for (let j = 0; j < 2; j++) {
          const from = _v.set(sx * 0.18, -0.24 + j * 0.12, W[k].z + (j ? -0.05 : 0.05));
          const to = _v2.set(wh.x - sx * 0.12, wh.y + (j ? 0.06 : -0.04), wh.z);
          const arm = this.arms[k][j];
          arm.position.copy(from);
          arm.scale.set(1, 1, from.distanceTo(to));
          arm.quaternion.setFromUnitVectors(_z, _v4.subVectors(to, from).normalize());
        }
        const sh = this.shocks[k];
        const top = _v.set(sx * 0.15, 0.08, W[k].z - 0.05), bot = _v2.set(wh.x - sx * 0.14, wh.y + 0.04, wh.z);
        sh.position.copy(bot);
        sh.quaternion.setFromUnitVectors(_y, _v4.subVectors(top, bot).normalize());
        sh.scale.set(1, top.distanceTo(bot), 1);
      }
      A.seat.set(0, 0.36, -0.28);
      A.pegL.set(0.38, -0.27, -0.02); A.pegR.set(-0.38, -0.27, -0.02);
      const sq = this.steerPivot.quaternion, sp = this.steerPivot.position;
      A.gripL.set(0.4, 0.075, -0.05).applyQuaternion(sq).add(sp);
      A.gripR.set(-0.4, 0.075, -0.05).applyQuaternion(sq).add(sp);
      if (this.usingGLB && this.glb.haveWheels) {
        this.glb.wheels.forEach((w, i) => {
          const c = W[i];
          const ext = c.travel - state.wheels[i].comp, rest = c.travel - c.sag * c.travel;
          w.pivot.position.copy(w.rest); w.pivot.position.y += rest - ext;
          w.pivot.rotation.set(state.wheels[i].spin, state.wheels[i].steer || 0, 0, 'YXZ');
        });
        if (this.glb.steer) this.glb.steer.rotation.y = state.steer * 0.9;
      }
    }
  }

  dispose() {
    this.root.removeFromParent();
    // geometry/material are shared through the caches; only GLB clones own nothing extra
  }
}

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1), _y = new THREE.Vector3(0, 1, 0);
