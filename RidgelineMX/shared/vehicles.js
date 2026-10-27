// =====================================================================
//  VEHICLES - every tuning number for every bike and quad lives here.
//  Want a faster bike? Raise `torque`. Softer suspension? Lower `freq`.
//  Adding a new vehicle = copy a block, give it a new id, change numbers.
//
//  Local axes:  +z = forward,  +y = up,  +x = LEFT side of the vehicle.
//  The body origin is the centre of mass (rider included).
//
//  model: path of your .glb (inside client/models/). If the file is not
//         there yet the game builds a placeholder with the same layout.
// =====================================================================

export const BIKE_COLORS = [
  { id: 'red', name: 'Factory Red', body: 0xd8261c, accent: 0xffffff, gear: [0xd8261c, 0x1b1b1f, 0xffffff] },
  { id: 'blue', name: 'Race Blue', body: 0x1d4ed8, accent: 0xffffff, gear: [0x1d4ed8, 0xf2f2f2, 0x0f172a] },
  { id: 'green', name: 'Lime Green', body: 0x46b11c, accent: 0x111111, gear: [0x46b11c, 0x111111, 0xffffff] },
  { id: 'orange', name: 'Orange Crush', body: 0xf06a0f, accent: 0x111111, gear: [0xf06a0f, 0x1e293b, 0xffffff] },
  { id: 'yellow', name: 'Desert Yellow', body: 0xf2c21b, accent: 0x1f2937, gear: [0xf2c21b, 0x1f2937, 0xffffff] },
  { id: 'white', name: 'Ghost White', body: 0xf1f1ee, accent: 0x9333ea, gear: [0xf1f1ee, 0x6b21a8, 0x111111] },
  { id: 'black', name: 'Stealth Black', body: 0x1c1c22, accent: 0xef4444, gear: [0x1c1c22, 0xef4444, 0xdddddd] },
  { id: 'teal', name: 'Teal Storm', body: 0x0d9488, accent: 0xffffff, gear: [0x0d9488, 0xf8fafc, 0x134e4a] },
];

const G = 9.81;

const BIKE_BASE = {
  type: 'bike',
  mass: 195,                     // kg, bike + rider
  inertia: [62, 48, 22],          // pitch (x), yaw (y), roll (z)  kg m^2
  rideHeight: 0.86,               // centre of mass above flat ground at rest
  cdA: 0.75, crr: 0.025,
  wheels: [
    { id: 'front', z: 0.76, x: 0, r: 0.36, travel: 0.30, freq: 1.55, sag: 0.30, steer: true, driven: false, brake: 'front', mu: 1.0, alphaPeak: 0.17 },
    { id: 'rear', z: -0.72, x: 0, r: 0.345, travel: 0.31, freq: 1.7, sag: 0.33, steer: false, driven: true, brake: 'rear', mu: 1.06, alphaPeak: 0.13 },
  ],
  damping: { bump: 0.32, rebound: 0.55 },
  progressive: 6,                 // spring force at full travel = this x static load
  steer: { maxLow: 32, latAcc: 10.6, rate: 3.6, feedback: 2.5, airYaw: 2.2 },
  lean: { max: 52, rate: 7 },
  air: { pitchAccel: 5.2, gyro: 1.6, damping: 0.35, rollLevel: 6 },
  balance: { rollK: 45000, rollC: 3200, airRollK: 900, airRollC: 160 },
  brakes: { front: 1500, rear: 1000 },      // N of force at the tyre at full input
  crash: { landPitch: 52, impact: 12.5, slide: 78, roll: 70, loop: 80 },
  probes: [
    // local positions of collision points on the body (+x = left)
    { p: [0, 0.75, 0.15], r: 0.18, hit: 'rider' },     // rider head / helmet
    { p: [0.42, 0.35, 0.62], r: 0.06, hit: 'hard' },   // left bar end
    { p: [-0.42, 0.35, 0.62], r: 0.06, hit: 'hard' },  // right bar end
    { p: [0, -0.35, 0.05], r: 0.12, hit: 'skid' },     // bash plate
    { p: [0, 0.18, 1.12], r: 0.1, hit: 'hard' },       // front fender
    { p: [0, 0.25, -1.0], r: 0.1, hit: 'soft' },       // rear fender
    { p: [0.22, -0.28, -0.12], r: 0.06, hit: 'hard' }, // left peg
    { p: [-0.22, -0.28, -0.12], r: 0.06, hit: 'hard' },// right peg
  ],
  radius: 0.55,                   // for rider-to-rider bumps
  audio: { kind: 'bike', cylinders: 1, base: 1.0 },
};

