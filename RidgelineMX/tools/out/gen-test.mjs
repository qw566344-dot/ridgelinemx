import { TRACKS } from '../../shared/tracks.js';
import { makeWorld, heightAt } from '../../shared/terrain.js';
import { sampleArr } from '../../shared/trackgen.js';
for (const def of TRACKS) {
  const W = makeWorld(def);
  const T = W.T;
  let maxGrade = 0, at = 0;
  for (let i = 0; i < T.n; i++) { const g = (T.grade[(i+4)%T.n]-T.grade[i])/(4*T.step); if (Math.abs(g) > maxGrade) { maxGrade = Math.abs(g); at = i*T.step; } }
  let mn=1e9,mx=-1e9; for (const h of W.H){ if(h<mn)mn=h; if(h>mx)mx=h; }
  console.log(def.id, 'build', W.buildMs, 'ms cells', W.cells, 'grade range', Math.min(...T.grade).toFixed(1), Math.max(...T.grade).toFixed(1), 'max grade', (maxGrade*100).toFixed(1)+'% at s', at.toFixed(0), 'H', mn.toFixed(1), mx.toFixed(1));
}
