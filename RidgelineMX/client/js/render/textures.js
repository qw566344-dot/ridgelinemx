// Procedural textures drawn on canvases at load time (no image files needed).
import * as THREE from 'three';
import { rng } from '/shared/noise.js';

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function finish(c, renderer, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// tileable value noise on a canvas-sized grid
function noiseLayer(ctx, size, cells, r, colorFn, alpha) {
  const g = [];
  for (let i = 0; i < cells * cells; i++) g.push(r());
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells, fy = (y / size) * cells;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      const tx = fx - ix, ty = fy - iy;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = g[(iy % cells) * cells + (ix % cells)], b = g[(iy % cells) * cells + ((ix + 1) % cells)];
      const c = g[((iy + 1) % cells) * cells + (ix % cells)], e = g[((iy + 1) % cells) * cells + ((ix + 1) % cells)];
      const v = a + (b - a) * sx + (c - a) * sy + (a - b - c + e) * sx * sy;
      const [cr, cg, cb] = colorFn(v);
      const i = (y * size + x) * 4;
      d[i] = d[i] * (1 - alpha) + cr * alpha;
      d[i + 1] = d[i + 1] * (1 - alpha) + cg * alpha;
      d[i + 2] = d[i + 2] * (1 - alpha) + cb * alpha;
    }
  }
  ctx.putImageData(img, 0, 0);
}

export function makeGrassTexture(renderer) {
  const S = 512, c = canvas(S), ctx = c.getContext('2d'), r = rng(11);
  ctx.fillStyle = '#5d8a35'; ctx.fillRect(0, 0, S, S);
  noiseLayer(ctx, S, 8, r, (v) => [70 + v * 40, 110 + v * 45, 40 + v * 20], 0.7);
  noiseLayer(ctx, S, 32, r, (v) => [60 + v * 50, 100 + v * 50, 35 + v * 25], 0.35);
  for (let i = 0; i < 9000; i++) {
    const x = r() * S, y = r() * S, l = 3 + r() * 7;
    const g = 90 + r() * 90;
    ctx.strokeStyle = `rgba(${g * 0.55 | 0},${g | 0},${g * 0.3 | 0},${0.35 + r() * 0.4})`;
    ctx.lineWidth = 1 + r();
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (r() - 0.5) * 4, y - l); ctx.stroke();
  }
  for (let i = 0; i < 300; i++) {
    ctx.fillStyle = r() < 0.5 ? 'rgba(220,210,90,0.5)' : 'rgba(240,240,240,0.4)';
    ctx.fillRect(r() * S, r() * S, 2, 2);
  }
  return finish(c, renderer);
}

export function makeDirtTexture(renderer) {
  const S = 512, c = canvas(S), ctx = c.getContext('2d'), r = rng(23);
  ctx.fillStyle = '#8a6440'; ctx.fillRect(0, 0, S, S);
  noiseLayer(ctx, S, 6, r, (v) => [120 + v * 40, 86 + v * 30, 55 + v * 22], 0.8);
  noiseLayer(ctx, S, 24, r, (v) => [110 + v * 50, 80 + v * 36, 52 + v * 26], 0.4);
  noiseLayer(ctx, S, 96, r, (v) => [100 + v * 60, 74 + v * 44, 48 + v * 30], 0.25);
  // pebbles and clods
  for (let i = 0; i < 2600; i++) {
    const x = r() * S, y = r() * S, rad = 0.6 + r() * r() * 3.5;
    const l = 70 + r() * 90;
    ctx.fillStyle = `rgb(${l | 0},${l * 0.78 | 0},${l * 0.58 | 0})`;
    ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(30,20,10,0.35)';
    ctx.beginPath(); ctx.arc(x + rad * 0.4, y + rad * 0.4, rad, 0, 7); ctx.fill();
  }
  return finish(c, renderer);
}

export function makeRockTexture(renderer) {
  const S = 256, c = canvas(S), ctx = c.getContext('2d'), r = rng(31);
  ctx.fillStyle = '#7c776f'; ctx.fillRect(0, 0, S, S);
  noiseLayer(ctx, S, 5, r, (v) => [100 + v * 60, 96 + v * 58, 90 + v * 55], 0.8);
  noiseLayer(ctx, S, 20, r, (v) => [90 + v * 70, 88 + v * 66, 84 + v * 62], 0.4);
  for (let i = 0; i < 160; i++) {
    ctx.strokeStyle = `rgba(40,38,36,${0.2 + r() * 0.3})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    let x = r() * S, y = r() * S; ctx.moveTo(x, y);
    for (let k = 0; k < 5; k++) { x += (r() - 0.5) * 30; y += (r() - 0.5) * 30; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  return finish(c, renderer);
}

// Soft round sprite for dust particles
export function makeDustSprite() {
  const S = 64, c = canvas(S), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  return t;
}

export function makeCheckerTexture(renderer, cells = 8) {
  const S = 256, c = canvas(S), ctx = c.getContext('2d');
  const w = S / cells;
  for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) {
    ctx.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
    ctx.fillRect(x * w, y * w, w, w);
  }
  return finish(c, renderer);
}

// Banner atlas: several generic, made-up track banners in one texture
export const BANNER_TEXTS = [
  ['RIDGELINE MX', '#d8261c', '#fff'], ['DIRT DEPOT', '#111', '#f2c21b'], ['GO FAST', '#1d4ed8', '#fff'],
  ['ROOST CO.', '#f06a0f', '#111'], ['BERM BROS', '#46b11c', '#fff'], ['MX PARK', '#fff', '#d8261c'],
  ['HOLESHOT', '#6b21a8', '#fff'], ['SEND IT', '#0d9488', '#fff'],
];
export function makeBannerAtlas(renderer) {
  const W = 1024, H = 64 * BANNER_TEXTS.length;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  BANNER_TEXTS.forEach(([text, bg, fg], i) => {
    const y = i * 64;
    ctx.fillStyle = bg; ctx.fillRect(0, y, W, 64);
    ctx.fillStyle = fg; ctx.fillRect(0, y, W, 5); ctx.fillRect(0, y + 59, W, 5);
    ctx.font = 'italic 900 44px Arial Black, Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let k = 0; k < 2; k++) ctx.fillText(text, W * (0.25 + k * 0.5), y + 34);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;
  return t;
}

export function makeTextTexture(text, bg, fg, w = 512, h = 128, font = 'italic 900 84px Arial Black, Arial') {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = fg; ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
