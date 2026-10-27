// =====================================================================
//  TRACK GENERATOR (pure math, runs in the browser AND on the server)
//  buildTrack(def)          -> centreline samples, widths, berms, jumps
//  buildFields(T, res)      -> grid telling every ground cell which part
//                              of the track it is nearest to (s, u)
//  trackSurface(T, s, u)    -> designed height of the track at (s, u)
//  s = metres along the lap, u = metres sideways (+ = left of travel)
// =====================================================================

const STEP = 0.5; // centreline sample spacing (m)

function nl(th) { return [Math.sin(th), -Math.cos(th)]; } // left normal of heading th

// --- Walk the turtle segments --------------------------------------------
function walk(def, lens) {
  let x = def.start.x, z = def.start.z, th = def.start.heading;
  const out = [];
  let si = 0;
  for (const seg of def.segments) {
    if (seg.turn !== undefined) {
      const a = (seg.turn * Math.PI) / 180;
      const sg = Math.sign(a) || 1;
      const n0 = nl(th);
      const cx = x + sg * seg.r * n0[0], cz = z + sg * seg.r * n0[1];
      const len = Math.abs(a) * seg.r;
      out.push({ seg, kind: 'turn', x0: x, z0: z, th0: th, cx, cz, sg, len });
      th = th - a;
      const n1 = nl(th);
      x = cx - sg * seg.r * n1[0];
      z = cz - sg * seg.r * n1[1];
    } else {
      const len = lens[si++];
      out.push({ seg, kind: 'straight', x0: x, z0: z, th0: th, len });
      x += Math.cos(th) * len;
      z += Math.sin(th) * len;
    }
  }
  return { parts: out, end: [x, z], th };
}

// Adjust the straight lengths as little as possible so the loop closes
// exactly. Straights marked `free: true` absorb most of the change.
// (least squares with the closure as a constraint - closed form)
function solveClosure(def) {
  const totalTurn = def.segments.reduce((a, s) => a + (s.turn || 0), 0);
  if (Math.abs(Math.abs(totalTurn) - 360) > 0.01) {
    throw new Error(def.id + ': turns add up to ' + totalTurn.toFixed(1) + ' deg, need 360');
  }
  const straights = def.segments.filter((s) => s.turn === undefined);
  const zero = walk(def, straights.map(() => 0), true);
  const dirs = zero.parts.filter((p) => p.kind === 'straight').map((p) => [Math.cos(p.th0), Math.sin(p.th0)]);
  const t = straights.map((s) => s.len);
  const winv = straights.map((s) => (s.free ? 12 : 1));
  // closure residual if every straight keeps its target length
  let bx = def.start.x - zero.end[0], bz = def.start.z - zero.end[1];
  for (let i = 0; i < t.length; i++) { bx -= dirs[i][0] * t[i]; bz -= dirs[i][1] * t[i]; }
  // M = A W^-1 A^T  (2x2)
  let m00 = 0, m01 = 0, m11 = 0;
  for (let i = 0; i < t.length; i++) {
    m00 += winv[i] * dirs[i][0] * dirs[i][0];
    m01 += winv[i] * dirs[i][0] * dirs[i][1];
    m11 += winv[i] * dirs[i][1] * dirs[i][1];
  }
  const det = m00 * m11 - m01 * m01;
  const l0 = (bx * m11 - bz * m01) / det, l1 = (m00 * bz - m01 * bx) / det;
  return t.map((ti, i) => ti + winv[i] * (dirs[i][0] * l0 + dirs[i][1] * l1));
}

function cyclicSmooth(arr, radius) {
  // box filter applied 3 times (close to a gaussian), wrapping around the lap
  const n = arr.length;
  let src = Float32Array.from(arr), dst = new Float32Array(n);
  const r = Math.max(1, Math.round(radius));
  for (let pass = 0; pass < 3; pass++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[(k + n) % n];
    for (let i = 0; i < n; i++) {
      dst[i] = sum / (2 * r + 1);
      sum += src[(i + r + 1) % n] - src[(i - r + n) % n];
    }
    [src, dst] = [dst, src];
  }
  return src;
}

