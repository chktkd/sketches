import * as THREE from 'three';
import { CELL, GRID_N, GRID_Y, toCellX, toCellY, toCellZ } from './config';
import type { VoxelWorld } from './voxel';

export const GRAVITY = 17;

/**
 * 積もった瓦礫の高さマップ（1 セル = 1.5m 四方）。
 * 眠った破片が体積ぶんを足し、起こされたら引く。落ちてくる破片はこの高さの上に積み重なる。
 */
export class RubbleMap {
  readonly h = new Float32Array(GRID_N * GRID_N);

  private idx(x: number, z: number): number {
    const ix = toCellX(x);
    const iz = toCellZ(z);
    if (ix < 0 || iz < 0 || ix >= GRID_N || iz >= GRID_N) return -1;
    return iz * GRID_N + ix;
  }

  height(x: number, z: number): number {
    const i = this.idx(x, z);
    return i < 0 ? 0 : (this.h[i] as number);
  }

  add(x: number, z: number, amount: number) {
    const i = this.idx(x, z);
    if (i < 0) return;
    this.h[i] = Math.max(0, Math.min(11, (this.h[i] as number) + amount));
  }
}

export interface ImpactEvent {
  x: number;
  y: number;
  z: number;
  /** 衝突の速さ m/s */
  speed: number;
  /** 破片の大きさ（セルなら CELL） */
  size: number;
}

export interface DebrisSpawn {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** 回転速度 */
  wx: number;
  wy: number;
  wz: number;
  sx: number;
  sy: number;
  sz: number;
  /** 見た目の元のセルの属性 */
  origin?: [number, number, number];
  info?: [number, number, number, number];
  color?: [number, number, number];
  /** 向きの初期値（省略時は無回転） */
  q?: [number, number, number, number];
}

const tq = new THREE.Quaternion();
const tq2 = new THREE.Quaternion();
const tv = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * 箱形の剛体破片のプール。InstancedMesh 1 つに対応する。
 * 地面・瓦礫・立っているビルのボクセルと衝突し、止まったら眠って計算から外れる。
 */
export class DebrisPool {
  readonly cap: number;
  private px: Float32Array;
  private py: Float32Array;
  private pz: Float32Array;
  private vx: Float32Array;
  private vy: Float32Array;
  private vz: Float32Array;
  private q: Float32Array;
  private w: Float32Array;
  private sx: Float32Array;
  private sy: Float32Array;
  private sz: Float32Array;
  private state: Uint8Array;
  private calm: Float32Array;
  private contrib: Float32Array;
  private grounded: Uint8Array;
  private next = 0;
  private high = 0;
  awake = 0;
  private readonly origin: THREE.InstancedBufferAttribute | null;
  private readonly info: THREE.InstancedBufferAttribute | null;

  constructor(
    readonly mesh: THREE.InstancedMesh,
    private readonly voxels: VoxelWorld,
    private readonly rubble: RubbleMap,
    private readonly onImpact: (e: ImpactEvent) => void,
    private readonly groundOnly = false
  ) {
    const cap = mesh.instanceMatrix.count;
    this.cap = cap;
    this.px = new Float32Array(cap);
    this.py = new Float32Array(cap);
    this.pz = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.vz = new Float32Array(cap);
    this.q = new Float32Array(cap * 4);
    this.w = new Float32Array(cap * 3);
    this.sx = new Float32Array(cap);
    this.sy = new Float32Array(cap);
    this.sz = new Float32Array(cap);
    this.state = new Uint8Array(cap);
    this.calm = new Float32Array(cap);
    this.contrib = new Float32Array(cap);
    this.grounded = new Uint8Array(cap);
    this.origin = (mesh.geometry.getAttribute('aOrigin') as THREE.InstancedBufferAttribute) ?? null;
    this.info = (mesh.geometry.getAttribute('aInfo') as THREE.InstancedBufferAttribute) ?? null;
    mesh.count = 0;
    // 最初は全部ゼロ行列（描画されない）
    (mesh.instanceMatrix.array as Float32Array).fill(0);
  }

  get used(): number {
    return this.high;
  }

