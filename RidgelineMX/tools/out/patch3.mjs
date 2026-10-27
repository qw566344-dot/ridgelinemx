import fs from 'fs';
const rep = (file, a, b) => { let s = fs.readFileSync(file, 'utf8'); if (!s.includes(a)) throw new Error('missing in ' + file + ': ' + a); s = s.replace(a, b); fs.writeFileSync(file, s); };
// landing faces less of a wall when you come up short
rep('shared/trackgen.js', "x += Math.max(2.2, f.h2 * 1.4); k.push({ x, h: f.h2, m: 0 });\n      x += f.land;", "x += Math.max(3.0, f.h2 * 1.8); k.push({ x, h: f.h2, m: 0 });\n      x += f.land;");
rep('shared/trackgen.js', "x += Math.max(2.4, (f.h2 - 0.3) * 1.3); k.push({ x, h: f.h2, m: 0 });", "x += Math.max(3.5, (f.h2 - 0.3) * 1.8); k.push({ x, h: f.h2, m: 0 });");
// jumps keep full height right to the track edge
rep('shared/trackgen.js', "const edgeMask = 1 - smooth01((au - (hw - 0.5)) / 2.5);", "const edgeMask = 1 - smooth01((au - (hw + 0.3)) / 3.0);");
// never reset a rider onto a steep berm
rep('shared/trackgen.js', "    ok[i] = flat ? 1 : 0;", "    if (T.bank[i] > 0.2) flat = false;\n    ok[i] = flat ? 1 : 0;");
// AI jump speeds
rep('client/js/sim/ai.js', "else if (f.type === 'step') target = { x: kn[5].x - f.top + 2.0, h: f.h2 };", "else if (f.type === 'step') target = { x: kn[5].x + 2.0, h: f.h2 };");
rep('client/js/sim/ai.js', "const vFace = Math.sqrt(vLip * vLip + 2 * G * f.h * 0.85);", "const vFace = Math.sqrt(vLip * vLip + 2 * G * f.h * 0.4);");
rep('client/js/sim/ai.js', "    if (f.type === 'rollers') continue;", "    if (f.type === 'rollers') {\n      if (f.h >= 0.85) for (let s = f.s0 - 6; s < f.s1; s += T.step) { const i = Math.floor(s / T.step) % n; v[i] = Math.min(v[i], 17); }\n      continue;\n    }");
// downhill rollers gentler
rep('shared/tracks.js', "{ at: 20, type: 'rollers', n: 4, len: 12, h: 1.1 },", "{ at: 20, type: 'rollers', n: 4, len: 16, h: 0.9 },");
