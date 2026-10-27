import fs from 'fs';
const rep = (file, a, b) => { let s = fs.readFileSync(file, 'utf8'); if (!s.includes(a)) throw new Error('missing in ' + file + ': ' + a); s = s.replace(a, b); fs.writeFileSync(file, s); };
rep('shared/vehicles.js', "  rideHeight: 0.66,", "  rideHeight: 0.62,");
rep('shared/vehicles.js', "  damping: { bump: 0.35, rebound: 0.6 },\n  progressive: 5,", "  damping: { bump: 0.45, rebound: 0.75 },\n  progressive: 5,");
rep('shared/vehicles.js', "  antiRoll: 9000,", "  antiRoll: 16000,");
rep('shared/vehicles.js', "  rollCentre: 0.45,", "  rollCentre: 0.55,");
rep('shared/vehicles.js', "  riderLean: 900,                 // N m of body-English torque when steering", "  riderLean: 900,                 // N m of body-English torque when steering\n  riderBalance: 2200,             // N m per radian: the rider throws weight to the high side");
rep('client/js/sim/atv.js', "      // rider hangs off the inside: rolls the quad into the turn", `      // rider throws their weight to the high side and soaks up roll
      _n.set(0, 0, 0);
      for (const w of v.wheels) if (w.contact) _n.add(w.n);
      _n.normalize();
      const re = Math.atan2(_n.dot(left), _n.dot(up));
      v.torque.addScaledVector(fwd, -c.riderBalance * re - rollW * I[2] * 3);
      // rider hangs off the inside: rolls the quad into the turn`);
