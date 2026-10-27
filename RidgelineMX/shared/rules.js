// =====================================================================
//  RACE RULES (shared by the game and the multiplayer server)
//  A lap only counts when every checkpoint was passed in order, so
//  cutting the track or riding backwards over the line does nothing.
//  The server runs the same tracker on what each client reports.
// =====================================================================
import { deltaS } from './trackgen.js';

export const GAME = {
  countdown: 3,          // seconds of 3-2-1 before the gate drops
  maxSpeed: 45,          // m/s - anything faster is treated as a cheat / glitch
  resetDelay: 2.6,       // seconds after a crash before the automatic reset
  maxPlayers: 8,
};

export class LapTracker {
  constructor(T) {
    this.T = T;
    this.cps = T.checkpoints;
    this.reset('race', 0);
  }

  // mode 'race': started from the gate, the first lap ends at the finish line
  // mode 'flying': timing starts the first time you cross the finish line
  reset(mode, time) {
    this.mode = mode;
    this.next = mode === 'race' ? 1 : 0;
    this.passed = 0;
    this.laps = 0;
    this.lapStart = mode === 'race' ? time : null;
    this.lastLap = null; this.bestLap = null;
    this.lapTimes = [];
    this.lastS = null;
    this.finished = false; this.finishTime = null;
  }

  // feed the rider's lap position every step; returns an event or null
  update(s, time) {
    if (this.lastS === null) { this.lastS = s; return null; }
    const prev = this.lastS;
    this.lastS = s;
    const move = deltaS(this.T, prev, s);
    if (move <= 0 || move > 30) return null; // backwards, or a teleport (reset)
    const cp = this.cps[this.next];
    if (deltaS(this.T, prev, cp) > 0 && deltaS(this.T, cp, s) >= 0) {
      const crossed = this.next;
      this.next = (this.next + 1) % this.cps.length;
      this.passed++;
      if (crossed === 0) {
        if (this.lapStart === null) { this.lapStart = time; return { type: 'start' }; }
        const t = time - this.lapStart;
        this.lapStart = time;
        this.laps++;
        this.lastLap = t;
        this.lapTimes.push(t);
        if (this.bestLap === null || t < this.bestLap) this.bestLap = t;
        return { type: 'lap', time: t, laps: this.laps };
      }
      return { type: 'cp', index: crossed };
    }
    return null;
  }

  // a single number that orders riders in a race (bigger = further ahead)
  progress(s) {
    const T = this.T;
    const last = this.cps[(this.next - 1 + this.cps.length) % this.cps.length];
    return this.passed * 1000 + deltaS(T, last, s);
  }

  currentLapTime(time) { return this.lapStart === null ? null : time - this.lapStart; }
}
