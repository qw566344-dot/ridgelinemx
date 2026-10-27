import fs from 'fs';
let s = fs.readFileSync('tools/sim-test.js','utf8');
s = s.replace("const f1 = (x) => x.toFixed(1), f2 = (x) => x.toFixed(2);",
`const f1 = (x) => x.toFixed(1), f2 = (x) => x.toFixed(2);
// simple lane keeping so straight-line tests stay straight
function keepLane(v, u = 0) {
  const p = pointAt(v.world.T, v.trackS + 12, u);
  const dx = p.x - v.pos.x, dz = p.z - v.pos.z;
  const xl = dx * v.left.x + dz * v.left.z, zf = dx * v.fwd.x + dz * v.fwd.z;
  v.input.steer = Math.max(-1, Math.min(1, Math.atan2(xl, zf) * 3));
}`);
s = s.replace("v.input.throttle = 1; v.input.steer = 0;\n      v.step(FIXED_DT);", "v.input.throttle = 1; keepLane(v);\n      v.step(FIXED_DT);");
s = s.replace("while (v.speed > 1 && tb < 10) { v.input.throttle = 0; v.input.brake = 1; v.step(FIXED_DT); tb += FIXED_DT; }", "while (v.speed > 1 && tb < 10) { v.input.throttle = 0; v.input.brake = 1; keepLane(v); v.step(FIXED_DT); tb += FIXED_DT; }");
s = s.replace("while (v.speed < target && i < 2000) { v.input.throttle = 1; v.step(FIXED_DT); i++; }", "while (v.speed < target && i < 2000) { v.input.throttle = 1; keepLane(v); v.step(FIXED_DT); i++; }");
fs.writeFileSync('tools/sim-test.js', s);
