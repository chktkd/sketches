import * as THREE from 'three';
import { CELL, cellX, cellY, cellZ } from './config';
import type { BuildingSpec } from './layout';
import { createRng } from './rng';
import type { VoxelWorld } from './voxel';

interface Style {
  bg: string;
  fg: string;
  edge: string;
  text: string;
}

const STYLES: Style[] = [
  { bg: '#b3141a', fg: '#ffffff', edge: '#ffd24a', text: 'ラーメン' },
  { bg: '#111418', fg: '#ffe34d', edge: '#ff3d7f', text: '居酒屋' },
  { bg: '#f4f4ef', fg: '#1559b8', edge: '#1559b8', text: '薬局' },
  { bg: '#1a4a9e', fg: '#ffffff', edge: '#7fd0ff', text: 'カラオケ' },
  { bg: '#0f6b3c', fg: '#fff6c9', edge: '#d6f55a', text: '焼肉' },
  { bg: '#1b1220', fg: '#ff5fd0', edge: '#39e1ff', text: 'ホテル' },
  { bg: '#f2b300', fg: '#17191b', edge: '#17191b', text: 'クリニック' },
  { bg: '#2a0f14', fg: '#ff9a3c', edge: '#ffcf6b', text: '麻雀' },
];

/** 縦長の看板を 8 種、1 枚のアトラスに描く（文字は縦書き） */
function atlas(): THREE.CanvasTexture {
  const cw = 256;
  const ch = 1024;
  const c = document.createElement('canvas');
  c.width = cw * STYLES.length;
  c.height = ch;
  const ctx = c.getContext('2d')!;
  STYLES.forEach((s, i) => {
    const x0 = i * cw;
    ctx.fillStyle = s.bg;
    ctx.fillRect(x0, 0, cw, ch);
    ctx.strokeStyle = s.edge;
    ctx.lineWidth = 12;
    ctx.strokeRect(x0 + 14, 14, cw - 28, ch - 28);
    ctx.lineWidth = 3;
    ctx.strokeRect(x0 + 32, 32, cw - 64, ch - 64);
    const chars = [...s.text];
    const size = Math.min(170, (ch - 160) / chars.length);
    ctx.font = `900 ${size}px "Noto Sans JP", "Hiragino Sans", "Yu Gothic", "WenQuanYi Zen Hei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = s.fg;
    ctx.shadowBlur = 18;
    ctx.fillStyle = s.fg;
    chars.forEach((ch2, k) =>
      ctx.fillText(ch2, x0 + cw / 2, 90 + size * (k + 0.5) + (ch - 180 - size * chars.length) / 2)
    );
    ctx.shadowBlur = 0;
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

interface Sign {
  cell: number;
  idx: number;
  matrix: THREE.Matrix4;
  gone: boolean;
}

/**
 * 外壁から突き出た縦長の看板。夕方から夜は自発光して街を彩り、
 * 取り付けた壁のセルが壊れると、看板も破片になって落ちる。
 */
export class SignBoards {
  readonly mesh: THREE.InstancedMesh;
  private readonly signs: Sign[] = [];
  private readonly material: THREE.MeshStandardMaterial;
  private dirty = false;

  constructor(buildings: BuildingSpec[], voxels: VoxelWorld) {
    const rng = createRng(777);
    const tex = atlas();
    this.material = new THREE.MeshStandardMaterial({
      map: tex,
      emissiveMap: tex,
      emissive: new THREE.Color(1, 1, 1),
      emissiveIntensity: 0.3,
      side: THREE.DoubleSide,
      roughness: 0.55,
      metalness: 0.15,
    });
    const rects: number[] = [];
    const specs: { cell: number; m: THREE.Matrix4; rect: [number, number] }[] = [];
    const W = 1.15;
    const H = 4.6;
    const dirs: [number, number][] = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const b of buildings) {
      if (b.floors < 3) continue;
      const n = b.floors >= 6 ? rng.int(1, 3) : rng.int(0, 1);
      for (let k = 0; k < n; k++) {
        const [ox, oz] = rng.pick(dirs);
        // 看板を付ける側の壁の、角を避けた位置
        let lx: number;
        let lz: number;
        if (ox !== 0) {
          lx = ox > 0 ? b.w - 1 : 0;
          lz = rng.int(1, Math.max(1, b.d - 2));
        } else {
          lz = oz > 0 ? b.d - 1 : 0;
          lx = rng.int(1, Math.max(1, b.w - 2));
        }
        const iy = rng.int(3, Math.max(3, b.layers - 4));
        const cell = voxels.idAt(b.x0 + lx, iy, b.z0 + lz);
        if (cell < 0) continue;
        const cx = cellX(b.x0 + lx);
        const cz = cellZ(b.z0 + lz);
        const off = CELL / 2 + W / 2 + 0.12;
        const pos = new THREE.Vector3(cx + ox * off, cellY(iy), cz + oz * off);
        const q = new THREE.Quaternion().setFromAxisAngle(
          THREE.Object3D.DEFAULT_UP,
          Math.atan2(-oz, ox)
        );
        specs.push({
          cell,
          m: new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1)),
          rect: [Math.floor(rng.next() * STYLES.length), 0],
        });
      }
    }
    const geo = new THREE.PlaneGeometry(W, H);
    this.mesh = new THREE.InstancedMesh(geo, this.material, Math.max(1, specs.length));
    this.mesh.count = specs.length;
    specs.forEach((s, i) => {
      this.mesh.setMatrixAt(i, s.m);
      const u0 = s.rect[0] / STYLES.length;
      rects.push(u0, 0, 1 / STYLES.length, 1);
      this.signs.push({ cell: s.cell, idx: i, matrix: s.m, gone: false });
    });
    geo.setAttribute(
      'aRect',
      new THREE.InstancedBufferAttribute(new Float32Array(rects.length ? rects : [0, 0, 1, 1]), 4)
    );
    this.material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aRect;')
        .replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>
#ifdef USE_MAP
  vMapUv = aRect.xy + vMapUv * aRect.zw;
#endif
#ifdef USE_EMISSIVEMAP
  vEmissiveMapUv = aRect.xy + vEmissiveMapUv * aRect.zw;
#endif`
        );
    };
    this.material.customProgramCacheKey = () => 'signboard-v1';
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
  }

  /** 夜ほど明るく。昼でも少し光らせる */
  setLevel(level: number) {
    this.material.emissiveIntensity = 0.3 + level * 1.4;
  }

  /** 取り付けたセルが壊れた看板を落とす。落ちた看板の位置を onBreak に渡す */
  update(voxels: VoxelWorld, onBreak: (m: THREE.Matrix4) => void) {
    for (const s of this.signs) {
      if (s.gone || voxels.alive[s.cell]) continue;
      s.gone = true;
      (this.mesh.instanceMatrix.array as Float32Array).fill(0, s.idx * 16, s.idx * 16 + 16);
      this.dirty = true;
      onBreak(s.matrix);
    }
    if (this.dirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.dirty = false;
    }
  }
}
