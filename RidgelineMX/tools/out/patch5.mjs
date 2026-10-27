import fs from 'fs';
const f = 'client/js/render/scenery.js';
let s = fs.readFileSync(f, 'utf8');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 80)); s = s.replace(a, b); };
rep(`    gateParts.push(box(hw * 2 + 0.6, 0.12, 0.6, 0x3a3f46, [0, 0.06, -0.35]));
    gateParts.push(box(hw * 2 + 0.6, 0.3, 0.25, 0x2b2f35, [0, 0.15, -0.75]));
    for (let i = 0; i <= slots; i++) {
      const x = -hw + 0.5 + i * ((hw * 2 - 1) / slots);
      gateParts.push(box(0.08, 0.7, 0.08, 0x9aa1a8, [x, 0.35, -0.55]));
    }`, `    gateParts.push(box(hw * 2 + 0.6, 0.12, 0.35, 0x3a3f46, [0, 0.06, 0.2]));
    for (let i = 0; i <= slots; i++) {
      const x = -hw + 0.5 + i * ((hw * 2 - 1) / slots);
      gateParts.push(box(0.08, 0.62, 0.08, 0x9aa1a8, [x, 0.31, 0.12]));
    }`);
rep(`      const local = new THREE.Vector3(lx, 0.12, -0.3).applyAxisAngle(THREE.Object3D.DEFAULT_UP, G.yaw);`, `      const local = new THREE.Vector3(lx, 0.1, 0.0).applyAxisAngle(THREE.Object3D.DEFAULT_UP, G.yaw);`);
rep(`  dropGate(down) { if (this.gate) this.gate.target = down ? Math.PI / 2 * 0.95 : 0; }`, `  // the gates fall backwards, toward the riders, and they ride over them
  dropGate(down) { if (this.gate) this.gate.target = down ? -Math.PI / 2 * 0.96 : 0; }`);
rep(`      // u: + = left; slot 0 is on the left when looking down the track... gate built with +x = right of yaw frame
      const lx = -hw + 0.5 + step * (i + 0.5);
      out.push({ s: T.gateS + 1.6 - row * 3.5, u: -lx });`, `      // the gate's local +x axis points to the rider's left (= +u)
      const lx = -hw + 0.5 + step * (i + 0.5);
      out.push({ s: T.gateS - 1.3 - row * 3.5, u: lx });`);
rep(`        const yaw = Math.atan2(p.tx, p.tz) + (side > 0 ? Math.PI / 2 : -Math.PI / 2);
        const b = [];`, `        const yaw = Math.atan2(p.tx, p.tz) + (side > 0 ? -Math.PI / 2 : Math.PI / 2); // local -z points away from the track
        const b = [];`);
rep(`rot: yaw + Math.PI + (r() - 0.5) * 0.4`, `rot: yaw + (r() - 0.5) * 0.4`);
// spectators: only the shirt takes the per-person colour
rep(`function personGeo() {
  // simple spectator: legs, body, arms, head
  return merge([`, `function personGeo() {
  // simple spectator: legs, body, arms, head. 'tint' marks the shirt (gets a per-person colour)
  const g = merge([`);
rep(`    sphere(0.14, 0xe0b090, [0, 1.56, 0], [1, 1.1, 1], 8, 6),
  ]);
}`, `    sphere(0.14, 0xe0b090, [0, 1.56, 0], [1, 1.1, 1], 8, 6),
  ]);
  const p = g.attributes.position, tint = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) tint[i] = p.getY(i) > 0.79 && p.getY(i) < 1.43 ? 1 : 0;
  g.setAttribute('tint', new THREE.BufferAttribute(tint, 1));
  return g;
}`);
rep(`      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')`, `      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float tint;')
        .replace('#include <color_vertex>', \`vColor = vec3(1.0);
          #ifdef USE_COLOR
            vColor *= color;
          #endif
          #ifdef USE_INSTANCING_COLOR
            vColor = mix(vColor, vColor * instanceColor.xyz, tint);
          #endif\`)`);
fs.writeFileSync(f, s);
