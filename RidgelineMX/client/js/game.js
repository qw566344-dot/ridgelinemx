// =====================================================================
//  GAME: loads a track, spawns riders, runs the fixed-step physics,
//  draws everything with smooth interpolation, and runs the modes:
//    menu (background), freeride, timetrial, race, practice
//  Multiplayer sessions use the same modes with remote riders that are
//  NOT simulated here - they are drawn from network snapshots (net.js).
// =====================================================================
import * as THREE from 'three';
import { getTrack } from '/shared/tracks.js';
import { makeWorld, heightAt } from '/shared/terrain.js';
import { getVehicle, BIKE_COLORS, VEHICLES } from '/shared/vehicles.js';
import { pointAt, sampleArr, wrapS, deltaS } from '/shared/trackgen.js';
import { LapTracker, GAME } from '/shared/rules.js';
import { Vehicle, FIXED_DT } from './sim/vehicle.js';
import { AIDriver } from './sim/ai.js';
import { TerrainMesh } from './render/terrainMesh.js';
import { Scenery } from './render/scenery.js';
import { Effects } from './render/effects.js';
import { VehicleVisual } from './render/vehicleModel.js';
import { Rider } from './render/rider.js';
import { CameraRig, CAMERA_MODES } from './camera.js';

const AI_NAMES = ['Tanner', 'Kade', 'Brody', 'Jett', 'Ryder', 'Colt', 'Maverick', 'Dax', 'Wyatt', 'Blaze', 'Cruz', 'Ace'];
const MAX_STEPS = 8;
const _v = new THREE.Vector3(), _q = new THREE.Quaternion();

export class Game {
  constructor({ renderer, settings, audio, input, ui }) {
    this.R = renderer;
    this.settings = settings;
    this.audio = audio;
    this.input = input;
    this.ui = ui;
    this.scene = renderer.scene;
    this.cam = new CameraRig(renderer.camera);
    this.cam.setMode(settings.get('camera') || 0);
    this.world = null; this.trackId = null;
    this.riders = [];
    this.player = null;
    this.mode = 'none';
    this.state = 'idle';
    this.acc = 0;
    this.simTime = 0;
    this.raceTime = 0;
    this.phase = 'none';
    this.paused = false;
    this.messages = [];
    this.fpsSamples = [];
    this.lowFpsTime = 0;
    this.net = null;
    this.applySettings();
    settings.onChange(() => this.applySettings());
  }

  applySettings() {
    const s = this.settings;
    this.cam.sensitivity = s.get('cameraSensitivity');
    this.cam.mouseSens = s.get('mouseSensitivity');
    this.cam.shakeScale = s.get('cameraShake');
    if (this.effects) this.effects.setQuality(s.quality());
    for (const r of this.riders) if (r.veh) this.applyAssists(r.veh, r.isPlayer);
    this.audio.applyVolumes();
  }

  applyAssists(veh, isPlayer) {
    if (!isPlayer) return;
    const s = this.settings;
    veh.assist.landing = s.get('landingAssist');
    veh.assist.traction = s.get('tractionAssist');
    veh.assist.wheelie = s.get('wheelieAssist');
  }

  // ------------------------------------------------------------------ track
  async loadTrack(id, onProgress = () => {}) {
    if (this.trackId === id && this.world) return;
    this.clearRiders();
    if (this.terrain) { this.terrain.dispose(); this.terrain = null; }
    if (this.scenery) { this.scenery.dispose(); this.scenery = null; }
    if (this.effects) { this.effects.dispose(); this.effects = null; }
    const def = getTrack(id);
    onProgress('Shaping the dirt...');
    await tick();
    this.world = makeWorld(def);
    const q = this.settings.quality();
    onProgress('Building terrain...');
    await tick();
    this.terrain = new TerrainMesh(this.world, this.R, q);
    this.scene.add(this.terrain.group);
    onProgress('Planting trees and fences...');
    await tick();
    this.scenery = new Scenery(this.world, this.R, q);
    this.scene.add(this.scenery.group);
    this.effects = new Effects(this.scene, this.world, q);
    this.trackId = id;
    this.ui.buildMinimap(this.world.T);
    onProgress('Ready');
  }

