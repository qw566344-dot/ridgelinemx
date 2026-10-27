// =====================================================================
//  MULTIPLAYER CLIENT
//  Talks to the server over a WebSocket (same address as the page, /ws).
//  - Lobby: create / join a party with a 6-character code, ready up,
//    the leader picks track + mode + laps and starts the session.
//  - Riding: your own bike is simulated here (instant, lag-free
//    controls) and sent 20x a second. Other riders are drawn 120 ms in
//    the past, smoothly interpolated between server snapshots, and
//    briefly extrapolated if packets are late.
//  - Race laps, positions and results come from the server.
//  - Drops are handled: it reconnects with a token and puts you back in
//    your party (and session) automatically.
//  To point the game at a different server: add ?server=wss://your.host/ws
// =====================================================================
import * as THREE from 'three';
import { PROTOCOL_VERSION, SEND_RATE, INTERP_DELAY, packState, cleanName, validCode, F_CRASHED, F_AIR } from '/shared/protocol.js';
import { TRACKS, getTrack } from '/shared/tracks.js';
import { getVehicle, BIKE_COLORS } from '/shared/vehicles.js';
import { escapeHtml } from './ui.js';
import { fmtTime } from './settings.js';

const $ = (id) => document.getElementById(id);
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

export class Net {
  constructor(ui, game, settings) {
    this.ui = ui; this.game = game; this.settings = settings;
    this.ws = null;
    this.connected = undefined;
    this.id = null;
    this.token = ssGet('mx.token');
    this.code = null;
    this.party = null;
    this.offset = 0; this.offsetSet = false;
    this.ping = null;
    this.sendAcc = 0;
    this.session = null;
    this.standings = null;
    this.retry = 0;
    this.wantOnline = false;
    this.status('Disconnected', 'bad');
    this.wireUI();
    ui.on('screen', (name) => {
      if (name === 'mp') { this.wantOnline = true; this.connect(); this.renderLobby(); }
      if (name === 'garage' || name === 'mp') this.sendProfile();
    });
    // garage "Back"/"Start" return to the lobby while in a party
    const origShow = ui.show.bind(ui);
    ui.show = (name) => {
      if (this.code && ui.screen === 'garage' && (name === 'menu' || name === 'play')) { this.sendProfile(); return origShow('mp'); }
      return origShow(name);
    };
  }

  serverUrl() {
    const q = new URLSearchParams(location.search).get('server');
    if (q) return q;
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  }

  serverNow() { return Date.now() + this.offset; }
  isLeader() { return this.party && this.party.leader === this.id; }