// --- Jump shapes (Hermite knots: x along the straight, h height, m slope) --
function hermite(knots, x) {
  if (x <= knots[0].x || x >= knots[knots.length - 1].x) return 0;
  for (let i = 0; i < knots.length - 1; i++) {
    const a = knots[i], b = knots[i + 1];
    if (x <= b.x) {
      const dx = b.x - a.x;
      if (dx <= 0) return b.h;
      const t = (x - a.x) / dx, t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * a.h + (t3 - 2 * t2 + t) * dx * a.m +
             (-2 * t3 + 3 * t2) * b.h + (t3 - t2) * dx * b.m;
    }
  }
  return 0;
}

function takeoff(k, x, h, face) {
  const m = Math.min(0.62, (2.1 * h) / face);
  k.push({ x: x + face, h, m });
  k.push({ x: x + face + 0.7, h: h + 0.1, m: 0 });
  return x + face + 0.7;
}

export function featureKnots(f) {
  const k = [{ x: 0, h: 0, m: 0 }];
  let x = 0;
  switch (f.type) {
    case 'table':
      x = takeoff(k, x, f.h, f.face);
      x += f.top; k.push({ x, h: f.h + 0.1, m: 0 });
      x += f.land; k.push({ x, h: 0, m: 0 });
      break;
    case 'double':
    case 'triple': {
      x = takeoff(k, x, f.h, f.face);
      x += Math.max(2.4, f.h * 1.5); k.push({ x, h: 0, m: 0 });
      if (f.type === 'triple') {
        x += f.gap * 0.5; k.push({ x, h: 0, m: 0 });
        x += 2.6; k.push({ x, h: f.h2 * 0.85, m: 0 });
        x += 2.6; k.push({ x, h: 0, m: 0 });
        x += f.gap * 0.5; k.push({ x, h: 0, m: 0 });
      } else {
        x += f.gap; k.push({ x, h: 0, m: 0 });
      }
      x += Math.max(3.0, f.h2 * 1.8); k.push({ x, h: f.h2, m: 0 });
      x += f.land; k.push({ x, h: 0, m: 0 });
      break;
    }
    case 'step':
      x = takeoff(k, x, f.h, f.face);
      x += Math.max(2.2, f.h * 1.3); k.push({ x, h: 0.3, m: 0 });
      x += f.gap; k.push({ x, h: 0.3, m: 0 });
      x += Math.max(3.5, (f.h2 - 0.3) * 1.8); k.push({ x, h: f.h2, m: 0 });
      x += f.top; k.push({ x, h: f.h2, m: 0 });
      x += f.land; k.push({ x, h: 0, m: 0 });
      break;
    default:
      return null;
  }
  return k;
}

export function featureLength(f) {
  if (f.type === 'whoops' || f.type === 'rollers') return f.n * f.len;
  const k = featureKnots(f);
  return k[k.length - 1].x;
}

function featureHeight(f, knots, x) {
  if (f.type === 'whoops' || f.type === 'rollers') {
    const L = f.n * f.len;
    if (x <= 0 || x >= L) return 0;
    return f.h * 0.5 * (1 - Math.cos((2 * Math.PI * x) / f.len));
  }
  return hermite(knots, x);
}