  // ------------------------------------------------------------------ riders
  addRider({ id, name, vehicleId, colorId, number, isPlayer = false, ai = null, remote = false }) {
    const def = getVehicle(vehicleId);
    const scheme = BIKE_COLORS.find((c) => c.id === colorId) || BIKE_COLORS[0];
    const vis = new VehicleVisual(def, scheme, number);
    vis.tryLoadModel();
    this.scene.add(vis.root);
    const rider = new Rider(scheme);
    rider.attachTo(vis.model);
    const r = { id, name, number, isPlayer, vis, rider, vehicleId, colorId, lap: new LapTracker(this.world.T), finished: false, best: null, key: String(id) };
    if (!remote) {
      r.veh = new Vehicle(vehicleId, this.world, { id, ai: !!ai });
      this.applyAssists(r.veh, isPlayer);
      if (ai) r.ai = new AIDriver(r.veh, ai);
    } else {
      r.remote = { buf: [], state: null, crashed: false, proxy: makeProxy(getVehicle(vehicleId)) };
    }
    this.riders.push(r);
    if (isPlayer) this.player = r;
    return r;
  }

  removeRider(r) {
    r.vis.dispose();
    r.rider.dispose();
    this.riders = this.riders.filter((x) => x !== r);
    if (this.player === r) this.player = null;
  }

  clearRiders() {
    for (const r of [...this.riders]) this.removeRider(r);
    this.riders = [];
    this.player = null;
    this.audio.silenceAll();
  }

  placeRider(r, s, u) {
    const T = this.world.T;
    const p = pointAt(T, s, u);
    r.veh.placeAt(p.x, p.z, p.tx, p.tz);
    r.veh.trackS = wrapS(T, s); r.veh.safeS = r.veh.trackS;
    if (!r.rider.attached) r.rider.attachTo(r.vis.model);
    r.lap.lastS = null;
  }

  // ------------------------------------------------------------------ modes
  async startMenu() {
    this.mode = 'menu';
    this.paused = false;
    await this.loadTrack(this.settings.get('track'));
    this.clearRiders();
    const T = this.world.T;
    for (let i = 0; i < 5; i++) {
      const vd = VEHICLES[i % VEHICLES.length];
      const r = this.addRider({ id: 100 + i, name: AI_NAMES[i], vehicleId: vd.id, colorId: BIKE_COLORS[(i * 3) % BIKE_COLORS.length].id, number: 10 + i * 7, ai: { skill: 0.88 + Math.random() * 0.1, lane: (i - 2) * 1.2 } });
      this.placeRider(r, T.finishS + 40 + i * 60, (i - 2) * 1.5);
    }
    this.focus = this.riders[0];
    this.focusTimer = 0;
    this.cam.setMode(3);
    this.phase = 'go';
    this.state = 'running';
  }