const ATV_BASE = {
  type: 'atv',
  mass: 300,
  inertia: [95, 115, 52],
  rideHeight: 0.62,
  cdA: 1.0, crr: 0.03,
  wheels: [
    { id: 'fl', z: 0.64, x: 0.58, r: 0.29, travel: 0.23, freq: 1.75, sag: 0.3, steer: true, driven: false, brake: 'front', mu: 0.97, alphaPeak: 0.16 },
    { id: 'fr', z: 0.64, x: -0.58, r: 0.29, travel: 0.23, freq: 1.75, sag: 0.3, steer: true, driven: false, brake: 'front', mu: 0.97, alphaPeak: 0.16 },
    { id: 'rl', z: -0.64, x: 0.55, r: 0.3, travel: 0.25, freq: 1.8, sag: 0.32, steer: false, driven: true, brake: 'rear', mu: 1.0, alphaPeak: 0.14 },
    { id: 'rr', z: -0.64, x: -0.55, r: 0.3, travel: 0.25, freq: 1.8, sag: 0.32, steer: false, driven: true, brake: 'rear', mu: 1.0, alphaPeak: 0.14 },
  ],
  damping: { bump: 0.45, rebound: 0.75 },
  progressive: 5,
  steer: { maxLow: 33, maxHigh: 8, highSpeed: 22, rate: 3.0, airYaw: 0.8 },
  antiRoll: 16000,                 // N per metre of left/right compression difference
  rollCentre: 0.55,               // 0 = tyre forces at the ground (tippy), 1 = at the CoM (can't tip)
  riderLean: 900,                 // N m of body-English torque when steering
  riderBalance: 2200,             // N m per radian: the rider throws weight to the high side
  axleScrub: 0.22,                // solid rear axle resists turning (understeer)
  air: { pitchAccel: 3.6, gyro: 1.1, damping: 0.4, rollLevel: 3 },
  brakes: { front: 2100, rear: 1500 },
  crash: { landPitch: 58, impact: 14, roll: 78, loop: 82 },
  probes: [
    { p: [0, 0.85, -0.05], r: 0.2, hit: 'rider' },
    { p: [0.45, 0.45, 0.45], r: 0.07, hit: 'hard' },
    { p: [-0.45, 0.45, 0.45], r: 0.07, hit: 'hard' },
    { p: [0, -0.32, 0.0], r: 0.14, hit: 'skid' },
    { p: [0, 0.05, 1.0], r: 0.14, hit: 'hard' },
    { p: [0, 0.15, -1.0], r: 0.14, hit: 'soft' },
    { p: [0.5, 0.2, -0.65], r: 0.12, hit: 'soft' },
    { p: [-0.5, 0.2, -0.65], r: 0.12, hit: 'soft' },
    { p: [0.55, 0.1, 0.65], r: 0.12, hit: 'soft' },
    { p: [-0.55, 0.1, 0.65], r: 0.12, hit: 'soft' },
    { p: [0, 0.35, 0.3], r: 0.25, hit: 'roll' },   // top of the body (rollover)
  ],
  radius: 0.8,
  audio: { kind: 'atv', cylinders: 1, base: 0.8 },
};

function engine(o) {
  return {
    idle: 1700, redline: 11000, torque: [[1000, 18], [3000, 30], [6000, 44], [8000, 48], [10000, 43], [11500, 35]],
    gearSpeeds: [12, 17.5, 23, 28.5, 33], shiftUp: 0.93, shiftDown: 0.45, shiftTime: 0.12,
    engineBrake: 9, inertia: 0.12, reverseSpeed: 2, ...o,
  };
}

