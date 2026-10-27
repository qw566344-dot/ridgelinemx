import { getTrack } from '../../shared/tracks.js';
import { makeWorld, heightAt } from '../../shared/terrain.js';
import { pointAt, sampleArr } from '../../shared/trackgen.js';
const W = makeWorld(getTrack(process.argv[2]||'ridgeline'));
const T = W.T;
const s0 = Number(process.argv[3]||1400), s1 = Number(process.argv[4]||1480);
console.log('L', T.L.toFixed(1));
for (let s = s0; s <= s1; s += 4) {
  const row = [];
  for (let u = -12; u <= 12; u += 2) { const p = pointAt(T, s, u); row.push(heightAt(W, p.x, p.z).toFixed(1).padStart(5)); }
  console.log(String(s % T.L | 0).padStart(5), 'grade', sampleArr(T,T.grade,s).toFixed(1).padStart(5), 'k', sampleArr(T,T.kappa,s).toFixed(3), 'bank', sampleArr(T,T.bank,s).toFixed(2), 'w', sampleArr(T,T.width,s).toFixed(1), '|', row.join(''));
}
