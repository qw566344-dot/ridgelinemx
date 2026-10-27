import { getTrack } from '../../shared/tracks.js';
import { makeWorld } from '../../shared/terrain.js';
import { trackSurface, sampleArr } from '../../shared/trackgen.js';
const W = makeWorld(getTrack('ridgeline'));
const T = W.T;
for (const s of [1461, 1462, 1462.5, 1463, 1463.05, 0, 0.3, 0.9, 2]) {
  console.log(s, 'surf', trackSurface(T, s, -4).toFixed(3), 'grade', sampleArr(T, T.grade, s).toFixed(3), 'fAll', sampleArr(T, T.fAll, s).toFixed(3), 'fL', sampleArr(T, T.fL, s).toFixed(3), 'bank', sampleArr(T, T.bank, s).toFixed(3), 'k', sampleArr(T, T.kappa, s).toFixed(4), 'w', sampleArr(T, T.width, s).toFixed(2));
}
console.log('n', T.n, 'step', T.step, 'L', T.L, 'last features', T.features.slice(-3).map(f => f.type + ' ' + f.s0.toFixed(1) + '-' + f.s1.toFixed(1)));
import { pointAt, trackWeight } from '../../shared/trackgen.js';
for (const s of [1462.4, 1462.8, 1463.0]) {
  const p = pointAt(T, s, -4);
  const gx = Math.round((p.x + W.half) / W.res), gz = Math.round((p.z + W.half) / W.res);
  for (const [ox, oz] of [[0,0],[1,0],[0,1],[1,1]]) {
    const i = (gz+oz) * W.cells + gx+ox;
    console.log('cell', s, ox, oz, 'S', W.F.S[i].toFixed(2), 'U', W.F.U[i].toFixed(2), 'H', W.H[i].toFixed(3), 'surf', trackSurface(T, W.F.S[i], W.F.U[i]).toFixed(3), 'w', trackWeight(T, W.F.S[i], W.F.U[i]).toFixed(2));
  }
}