  // opts: { mode, trackId, vehicleId, colorId, laps, aiCount, section, mp }
  async startSession(opts) {
    this.ui.showLoading('Loading ' + getTrack(opts.trackId).name + '...');
    await this.loadTrack(opts.trackId, (m) => this.ui.showLoading(m));
    this.clearRiders();
    this.mode = opts.mode;
    this.autopilot = null;
    this.opts = opts;
    this.laps = opts.laps || 3;
    this.paused = false;
    this.results = null;
    this.raceTime = 0;
    this.simTime = 0;
    this.messages = [];
    const T = this.world.T;
    const name = this.settings.get('playerName') || 'You';
    const grid = this.scenery.gridSlots(Math.max(1, (opts.aiCount || 0) + 1 + (opts.mp ? opts.mp.players.length : 0)));
    const me = this.addRider({ id: opts.mp ? opts.mp.myId : 1, name, vehicleId: opts.vehicleId, colorId: opts.colorId, number: opts.number || 1, isPlayer: true });
    let slot = opts.mp ? opts.mp.slot : 0;
    if (opts.mode === 'race' || opts.mode === 'timetrial' || opts.mode === 'freeride') {
      const g = grid[slot] || grid[0];
      this.placeRider(me, g.s, g.u);
    }
    if (opts.mode === 'practice') {
      const sec = T.sections.find((s) => s.name === opts.section) || T.sections[0];
      this.practice = { sec, best: this.settings.bestSection(this.trackId, opts.vehicleId, sec.name), timing: null, last: null };
      this.placeRider(me, sec.s0 - 30, 0);
    }
    // AI opponents (single player race)
    if (opts.mode === 'race' && !opts.mp) {
      const skillBase = { easy: 0.84, medium: 0.91, hard: 0.97 }[this.settings.get('aiSkill')] || 0.91;
      for (let i = 0; i < opts.aiCount; i++) {
        const vd = opts.aiVehicleType === 'same' ? getVehicle(opts.vehicleId) : VEHICLES[(i + 1) % VEHICLES.length];
        const g = grid[i + 1];
        const r = this.addRider({
          id: 10 + i, name: AI_NAMES[i % AI_NAMES.length], vehicleId: vd.id, colorId: BIKE_COLORS[(i + 2) % BIKE_COLORS.length].id,
          number: 2 + i * 9, ai: { skill: skillBase + (Math.random() - 0.5) * 0.06, lane: g.u * 0.4, splitLane: Math.random() < 0.5 ? 'L' : 'R' },
        });
        this.placeRider(r, g.s, g.u);
        r.ai.enabled = false;
      }
    }
    // remote players (multiplayer)
    if (opts.mp) {
      for (const p of opts.mp.players) {
        if (p.id === opts.mp.myId) continue;
        this.addRider({ id: p.id, name: p.name, vehicleId: p.vehicle, colorId: p.color, number: p.number, remote: true });
      }
    }
    const lapMode = opts.mode === 'timetrial' ? 'flying' : 'race';
    for (const r of this.riders) r.lap.reset(lapMode, 0);
    this.cam.setMode(this.settings.get('camera') || 0);
    this.cam.snapNext = true;
    if (opts.mode === 'race' || (opts.mp && opts.mode === 'timetrial')) {
      this.phase = 'countdown';
      this.countdown = GAME.countdown + 0.99;
      this.lastBeep = 4;
      this.scenery.dropGate(false);
      this.scenery.setGate(0);
      if (opts.mp && opts.mp.startAt) this.countdown = Math.max(0.5, (opts.mp.startAt - opts.mp.serverNow()) / 1000);
    } else {
      this.phase = 'go';
      this.scenery.dropGate(true);
    }
    this.state = 'running';
    this.ui.hideLoading();
    this.ui.showHud(this);
    this.scenery.forceUpdate(this.R.camera);
  }

  // ------------------------------------------------------------------ frame
  frame(dt) {
    if (!this.world || this.state !== 'running') return;
    dt = Math.min(dt, 0.1);
    this.trackFps(dt);
    const inp = this.input;
    const playing = this.mode !== 'menu';
    // global keys
    if (playing && inp.pressed('pause')) this.ui.togglePause(this);
    if (inp.pressed('camera')) { const m = this.cam.cycle(); this.settings.set('camera', this.cam.mode); this.toast('Camera: ' + m); }
    if (inp.pressed('fps')) this.settings.set('showFps', !this.settings.get('showFps'));
    if (this.paused) { this.render(0, 1); return; }
    if (playing && this.player && this.player.veh) {
      if (inp.pressed('reset')) this.requestReset();
      if (inp.pressed('retry')) this.quickRetry();
    }
    if (inp.mouse.dx || inp.mouse.dy) this.cam.mouseLook(inp.mouse.dx, inp.mouse.dy);

    // physics at a fixed 120 Hz
    this.acc += dt;
    let steps = 0;
    while (this.acc >= FIXED_DT && steps < MAX_STEPS) {
      this.fixedStep(FIXED_DT);
      this.acc -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_STEPS) this.acc = 0;
    const alpha = this.acc / FIXED_DT;
    this.updateLogic(dt);
    this.render(dt, alpha);
  }

