// =====================================================================
//  RENDERER: WebGL setup, sky, sun, fog, shadows and quality presets.
//  Graphics settings (shadows, resolution, view distance) are applied
//  here by applyQuality() - see settings.js for the presets.
// =====================================================================
import * as THREE from 'three';

const SKY_VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const SKY_FRAG = `
uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uGround; uniform vec3 uSunDir; uniform vec3 uSunColor;
varying vec3 vDir;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float clouds(vec2 p) {
  float v = 0.0, a = 0.55;
  for (int i = 0; i < 4; i++) { v += vnoise(p) * a; p *= 2.07; a *= 0.5; }
  return v;
}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.55));
  col = mix(col, uGround, smoothstep(0.0, -0.08, h));
  float s = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.25 + pow(s, 3.0) * 0.08);
  // soft fair-weather clouds
  if (h > 0.01) {
    vec2 cp = d.xz / (h + 0.12) * 1.4;
    float c = smoothstep(0.52, 0.8, clouds(cp + vec2(3.0, 7.0)));
    c *= smoothstep(0.01, 0.12, h);
    col = mix(col, vec3(1.0, 0.99, 0.97) * (0.92 + 0.08 * s), c * 0.85);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(65, 1, 0.1, 2400);
    this.sunDir = new THREE.Vector3(-0.45, 0.72, -0.35).normalize();
    this.fogColor = new THREE.Color(0xc9d8e4);
    this.scene.fog = new THREE.Fog(this.fogColor, 180, 900);
    this.scene.background = this.fogColor;

    this.hemi = new THREE.HemisphereLight(0xcfe3ff, 0x6b5a40, 0.85);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 3.1);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.shadowRange = 45;
    this.makeSky();
    this.quality = null;
    this.resScale = 1;
    this.envMap = this.makeEnvironment();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('fullscreenchange', () => setTimeout(() => this.resize(), 50));
  }

  makeSky() {
    const geo = new THREE.SphereGeometry(2000, 32, 16);
    this.skyUniforms = {
      uTop: { value: new THREE.Color(0x3b78c8) }, uHorizon: { value: new THREE.Color(0xcfe0ec) },
      uGround: { value: new THREE.Color(0x8c9a8a) }, uSunDir: { value: this.sunDir },
      uSunColor: { value: new THREE.Color(0xfff2d8) },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: this.skyUniforms,
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);
    this.scene.background = null;
  }

  // a tiny "photo studio" made from the sky colours, used for shiny paint reflections
  makeEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const geo = new THREE.SphereGeometry(10, 32, 16);
    const mat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: this.skyUniforms, side: THREE.BackSide,
    });
    envScene.add(new THREE.Mesh(geo, mat));
    const rt = pmrem.fromScene(envScene, 0.02);
    pmrem.dispose();
    this.scene.environment = rt.texture;
    return rt.texture;
  }

  applyQuality(q) {
    this.quality = q;
    const r = this.renderer;
    this.resScale = q.resolution;
    r.shadowMap.enabled = q.shadows !== 'off';
    const size = q.shadows === 'high' ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
    this.sun.castShadow = q.shadows !== 'off';
    this.shadowRange = q.shadows === 'high' ? 55 : 40;
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -this.shadowRange; cam.right = cam.top = this.shadowRange;
    cam.near = 1; cam.far = 400; cam.updateProjectionMatrix();
    this.scene.fog.near = q.viewDistance * 0.22;
    this.scene.fog.far = q.viewDistance;
    this.camera.far = Math.max(q.viewDistance * 1.2, 800) + 1500;
    this.camera.updateProjectionMatrix();
    // materials compiled for shadows need an update when the toggle changes
    this.scene.traverse((o) => { if (o.material && o.material.needsUpdate !== undefined) o.material.needsUpdate = true; });
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * (this.resScale || 1);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  // keep the shadow box centred on what matters (the player)
  followShadow(target) {
    const d = this.sunDir;
    const snap = 2;
    const tx = Math.round(target.x / snap) * snap, tz = Math.round(target.z / snap) * snap;
    this.sun.target.position.set(tx, target.y, tz);
    this.sun.position.set(tx + d.x * 150, target.y + d.y * 150, tz + d.z * 150);
    this.sun.target.updateMatrixWorld();
  }

  render() {
    this.sky.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }
}