// --- Build the whole track description ------------------------------------
export function buildTrack(def) {
  const lens = solveClosure(def);
  const { parts } = walk(def, lens);
  let L = 0;
  for (const p of parts) { p.s0 = L; L += p.len; p.s1 = L; }

  const n = Math.round(L / STEP);
  const step = L / n;
  const xs = new Float32Array(n), zs = new Float32Array(n);
  const tx = new Float32Array(n), tz = new Float32Array(n);
  const kraw = new Float32Array(n), wraw = new Float32Array(n), bermraw = new Float32Array(n);
  let pi = 0;
  for (let i = 0; i < n; i++) {
    const s = i * step;
    while (pi < parts.length - 1 && s >= parts[pi].s1) pi++;
    const p = parts[pi];
    const t = s - p.s0;
    let x, z, th;
    if (p.kind === 'straight') {
      th = p.th0;
      x = p.x0 + Math.cos(th) * t;
      z = p.z0 + Math.sin(th) * t;
      kraw[i] = 0;
      bermraw[i] = 0;
      wraw[i] = p.seg.w || def.defaultWidth;
    } else {
      th = p.th0 - (p.sg * t) / p.seg.r;
      const nn = nl(th);
      x = p.cx - p.sg * p.seg.r * nn[0];
      z = p.cz - p.sg * p.seg.r * nn[1];
      kraw[i] = p.sg / p.seg.r;
      bermraw[i] = p.seg.berm ?? 0.8;
      wraw[i] = p.seg.w || def.defaultWidth;
    }
    xs[i] = x; zs[i] = z;
    tx[i] = Math.cos(th); tz[i] = Math.sin(th);
  }
  const kappa = cyclicSmooth(kraw, 6 / step);
  const width = cyclicSmooth(wraw, 10 / step);
  const berm = cyclicSmooth(bermraw, 7 / step);

  // Bank (slope of the berm face) and berm width per sample
  const bank = new Float32Array(n), bermW = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const b = Math.min(0.62, Math.abs(kappa[i]) * 9.5) * berm[i];
    bank[i] = b;
    bermW[i] = 4.0 * Math.min(1, b / 0.35);
  }

  // Features -> per-sample height arrays (all lanes, left lane, right lane)
  const fAll = new Float32Array(n), fL = new Float32Array(n), fR = new Float32Array(n);
  const features = [];
  for (const p of parts) {
    if (p.kind !== 'straight' || !p.seg.features) continue;
    for (const f of p.seg.features) {
      const len = featureLength(f);
      const knots = featureKnots(f);
      const s0 = p.s0 + f.at;
      if (f.at + len > p.len + 0.01) {
        console.warn(`[track ${def.id}] feature ${f.type} in "${p.seg.name}" runs ${(f.at + len - p.len).toFixed(1)} m past the straight`);
      }
      features.push({ ...f, s0, s1: s0 + len, knots, segName: p.seg.name });
      const arr = f.lane === 'L' ? fL : f.lane === 'R' ? fR : fAll;
      const i0 = Math.floor(s0 / step), i1 = Math.ceil((s0 + len) / step);
      for (let i = i0; i <= i1; i++) {
        const ii = ((i % n) + n) % n;
        arr[ii] += featureHeight(f, knots, i * step - s0);
      }
    }
  }

  // Sections (for practice mode and the HUD)
  const sections = parts.filter((p) => p.kind === 'straight' && p.seg.name)
    .map((p) => ({ name: p.seg.name, s0: p.s0, s1: p.s1 }));

  // Fence offsets on each side
  const fenceL = new Float32Array(n), fenceR = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const hw = width[i] / 2;
    const outsideLeft = kappa[i] < 0; // right turn -> outside is the left
    const extra = bermW[i] + 1.5;
    fenceL[i] = hw + 3.0 + (outsideLeft ? extra : 0);
    fenceR[i] = hw + 3.0 + (!outsideLeft && kappa[i] > 0 ? extra : 0);
  }

  // Checkpoints every ~60 m, the finish line is checkpoint 0
  const cpCount = Math.max(6, Math.round(L / 60));
  const checkpoints = [];
  for (let i = 0; i < cpCount; i++) checkpoints.push((def.finishAt + (i * L) / cpCount) % L);

  const T = {
    def, id: def.id, L, n, step, xs, zs, tx, tz, kappa, width, bank, bermW, berm,
    fAll, fL, fR, features, sections, fenceL, fenceR, checkpoints,
    gateS: def.gateAt, finishS: def.finishAt, parts,
    grade: new Float32Array(n), // filled in by setGrade() once the base terrain is known
  };
  T.flatSpawn = buildSpawnMask(T);
  return T;
}

