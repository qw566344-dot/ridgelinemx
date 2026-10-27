// =====================================================================
//  TRACK LAYOUTS
//  Each track is drawn "turtle style": a list of straights and turns.
//  Two straights are marked `free: true` - the generator stretches or
//  shrinks those two so the loop closes exactly. Change any length or
//  angle here and the whole track (terrain, berms, fences, AI line,
//  checkpoints) rebuilds itself.
//
//  turn:     { turn: degrees (+ = left, - = right), r: radius m, berm: 0..1 }
//  straight: { len: metres, w: track width m (optional), features: [...] }
//
//  Jump features (positions are metres from the start of the straight):
//    table  { h, face, top, land }          tabletop
//    double { h, face, gap, h2, land }      two humps, gap between
//    triple { h, face, gap, h2, land }      three humps, clear them all
//    step   { h, face, gap, h2, top, land } step-up onto a plateau
//    whoops { n, len, h }                   n bumps, len apart
//    rollers{ n, len, h }                   n big soft bumps
//  Add  lane: 'L'  or  lane: 'R'  to put a feature in one half of a split lane.
// =====================================================================

export const TRACKS = [
  {
    id: 'ridgeline',
    name: 'Ridgeline National',
    desc: 'A big outdoor national track carved into rolling hills. Tall berms, a ridge-top triple, a long downhill with big air and a split rhythm lane.',
    worldSize: 700,
    seed: 1207,
    start: { x: -147, z: 171, heading: 0 },
    defaultWidth: 12,
    terrain: {
      hills: 9, hillScale: 170,
      rim: 34, rimStart: 270,
      bumps: [
        { x: 153, z: -89, r: 90, h: 12 },    // the ridge (whoops climb it, triple crosses the top)
        { x: -147, z: -159, r: 80, h: 11 },  // west hill (uphill table, then the long downhill)
        { x: 43, z: 31, r: 70, h: -3 },       // infield dip
      ],
    },
    segments: [
      { len: 160, w: 20, free: true, name: 'Start Straight' },
      { turn: 100, r: 26, berm: 0.9 },
      { len: 85, name: 'Holeshot Table', features: [{ at: 28, type: 'table', h: 1.8, face: 8, top: 8, land: 10 }] },
      { turn: -100, r: 16, berm: 1 },
      { len: 110, name: 'Rhythm One', features: [
        { at: 10, type: 'rollers', n: 1, len: 9, h: 0.8 },
        { at: 25, type: 'double', h: 1.6, face: 6.5, gap: 6, h2: 1.4, land: 9 },
        { at: 62, type: 'rollers', n: 2, len: 9, h: 0.8 },
      ] },
      { turn: 90, r: 20, berm: 1 },
      { len: 120, name: 'Whoops Climb', features: [{ at: 18, type: 'whoops', n: 18, len: 4.6, h: 0.5 }] },
      { turn: 70, r: 30, berm: 0.5 },
      { len: 120, name: 'Ridge Triple', features: [{ at: 36, type: 'triple', h: 2.2, face: 9, gap: 9, h2: 1.9, land: 12 }] },
      { turn: 110, r: 16, berm: 1 },
      { len: 70, name: 'Step-Up', features: [{ at: 18, type: 'step', h: 1.5, face: 6.5, gap: 6, h2: 2.4, top: 8, land: 10 }] },
      { turn: -90, r: 18, berm: 1 },
      { len: 110, w: 22, name: 'Split Lanes', features: [
        { at: 20, type: 'triple', h: 1.8, face: 7.5, gap: 5, h2: 1.6, land: 10, lane: 'L' },
        { at: 20, type: 'rollers', n: 5, len: 10, h: 0.9, lane: 'R' },
      ] },
      { turn: -90, r: 22, berm: 1 },
      { len: 60, name: 'Uphill Table', features: [{ at: 14, type: 'table', h: 1.6, face: 7, top: 6, land: 8 }] },
      { turn: 180, r: 20, berm: 1 },
      { len: 280, free: true, name: 'Big Downhill', features: [
        { at: 20, type: 'rollers', n: 4, len: 16, h: 0.9 },
        { at: 100, type: 'double', h: 2.0, face: 8.5, gap: 10, h2: 1.8, land: 11 },
        { at: 170, type: 'table', h: 2.3, face: 9.5, top: 12, land: 12 },
      ] },
      { turn: 90, r: 25, berm: 0.9 },
    ],
    gateAt: 14,        // metres along the lap where the start gate stands
    finishAt: 115,     // metres along the lap of the finish line
  },
  {
    id: 'quarry',
    name: 'Quarry Arenacross',
    desc: 'Tight, technical and fast on the floor of an old stone quarry. Hairpin switchbacks, rhythm after rhythm and a long wall-side straight.',
    worldSize: 460,
    seed: 4471,
    start: { x: -102, z: -66, heading: 0 },
    defaultWidth: 11,
    terrain: {
      hills: 1.2, hillScale: 60,
      rim: 40, rimStart: 175, rimSharp: true,
      bumps: [{ x: 63, z: -126, r: 70, h: 5 }],
    },
    segments: [
      { len: 140, w: 18, name: 'Start Straight' },
      { turn: -180, r: 16, berm: 1 },
      { len: 90, name: 'Quarry Rhythm', features: [
        { at: 10, type: 'double', h: 1.4, face: 6, gap: 5, h2: 1.2, land: 7 },
        { at: 45, type: 'table', h: 1.5, face: 6.5, top: 6, land: 8 },
      ] },
      { turn: 180, r: 14, berm: 1 },
      { len: 100, name: 'Back Whoops', features: [{ at: 14, type: 'whoops', n: 15, len: 4.4, h: 0.5 }] },
      { turn: -180, r: 15, berm: 1 },
      { len: 100, name: 'Big Triple', features: [{ at: 24, type: 'triple', h: 2.0, face: 8.5, gap: 8, h2: 1.8, land: 11 }] },
      { turn: 90, r: 14, berm: 1 },
      { len: 60, name: 'Step Rhythm', features: [
        { at: 4, type: 'rollers', n: 2, len: 8, h: 0.7 },
        { at: 25, type: 'double', h: 1.3, face: 5.5, gap: 4.5, h2: 1.1, land: 7 },
      ] },
      { turn: 90, r: 16, berm: 1 },
      { len: 150, name: 'Quarry Straight', features: [
        { at: 20, type: 'step', h: 1.5, face: 6.5, gap: 6, h2: 2.4, top: 8, land: 10 },
        { at: 72, type: 'rollers', n: 3, len: 10, h: 0.9 },
        { at: 112, type: 'table', h: 1.6, face: 7, top: 6, land: 9 },
      ] },
      { turn: 90, r: 16, berm: 1 },
      { len: 200, free: true, name: 'Wall Ride', features: [
        { at: 20, type: 'double', h: 1.8, face: 7.5, gap: 7, h2: 1.6, land: 9 },
        { at: 66, type: 'whoops', n: 12, len: 4.6, h: 0.5 },
        { at: 140, type: 'table', h: 2.2, face: 9, top: 10, land: 11 },
      ] },
      { turn: 90, r: 18, berm: 1 },
      { len: 210, free: true, name: 'Top Straight', features: [
        { at: 14, type: 'rollers', n: 3, len: 10, h: 0.9 },
        { at: 66, type: 'triple', h: 2.0, face: 8.5, gap: 7, h2: 1.8, land: 10 },
        { at: 135, type: 'table', h: 1.7, face: 7.5, top: 8, land: 9 },
      ] },
      { turn: 90, r: 16, berm: 1 },
      { len: 16, name: 'Back Chute' },
      { turn: 90, r: 16, berm: 1 },
    ],
    gateAt: 14,
    finishAt: 100,
  },
];

export function getTrack(id) {
  return TRACKS.find((t) => t.id === id) || TRACKS[0];
}