  fixedStep(dt) {
    this.simTime += dt;
    const holding = this.phase === 'countdown';
    if (this.phase === 'go' || this.phase === 'finished') this.raceTime += dt;
    const ctl = this.input.controls;
    for (const r of this.riders) {
      const v = r.veh;
      if (!v) continue;
      if (r.isPlayer && this.mode !== 'menu') {
        const c = r.finished && this.mode === 'race' ? { throttle: 0.2, brake: 0, steer: 0, rearBrake: 0, clutch: false, lean: 0 } : ctl;
        if (this.autopilot && !holding) this.autopilot.update(dt); // testing / demo: the AI rides your bike
        else Object.assign(v.input, c);
        if (holding) v.input.clutch = true; // rev on the gate
        // auto reset after a crash
        if (v.crashed && v.crashTime > GAME.resetDelay) this.resetRider(r);
        if (!v.crashed && v.offTrack > 1.2) this.resetRider(r);
      } else if (r.ai) {
        if (r.ai.enabled && !holding) r.ai.update(dt);
        else { v.input.throttle = holding ? 0.5 : 0; v.input.clutch = holding; v.input.brake = 0; v.input.steer = 0; }
        if (r.finished && this.mode === 'race') { v.input.throttle = Math.min(v.input.throttle, 0.25); }
      }
      if (holding && r.grid) {
        // on the gate: engine runs, but the bike stays put
        v.step(dt);
        v.pos.copy(r.grid.pos); v.quat.copy(r.grid.quat); v.vel.set(0, 0, 0); v.angVel.set(0, 0, 0);
        v.prevPos.copy(v.pos); v.prevQuat.copy(v.quat);
      } else v.step(dt);
    }
    this.collide(dt);
    // lap tracking (local riders)
    for (const r of this.riders) {
      if (!r.veh || holding) continue;
      const ev = r.lap.update(r.veh.trackS, this.raceTime);
      if (ev) this.onLapEvent(r, ev);
    }
    this.processEvents();
  }

