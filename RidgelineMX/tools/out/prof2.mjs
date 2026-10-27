import { getTrack } from '../../shared/tracks.js';
import { makeWorld, heightAt } from '../../shared/terrain.js';
import { pointAt, locate } from '../../shared/trackgen.js';
const W = makeWorld(getTrack('ridgeline'));
const T = W.T;
for (let s = 1456; s <= 1472; s += 1) {
  const row = [];
  for (let u = -12; u <= -4; u += 0.5) { const p = pointAt(T, s, u); row.push(heightAt(W, p.x, p.z).toFixed(2).padStart(6)); }
  const p = pointAt(T, s, -8); const l = locate(W.F, p.x, p.z);
  console.log(String(s % T.L | 0).padStart(5), row.join(''), ' field s', l && l.s.toFixed(1), 'u', l && l.u.toFixed(1));
}