  // ------------------------------------------------------------- connection
  connect() {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    this.status(this.retry ? 'Reconnecting...' : 'Connecting...', 'warn');
    let ws;
    try { ws = new WebSocket(this.serverUrl()); } catch (e) { this.status('Disconnected', 'bad'); this.error('Could not reach the server.'); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.connected = true;
      ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, token: this.token, name: this.name(), vehicle: this.settings.get('vehicle'), color: this.settings.get('color') }));
      this.pingTimer = setInterval(() => this.sendPing(), 2000);
    };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } this.onMessage(m); };
    ws.onclose = () => {
      clearInterval(this.pingTimer);
      const was = this.connected;
      this.connected = false;
      this.ws = null;
      if (this.wantOnline || this.code) {
        this.retry++;
        const wait = Math.min(10000, 500 * 2 ** Math.min(5, this.retry));
        this.status(`Disconnected - retrying in ${Math.round(wait / 1000)}s`, 'bad');
        if (was && this.game.mode !== 'menu') this.game.toast('Connection lost - reconnecting...', 2.5, 'bad');
        setTimeout(() => this.connect(), wait);
      } else this.status('Disconnected', 'bad');
    };
    ws.onerror = () => {};
  }

  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  sendPing() { this.send({ t: 'ping', c: Date.now(), rtt: this.ping }); }
  name() { return cleanName($('mp-name').value || this.settings.get('playerName') || 'Rider'); }
  sendProfile() { if (this.connected) this.send({ t: 'profile', name: this.name(), vehicle: this.settings.get('vehicle'), color: this.settings.get('color') }); }

  autoRejoin() {
    // page reloaded while in a party: reconnect and pick up where we left off
    if (this.token && ssGet('mx.code')) { this.wantOnline = true; this.connect(); }
  }

  onMessage(m) {
    switch (m.t) {
      case 'welcome':
        this.id = m.id; this.token = m.token; ssSet('mx.token', m.token);
        this.syncClock(m.s, 0);
        this.status(this.code ? 'In Party' : 'Online', 'ok');
        if (!this.party && ssGet('mx.code') && !this.code) { /* server restores membership via token */ }
        break;
      case 'pong': {
        const now = Date.now();
        this.ping = now - m.c;
        this.syncClock(m.s, this.ping);
        this.renderPing();
        break;
      }
      case 'party':
        this.party = m; this.code = m.code; ssSet('mx.code', m.code);
        this.status(this.game.opts && this.game.opts.mp && this.game.mode !== 'menu' ? 'In Session' : 'In Party', 'ok');
        this.renderLobby();
        this.syncSessionMembers();
        break;
      case 'left':
        this.party = null; this.code = null; ssSet('mx.code', '');
        this.status('Online', 'ok');
        this.renderLobby();
        break;
      case 'error':
        this.error(m.msg || m.code);
        if (this.game.mode !== 'menu') this.game.toast(m.msg || m.code, 2.5, 'bad');
        break;
      case 'session': this.onSession(m); break;
      case 'snap': this.onSnap(m); break;
      case 'race': this.standings = m.rows; this.onRace(m); break;
      case 'results': this.onResults(m); break;
      case 'ended':
        this.session = null;
        if (this.game.opts && this.game.opts.mp && this.game.mode !== 'menu') {
          this.game.toast('The leader ended the session', 2);
          this.ui.hideHud(); this.ui.hideResults(); this.ui.hidePause();
          this.game.startMenu().then(() => this.ui.show('mp'));
        }
        break;
      default: break;
    }
  }

  syncClock(serverTime, rtt) {
    const est = serverTime + rtt / 2 - Date.now();
    if (!this.offsetSet) { this.offset = est; this.offsetSet = true; }
    else this.offset = this.offset * 0.85 + est * 0.15;
  }

  // ------------------------------------------------------------- lobby UI
  wireUI() {
    $('mp-name').value = this.settings.get('playerName') || '';
    $('mp-name').addEventListener('change', () => { this.settings.set('playerName', this.name()); this.sendProfile(); });
    $('mp-create').addEventListener('click', () => { this.clearError(); this.settings.set('playerName', this.name()); this.wantOnline = true; this.whenOnline(() => { this.sendProfile(); this.send({ t: 'create' }); }); });
    $('mp-join').addEventListener('click', () => this.joinFromInput());
    $('mp-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.joinFromInput(); });
    $('mp-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); });
    $('mp-leave').addEventListener('click', () => { this.send({ t: 'leave' }); this.party = null; this.code = null; ssSet('mx.code', ''); this.renderLobby(); });
    $('mp-ready').addEventListener('click', () => { const me = this.me(); this.send({ t: 'ready', ready: !(me && me.ready) }); });
    $('mp-copy').addEventListener('click', () => this.copyCode());
    $('mp-garage').addEventListener('click', () => this.ui.show('garage'));
    $('mp-startbtn').addEventListener('click', () => {
      if (this.party && this.party.session && !this.isLeader()) { this.send({ t: 'rejoin' }); return; }
      if (this.party && this.party.session && this.isLeader() && $('mp-startbtn').dataset.act === 'rejoin') { this.send({ t: 'rejoin' }); return; }
      this.send({ t: 'start' });
    });
    $('mp-track').innerHTML = TRACKS.map((t) => `<option value="${t.id}">${t.name}</option>`).join('');
    for (const id of ['mp-track', 'mp-mode', 'mp-laps']) $(id).addEventListener('change', () => this.send({ t: 'settings', track: $('mp-track').value, mode: $('mp-mode').value, laps: Number($('mp-laps').value) }));
  }

  whenOnline(f) {
    if (this.connected && this.id) return f();
    this.connect();
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (this.connected && this.id) { clearInterval(iv); f(); }
      else if (Date.now() - t0 > 8000) { clearInterval(iv); this.error('Could not connect to the multiplayer server. Is it running? (node server/server.js)'); }
    }, 100);
  }

  joinFromInput() {
    this.clearError();
    const code = $('mp-code').value.toUpperCase();
    if (!validCode(code)) { this.error('Enter the 6-character party code (letters and numbers, e.g. MX7K2P).'); return; }
    this.settings.set('playerName', this.name());
    this.wantOnline = true;
    this.status('Joining...', 'warn');
    this.whenOnline(() => { this.sendProfile(); this.send({ t: 'join', code }); });
  }

  copyCode() {
    const code = this.code;
    if (!code) return;
    const done = () => { $('mp-copy').textContent = 'Copied!'; setTimeout(() => ($('mp-copy').textContent = 'Copy Code'), 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done, () => this.fallbackCopy(code, done));
    else this.fallbackCopy(code, done);
  }
  fallbackCopy(code, done) {
    const ta = document.createElement('textarea');
    ta.value = code; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch { /* ignore */ }
    ta.remove();
  }

  me() { return this.party ? this.party.members.find((m) => m.id === this.id) : null; }

  status(text, kind) {
    const el = $('mp-status');
    if (!el) return;
    el.textContent = text;
    el.className = 'status ' + (kind || '');
  }
  error(msg) { $('mp-error').textContent = msg; $('mp-error2').textContent = msg; }
  clearError() { $('mp-error').textContent = ''; $('mp-error2').textContent = ''; }
  renderPing() { const el = $('mp-ping'); if (el) el.textContent = this.ping != null ? `ping ${this.ping} ms` : ''; }

  renderLobby() {
    const inParty = !!this.party;
    $('mp-start').hidden = inParty;
    $('mp-party').hidden = !inParty;
    $('mp-back-row').hidden = inParty;
    if (!inParty) return;
    const P = this.party, leader = this.isLeader();
    $('mp-codeshow').textContent = P.code;
    $('mp-count').textContent = `(${P.members.filter((m) => m.connected).length}/8)`;
    $('mp-members').innerHTML = P.members.map((m) => {
      const v = getVehicle(m.vehicle), col = BIKE_COLORS.find((c) => c.id === m.color) || BIKE_COLORS[0];
      const tags = [];
      if (m.id === P.leader) tags.push('<span class="tagl leader">Leader</span>');
      tags.push(m.connected ? (m.ready ? '<span class="tagl ready">Ready</span>' : '<span class="tagl">Not ready</span>') : '<span class="tagl gone">Disconnected</span>');
      return `<li><span><span style="color:#${col.body.toString(16).padStart(6, '0')}">&#9679;</span> <b>${escapeHtml(m.name)}</b>${m.id === this.id ? ' (you)' : ''} <small>#${m.number} ${v.name}</small></span><span>${m.ping != null ? m.ping + ' ms ' : ''}${tags.join('')}</span></li>`;
    }).join('');
    $('mp-track').value = P.settings.track; $('mp-mode').value = P.settings.mode; $('mp-laps').value = String(P.settings.laps);
    for (const id of ['mp-track', 'mp-mode', 'mp-laps']) $(id).disabled = !leader;
    $('mp-leader-note').textContent = leader ? 'You are the leader: pick the track and mode, then start.' : 'The party leader picks the track and mode.';
    const me = this.me();
    $('mp-ready').textContent = me && me.ready ? 'Not Ready' : 'Ready';
    const sb = $('mp-startbtn');
    if (P.session) { sb.hidden = false; sb.textContent = 'Join Session'; sb.dataset.act = 'rejoin'; }
    else { sb.hidden = !leader; sb.textContent = 'Start Session'; sb.dataset.act = 'start'; }
    this.renderPing();
  }

  // ------------------------------------------------------------- sessions
  async onSession(m) {
    const g = this.game;
    // someone joined a running session: just add them
    if (m.rejoin && this.session && this.session.id === m.id && g.opts && g.opts.mp && g.mode !== 'menu') {
      this.session = m;
      this.syncSessionMembers(m.players);
      return;
    }
    this.session = m;
    this.standings = null;
    this.status('Joining Session', 'warn');
    const mine = m.players.find((p) => p.id === this.id);
    if (!mine) return;
    this.ui.hideResults(); this.ui.hidePause();
    await g.startSession({
      mode: m.mode, trackId: m.track, vehicleId: mine.vehicle, colorId: mine.color, laps: m.laps, number: mine.number,
      mp: { myId: this.id, slot: mine.slot, players: m.players, startAt: m.mode === 'freeride' ? null : m.goAt + 1000, serverNow: () => this.serverNow() },
    });
    // late join: the gate already dropped
    if (m.mode !== 'freeride' && this.serverNow() > m.goAt + 1000 && g.phase === 'countdown') g.countdown = 0.95;
    g.net = this;
    this.status('In Session', 'ok');
  }

  // add / remove remote riders to match the session + party
  syncSessionMembers(players) {
    const g = this.game;
    if (!g.opts || !g.opts.mp || g.mode === 'menu' || !this.session) return;
    const list = players || this.session.players;
    const inParty = new Set((this.party ? this.party.members : []).map((m) => m.id));
    for (const p of list) {
      if (p.id === this.id) continue;
      if (!inParty.has(p.id)) continue;
      if (!g.riders.some((r) => r.id === p.id)) {
        g.addRider({ id: p.id, name: p.name, vehicleId: p.vehicle, colorId: p.color, number: p.number, remote: true });
        g.toast(`${p.name} joined`, 1.5);
      }
    }
    for (const r of [...g.riders]) if (r.remote && !inParty.has(r.id)) { g.toast(`${r.name} left`, 1.5); g.removeRider(r); }
  }

  tick(dt, game) {
    if (!this.connected || !this.session) return;
    this.sendAcc += dt;
    if (this.sendAcc < 1 / SEND_RATE) return;
    this.sendAcc = 0;
    this.send({ t: 's', d: packState(game.player.veh) });
  }

  sendEvent(e) { this.send({ t: 'ev', e: e.t }); }

  onSnap(m) {
    const g = this.game;
    for (const row of m.p) {
      const id = row[0];
      if (id === this.id) continue;
      const r = g.riders.find((x) => x.id === id && x.remote);
      if (!r) continue;
      const buf = r.remote.buf;
      const t = row[1];
      if (buf.length && t <= buf[buf.length - 1].t) continue;
      buf.push({ t, d: row.slice(2) });
      if (buf.length > 40) buf.shift();
      r.remote.lastRecv = Date.now();
    }
  }

  // smooth a remote rider into place for this frame
  interpolate(r, game) {
    const R = r.remote, buf = R.buf;
    if (!buf.length) return;
    const rt = this.serverNow() - INTERP_DELAY;
    let a = buf[0], b = buf[0], k = 0;
    if (rt <= buf[0].t) { a = b = buf[0]; }
    else if (rt >= buf[buf.length - 1].t) { a = b = buf[buf.length - 1]; }
    else {
      for (let i = 0; i < buf.length - 1; i++) if (buf[i].t <= rt && rt < buf[i + 1].t) { a = buf[i]; b = buf[i + 1]; k = (rt - a.t) / (b.t - a.t); break; }
    }
    const da = a.d, db = b.d;
    const st = R.state || (R.state = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), vel: new THREE.Vector3(), visual: { lean: 0, steer: 0, wheels: [] }, crashed: false, rpm: 0, thr: 0, spin: [0, 0, 0, 0], airT: 0 });
    const L = (i) => da[i] + (db[i] - da[i]) * k;
    st.pos.set(L(0), L(1), L(2));
    _q1.set(da[3], da[4], da[5], da[6]).normalize(); _q2.set(db[3], db[4], db[5], db[6]).normalize();
    st.quat.copy(_q1).slerp(_q2, k);
    st.vel.set(L(7), L(8), L(9));
    // packets late: carry on along the last velocity for a moment
    const late = (rt - buf[buf.length - 1].t) / 1000;
    if (late > 0) st.pos.addScaledVector(st.vel, Math.min(0.25, late));
    const stale = Date.now() - (R.lastRecv || 0) > 3000;
    r.vis.root.visible = !stale;
    const def = getVehicle(r.vehicleId);
    const dt = 1 / 60;
    const spd = st.vel.length();
    const flags = db[15];
    st.crashed = !!(flags & F_CRASHED);
    st.rpm = L(13); st.thr = L(14);
    const steer = L(11);
    const wheels = def.wheels.map((w, i) => {
      st.spin[i] += (spd / w.r) * dt;
      return { comp: L(16 + i), spin: st.spin[i], steer: w.steer ? steer : 0 };
    });
    st.visual.lean = L(10); st.visual.steer = steer; st.visual.wheels = wheels;
    R.s = db[12];
    R.pos = st.pos; R.vel = st.vel;
    // pose proxy for the rider animation
    const px = R.proxy;
    const air = !!(flags & F_AIR);
    st.airT = air ? st.airT + dt : 0;
    px.speed = spd; px.grounded = !air; px.airTime = st.airT; px.lean = st.visual.lean;
    px.input.throttle = st.thr; px.controller.steer = Math.max(-1, Math.min(1, steer * 3));
    px.wheels.forEach((w, i) => { w.comp = wheels[i] ? wheels[i].comp : 0.1; });
  }

  onRace(m) {
    const g = this.game;
    if (!g.opts || !g.opts.mp) return;
    // mark finishers on our side for the HUD flags
    for (const row of m.rows) {
      const r = g.riders.find((x) => x.id === row.id);
      if (r) { r.finished = row.finished; r.finishTime = row.time; if (row.best != null) r.lap.bestLap = row.best; }
      if (row.id === this.id && row.finished && !this.toldFinish) { this.toldFinish = true; g.toast(`FINISHED ${ordinal(row.pos)}!`, 3, 'good'); }
    }
  }

  orderedRiders(game) {
    if (!this.standings) return game.standings();
    const out = [];
    for (const row of this.standings) { const r = game.riders.find((x) => x.id === row.id); if (r) out.push(r); }
    for (const r of game.riders) if (!out.includes(r)) out.push(r);
    return out;
  }

  onResults(m) {
    this.toldFinish = false;
    const g = this.game;
    const rows = m.rows.map((r) => {
      const rider = g.riders.find((x) => x.id === r.id);
      return { pos: r.pos, name: r.name, vehicle: rider ? getVehicle(rider.vehicleId).name : '', time: m.mode === 'race' ? r.time : r.best, best: r.best, laps: r.laps, me: r.id === this.id };
    });
    g.results = rows;
    setTimeout(() => this.ui.showResults(rows, g), m.mode === 'race' ? 1500 : 0);
  }

  requestRestart() {
    if (this.isLeader()) this.send({ t: 'start' });
    else this.game.toast('Only the party leader can restart', 2);
  }

  leaveSession() {
    // back to the menu: we stay in the party, we just stop riding
    this.game.net = null;
    this.status('In Party', 'ok');
  }
}

function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
function ssGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } }
