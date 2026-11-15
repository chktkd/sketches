import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BUMP_GLSL, NOISE_GLSL } from './glsl';
import { createRng } from './rng';
import { swayify } from './wind';

/* ───────────── 高さ関数（CPU 側の値ノイズ） ───────────── */

const ihash = (x: number, y: number) => {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const vnoise = (x: number, y: number) => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = ihash(ix, iy);
  const b = ihash(ix + 1, iy);
  const c = ihash(ix, iy + 1);
  const d = ihash(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
};
const fbm = (x: number, y: number, oct = 5) => {
  let s = 0;
  let a = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x * f, y * f);
    f *= 2.03;
    a *= 0.5;
  }
  return s;
};
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** 山岳のある方角と、湖の位置 */
export const MOUNTAIN_ANGLE = -2.35;
export const LAKE = { x: 760, z: -430, r: 360 };
export const WATER_Y = -1.2;
const SIZE = 7200;

/** 街の外の地形の高さ。街の周辺は平ら、離れるほど丘・山になり、湖の盆地がある */
export function terrainHeight(x: number, z: number): number {
  const d = Math.max(Math.abs(x), Math.abs(z));
  const r = Math.hypot(x, z);
  const flat = smooth(215, 700, d);
  const ang = Math.atan2(z, x);
  let h = flat * (fbm(x / 950 + 11, z / 950 + 7) * 95 + (fbm(x / 240, z / 240) - 0.5) * 22);
  const sector = smooth(-0.15, 0.75, Math.cos(ang - MOUNTAIN_ANGLE));
  const ridge = 1 - Math.abs(2 * fbm(x / 1250 + 3, z / 1250 + 5, 6) - 1);
  h += sector * smooth(950, 2500, r) * (ridge * ridge * 560 + 60);
  const ld = Math.hypot(x - LAKE.x, z - LAKE.z);
  const basin = smooth(LAKE.r * 1.15, LAKE.r * 0.35, ld);
  h = h * (1 - basin) + -7 * basin;
  return h - 0.08;
}

const GRASS = new THREE.Color(0.15, 0.21, 0.09);
const GRASS2 = new THREE.Color(0.26, 0.26, 0.13);
const FOREST = new THREE.Color(0.08, 0.14, 0.065);
const ROCK = new THREE.Color(0.38, 0.36, 0.33);
const SAND = new THREE.Color(0.52, 0.47, 0.34);
const SNOW = new THREE.Color(0.86, 0.88, 0.92);

export class Terrain {
  readonly group = new THREE.Group();
  readonly water: THREE.Mesh;
  private readonly waterNormal: THREE.CanvasTexture;

