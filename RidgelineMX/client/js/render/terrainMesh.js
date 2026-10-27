// =====================================================================
//  TERRAIN MESH
//  The height grid is cut into 64 m chunks. Each chunk has 3 levels of
//  detail (1 m, 2 m, 4 m) that swap by distance; skirts hide the cracks.
//  One shared material blends grass / dirt / rock textures using a
//  per-vertex "splat" value, with baked ambient occlusion in the colours.
//  Beyond the playable map a coarse ring of hills and mountains fills
//  the horizon.
// =====================================================================
import * as THREE from 'three';
import { heightAt } from '/shared/terrain.js';
import { fbm, smoothstep } from '/shared/noise.js';
import { makeGrassTexture, makeDirtTexture, makeRockTexture } from './textures.js';

const CHUNK = 64;
let sharedTextures = null;

function terrainMaterial(renderer) {
  if (!sharedTextures) {
    sharedTextures = { grass: makeGrassTexture(renderer), dirt: makeDirtTexture(renderer), rock: makeRockTexture(renderer) };
  }
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tGrass = { value: sharedTextures.grass };
    sh.uniforms.tDirt = { value: sharedTextures.dirt };
    sh.uniforms.tRock = { value: sharedTextures.rock };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 splat;\nvarying vec3 vSplat;\nvarying vec3 vWPos;')
      .replace('#include <common>', '#include <common>\nvarying float vSlope;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = splat;\nvWPos = (modelMatrix * vec4(position, 1.0)).xyz;\nvSlope = 1.0 - normalize(mat3(modelMatrix) * normal).y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tGrass; uniform sampler2D tDirt; uniform sampler2D tRock;\nvarying vec3 vSplat;\nvarying vec3 vWPos;\nvarying float vSlope;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 wuv = vWPos.xz;
        float big = texture2D(tGrass, wuv * 0.011).g;
        vec3 grass = texture2D(tGrass, wuv * 0.17).rgb * (0.78 + big * 0.55);
        grass = mix(grass, texture2D(tGrass, wuv * 0.043).rgb, 0.35);
        vec3 dirt = texture2D(tDirt, wuv * 0.21).rgb;
        dirt = mix(dirt, texture2D(tDirt, wuv * 0.05).rgb, 0.3);
        dirt = mix(dirt, dirt * vec3(0.66, 0.6, 0.55), vSplat.z);
        // jump faces and berm walls: freshly cut, darker and redder dirt
        dirt = mix(dirt, dirt * vec3(0.82, 0.68, 0.56), smoothstep(0.04, 0.3, vSlope));
        vec3 rock = texture2D(tRock, wuv * 0.09 + vec2(vWPos.y * 0.07, 0.0)).rgb;
        float edgeNoise = texture2D(tDirt, wuv * 0.07).r - 0.45;
        float d = smoothstep(0.3, 0.7, vSplat.x + edgeNoise * 0.6);
        vec3 ground = mix(grass, dirt, d);
        ground = mix(ground, rock, vSplat.y);
        diffuseColor.rgb *= ground * 1.9;`);
  };
  return mat;
}

export class TerrainMesh {
  constructor(world, renderer, quality) {
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    this.material = terrainMaterial(renderer.renderer);
    this.lods = [];
    this.geometries = [];
    this.castShadows = quality.shadows === 'high';
    this.buildAO();
    this.build();
    this.buildHorizon();
  }

  // ambient occlusion grid at 1 m: how much the ground around each point rises above it
  buildAO() {
    const W = this.world, size = W.size, n = Math.round(size) + 1, half = size / 2;
    const ao = new Float32Array(n * n);
    const dirs = [];
    for (let k = 0; k < 8; k++) dirs.push([Math.cos((k / 8) * Math.PI * 2), Math.sin((k / 8) * Math.PI * 2)]);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = i - half, z = j - half;
        const h = heightAt(W, x, z);
        let occ = 0;
        for (const [dx, dz] of dirs) {
          const h1 = heightAt(W, x + dx * 1.5, z + dz * 1.5) - h;
          const h2 = heightAt(W, x + dx * 4.5, z + dz * 4.5) - h;
          occ += Math.max(0, h1 / 1.5) * 0.5 + Math.max(0, h2 / 4.5);
        }
        ao[j * n + i] = Math.max(0.55, 1 - occ * 0.09);
      }
    }
    this.ao = ao; this.aoN = n;
  }

  aoAt(x, z) {
    const half = this.world.size / 2;
    const i = Math.min(this.aoN - 1, Math.max(0, Math.round(x + half)));
    const j = Math.min(this.aoN - 1, Math.max(0, Math.round(z + half)));
    return this.ao[j * this.aoN + i];
  }

  buildChunkGeometry(x0, z0, spacing) {
    const W = this.world;
    const N = Math.round(CHUNK / spacing);
    const vpr = N + 1;
    const gridCount = vpr * vpr;
    const skirtCount = 4 * vpr;
    const count = gridCount + skirtCount;
    const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3);
    const col = new Uint8Array(count * 3), spl = new Uint8Array(count * 3);
    const cx = x0 + CHUNK / 2, cz = z0 + CHUNK / 2;
    const half = W.half;
    const setVert = (vi, x, z, drop) => {
      const h = heightAt(W, x, z);
      pos[vi * 3] = x - cx; pos[vi * 3 + 1] = h - drop; pos[vi * 3 + 2] = z - cz;
      const e = 0.5;
      const dx = heightAt(W, x + e, z) - heightAt(W, x - e, z);
      const dz = heightAt(W, x, z + e) - heightAt(W, x, z - e);
      const nx = -dx / (2 * e), nz = -dz / (2 * e);
      const il = 1 / Math.sqrt(nx * nx + 1 + nz * nz);
      nor[vi * 3] = nx * il; nor[vi * 3 + 1] = il; nor[vi * 3 + 2] = nz * il;
      // splat: dirt, rock, wear
      const gi = Math.round((x + half) / W.res), gj = Math.round((z + half) / W.res);
      const ci = Math.min(W.cells - 1, Math.max(0, gj)) * W.cells + Math.min(W.cells - 1, Math.max(0, gi));
      const dirt = W.DIRT[ci] / 255;
      const slope = 1 - il;
      let rock = smoothstep(0.25, 0.5, slope) * (1 - dirt);
      if (W.def.terrain.rimSharp) rock = Math.max(rock, smoothstep(0.12, 0.3, slope) * (1 - dirt));
      let wear = 0;
      if (W.F.S[ci] >= 0) {
        const u = Math.abs(W.F.U[ci]);
        wear = dirt * Math.max(0, 1 - u / 5) * (0.55 + 0.45 * fbm(x * 0.15, z * 0.15, 3, 2));
      }
      spl[vi * 3] = dirt * 255; spl[vi * 3 + 1] = rock * 255; spl[vi * 3 + 2] = Math.min(1, wear) * 255;
      const ao = this.aoAt(x, z);
      const tint = 0.92 + 0.12 * fbm(x * 0.02, z * 0.02, 7, 2);
      col[vi * 3] = Math.min(255, ao * tint * 255); col[vi * 3 + 1] = Math.min(255, ao * tint * 255); col[vi * 3 + 2] = Math.min(255, ao * 255);
    };
    for (let j = 0; j < vpr; j++) for (let i = 0; i < vpr; i++) setVert(j * vpr + i, x0 + i * spacing, z0 + j * spacing, 0);
    // skirt vertices along the 4 edges
    const edge = [];
    for (let i = 0; i < vpr; i++) edge.push([i, 0]);
    for (let j = 0; j < vpr; j++) edge.push([N, j]);
    for (let i = N; i >= 0; i--) edge.push([i, N]);
    for (let j = N; j >= 0; j--) edge.push([0, j]);
    const idx = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = j * vpr + i, b = a + 1, c = a + vpr, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    for (let k = 0; k < 4 * vpr; k++) {
      const [i, j] = edge[k];
      setVert(gridCount + k, x0 + i * spacing, z0 + j * spacing, 2.0);
    }
    for (let side = 0; side < 4; side++) {
      for (let k = 0; k < vpr - 1; k++) {
        const e0 = side * vpr + k, e1 = e0 + 1;
        const [i0, j0] = edge[e0], [i1, j1] = edge[e1];
        const g0 = j0 * vpr + i0, g1 = j1 * vpr + i1;
        const s0 = gridCount + e0, s1 = gridCount + e1;
        idx.push(g0, s0, g1, g1, s0, s1, g0, g1, s0, g1, s1, s0); // both windings: always visible
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
    geo.setAttribute('splat', new THREE.BufferAttribute(spl, 3, true));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    this.geometries.push(geo);
    return geo;
  }

  build() {
    const W = this.world, half = W.size / 2;
    const n = Math.ceil(W.size / CHUNK);
    const start = -half;
    for (let cj = 0; cj < n; cj++) {
      for (let ci = 0; ci < n; ci++) {
        const x0 = start + ci * CHUNK, z0 = start + cj * CHUNK;
        const lod = new THREE.LOD();
        lod.position.set(x0 + CHUNK / 2, 0, z0 + CHUNK / 2);
        const levels = [[1, 0], [2, 150], [4, 300]];
        for (const [sp, dist] of levels) {
          const m = new THREE.Mesh(this.buildChunkGeometry(x0, z0, sp), this.material);
          m.receiveShadow = true;
          m.castShadow = sp === 1 && this.castShadows;
          m.matrixAutoUpdate = false; m.updateMatrix();
          lod.addLevel(m, dist);
        }
        lod.matrixAutoUpdate = false; lod.updateMatrix();
        this.group.add(lod);
        this.lods.push(lod);
      }
    }
  }

  // Low-detail hills and mountains around the map, out to the horizon
  buildHorizon() {
    const W = this.world, half = W.size / 2, seed = W.def.seed;
    const R = 1800, step = 30;
    const n = Math.round((2 * R) / step) + 1;
    const pos = [], col = [], idx = [];
    const map = new Int32Array(n * n).fill(-1);
    const base = W.base;
    const heightOut = (x, z) => {
      const d = Math.max(Math.abs(x), Math.abs(z));
      let h = base(Math.max(-half, Math.min(half, x)), Math.max(-half, Math.min(half, z)));
      const far = smoothstep(half, half + 300, d);
      h = h * (1 - far) + far * (30 + 25 * fbm(x / 200, z / 200, seed + 50, 3));
      h += 160 * smoothstep(650, 1500, d) * (0.6 + 0.6 * fbm(x / 380, z / 380, seed + 77, 4));
      return h;
    };
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = -R + i * step, z = -R + j * step;
      // skip vertices well inside the detailed map
      if (Math.abs(x) < half - step * 2 && Math.abs(z) < half - step * 2) continue;
      const inside = Math.abs(x) <= half && Math.abs(z) <= half;
      const h = inside ? heightAt(W, x, z) - 1.5 : heightOut(x, z);
      map[j * n + i] = pos.length / 3;
      pos.push(x, h, z);
      const t = Math.min(1, Math.max(0, (h - 10) / 120));
      col.push(0.33 + t * 0.2, 0.45 + t * 0.12, 0.27 + t * 0.2);
    }
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const a = map[j * n + i], b = map[j * n + i + 1], c = map[(j + 1) * n + i], d = map[(j + 1) * n + i + 1];
      if (a < 0 || b < 0 || c < 0 || d < 0) continue;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.geometries.push(geo);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.horizonMat = mat;
    const m = new THREE.Mesh(geo, mat);
    m.matrixAutoUpdate = false;
    this.group.add(m);
  }

  setShadowCasting(on) {
    for (const lod of this.lods) lod.levels[0].object.castShadow = on;
  }

  dispose() {
    for (const g of this.geometries) g.dispose();
    this.material.dispose();
    this.horizonMat.dispose();
    this.group.removeFromParent();
  }
}
