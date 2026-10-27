// =====================================================================
//  TERRAIN BUILDER (pure math - used by the game and by the test tools)
//  makeWorld(def) builds the complete height grid for a track:
//    natural hills + the carved track (jumps, berms, windrows)
//  The SAME grid is used for physics and for drawing, so what you see
//  is exactly what the wheels touch.
// =====================================================================
import { fbm, smoothstep } from './noise.js';
import { buildTrack, buildFields, setGrade, trackSurface, trackWeight, dirtAmount } from './trackgen.js';

export const TERRAIN_RES = 0.5; // metres per height sample

export function makeBaseFn(def) {
  const t = def.terrain, half = def.worldSize / 2, seed = def.seed;
  return function base(x, z) {
    let h = t.hills * fbm(x / t.hillScale, z / t.hillScale, seed, 4);
    for (const b of t.bumps) {
      const dx = x - b.x, dz = z - b.z;
      h += b.h * Math.exp(-(dx * dx + dz * dz) / (b.r * b.r));
    }
    // surrounding hills / quarry walls
    const d = Math.pow(Math.pow(Math.abs(x), 4) + Math.pow(Math.abs(z), 4), 0.25);
    if (t.rimSharp) {
      const k = smoothstep(t.rimStart, t.rimStart + 22, d);
      h += t.rim * k * (0.8 + 0.25 * fbm(x / 40, z / 40, seed + 9, 3));
    } else {
      const k = smoothstep(t.rimStart, half + 10, d);
      h += t.rim * k * k * (0.7 + 0.5 * fbm(x / 90, z / 90, seed + 9, 3));
    }
    h += 0.35 * fbm(x / 14, z / 14, seed + 5, 2);
    return h;
  };
}

// Everything the game needs to know about the ground for one track.
export function makeWorld(def, opts = {}) {
  const t0 = Date.now();
  const T = buildTrack(def);
  const base = makeBaseFn(def);
  setGrade(T, base);
  const res = opts.res || TERRAIN_RES;
  const F = buildFields(T, res, 34);
  const cells = F.cells, half = F.half;
  const H = new Float32Array(cells * cells);
  const DIRT = new Uint8Array(cells * cells);

  // natural ground on a coarse 2 m grid, then bilinear fill (it is smooth)
  const cr = 2, cc = Math.round(def.worldSize / cr) + 2;
  const coarse = new Float32Array(cc * cc);
  for (let j = 0; j < cc; j++) for (let i = 0; i < cc; i++) coarse[j * cc + i] = base(i * cr - half, j * cr - half);
  for (let gz = 0; gz < cells; gz++) {
    const fz = (gz * res) / cr, jz = Math.min(cc - 2, Math.floor(fz)), tz = fz - jz;
    for (let gx = 0; gx < cells; gx++) {
      const fx = (gx * res) / cr, jx = Math.min(cc - 2, Math.floor(fx)), tx = fx - jx;
      const a = coarse[jz * cc + jx], b = coarse[jz * cc + jx + 1];
      const c = coarse[(jz + 1) * cc + jx], d = coarse[(jz + 1) * cc + jx + 1];
      H[gz * cells + gx] = (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
    }
  }
  // carve the track in
  for (let i = 0; i < H.length; i++) {
    const s = F.S[i];
    if (s < 0) continue;
    const u = F.U[i];
    const w = trackWeight(T, s, u);
    if (w > 0) H[i] += (trackSurface(T, s, u) - H[i]) * w;
    DIRT[i] = Math.round(255 * dirtAmount(T, s, u));
  }
  const world = { def, T, F, res, cells, half, H, DIRT, base, size: def.worldSize };
  world.buildMs = Date.now() - t0;
  return world;
}

// --- Queries used by physics --------------------------------------------------
export function heightAt(W, x, z) {
  const fx = (x + W.half) / W.res, fz = (z + W.half) / W.res;
  let ix = Math.floor(fx), iz = Math.floor(fz);
  if (ix < 0) ix = 0; if (iz < 0) iz = 0;
  if (ix > W.cells - 2) ix = W.cells - 2; if (iz > W.cells - 2) iz = W.cells - 2;
  const tx = Math.min(1, Math.max(0, fx - ix)), tz = Math.min(1, Math.max(0, fz - iz));
  const i = iz * W.cells + ix, H = W.H;
  const a = H[i], b = H[i + 1], c = H[i + W.cells], d = H[i + W.cells + 1];
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
}

// Height and surface normal in one go. out = {h, nx, ny, nz}
export function groundAt(W, x, z, out) {
  const fx = (x + W.half) / W.res, fz = (z + W.half) / W.res;
  let ix = Math.floor(fx), iz = Math.floor(fz);
  if (ix < 0) ix = 0; if (iz < 0) iz = 0;
  if (ix > W.cells - 2) ix = W.cells - 2; if (iz > W.cells - 2) iz = W.cells - 2;
  const tx = Math.min(1, Math.max(0, fx - ix)), tz = Math.min(1, Math.max(0, fz - iz));
  const i = iz * W.cells + ix, H = W.H;
  const a = H[i], b = H[i + 1], c = H[i + W.cells], d = H[i + W.cells + 1];
  out.h = (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  // analytic gradient of the bilinear patch
  const dhdx = ((b - a) * (1 - tz) + (d - c) * tz) / W.res;
  const dhdz = ((c - a) * (1 - tx) + (d - b) * tx) / W.res;
  const inv = 1 / Math.sqrt(dhdx * dhdx + 1 + dhdz * dhdz);
  out.nx = -dhdx * inv; out.ny = inv; out.nz = -dhdz * inv;
  return out;
}

export function dirtAt(W, x, z) {
  const ix = Math.round((x + W.half) / W.res), iz = Math.round((z + W.half) / W.res);
  if (ix < 0 || iz < 0 || ix >= W.cells || iz >= W.cells) return 0;
  return W.DIRT[iz * W.cells + ix] / 255;
}