  spawn(s: DebrisSpawn): number {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    if (this.state[i] === 2) this.releaseRubble(i);
    if (this.state[i] !== 1) this.awake++;
    this.high = Math.max(this.high, i + 1);
    this.state[i] = 1;
    this.px[i] = s.x;
    this.py[i] = s.y;
    this.pz[i] = s.z;
    this.vx[i] = s.vx;
    this.vy[i] = s.vy;
    this.vz[i] = s.vz;
    const q = s.q ?? [0, 0, 0, 1];
    this.q.set(q, i * 4);
    this.w[i * 3] = s.wx;
    this.w[i * 3 + 1] = s.wy;
    this.w[i * 3 + 2] = s.wz;
    this.sx[i] = s.sx;
    this.sy[i] = s.sy;
    this.sz[i] = s.sz;
    this.calm[i] = 0;
    this.grounded[i] = 0;
    this.contrib[i] = 0;
    if (s.origin && this.origin) this.origin.setXYZ(i, s.origin[0], s.origin[1], s.origin[2]);
    if (s.info && this.info) this.info.setXYZW(i, s.info[0], s.info[1], s.info[2], s.info[3]);
    if (s.color && this.mesh.instanceColor)
      this.mesh.instanceColor.setXYZ(i, s.color[0], s.color[1], s.color[2]);
    this.origin && (this.origin.needsUpdate = true);
    this.info && (this.info.needsUpdate = true);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    return i;
  }

  private releaseRubble(i: number) {
    const c = this.contrib[i] as number;
    if (c > 0) this.rubble.add(this.px[i] as number, this.pz[i] as number, -c);
    this.contrib[i] = 0;
  }