  // simple rider-to-rider bumping (spheres at the centre of mass)
  collide(dt) {
    const list = this.riders.filter((r) => r.veh || (r.remote && r.remote.state));
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (!a.veh && !b.veh) continue;
      const pa = a.veh ? a.veh.pos : a.remote.pos, pb = b.veh ? b.veh.pos : b.remote.pos;
      const ra = a.veh ? a.veh.cfg.radius : 0.7, rb = b.veh ? b.veh.cfg.radius : 0.7;
      _v.subVectors(pb, pa);
      const d = _v.length();
      const min = ra + rb;
      if (d >= min || d < 1e-4) continue;
      _v.divideScalar(d);
      const pen = min - d;
      const va = a.veh ? a.veh.vel : a.remote.vel, vb = b.veh ? b.veh.vel : b.remote.vel;
      const rel = (vb.x - va.x) * _v.x + (vb.y - va.y) * _v.y + (vb.z - va.z) * _v.z;
      const both = a.veh && b.veh;
      const push = pen * (both ? 0.5 : 1);
      if (a.veh) { a.veh.pos.addScaledVector(_v, -push); if (rel < 0) a.veh.vel.addScaledVector(_v, rel * (both ? 0.5 : 0.8)); }
      if (b.veh) { b.veh.pos.addScaledVector(_v, push); if (rel < 0) b.veh.vel.addScaledVector(_v, -rel * (both ? 0.5 : 0.8)); }
      if (-rel > 7) {
        // a hard hit knocks the slower rider down
        if (a.veh && !a.veh.crashed && a.veh.speed < (b.veh ? b.veh.speed : 99)) a.veh.crash('Taken out');
        else if (b.veh && !b.veh.crashed) b.veh.crash('Taken out');
      }
    }
  }

  processEvents() {
    for (const r of this.riders) {
      const v = r.veh;
      if (!v || !v.events.length) continue;
      for (const e of v.events) {
        if (e.type === 'crash') {
          r.rider.detach(this.scene, v.vel);
          this.effects.crash(v.pos, v.vel);
          if (r.isPlayer) {
            this.audio.crash();
            this.cam.addShake(0.9);
            this.toast('CRASH! ' + e.reason + '  (R to reset)', 2.2, 'bad');
            if (this.net) this.net.sendEvent({ t: 'crash' });
          }
        } else if (e.type === 'land') {
          const strength = Math.min(1.5, (v.landImpact || 0) / 6);
          if (e.air > 0.35) {
            this.effects.landing(v.pos.clone().add(_v.set(0, -v.cfg.rideHeight, 0)), Math.max(0.4, strength));
            if (r.isPlayer) {
              this.audio.thud(Math.max(0.3, strength));
              this.cam.addShake(Math.max(0, strength - 0.6) * 0.8);
              if (e.air > 1.3) this.toast(`Big air! ${e.air.toFixed(1)} s`, 1.2, 'good');
            }
          }
        } else if (e.type === 'reset') {
          if (!r.rider.attached) r.rider.attachTo(r.vis.model);
          r.lap.lastS = null;
          if (r.isPlayer && this.net) this.net.sendEvent({ t: 'reset' });
        }
      }
      v.events.length = 0;
    }
  }

  // let the AI ride the player's vehicle (used by the automated tests)
  setAutopilot(on, skill = 1) {
    if (!this.player || !this.player.veh) return;
    if (on) { this.autopilot = new AIDriver(this.player.veh, { skill, lane: 0 }); this.player.veh.isAI = false; }
    else { this.autopilot = null; this.applyAssists(this.player.veh, true); }
  }

  requestReset() {
    const v = this.player.veh;
    if (v.crashed && v.crashTime < 0.8) return;
    if (this.phase === 'countdown') return;
    this.resetRider(this.player);
  }

  resetRider(r) {
    const v = r.veh;
    v.resetToTrack(v.safeS, Math.max(-3, Math.min(3, v.trackU)));
    r.rider.attachTo(r.vis.model);
    if (r.isPlayer) this.cam.snapNext = true;
  }

  quickRetry() {
    if (this.mode === 'timetrial' && !this.opts.mp) {
      const g = this.scenery.gridSlots(1)[0];
      this.placeRider(this.player, g.s, g.u);
      this.player.lap.reset('flying', this.raceTime);
      this.cam.snapNext = true;
      this.toast('Restarted - timing starts at the finish line');
    } else if (this.mode === 'practice') {
      this.placeRider(this.player, this.practice.sec.s0 - 30, 0);
      this.practice.timing = null;
      this.cam.snapNext = true;
      this.toast('Retry: ' + this.practice.sec.name);
    }
  }

  onLapEvent(r, ev) {
    const isMe = r.isPlayer;
    if (ev.type === 'start' && isMe) this.toast('Timing started', 1.2);
    if (ev.type !== 'lap') return;
    r.best = r.lap.bestLap;
    if (isMe) {
      const rec = this.settings.saveLap(this.trackId, r.vehicleId, ev.time);
      this.toast(`Lap ${ev.laps}: ${fmt(ev.time)}${rec ? '  NEW RECORD!' : ''}`, 2.5, rec ? 'good' : '');
      this.audio.beep(true);
    }
    if (this.mode === 'race' && !(this.opts && this.opts.mp) && r.lap.laps >= this.laps && !r.finished) {
      r.finished = true;
      r.finishTime = this.raceTime;
      r.place = this.riders.filter((x) => x.finished).length;
      if (isMe) {
        this.toast(`FINISHED ${ordinal(r.place)}!`, 3, 'good');
        setTimeout(() => this.showResults(), 2500);
      }
    }
  }

  showResults() {
    if (this.mode !== 'race' || this.results) return;
    this.results = this.standings().map((r, i) => ({ pos: i + 1, name: r.name, vehicle: getVehicle(r.vehicleId).name, time: r.finished ? r.finishTime : null, best: r.lap.bestLap, laps: r.lap.laps, me: r.isPlayer }));
    this.ui.showResults(this.results, this);
  }

  standings() {
    return [...this.riders].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.lap.progress(riderS(b)) - a.lap.progress(riderS(a));
    });
  }

  // ------------------------------------------------------------------ logic
  updateLogic(dt) {
    // countdown / gate
    if (this.phase === 'countdown') {
      if (!this.gridSaved) {
        for (const r of this.riders) if (r.veh) r.grid = { pos: r.veh.pos.clone(), quat: r.veh.quat.clone() };
        this.gridSaved = true;
      }
      this.countdown -= dt;
      const n = Math.ceil(this.countdown - 1);
      if (n < this.lastBeep && n >= 1 && n <= 3) { this.lastBeep = n; this.audio.beep(false); }
      if (this.countdown <= 1) {
        this.phase = 'go';
        this.gridSaved = false;
        this.raceTime = 0;
        for (const r of this.riders) { r.grid = null; r.lap.reset(this.mode === 'timetrial' ? 'flying' : 'race', 0); if (r.ai) r.ai.enabled = true; }
        this.scenery.dropGate(true);
        this.audio.beep(true);
        this.toast('GO!', 1, 'good');
      }
    }
    // practice section timing
    if (this.mode === 'practice' && this.player && this.player.veh) {
      const P = this.practice, v = this.player.veh;
      const T = this.world.T;
      const into = deltaS(T, P.sec.s0, v.trackS);
      if (P.timing === null && into > 0 && into < 3 && !v.crashed) P.timing = this.raceTime;
      if (P.timing !== null && v.crashed) { P.timing = null; }
      if (P.timing !== null && deltaS(T, P.sec.s1, v.trackS) > 0 && deltaS(T, P.sec.s1, v.trackS) < 5) {
        const t = this.raceTime - P.timing;
        P.last = t; P.timing = null;
        const rec = this.settings.saveSection(this.trackId, this.player.vehicleId, P.sec.name, t);
        if (rec) P.best = t;
        this.toast(`${P.sec.name}: ${fmt(t)}${rec ? '  NEW BEST!' : ''}   (T to retry)`, 3, rec ? 'good' : '');
      }
    }
    // menu background: pick a rider to watch now and then
    if (this.mode === 'menu') {
      this.focusTimer -= dt;
      if (this.focusTimer <= 0 || !this.focus) {
        this.focus = this.riders[Math.floor(Math.random() * this.riders.length)];
        this.focusTimer = 9;
        this.cam.tvPoint = null;
      }
    }
    // network: send my state ~20 times a second
    if (this.net && this.player && this.player.veh) this.net.tick(dt, this);
    // remote riders: interpolate from snapshots
    if (this.net) for (const r of this.riders) if (r.remote) this.net.interpolate(r, this);
    // stuck hint
    if (this.player && this.player.veh && this.player.veh.stuckTime > 4 && !this.stuckHinted) { this.toast('Stuck? Press R to reset', 2.5); this.stuckHinted = true; }
    if (this.player && this.player.veh && this.player.veh.stuckTime === 0) this.stuckHinted = false;
    this.ui.updateHud(this, dt);
  }

  toast(text, time = 1.6, kind = '') { this.ui.toast(text, time, kind); }

  // ------------------------------------------------------------------ draw
  render(dt, alpha) {
    const others = [];
    for (const r of this.riders) {
      let pos, quat, state, crashed;
      if (r.veh) {
        const v = r.veh;
        pos = _v.copy(v.prevPos).lerp(v.pos, alpha);
        quat = _q.copy(v.prevQuat).slerp(v.quat, alpha);
        r.vis.root.position.copy(pos);
        r.vis.root.quaternion.copy(quat);
        r.vis.update({ lean: v.lean, steer: v.steerAngle, wheels: v.wheels });
        crashed = v.crashed;
        if (dt > 0) this.effects.vehicle(v, dt, r.key);
        if (!r.isPlayer) others.push({ key: r.key, pos: r.vis.root.position, engine: v.engine, input: v.input, crashed, kind: v.cfg.audio.kind });
      } else if (r.remote && r.remote.state) {
        const st = r.remote.state;
        r.vis.root.position.copy(st.pos);
        r.vis.root.quaternion.copy(st.quat);
        r.vis.update(st.visual);
        crashed = st.crashed;
        others.push({ key: r.key, pos: r.vis.root.position, rpm: st.rpm, thr: st.thr, crashed, kind: getVehicle(r.vehicleId).cfgKind || (getVehicle(r.vehicleId).type === 'bike' ? 'bike' : 'atv') });
        // remote crash -> rider tumbles here too
        if (crashed && r.rider.attached) r.rider.detach(this.scene, st.vel);
        if (!crashed && !r.rider.attached) r.rider.attachTo(r.vis.model);
      } else { r.vis.root.visible = false; continue; }
      r.vis.root.visible = true;
      r.vis.root.updateMatrixWorld();
      if (r.rider.attached) r.rider.updateRiding(Math.max(dt, 0.001), r.veh || r.remote.proxy, r.vis);
      else r.rider.updateRagdoll(Math.max(dt, 0.001), this.world);
    }
    // camera
    const cam = this.R.camera;
    const focus = this.mode === 'menu' ? this.focus : this.player;
    if (focus && (focus.veh || (focus.remote && focus.remote.state))) {
      const v = focus.veh;
      const target = v ? {
        pos: focus.vis.root.position, quat: focus.vis.root.quaternion, vel: v.vel, speed: v.speed, grounded: v.grounded,
        trackS: v.trackS, lean: v.lean,
      } : { pos: focus.vis.root.position, quat: focus.vis.root.quaternion, vel: focus.remote.state.vel, speed: focus.remote.state.vel.length(), grounded: true, trackS: 0 };
      let head = null;
      if (this.cam.mode === 2 && focus.rider.attached) {
        head = focus.rider.j.head.clone().add(_v.set(0, 0.15, 0.12)).applyMatrix4(focus.vis.model.matrixWorld);
      }
      if (dt > 0) this.cam.update(dt, target, this.world, head);
      focus.vis.root.visible = true;
      // helmet cam: hide our own rider's head
      focus.rider.mesh.visible = !(this.cam.mode === 2 && focus === this.player && focus.rider.attached);
      this.R.followShadow(focus.vis.root.position);
      if (this.player === focus && v) this.audio.player(v, cam);
    }
    this.audio.others(others, cam);
    this.scenery.update(dt, cam);
    this.effects.update(dt, cam, this.R.renderer);
    this.R.render();
  }

  // automatically lower optional effects if the frame rate stays low
  trackFps(dt) {
    if ((this.rawDt || dt) > 0.2 || document.hidden) return; // tab in the background: not a real frame rate
    dt = this.rawDt || dt;
    this.fpsSamples.push(dt);
    if (this.fpsSamples.length > 60) this.fpsSamples.shift();
    const avg = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;
    this.fps = 1 / avg;
    if (!this.settings.get('autoQuality') || this.mode === 'menu') return;
    if (this.fps < 42) this.lowFpsTime += dt; else this.lowFpsTime = Math.max(0, this.lowFpsTime - dt);
    if (this.lowFpsTime > 4) {
      this.lowFpsTime = 0;
      const q = this.settings;
      if (q.get('particles') > 0.4) { q.set('particles', Math.max(0.3, q.get('particles') - 0.3)); this.toast('Auto quality: fewer particles'); }
      else if (q.get('grass') > 0) { q.set('grass', 0); this.scenery.grass.visible = false; this.toast('Auto quality: grass off'); }
      else if (q.get('shadows') === 'high') { q.set('shadows', 'low'); this.R.applyQuality(q.quality()); this.toast('Auto quality: lower shadows'); }
      else if (q.get('resolution') > 0.7) { q.set('resolution', Math.round((q.get('resolution') - 0.15) * 100) / 100); this.R.applyQuality(q.quality()); this.toast('Auto quality: lower resolution'); }
    }
  }

  stop() {
    this.state = 'idle';
    this.clearRiders();
  }
}

function riderS(r) { return r.veh ? r.veh.trackS : r.remote && r.remote.s !== undefined ? r.remote.s : 0; }
function tick() { return new Promise((r) => setTimeout(r, 0)); }
export function fmt(t) {
  if (t == null || !isFinite(t)) return '--:--.---';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}
export function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

// a stand-in "vehicle" object so remote riders can be posed like local ones
function makeProxy(def) {
  return {
    input: { throttle: 0, brake: 0, steer: 0, lean: 0 }, speed: 0, grounded: true, airTime: 0, lean: 0,
    wheels: def.wheels.map((w) => ({ comp: 0.09, cfg: { travel: w.travel } })), controller: { steer: 0 },
  };
}
