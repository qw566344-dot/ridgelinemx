// =====================================================================
//  SETTINGS + SAVED RECORDS (kept in the browser's localStorage)
//  Graphics presets: Low / Medium / High; touching any single graphics
//  option switches the preset to Custom.
// =====================================================================
const KEY = 'ridgelinemx.settings.v1';
const REC = 'ridgelinemx.records.v1';

export const PRESETS = {
  low: { shadows: 'off', resolution: 0.75, viewDistance: 520, grass: 0, particles: 0.4, detail: 'low', tireMarks: false },
  medium: { shadows: 'low', resolution: 1.0, viewDistance: 760, grass: 6, particles: 0.75, detail: 'medium', tireMarks: true },
  high: { shadows: 'high', resolution: 1.0, viewDistance: 1000, grass: 14, particles: 1.0, detail: 'high', tireMarks: true },
};

const DEFAULTS = {
  preset: 'medium',
  ...PRESETS.medium,
  autoQuality: true,
  showFps: false,
  cameraSensitivity: 1.0,
  mouseSensitivity: 1.0,
  cameraShake: 1.0,
  screenEffects: true,
  masterVolume: 0.8,
  engineVolume: 0.8,
  effectsVolume: 0.8,
  units: 'mph',
  landingAssist: 0.6,
  tractionAssist: true,
  wheelieAssist: true,
  laps: 3,
  aiCount: 5,
  aiSkill: 'medium',
  playerName: '',
  vehicle: 'mx450',
  color: 'red',
  track: 'ridgeline',
  camera: 0,
};

function load(key, fallback) {
  try {
    const s = localStorage.getItem(key);
    return s ? { ...fallback, ...JSON.parse(s) } : { ...fallback };
  } catch { return { ...fallback }; }
}
function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode etc. */ } }

export class Settings {
  constructor() {
    this.v = load(KEY, DEFAULTS);
    this.records = load(REC, {});
    this.listeners = [];
  }
  get(k) { return this.v[k]; }
  set(k, val) {
    this.v[k] = val;
    if (k in PRESETS.medium && this.v.preset !== 'custom') this.v.preset = 'custom';
    save(KEY, this.v);
    this.listeners.forEach((f) => f(k, val));
  }
  applyPreset(name) {
    if (!PRESETS[name]) return;
    Object.assign(this.v, PRESETS[name]);
    this.v.preset = name;
    save(KEY, this.v);
    this.listeners.forEach((f) => f('preset', name));
  }
  quality() {
    const v = this.v;
    return { shadows: v.shadows, resolution: v.resolution, viewDistance: v.viewDistance, grass: v.grass, particles: v.particles, detail: v.detail, tireMarks: v.tireMarks };
  }
  onChange(f) { this.listeners.push(f); }

  // best lap / section times per track + vehicle
  bestLap(track, vehicle) { return this.records[`lap:${track}:${vehicle}`] || null; }
  saveLap(track, vehicle, t) {
    const k = `lap:${track}:${vehicle}`;
    if (!this.records[k] || t < this.records[k]) { this.records[k] = t; save(REC, this.records); return true; }
    return false;
  }
  bestSection(track, vehicle, name) { return this.records[`sec:${track}:${vehicle}:${name}`] || null; }
  saveSection(track, vehicle, name, t) {
    const k = `sec:${track}:${vehicle}:${name}`;
    if (!this.records[k] || t < this.records[k]) { this.records[k] = t; save(REC, this.records); return true; }
    return false;
  }
}

export function fmtTime(t) {
  if (t == null || !isFinite(t)) return '--:--.---';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}
