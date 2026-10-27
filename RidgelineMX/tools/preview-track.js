// Draws every track layout top-down as an SVG and checks it for problems.
//   node tools/preview-track.js        -> tools/out/tracks.html
import { TRACKS } from '../shared/tracks.js';
import { buildTrack, pointAt } from '../shared/trackgen.js';
import fs from 'fs';

fs.mkdirSync('tools/out', { recursive: true });
let html = '<html><body style="background:#222;color:#eee;font-family:sans-serif">';
for (const def of TRACKS) {
  let T;
  try { T = buildTrack(def); } catch (e) { console.log('ERROR', e.message); html += `<p>${def.id}: ${e.message}</p>`; continue; }
  const half = def.worldSize / 2;
  const sc = 900 / def.worldSize;
  const X = (x) => ((x + half) * sc).toFixed(1), Z = (z) => ((z + half) * sc).toFixed(1);
  // separation check: closest approach of parts of the lap more than 80 m apart
  let minSep = 1e9, where = null;
  const stride = 4;
  for (let i = 0; i < T.n; i += stride) {
    for (let j = i + stride; j < T.n; j += stride) {
      let ds = Math.abs(i - j) * T.step; ds = Math.min(ds, T.L - ds);
      if (ds < 90) continue;
      const d = Math.hypot(T.xs[i] - T.xs[j], T.zs[i] - T.zs[j]);
      const need = T.width[i] / 2 + T.width[j] / 2;
      const sep = d - need;
      if (sep < minSep) { minSep = sep; where = [i * T.step, j * T.step, d]; }
    }
  }
  let svg = `<svg width="900" height="900" style="background:#3d5a2a">`;
  svg += `<rect x="0" y="0" width="900" height="900" fill="none" stroke="#888"/>`;
  const edge = (u0) => {
    let d = '';
    for (let i = 0; i <= T.n; i += 2) {
      const s = (i % T.n) * T.step;
      const hw = T.width[i % T.n] / 2;
      const u = u0 === 'L' ? T.fenceL[i % T.n] : u0 === 'R' ? -T.fenceR[i % T.n] : u0 * hw;
      const p = pointAt(T, s, u);
      d += (i === 0 ? 'M' : 'L') + X(p.x) + ',' + Z(p.z);
    }
    return d;
  };
  svg += `<path d="${edge(1)}" fill="none" stroke="#a0784a" stroke-width="1"/>`;
  svg += `<path d="${edge(-1)}" fill="none" stroke="#a0784a" stroke-width="1"/>`;
  svg += `<path d="${edge('L')}" fill="none" stroke="#fff" stroke-width="0.6" stroke-dasharray="3,3"/>`;
  svg += `<path d="${edge('R')}" fill="none" stroke="#fff" stroke-width="0.6" stroke-dasharray="3,3"/>`;
  svg += `<path d="${edge(0)}" fill="none" stroke="#6b4a2a" stroke-width="${(12 * sc).toFixed(1)}" opacity="0.6"/>`;
  for (const f of T.features) {
    let d = '';
    for (let s = f.s0; s <= f.s1; s += 1) {
      const u = f.lane === 'L' ? 3 : f.lane === 'R' ? -3 : 0;
      const p = pointAt(T, s, u);
      d += (s === f.s0 ? 'M' : 'L') + X(p.x) + ',' + Z(p.z);
    }
    const col = { table: '#ff0', double: '#f80', triple: '#f00', step: '#f0f', whoops: '#0ff', rollers: '#0f8' }[f.type];
    svg += `<path d="${d}" stroke="${col}" stroke-width="4" fill="none"/>`;
  }
  for (const [s, col] of [[T.gateS, '#0f0'], [T.finishS, '#fff']]) {
    const a = pointAt(T, s, 8), b = pointAt(T, s, -8);
    svg += `<line x1="${X(a.x)}" y1="${Z(a.z)}" x2="${X(b.x)}" y2="${Z(b.z)}" stroke="${col}" stroke-width="3"/>`;
  }
  for (let s = 0; s < T.L; s += 100) {
    const p = pointAt(T, s, 0);
    svg += `<text x="${X(p.x)}" y="${Z(p.z)}" fill="#fff" font-size="10">${s}</text>`;
  }
  svg += '</svg>';
  const frees = T.parts.filter((p) => p.kind === 'straight').map((p) => `${p.seg.name}:${p.seg.len}->${p.len.toFixed(0)}`);
  const info = `${def.name}: length ${T.L.toFixed(0)} m, straights ${frees.join(', ')}, min separation ${minSep.toFixed(1)} m at s=${where && where[0].toFixed(0)} vs ${where && where[1].toFixed(0)}`;
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < T.n; i++) { x0 = Math.min(x0, T.xs[i]); x1 = Math.max(x1, T.xs[i]); z0 = Math.min(z0, T.zs[i]); z1 = Math.max(z1, T.zs[i]); }
  console.log(info);
  console.log(`  bounds x ${x0.toFixed(0)}..${x1.toFixed(0)}  z ${z0.toFixed(0)}..${z1.toFixed(0)}  centre (${((x0 + x1) / 2).toFixed(0)}, ${((z0 + z1) / 2).toFixed(0)})`);
  html += `<h3>${info}</h3>${svg}`;
}
fs.writeFileSync('tools/out/tracks.html', html + '</body></html>');