// Mark samples where it is safe to reset a rider (no jump under them)
function buildSpawnMask(T) {
  const ok = new Uint8Array(T.n);
  const pad = Math.round(4 / T.step);
  for (let i = 0; i < T.n; i++) {
    let flat = true;
    for (let k = -pad; k <= pad && flat; k++) {
      const j = (i + k + T.n) % T.n;
      if (T.fAll[j] > 0.05 || T.fL[j] > 0.05 || T.fR[j] > 0.05) flat = false;
    }
    if (T.bank[i] > 0.2) flat = false;
    ok[i] = flat ? 1 : 0;
  }
  return ok;
}

// --- Sampling helpers -------------------------------------------------------
export function wrapS(T, s) { return ((s % T.L) + T.L) % T.L; }

export function sampleArr(T, arr, s) {
  const f = wrapS(T, s) / T.step;
  const i = Math.floor(f), t = f - i;
  const a = arr[i % T.n], b = arr[(i + 1) % T.n];
  return a + (b - a) * t;
}

export function pointAt(T, s, u = 0) {
  const x = sampleArr(T, T.xs, s), z = sampleArr(T, T.zs, s);
  let tx = sampleArr(T, T.tx, s), tz = sampleArr(T, T.tz, s);
  const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
  // left normal of (tx, tz) is (tz, -tx)
  return { x: x + tz * u, z: z - tx * u, tx, tz };
}

// Designed track height at (s, u) relative to nothing (add grade yourself
// via trackSurface which includes it).
export function trackSurface(T, s, u) {
  const hw = sampleArr(T, T.width, s) / 2;
  const grade = sampleArr(T, T.grade, s);
  const au = Math.abs(u);
  // jumps (full width) fade out beyond the edges
  const edgeMask = 1 - smooth01((au - (hw + 0.3)) / 3.0);
  let h = grade + sampleArr(T, T.fAll, s) * edgeMask;
  const fl = sampleArr(T, T.fL, s), fr = sampleArr(T, T.fR, s);
  if (fl > 0 || fr > 0) {
    const lm = smooth01((u - 0.3) / 1.4) * edgeMask;
    const rm = smooth01((-u - 0.3) / 1.4) * edgeMask;
    h += fl * lm + fr * rm;
  }
  // berms: the outside of the turn rises
  const k = sampleArr(T, T.kappa, s);
  const b = sampleArr(T, T.bank, s);
  if (b > 0.01) {
    const uo = k > 0 ? -u : u; // + toward the outside
    if (uo > 0) {
      const bw = Math.max(0.5, sampleArr(T, T.bermW, s));
      if (uo <= hw) h += (b * uo * uo) / (2 * hw);
      else if (uo <= hw + bw) {
        const e = uo - hw;
        h += (b * hw) / 2 + b * e - (b / (2 * bw)) * e * e;
      } else h += (b * hw) / 2 + (b * bw) / 2;
    }
  }
  // little windrows of graded dirt along the edges
  const wr = au - (hw + 1.0);
  if (wr > -1.2 && wr < 1.2) h += 0.28 * (0.5 + 0.5 * Math.cos((wr / 1.2) * Math.PI));
  return h;
}

// How strongly the track surface replaces the natural ground at (s, u)
export function trackWeight(T, s, u) {
  const hw = sampleArr(T, T.width, s) / 2;
  const k = sampleArr(T, T.kappa, s);
  const outside = (k > 0 ? -u : u) > 0;
  const edge = hw + 2.2 + (outside ? sampleArr(T, T.bermW, s) : 0);
  return 1 - smooth01((Math.abs(u) - edge) / 11);
}