export const VEHICLES = [
  {
    ...BIKE_BASE,
    id: 'mx450', name: 'MX 450F', model: 'models/dirtbike_450.glb',
    desc: 'Open-class four-stroke. Brutal torque out of corners and the speed to clear anything on the track.',
    stats: { speed: 9, accel: 9, handling: 7, stability: 6, suspension: 8 },
    engine: engine({ torque: [[1000, 18], [3000, 30], [6000, 40], [8000, 42], [10000, 38], [11500, 30]] }),
  },
  {
    ...BIKE_BASE,
    id: 'mx250', name: 'MX 250F', model: 'models/dirtbike_250.glb',
    mass: 185, inertia: [56, 44, 20],
    desc: 'Light and screaming. Less grunt than the 450 but it flicks into turns and floats over whoops.',
    stats: { speed: 7, accel: 7, handling: 9, stability: 6, suspension: 7 },
    steer: { ...BIKE_BASE.steer, rate: 4.2, latAcc: 11.0 },
    engine: engine({ idle: 2000, redline: 13500, torque: [[1500, 11], [4000, 17], [8000, 24], [11000, 26.5], [13000, 24], [14000, 19]], gearSpeeds: [11, 16, 21, 26, 30.5] }),
  },
  {
    ...ATV_BASE,
    id: 'atv450', name: 'Quad 450R', model: 'models/atv_450.glb',
    desc: 'A race-bred sport quad. Planted on four wheels, slides the rear when you ask it to.',
    stats: { speed: 8, accel: 7, handling: 7, stability: 9, suspension: 7 },
    engine: engine({ idle: 1600, redline: 10000, torque: [[1000, 22], [3000, 36], [6000, 48], [7500, 50], [9000, 44], [10500, 35]], gearSpeeds: [10, 15, 20, 25, 29.5], reverseSpeed: 4 }),
  },
  {
    ...ATV_BASE,
    id: 'atv700', name: 'Quad 700 Raptor', model: 'models/atv_700.glb',
    mass: 335, inertia: [105, 128, 58],
    desc: 'Big-bore torque monster. Heavy and stable, pulls hard everywhere, a handful in tight turns.',
    stats: { speed: 9, accel: 8, handling: 5, stability: 10, suspension: 8 },
    steer: { ...ATV_BASE.steer, maxLow: 30, rate: 2.6 },
    engine: engine({ idle: 1300, redline: 8500, torque: [[1000, 38], [2500, 55], [4500, 66], [6000, 64], [7500, 56], [9000, 44]], gearSpeeds: [9.5, 14.5, 19.5, 24.5, 30], reverseSpeed: 4 }),
  },
];

export function getVehicle(id) {
  return VEHICLES.find((v) => v.id === id) || VEHICLES[0];
}

// Fill in derived numbers (spring rates, mount points, gear ratios)
export function prepareVehicle(def) {
  const v = JSON.parse(JSON.stringify(def));
  const zs = v.wheels.map((w) => w.z);
  const zf = Math.max(...zs), zr = Math.min(...zs);
  const wb = zf - zr;
  for (const w of v.wheels) {
    const sameAxle = v.wheels.filter((o) => o.z === w.z).length;
    const frac = w.z === zf ? -zr / wb : zf / wb;          // share of weight on this axle
    const load = (v.mass * G * frac) / sameAxle;            // static load on this wheel
    const mw = load / G;
    w.k = mw * Math.pow(2 * Math.PI * w.freq, 2);
    const sagDist = w.sag * w.travel;
    w.preload = Math.max(0, load - w.k * sagDist);
    const full = load * v.progressive;
    w.k3 = Math.max(0, (full - w.preload - w.k * w.travel) / Math.pow(w.travel, 3));
    w.cBump = 2 * v.damping.bump * Math.sqrt(w.k * mw);
    w.cRebound = 2 * v.damping.rebound * Math.sqrt(w.k * mw);
    w.staticLoad = load;
    // mount = wheel centre when the suspension is fully compressed
    w.y = -(v.rideHeight - w.r) + w.travel - sagDist;
  }
  v.wheelbase = wb;
  const driven = v.wheels.find((w) => w.driven);
  const wr = (v.engine.redline * 2 * Math.PI) / 60;
  v.engine.ratios = v.engine.gearSpeeds.map((s) => (wr * driven.r) / s);
  return v;
}
