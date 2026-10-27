import fs from 'fs';
let s = fs.readFileSync('client/js/sim/vehicle.js','utf8');
s = s.replace("    this.addForceAt(_t[2].copy(fw).multiplyScalar(Fl), cp);\n    const rc = this.controller.rollCentre;\n    const lift = r.dot(up) * -rc;  // r points from CoM to contact (down), raise by rc of that",
`    // drive / brake force: raised part-way toward the CoM by pitchCentre
    // (the rider shifting their weight keeps the bike from wheelie-ing / stoppie-ing at every touch of the controls)
    const below = r.dot(up); // negative: contact is below the CoM
    const longPt = _t[0].copy(cp).addScaledVector(up, -below * this.controller.pitchCentre);
    this.addForceAt(_t[2].copy(fw).multiplyScalar(Fl), longPt);
    const rc = this.controller.rollCentre;
    const lift = below * -rc;`);
fs.writeFileSync('client/js/sim/vehicle.js', s);
let b = fs.readFileSync('client/js/sim/bike.js','utf8');
b = b.replace("this.rollCentre = 1.0; // tyre side forces act at the CoM: the lean balances them", "this.rollCentre = 1.0; // tyre side forces act at the CoM: the lean balances them\n    this.pitchCentre = 0.5; // the rider's body position soaks up half the wheelie / stoppie torque");
fs.writeFileSync('client/js/sim/bike.js', b);
let a = fs.readFileSync('client/js/sim/atv.js','utf8');
a = a.replace("this.rollCentre = veh.cfg.rollCentre;", "this.rollCentre = veh.cfg.rollCentre;\n    this.pitchCentre = 0.25;");
fs.writeFileSync('client/js/sim/atv.js', a);