// 0 = grass, 1 = dirt
export function dirtAmount(T, s, u) {
  const hw = sampleArr(T, T.width, s) / 2;
  const k = sampleArr(T, T.kappa, s);
  const outside = (k > 0 ? -u : u) > 0;
  const edge = hw + 1.6 + (outside ? sampleArr(T, T.bermW, s) * 0.9 : 0);
  return 1 - smooth01((Math.abs(u) - edge) / 2.5);
}

function smooth01(t) {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

// Set the track's elevation profile from the natural ground under it.
export function setGrade(T, baseFn) {
  const raw = new Float32Array(T.n);
  for (let i = 0; i < T.n; i++) raw[i] = baseFn(T.xs[i], T.zs[i]);
  const g = cyclicSmooth(raw, 26 / T.step);
  T.grade.set(g);
}

// --- Nearest-track lookup grid ----------------------------------------------
// For every cell within `radius` of the centreline: s (along) and u (side).
export function buildFields(T, res, radius = 32) {
  const size = T.def.worldSize;
  const half = size / 2;
  const cells = Math.round(size / res) + 1;
  const S = new Float32Array(cells * cells).fill(-1);
  const U = new Float32Array(cells * cells);
  const D = new Float32Array(cells * cells).fill(1e9);
  const stride = Math.max(1, Math.round(1.0 / T.step));
  const rc = Math.ceil(radius / res);
  const r2 = radius * radius;
  for (let i = 0; i < T.n; i += stride) {
    const px = T.xs[i], pz = T.zs[i];
    const cx = Math.round((px + half) / res), cz = Math.round((pz + half) / res);
    const ttx = T.tx[i], ttz = T.tz[i];
    const s0 = i * T.step;
    for (let gz = Math.max(0, cz - rc); gz <= Math.min(cells - 1, cz + rc); gz++) {
      const wz = gz * res - half, dz = wz - pz;
      for (let gx = Math.max(0, cx - rc); gx <= Math.min(cells - 1, cx + rc); gx++) {
        const wx = gx * res - half, dx = wx - px;
        const d2 = dx * dx + dz * dz;
        if (d2 > r2) continue;
        const idx = gz * cells + gx;
        if (d2 < D[idx]) {
          D[idx] = d2;
          S[idx] = s0 + dx * ttx + dz * ttz;
          U[idx] = dx * ttz - dz * ttx; // dot with left normal (tz, -tx)
        }
      }
    }
  }
  // wrap every stamped cell into 0..L (cells just behind s=0 come out negative)
  for (let i = 0; i < S.length; i++) {
    if (D[i] < 1e9) S[i] = ((S[i] % T.L) + T.L) % T.L;
    else S[i] = -1;
  }
  return { res, cells, half, S, U };
}

// Look up (s, u) at a world position. Returns null when far from the track.
export function locate(F, x, z) {
  const gx = Math.round((x + F.half) / F.res), gz = Math.round((z + F.half) / F.res);
  if (gx < 0 || gz < 0 || gx >= F.cells || gz >= F.cells) return null;
  const i = gz * F.cells + gx;
  if (F.S[i] < 0) return null;
  return { s: F.S[i], u: F.U[i] };
}

// Precise (s, u) by refining the grid guess against the real centreline
export function locatePrecise(T, F, x, z, hintS) {
  let s;
  if (hintS !== undefined && hintS !== null) s = hintS;
  else {
    const g = locate(F, x, z);
    if (!g) return null;
    s = g.s;
  }
  for (let it = 0; it < 3; it++) {
    const p = pointAt(T, s, 0);
    const dx = x - p.x, dz = z - p.z;
    const along = dx * p.tx + dz * p.tz;
    s = wrapS(T, s + along);
    if (Math.abs(along) < 0.01) break;
  }
  const p = pointAt(T, s, 0);
  const dx = x - p.x, dz = z - p.z;
  return { s, u: dx * p.tz - dz * p.tx };
}

// Signed distance travelled from s0 to s1 the short way round the lap
export function deltaS(T, s0, s1) {
  let d = s1 - s0;
  if (d > T.L / 2) d -= T.L;
  if (d < -T.L / 2) d += T.L;
  return d;
}
