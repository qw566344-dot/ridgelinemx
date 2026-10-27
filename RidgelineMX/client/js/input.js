// =====================================================================
//  INPUT: keyboard (and a basic gamepad) -> smooth 0..1 controls.
//  Key bindings live in KEYS below. A gamepad is read every frame
//  (left stick steer/lean, triggers throttle/brake, A = reset, Y = camera).
// =====================================================================
export const KEYS = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  rearBrake: ['Space'],
  clutch: ['ShiftLeft', 'ShiftRight'],
  leanBack: ['KeyQ'],
  leanFwd: ['KeyE'],
  reset: ['KeyR'],
  camera: ['KeyC'],
  retry: ['KeyT'],
  pause: ['Escape', 'KeyP'],
  fps: ['F3'],
};

export class Input {
  constructor() {
    this.down = new Set();
    this.pressedOnce = new Set();
    this.controls = { throttle: 0, brake: 0, steer: 0, rearBrake: 0, clutch: false, lean: 0 };
    this.enabled = true;
    this.mouse = { dx: 0, dy: 0, look: false };
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (!this.down.has(e.code)) this.pressedOnce.add(e.code);
      this.down.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F3'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
    window.addEventListener('mousedown', (e) => { if (e.button === 2) this.mouse.look = true; });
    window.addEventListener('mouseup', (e) => { if (e.button === 2) this.mouse.look = false; });
    window.addEventListener('mousemove', (e) => { if (this.mouse.look) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; } });
    window.addEventListener('contextmenu', (e) => { if (e.target && e.target.tagName === 'CANVAS') e.preventDefault(); });
    this.padPrev = {};
  }

  held(action) { return KEYS[action].some((k) => this.down.has(k)); }

  // true once per key press
  pressed(action) {
    let hit = false;
    for (const k of KEYS[action]) if (this.pressedOnce.has(k)) hit = true;
    if (this.padPressed && this.padPressed[action]) hit = true;
    return hit;
  }

  endFrame() { this.pressedOnce.clear(); this.padPressed = {}; this.mouse.dx = 0; this.mouse.dy = 0; }

  update(dt) {
    const c = this.controls;
    const ramp = (cur, target, up, downRate) => {
      const r = target > cur ? up : downRate;
      return cur + Math.max(-r * dt, Math.min(r * dt, target - cur));
    };
    let thr = this.held('throttle') ? 1 : 0, brk = this.held('brake') ? 1 : 0;
    let st = (this.held('left') ? 1 : 0) - (this.held('right') ? 1 : 0);
    let lean = (this.held('leanFwd') ? 1 : 0) - (this.held('leanBack') ? 1 : 0);
    let rear = this.held('rearBrake') ? 1 : 0;
    let clutch = this.held('clutch');
    // gamepad (if any)
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads && Array.from(pads).find((p) => p && p.connected);
    this.padPressed = this.padPressed || {};
    if (pad) {
      const dz = (v) => (Math.abs(v) < 0.12 ? 0 : v);
      const ax = dz(pad.axes[0] || 0), ay = dz(pad.axes[1] || 0);
      const rt = pad.buttons[7] ? pad.buttons[7].value : 0, lt = pad.buttons[6] ? pad.buttons[6].value : 0;
      if (Math.abs(ax) > 0) st = -ax;
      if (Math.abs(ay) > 0) lean = ay;
      thr = Math.max(thr, rt); brk = Math.max(brk, lt);
      if (pad.buttons[2] && pad.buttons[2].pressed) rear = 1;
      if (pad.buttons[5] && pad.buttons[5].pressed) clutch = true;
      const edge = (i, action) => {
        const b = pad.buttons[i] && pad.buttons[i].pressed;
        if (b && !this.padPrev[i]) this.padPressed[action] = true;
        this.padPrev[i] = b;
      };
      edge(0, 'reset'); edge(3, 'camera'); edge(9, 'pause'); edge(1, 'retry');
    }
    if (!this.enabled) { thr = brk = st = lean = rear = 0; clutch = false; }
    c.throttle = ramp(c.throttle, thr, 7, 10);
    c.brake = ramp(c.brake, brk, 8, 12);
    c.steer = ramp(c.steer, st, 6, 9);
    c.lean = ramp(c.lean, lean, 6, 8);
    c.rearBrake = ramp(c.rearBrake, rear, 10, 12);
    c.clutch = clutch;
    return c;
  }
}
