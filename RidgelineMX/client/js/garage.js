// =====================================================================
//  GARAGE SHOWROOM: a small 3D scene with the selected vehicle and its
//  rider on a turntable. Drag to rotate, it spins slowly on its own.
//  Uses the main renderer, drawn instead of the track while the
//  Vehicle Selection screen is open.
// =====================================================================
import * as THREE from 'three';
import { getVehicle, BIKE_COLORS } from '/shared/vehicles.js';
import { VehicleVisual } from './render/vehicleModel.js';
import { Rider } from './render/rider.js';

export class Garage {
  constructor(R) {
    this.R = R;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1f29);
    this.scene.fog = new THREE.Fog(0x1a1f29, 8, 22);
    this.scene.environment = R.envMap;
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    const hemi = new THREE.HemisphereLight(0xdde8ff, 0x3a3226, 1.2);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(4, 7, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = key.shadow.camera.bottom = -3; key.shadow.camera.right = key.shadow.camera.top = 3;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffb27a, 1.4);
    rim.position.set(-5, 3, -4);
    this.scene.add(rim);
    // dirt pad + turntable
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.8, 0.12, 48), new THREE.MeshStandardMaterial({ color: 0x5b4330, roughness: 0.95 }));
    pad.position.y = -0.06; pad.receiveShadow = true;
    this.scene.add(pad);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.62, 0.04, 8, 64), new THREE.MeshStandardMaterial({ color: 0xff5a1f, emissive: 0x7a2200, roughness: 0.4 }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.01;
    this.scene.add(ring);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 48), new THREE.MeshStandardMaterial({ color: 0x232833, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.12; floor.receiveShadow = true;
    this.scene.add(floor);
    this.turn = new THREE.Group();
    this.scene.add(this.turn);
    this.yaw = 0.7; this.pitch = 0.18; this.drag = null; this.idle = 0;
    this.key = null;
    const el = R.renderer.domElement;
    el.addEventListener('pointerdown', (e) => { if (!this.active) return; this.drag = { x: e.clientX, y: e.clientY }; this.idle = 0; });
    window.addEventListener('pointermove', (e) => {
      if (!this.drag || !this.active) return;
      this.yaw -= (e.clientX - this.drag.x) * 0.008;
      this.pitch = Math.max(-0.05, Math.min(0.7, this.pitch + (e.clientY - this.drag.y) * 0.004));
      this.drag = { x: e.clientX, y: e.clientY };
      this.idle = 0;
    });
    window.addEventListener('pointerup', () => { this.drag = null; });
  }

  show(vehicleId, colorId) {
    const key = vehicleId + ':' + colorId;
    if (key === this.key) return;
    this.key = key;
    if (this.vis) { this.vis.dispose(); this.rider.dispose(); }
    const def = getVehicle(vehicleId);
    const scheme = BIKE_COLORS.find((c) => c.id === colorId) || BIKE_COLORS[0];
    this.vis = new VehicleVisual(def, scheme, 1);
    this.vis.tryLoadModel();
    this.vis.root.position.y = this.vis.cfg.rideHeight;
    this.turn.add(this.vis.root);
    this.rider = new Rider(scheme);
    this.rider.attachTo(this.vis.model);
    this.state = { lean: 0, steer: 0.25, wheels: this.vis.cfg.wheels.map((w) => ({ comp: w.sag * w.travel, spin: 0, steer: 0 })) };
    this.fake = { input: { throttle: 0, brake: 0, lean: 0 }, speed: 3, grounded: true, airTime: 0, lean: 0, wheels: this.vis.cfg.wheels.map((w) => ({ comp: w.sag * w.travel, cfg: w })), controller: { steer: 0 } };
    this.vis.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  }

  render(dt) {
    this.active = true;
    this.idle += dt;
    if (this.idle > 2 && !this.drag) this.yaw += dt * 0.25;
    const r = 4.6;
    this.camera.position.set(Math.sin(this.yaw) * Math.cos(this.pitch) * r, 0.7 + Math.sin(this.pitch) * r, Math.cos(this.yaw) * Math.cos(this.pitch) * r);
    this.camera.lookAt(0, 0.65, 0);
    const R = this.R;
    this.camera.aspect = R.camera.aspect;
    this.camera.updateProjectionMatrix();
    if (this.vis) {
      this.vis.update(this.state);
      this.vis.root.updateMatrixWorld();
      this.rider.updateRiding(dt, this.fake, this.vis);
    }
    R.renderer.render(this.scene, this.camera);
  }
}