  /** 球の範囲内の破片を弾き飛ばす（ショベルカーが瓦礫を押しのける） */
  kick(cx: number, cy: number, cz: number, r: number, vx: number, vy: number, vz: number) {
    const r2 = r * r;
    for (let i = 0; i < this.high; i++) {
      if (this.state[i] === 0) continue;
      const dx = (this.px[i] as number) - cx;
      const dy = (this.py[i] as number) - cy;
      const dz = (this.pz[i] as number) - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) continue;
      if (this.state[i] === 2) {
        this.releaseRubble(i);
        this.state[i] = 1;
        this.awake++;
      }
      const d = Math.sqrt(d2) + 0.001;
      const k = 1 - d / r;
      this.vx[i] = (this.vx[i] as number) + vx * 0.6 + (dx / d) * 6 * k + (Math.random() - 0.5) * 3;
      this.vy[i] = (this.vy[i] as number) + Math.max(vy * 0.5, 0) + 3 + Math.random() * 4 * k;
      this.vz[i] = (this.vz[i] as number) + vz * 0.6 + (dz / d) * 6 * k + (Math.random() - 0.5) * 3;
      this.w[i * 3] = (this.w[i * 3] as number) + (Math.random() - 0.5) * 5;
      this.w[i * 3 + 2] = (this.w[i * 3 + 2] as number) + (Math.random() - 0.5) * 5;
      this.calm[i] = 0;
      this.grounded[i] = 0;
    }
  }

  private solidAt(x: number, y: number, z: number): boolean {
    return this.voxels.idAt(toCellX(x), toCellY(y), toCellZ(z)) >= 0;
  }

  update(dt: number) {
    if (this.high === 0) return;
    const arr = this.mesh.instanceMatrix.array as Float32Array;
    let any = false;
    let awake = 0;
    const step = Math.min(dt, 1 / 30);
    for (let i = 0; i < this.high; i++) {
      if (this.state[i] !== 1) continue;
      awake++;
      any = true;
      let x = this.px[i] as number;
      let y = this.py[i] as number;
      let z = this.pz[i] as number;
      let vx = this.vx[i] as number;
      let vy = this.vy[i] as number;
      let vz = this.vz[i] as number;
      const sx = this.sx[i] as number;
      const sy = this.sy[i] as number;
      const sz = this.sz[i] as number;
      const probe = Math.max(sx, sy, sz) * 0.32;

      vy -= GRAVITY * step;

      // 立っているビルのセルとの衝突（軸ごと）
      if (!this.groundOnly && y < GRID_Y * CELL) {
        let nx = x + vx * step;
        if (this.solidAt(nx + Math.sign(vx) * probe, y, z)) {
          vx *= -0.28;
          vz *= 0.8;
          nx = x;
        }
        x = nx;
        let nz = z + vz * step;
        if (this.solidAt(x, y, nz + Math.sign(vz) * probe)) {
          vz *= -0.28;
          vx *= 0.8;
          nz = z;
        }
        z = nz;
        let ny = y + vy * step;
        if (vy < 0 && this.solidAt(x, ny - probe, z)) {
          // ビルの屋根・床に乗った: 反発して滑る
          if (vy < -4) this.onImpact({ x, y, z, speed: -vy, size: Math.max(sx, sy, sz) });
          vy *= -0.22;
          vx *= 0.9;
          vz *= 0.9;
          ny = y;
          this.calm[i] = 0;
        } else if (vy > 0 && this.solidAt(x, ny + probe, z)) {
          vy *= -0.2;
          ny = y;
        }
        y = ny;
      } else {
        x += vx * step;
        y += vy * step;
        z += vz * step;
      }

      // 姿勢の積分
      const q = this.q;
      const wx = this.w[i * 3] as number;
      const wy = this.w[i * 3 + 1] as number;
      const wz = this.w[i * 3 + 2] as number;
      let qx = q[i * 4] as number;
      let qy = q[i * 4 + 1] as number;
      let qz = q[i * 4 + 2] as number;
      let qw = q[i * 4 + 3] as number;
      const h = 0.5 * step;
      const dqx = h * (wx * qw + wy * qz - wz * qy);
      const dqy = h * (wy * qw + wz * qx - wx * qz);
      const dqz = h * (wz * qw + wx * qy - wy * qx);
      const dqw = h * (-wx * qx - wy * qy - wz * qz);
      qx += dqx;
      qy += dqy;
      qz += dqz;
      qw += dqw;
      const inv = 1 / Math.hypot(qx, qy, qz, qw);
      qx *= inv;
      qy *= inv;
      qz *= inv;
      qw *= inv;

      // 地面・瓦礫との接触: 回転した箱の下端
      const r10 = 2 * (qx * qy + qw * qz);
      const r11 = 1 - 2 * (qx * qx + qz * qz);
      const r12 = 2 * (qy * qz - qw * qx);
      let ext = 0.5 * (Math.abs(r10) * sx + Math.abs(r11) * sy + Math.abs(r12) * sz);
      const ground = this.rubble.height(x, z);
      let touching = false;
      if (y - ext < ground) {
        const impact = -vy;
        y = ground + ext;
        if (impact > 5)
          this.onImpact({ x, y: ground, z, speed: impact, size: Math.max(sx, sy, sz) });
        vy = impact > 2.5 ? impact * 0.24 : 0;
        const fr = Math.exp(-5 * step);
        vx *= fr;
        vz *= fr;
        let k = Math.exp(-2.5 * step);
        if (impact > 4) {
          // 角が当たって回転が付く
          this.w[i * 3] = wx * 0.5 + (Math.random() - 0.5) * impact * 0.5;
          this.w[i * 3 + 2] = wz * 0.5 + (Math.random() - 0.5) * impact * 0.5;
          k = 1;
        }
        this.w[i * 3] = (this.w[i * 3] as number) * k;
        this.w[i * 3 + 1] = (this.w[i * 3 + 1] as number) * k;
        this.w[i * 3 + 2] = (this.w[i * 3 + 2] as number) * k;
        touching = true;
        this.grounded[i] = 1;
      } else if (y - ext > ground + 0.2) {
        this.grounded[i] = 0;
      }

      // 地面でゆっくりなら、一番近い面が下になるように倒れ込む
      const speed2 = vx * vx + vy * vy + vz * vz;
      if (touching && speed2 < 9) {
        tq.set(qx, qy, qz, qw);
        // 箱のローカル軸のうち、ワールド上向きに一番近いものを探す
        let best = -1;
        let bestDot = 0;
        let ax = 0;
        let ay = 0;
        let az = 0;
        for (let a = 0; a < 3; a++) {
          tv.set(a === 0 ? 1 : 0, a === 1 ? 1 : 0, a === 2 ? 1 : 0).applyQuaternion(tq);
          const d = tv.y;
          if (Math.abs(d) > Math.abs(bestDot)) {
            bestDot = d;
            best = a;
            ax = tv.x;
            ay = tv.y;
            az = tv.z;
          }
        }
        if (best >= 0) {
          tv.set(ax, ay, az).multiplyScalar(Math.sign(bestDot));
          tq2.setFromUnitVectors(tv, UP);
          tq2.slerp(tq.set(0, 0, 0, 1), 1 - Math.min(1, 7 * step));
          tq.set(qx, qy, qz, qw).premultiply(tq2).normalize();
          qx = tq.x;
          qy = tq.y;
          qz = tq.z;
          qw = tq.w;
          const nr10 = 2 * (qx * qy + qw * qz);
          const nr11 = 1 - 2 * (qx * qx + qz * qz);
          const nr12 = 2 * (qy * qz - qw * qx);
          ext = 0.5 * (Math.abs(nr10) * sx + Math.abs(nr11) * sy + Math.abs(nr12) * sz);
          if (y - ext < ground) y = ground + ext;
        }
      }

      // 眠る判定
      const wSpeed2 =
        (this.w[i * 3] as number) ** 2 +
        (this.w[i * 3 + 1] as number) ** 2 +
        (this.w[i * 3 + 2] as number) ** 2;
      if (touching && speed2 < 0.5 && wSpeed2 < 2.5) {
        this.calm[i] = (this.calm[i] as number) + step;
        if ((this.calm[i] as number) > 0.5) {
          this.state[i] = 2;
          this.awake--;
          vx = vy = vz = 0;
          const amount = Math.min(1.1, ((sx * sy * sz) / (CELL * CELL * 1.0)) * 1.0);
          this.contrib[i] = amount;
          this.rubble.add(x, z, amount);
        }
      } else {
        this.calm[i] = 0;
      }

      // 奈落対策
      if (y < -30) {
        this.state[i] = 0;
        this.awake--;
        arr.fill(0, i * 16, i * 16 + 16);
        continue;
      }

      this.px[i] = x;
      this.py[i] = y;
      this.pz[i] = z;
      this.vx[i] = vx;
      this.vy[i] = vy;
      this.vz[i] = vz;
      q[i * 4] = qx;
      q[i * 4 + 1] = qy;
      q[i * 4 + 2] = qz;
      q[i * 4 + 3] = qw;
      writeMatrix(arr, i * 16, x, y, z, qx, qy, qz, qw, sx, sy, sz);
    }
    this.awake = awake;
    this.mesh.count = this.high;
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export function writeMatrix(
  a: Float32Array,
  o: number,
  px: number,
  py: number,
  pz: number,
  qx: number,
  qy: number,
  qz: number,
  qw: number,
  sx: number,
  sy: number,
  sz: number
) {
  const x2 = qx + qx;
  const y2 = qy + qy;
  const z2 = qz + qz;
  const xx = qx * x2;
  const xy = qx * y2;
  const xz = qx * z2;
  const yy = qy * y2;
  const yz = qy * z2;
  const zz = qz * z2;
  const wx = qw * x2;
  const wy = qw * y2;
  const wz = qw * z2;
  a[o] = (1 - (yy + zz)) * sx;
  a[o + 1] = (xy + wz) * sx;
  a[o + 2] = (xz - wy) * sx;
  a[o + 3] = 0;
  a[o + 4] = (xy - wz) * sy;
  a[o + 5] = (1 - (xx + zz)) * sy;
  a[o + 6] = (yz + wx) * sy;
  a[o + 7] = 0;
  a[o + 8] = (xz + wy) * sz;
  a[o + 9] = (yz - wx) * sz;
  a[o + 10] = (1 - (xx + yy)) * sz;
  a[o + 11] = 0;
  a[o + 12] = px;
  a[o + 13] = py;
  a[o + 14] = pz;
  a[o + 15] = 1;
}

/* ───────────────────────── 粉塵・煙 ───────────────────────── */

export interface DustOptions {
  count: number;
  x: number;
  y: number;
  z: number;
  /** 発生位置のばらつき */
  spread: number;
  /** 初速の大きさ */
  speed: number;
  /** 追加の速度（舞い上がり） */
  vx?: number;
  vy?: number;
  vz?: number;
  size: number;
  life: number;
  /** 0..1 の明るさ。0 で黒煙、1 で白い粉塵 */
  tone?: number;
  alpha?: number;
}

function puffTexture(): THREE.CanvasTexture {
  const n = 128;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, n, n);
  // 小さな円を重ねて、ふわっと不規則な塊にする
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2;
    const rr = Math.random() * 0.26 * n;
    const x = n / 2 + Math.cos(a) * rr;
    const y = n / 2 + Math.sin(a) * rr;
    const r = (0.14 + Math.random() * 0.2) * n;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.34)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.14)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, n, n);
  }
  // 周縁を滑らかに消す
  const mask = ctx.createRadialGradient(n / 2, n / 2, n * 0.18, n / 2, n / 2, n * 0.5);
  mask.addColorStop(0, 'rgba(0,0,0,1)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = mask;
  ctx.fillRect(0, 0, n, n);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 粉塵・煙の粒子。CPU で動かし、Points でソフトなスプライトとして描く */
export class DustSystem {
  readonly points: THREE.Points;
  private readonly cap: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private s0: Float32Array;
  private s1: Float32Array;
  private a0: Float32Array;
  private rot: Float32Array;
  private spin: Float32Array;
  private tone: Float32Array;
  private aSize: THREE.BufferAttribute;
  private aAlpha: THREE.BufferAttribute;
  private aRot: THREE.BufferAttribute;
  private aTone: THREE.BufferAttribute;
  private aPos: THREE.BufferAttribute;
  private next = 0;
  private high = 0;
  readonly uniforms = {
    uScale: { value: 800 },
    uTex: { value: puffTexture() },
    uLight: { value: new THREE.Color(1, 1, 1) },
    uAmbient: { value: new THREE.Color(0.3, 0.3, 0.35) },
    uFogColor: { value: new THREE.Color(0xb7c7d6) },
    uFogDensity: { value: 0.002 },
  };

  constructor(cap = 6000) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.age = new Float32Array(cap).fill(1e9);
    this.life = new Float32Array(cap).fill(1);
    this.s0 = new Float32Array(cap);
    this.s1 = new Float32Array(cap);
    this.a0 = new Float32Array(cap);
    this.rot = new Float32Array(cap);
    this.spin = new Float32Array(cap);
    this.tone = new Float32Array(cap);
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3);
    this.aSize = new THREE.BufferAttribute(new Float32Array(cap), 1);
    this.aAlpha = new THREE.BufferAttribute(new Float32Array(cap), 1);
    this.aRot = new THREE.BufferAttribute(new Float32Array(cap), 1);
    this.aTone = new THREE.BufferAttribute(this.tone, 1);
    for (const a of [this.aPos, this.aSize, this.aAlpha, this.aRot, this.aTone])
      a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('aSize', this.aSize);
    geo.setAttribute('aAlpha', this.aAlpha);
    geo.setAttribute('aRot', this.aRot);
    geo.setAttribute('aTone', this.aTone);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute float aSize; attribute float aAlpha; attribute float aRot; attribute float aTone;
        uniform float uScale;
        varying float vAlpha; varying float vRot; varying float vTone; varying float vDepth;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(aSize * uScale / max(-mv.z, 0.1), 0.0, 1400.0);
          vAlpha = aAlpha; vRot = aRot; vTone = aTone; vDepth = -mv.z;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTex; uniform vec3 uLight; uniform vec3 uAmbient;
        uniform vec3 uFogColor; uniform float uFogDensity;
        varying float vAlpha; varying float vRot; varying float vTone; varying float vDepth;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float s = sin(vRot), co = cos(vRot);
          vec2 uv = vec2(c.x * co - c.y * s, c.x * s + c.y * co) + 0.5;
          float a = texture2D(uTex, uv).a * vAlpha;
          if (a < 0.003) discard;
          vec3 base = mix(vec3(0.12, 0.11, 0.1), vec3(0.78, 0.74, 0.68), vTone);
          vec3 col = base * (uLight * 0.62 + uAmbient);
          float f = 1.0 - exp(-uFogDensity * uFogDensity * vDepth * vDepth);
          col = mix(col, uFogColor, f);
          gl_FragColor = vec4(col, a);
        }`,
      fog: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  emit(o: DustOptions) {
    const tone = o.tone ?? 0.8;
    for (let n = 0; n < o.count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % this.cap;
      this.high = Math.max(this.high, i + 1);
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * 0.9 - 0.15;
      const sp = o.speed * (0.3 + Math.random() * 0.7);
      this.pos[i * 3] = o.x + (Math.random() - 0.5) * o.spread;
      this.pos[i * 3 + 1] = o.y + (Math.random() - 0.3) * o.spread * 0.6;
      this.pos[i * 3 + 2] = o.z + (Math.random() - 0.5) * o.spread;
      this.vel[i * 3] = Math.cos(a) * Math.cos(e) * sp + (o.vx ?? 0) * 0.4;
      this.vel[i * 3 + 1] = Math.sin(e) * sp * 0.7 + (o.vy ?? 0) * 0.4 + Math.random() * 1.5;
      this.vel[i * 3 + 2] = Math.sin(a) * Math.cos(e) * sp + (o.vz ?? 0) * 0.4;
      this.age[i] = 0;
      this.life[i] = o.life * (0.6 + Math.random() * 0.8);
      this.s0[i] = o.size * (0.5 + Math.random() * 0.5);
      this.s1[i] = o.size * (1.6 + Math.random() * 1.8);
      this.a0[i] = (o.alpha ?? 0.55) * (0.6 + Math.random() * 0.5);
      this.rot[i] = Math.random() * 6.28;
      this.spin[i] = (Math.random() - 0.5) * 0.9;
      this.tone[i] = Math.min(1, Math.max(0, tone + (Math.random() - 0.5) * 0.25));
    }
  }

  update(dt: number) {
    const size = this.aSize.array as Float32Array;
    const alpha = this.aAlpha.array as Float32Array;
    const rot = this.aRot.array as Float32Array;
    const drag = Math.exp(-1.1 * dt);
    for (let i = 0; i < this.high; i++) {
      const age = (this.age[i] as number) + dt;
      this.age[i] = age;
      const life = this.life[i] as number;
      if (age >= life) {
        alpha[i] = 0;
        continue;
      }
      const t = age / life;
      this.vel[i * 3] = (this.vel[i * 3] as number) * drag;
      this.vel[i * 3 + 1] = (this.vel[i * 3 + 1] as number) * drag + 0.9 * dt;
      this.vel[i * 3 + 2] = (this.vel[i * 3 + 2] as number) * drag;
      this.pos[i * 3] = (this.pos[i * 3] as number) + (this.vel[i * 3] as number) * dt;
      this.pos[i * 3 + 1] = Math.max(
        0.1,
        (this.pos[i * 3 + 1] as number) + (this.vel[i * 3 + 1] as number) * dt
      );
      this.pos[i * 3 + 2] = (this.pos[i * 3 + 2] as number) + (this.vel[i * 3 + 2] as number) * dt;
      const e = 1 - (1 - t) * (1 - t);
      size[i] = (this.s0[i] as number) + ((this.s1[i] as number) - (this.s0[i] as number)) * e;
      const fadeIn = Math.min(1, age / 0.12);
      alpha[i] = (this.a0[i] as number) * fadeIn * (1 - t) * (1 - t * 0.4);
      rot[i] = (this.rot[i] as number) + (this.spin[i] as number) * age;
    }
    this.aPos.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.aAlpha.needsUpdate = true;
    this.aRot.needsUpdate = true;
    this.aTone.needsUpdate = true;
    this.points.geometry.setDrawRange(0, this.high);
  }
}