  constructor(forestDensity = 1) {
    const seg = 380;
    const n = seg + 1;
    const pos = new Float32Array(n * n * 3);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        // 中心付近は細かく、遠くは粗く（2 乗でひずませる）
        const u = (i / seg) * 2 - 1;
        const w = (j / seg) * 2 - 1;
        const x = Math.sign(u) * u * u * (SIZE / 2) * 0.35 + u * (SIZE / 2) * 0.65;
        const z = Math.sign(w) * w * w * (SIZE / 2) * 0.35 + w * (SIZE / 2) * 0.65;
        const o = (j * n + i) * 3;
        pos[o] = x;
        pos[o + 1] = terrainHeight(x, z);
        pos[o + 2] = z;
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < seg; j++) {
      for (let i = 0; i < seg; i++) {
        const a = j * n + i;
        idx.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();

    // 頂点色: 標高・斜面・ノイズで、草・枯草・森・岩・砂・雪を塗り分ける
    const nor = geo.getAttribute('normal');
    const col = new Float32Array(n * n * 3);
    const c = new THREE.Color();
    for (let k = 0; k < n * n; k++) {
      const x = pos[k * 3] as number;
      const h = pos[k * 3 + 1] as number;
      const z = pos[k * 3 + 2] as number;
      const slope = 1 - (nor.getY(k) as number);
      const patch = fbm(x / 160, z / 160, 4);
      c.copy(GRASS).lerp(GRASS2, smooth(0.35, 0.7, fbm(x / 90 + 40, z / 90, 3)));
      c.lerp(FOREST, smooth(0.52, 0.68, patch) * 0.85);
      c.lerp(ROCK, Math.max(smooth(0.16, 0.34, slope), smooth(120, 260, h) * 0.7));
      c.lerp(SNOW, smooth(300, 380, h + (fbm(x / 70, z / 70, 3) - 0.5) * 60));
      const ld = Math.hypot(x - LAKE.x, z - LAKE.z);
      if (h < 1.2 && ld < LAKE.r * 1.3) c.lerp(SAND, smooth(1.2, -0.6, h) * 0.9);
      // 街に近い所は踏み固められた土
      const d = Math.max(Math.abs(x), Math.abs(z));
      c.lerp(new THREE.Color(0.3, 0.26, 0.18), smooth(260, 205, d) * 0.7);
      col[k * 3] = c.r;
      col[k * 3 + 1] = c.g;
      col[k * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.96,
      metalness: 0,
    });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTPos = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vTPos;
${NOISE_GLSL}
${BUMP_GLSL}`
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
float tH = 0.0;
{
  // 近くでは細かい草の斑・土の粒。各ノイズは、画素より細かくなる距離で個別に消す（ちらつき防止）
  vec2 q = vTPos.xz;
  float pxm = max(length(dFdx(q)), length(dFdy(q)));
  float w1 = 1.0 - smoothstep(0.12, 0.45, pxm * 0.6);
  float w2 = 1.0 - smoothstep(0.12, 0.45, pxm * 3.3);
  float w3 = 1.0 - smoothstep(0.12, 0.45, pxm * 11.0);
  float w0 = 1.0 - smoothstep(0.12, 0.45, pxm * 0.05);
  float g0 = fbm2(q * 0.05);
  float g1 = fbm2(q * 0.6);
  float g2 = vnoise(q * 3.3);
  float g3 = vnoise(q * 11.0);
  float detail = 1.0 + (g0 - 0.5) * 0.55 * w0 + (g1 - 0.5) * 0.45 * w1 + (g2 - 0.5) * 0.3 * w2 + (g3 - 0.5) * 0.24 * w3;
  diffuseColor.rgb *= detail;
  tH = ((g2 - 0.5) * 0.25 * w2 + (g3 - 0.5) * 0.12 * w3 + (g1 - 0.5) * 0.3 * w1);
}`
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
normal = bumpNormal(-vViewPosition, normal, tH, faceDirection);`
        );
    };
    mat.customProgramCacheKey = () => 'terrain-v1';
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.group.add(mesh);

    // ── 湖
    this.waterNormal = waterNormalTexture();
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x0b2a35,
      roughness: 0.045,
      metalness: 0.1,
      normalMap: this.waterNormal,
      normalScale: new THREE.Vector2(0.55, 0.55),
      transparent: true,
      opacity: 0.93,
      envMapIntensity: 1.6,
    });
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(LAKE.r * 5, LAKE.r * 5), waterMat);
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set(LAKE.x, WATER_Y, LAKE.z);
    this.water.frustumCulled = false;
    this.group.add(this.water);

    this.addForest(forestDensity);
  }

  /** 遠景の森: 広葉樹と針葉樹をインスタンスで */
  private addForest(density: number) {
    const rng = createRng(60061);
    const trunk = (h: number) => {
      const g = new THREE.CylinderGeometry(0.28, 0.42, h, 6);
      g.translate(0, h / 2, 0);
      return g;
    };
    const paint = (g: THREE.BufferGeometry, r: number, gr: number, b: number) => {
      const ng = g.index ? g.toNonIndexed() : g;
      ng.deleteAttribute('uv');
      const cnt = ng.getAttribute('position').count;
      const c = new Float32Array(cnt * 3);
      for (let i = 0; i < cnt; i++) {
        const py = ng.getAttribute('position').getY(i);
        const f = 0.6 + Math.min(1, Math.max(0, py / 9)) * 0.55;
        c[i * 3] = r * f;
        c[i * 3 + 1] = gr * f;
        c[i * 3 + 2] = b * f;
      }
      ng.setAttribute('color', new THREE.BufferAttribute(c, 3));
      return ng;
    };
    const blob = (r: number, x: number, y: number, z: number) => {
      let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(r, 1);
      g.deleteAttribute('uv');
      g.deleteAttribute('normal');
      g = mergeVertices(g, 1e-3);
      const p = g.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        const k =
          0.85 +
          0.3 * ihash(Math.round(p.getX(i) * 40), Math.round(p.getZ(i) * 40 + p.getY(i) * 17));
        p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.85, p.getZ(i) * k);
      }
      g.computeVertexNormals();
      g.translate(x, y, z);
      return g;
    };
    const broad = mergeGeometries(
      [
        paint(trunk(3.4), 0.22, 0.16, 0.1),
        paint(blob(2.5, 0, 5.2, 0), 0.1, 0.2, 0.065),
        paint(blob(1.9, 1.3, 4.4, 0.5), 0.12, 0.22, 0.07),
        paint(blob(1.8, -1.2, 4.6, -0.7), 0.09, 0.18, 0.06),
      ].map((g) => (g.index ? g.toNonIndexed() : g)),
      false
    );
    const cone = (r: number, h: number, y: number) => {
      const g = new THREE.ConeGeometry(r, h, 9, 1);
      g.translate(0, y + h / 2, 0);
      return g;
    };
    const conifer = mergeGeometries(
      [
        paint(trunk(2.2), 0.2, 0.14, 0.09),
        paint(cone(2.6, 4.6, 1.8), 0.07, 0.19, 0.1),
        paint(cone(2.0, 4.0, 4.4), 0.08, 0.21, 0.11),
        paint(cone(1.3, 3.4, 7.2), 0.09, 0.23, 0.12),
      ].map((g) => (g.index ? g.toNonIndexed() : g)),
      false
    );
    const mk = (geo: THREE.BufferGeometry, cap: number) => {
      const m = new THREE.InstancedMesh(
        geo,
        swayify(
          new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }),
          0.03
        ),
        cap
      );
      m.frustumCulled = false;
      m.castShadow = false;
      m.receiveShadow = false;
      this.group.add(m);
      return m;
    };
    const cap = Math.floor(4200 * density);
    const broadMesh = mk(broad, cap);
    const coniferMesh = mk(conifer, cap);
    let nb = 0;
    let nc = 0;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const col = new THREE.Color();
    for (let tries = 0; tries < cap * 14 && nb < cap && nc < cap; tries++) {
      const a = rng.next() * Math.PI * 2;
      const rr = 250 + Math.pow(rng.next(), 1.35) * 2300;
      const x = Math.cos(a) * rr;
      const z = Math.sin(a) * rr;
      if (Math.max(Math.abs(x), Math.abs(z)) < 250) continue;
      const h = terrainHeight(x, z);
      if (h < 0.6 || h > 230) continue;
      const patch = fbm(x / 160, z / 160, 4);
      if (patch < 0.45 || rng.next() > (patch - 0.4) * 6) continue;
      const ld = Math.hypot(x - LAKE.x, z - LAKE.z);
      if (ld < LAKE.r * 1.05) continue;
      const hi = h > 40 || rng.next() < 0.35;
      const sc = (hi ? 1.2 : 1.0) * (0.8 + rng.next() * 1.0) * (rr > 900 ? 1.4 : 1);
      p.set(x, h - 0.2, z);
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rng.next() * 6.28);
      s.set(sc * (0.85 + rng.next() * 0.3), sc, sc * (0.85 + rng.next() * 0.3));
      m4.compose(p, q, s);
      const t = 0.8 + rng.next() * 0.35;
      col.setRGB(t, t * (0.95 + rng.next() * 0.1), t * 0.95);
      if (hi && nc < cap) {
        coniferMesh.setMatrixAt(nc, m4);
        coniferMesh.setColorAt(nc, col);
        nc++;
      } else if (nb < cap) {
        broadMesh.setMatrixAt(nb, m4);
        broadMesh.setColorAt(nb, col);
        nb++;
      }
    }
    broadMesh.count = nb;
    coniferMesh.count = nc;
    for (const m of [broadMesh, coniferMesh]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  update(time: number) {
    // 水面の細かい波: 2 方向のうねりを法線マップのスクロールで
    this.waterNormal.offset.set(time * 0.006, time * 0.0035);
  }
}

/** 水面の法線マップ（繰り返せるノイズから生成） */
function waterNormalTexture(): THREE.CanvasTexture {
  const n = 256;
  const h = new Float32Array(n * n);
  const waves: [number, number, number, number][] = [];
  const rng = createRng(555);
  for (let i = 0; i < 14; i++) {
    const a = rng.next() * Math.PI * 2;
    const k = Math.round(rng.range(2, 14));
    waves.push([Math.cos(a) * k, Math.sin(a) * k, rng.range(0.4, 1) / k, rng.next() * 6.28]);
  }
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let v = 0;
      for (const [kx, ky, amp, ph] of waves)
        v += Math.sin(((x * kx + y * ky) / n) * Math.PI * 2 + ph) * amp;
      h[y * n + x] = v;
    }
  }
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (h[y * n + ((x + 1) % n)] as number) - (h[y * n + ((x + n - 1) % n)] as number);
      const dy = (h[((y + 1) % n) * n + x] as number) - (h[((y + n - 1) % n) * n + x] as number);
      const l = Math.hypot(dx * 3, dy * 3, 1);
      const o = (y * n + x) * 4;
      img.data[o] = Math.round(((-dx * 3) / l) * 127.5 + 127.5);
      img.data[o + 1] = Math.round(((-dy * 3) / l) * 127.5 + 127.5);
      img.data[o + 2] = Math.round((1 / l) * 127.5 + 127.5);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(160, 160);
  t.anisotropy = 8;
  return t;
}
