// =====================================================================
//  RIDGELINE MX - entry point. Creates the renderer, game, UI, audio and
//  network objects, wires the menus to the game, and runs the frame loop.
// =====================================================================
import { Renderer } from './render/renderer.js';
import { Settings } from './settings.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { UI } from './ui.js';
import { Game } from './game.js';
import { Garage } from './garage.js';
import { Net } from './net.js';

const settings = new Settings();
const R = new Renderer(document.getElementById('game'));
R.applyQuality(settings.quality());
const input = new Input();
const audio = new Audio(settings);
const ui = new UI(settings);
const game = new Game({ renderer: R, settings, audio, input, ui });
const garage = new Garage(R);
const net = new Net(ui, game, settings);

// expose for debugging / automated tests in the console
window.MX = { game, ui, settings, R, net, garage, input };

// ---- menu wiring
ui.on('screen', (name) => {
  if (name === 'garage') garage.show(settings.get('vehicle'), settings.get('color'));
  garage.active = name === 'garage';
  if (name !== 'loading') audio.unlock();
});
ui.on('garageChange', () => garage.show(settings.get('vehicle'), settings.get('color')));
ui.on('trackChange', async () => {
  ui.showLoading('Loading track...');
  await game.startMenu();
  ui.show('tracks');
});
ui.on('startMode', async (opts) => {
  audio.unlock();
  await game.startSession(opts);
});
ui.on('pause', () => { game.paused = true; input.enabled = false; ui.showPause(); });
ui.on('resume', () => { game.paused = false; input.enabled = true; ui.hidePause(); ui.showHud(game); });
ui.on('restart', async () => {
  ui.hidePause(); ui.hideResults();
  input.enabled = true;
  if (game.opts && game.opts.mp) { net.requestRestart(); return; }
  await game.startSession(game.opts);
});
ui.on('resetVehicle', () => { if (game.player && game.player.veh) game.resetRider(game.player); ui.emit('resume'); });
ui.on('camera', () => { game.cam.cycle(); settings.set('camera', game.cam.mode); });
ui.on('mainMenu', async () => {
  ui.hidePause(); ui.hideResults(); ui.hideHud();
  input.enabled = true;
  if (game.opts && game.opts.mp) net.leaveSession();
  ui.showLoading('Back to the menu...');
  await game.startMenu();
  ui.show(game.opts && game.opts.mp && net.code ? 'mp' : 'menu');
});
ui.on('quality', async () => {
  R.applyQuality(settings.quality());
  game.applySettings();
  // grass / detail / shadows need the scenery rebuilt
  if (game.world) {
    const keepPlaying = game.mode !== 'menu';
    const id = game.trackId;
    game.trackId = null;
    const riders = game.riders;
    // rebuild scenery only (keeps riders + physics)
    const { Scenery } = await import('./render/scenery.js');
    game.scenery.dispose();
    game.scenery = new Scenery(game.world, R, settings.quality());
    R.scene.add(game.scenery.group);
    game.terrain.setShadowCasting(settings.get('shadows') === 'high');
    game.trackId = id;
    game.scenery.forceUpdate(R.camera);
    if (keepPlaying && game.phase === 'go') game.scenery.dropGate(true), game.scenery.setGate(-Math.PI / 2 * 0.96);
    void riders;
  }
});

window.addEventListener('pointerdown', () => audio.unlock(), { once: false });
window.addEventListener('keydown', () => audio.unlock());

// ---- boot
(async () => {
  ui.showLoading('Building the track...');
  try {
    await game.startMenu();
  } catch (e) {
    console.error(e);
    ui.showLoading('Something went wrong loading the game: ' + e.message);
    return;
  }
  ui.show('menu');
  net.autoRejoin();
})();

// ---- frame loop
let last = performance.now();
function loop(now) {
  const raw = (now - last) / 1000;
  const dt = Math.min(0.1, raw);
  game.rawDt = raw;
  last = now;
  input.update(dt);
  if (ui.screen === 'garage') garage.render(dt);
  else game.frame(dt);
  input.endFrame();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
