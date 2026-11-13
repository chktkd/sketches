import * as THREE from 'three';
import { BLOCKS, BLOCK_CELLS, CELL, HALF, PITCH, ROAD_CELLS, WORLD_SIZE } from './config';
import type { CityLayout } from './layout';
import { createRng } from './rng';

export const GROUND_MARGIN = 24;
export const GROUND_EXTENT = WORLD_SIZE + GROUND_MARGIN * 2;

const rand = createRng(77);

/** ノイズつきの塗り。単色ベタ塗りだと CG っぽくなるので、粒を散らす */
function speckle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  n: number,
  light: boolean
) {
  for (let i = 0; i < n; i++) {
    const a = rand.range(0.03, 0.14);
    ctx.fillStyle = light ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a * 1.4})`;
    const s = rand.range(0.6, 2.4);
    ctx.fillRect(x + rand.next() * w, y + rand.next() * h, s, s);
  }
}

export interface GroundTextures {
  map: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
}

/** 道路・歩道・区画の舗装を描いた地面のベース画像 */
export function paintGround(layout: CityLayout, size = 4096): GroundTextures {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const ppm = size / GROUND_EXTENT;
  const X = (m: number) => (m + GROUND_EXTENT / 2) * ppm;
  const cellM = (cell: number) => cell * CELL - HALF;

  // 外周: 土と草
  ctx.fillStyle = '#4b5640';
  ctx.fillRect(0, 0, size, size);
  speckle(ctx, 0, 0, size, size, 90000, false);
  speckle(ctx, 0, 0, size, size, 60000, true);

  // 街全体の下地（コンクリート）
  const cityPx = X(-HALF);
  const citySz = WORLD_SIZE * ppm;
  ctx.fillStyle = '#6f6e6a';
  ctx.fillRect(cityPx, cityPx, citySz, citySz);

  // 道路。外周へ少し伸ばす
  const roadFill = ctx.createLinearGradient(0, 0, size, size);
  roadFill.addColorStop(0, '#2c2d30');
  roadFill.addColorStop(1, '#303135');
  ctx.fillStyle = roadFill;
  for (let i = 0; i <= BLOCKS; i++) {
    const m0 = cellM(i * PITCH);
    const w = ROAD_CELLS * CELL;
    ctx.fillRect(X(m0), X(-GROUND_EXTENT / 2), w * ppm, size);
    ctx.fillRect(X(-GROUND_EXTENT / 2), X(m0), size, w * ppm);
  }

  // 歩道: ブロックの外周に 2.4m 幅
  const sw = 2.4;
  for (let bx = 0; bx < BLOCKS; bx++) {
    for (let bz = 0; bz < BLOCKS; bz++) {
      const x0 = cellM(ROAD_CELLS + bx * PITCH);
      const z0 = cellM(ROAD_CELLS + bz * PITCH);
      const s = BLOCK_CELLS * CELL;
      ctx.fillStyle = '#9b9a94';
      ctx.fillRect(X(x0), X(z0), s * ppm, s * ppm);
      // 縁石
      ctx.strokeStyle = '#c9c8c2';
      ctx.lineWidth = 0.22 * ppm;
      ctx.strokeRect(
        X(x0) + 0.11 * ppm,
        X(z0) + 0.11 * ppm,
        s * ppm - 0.22 * ppm,
        s * ppm - 0.22 * ppm
      );
      // 歩道の内側（区画）
      ctx.fillStyle = '#6d6b64';
      ctx.fillRect(X(x0 + sw), X(z0 + sw), (s - sw * 2) * ppm, (s - sw * 2) * ppm);
      // 歩道タイルの目地
      ctx.strokeStyle = 'rgba(0,0,0,0.13)';
      ctx.lineWidth = 0.05 * ppm;
      for (let t = 0; t <= s; t += 1.2) {
        for (const edge of [0, s - sw]) {
          ctx.beginPath();
          ctx.moveTo(X(x0 + t), X(z0 + edge));
          ctx.lineTo(X(x0 + t), X(z0 + edge + sw));
          ctx.moveTo(X(x0 + edge), X(z0 + t));
          ctx.lineTo(X(x0 + edge + sw), X(z0 + t));
          ctx.stroke();
        }
      }
    }
  }

  // 区画ごとの地面: ビルの足元・広場・公園
  for (const lot of layout.lots) {
    const x = X(cellM(lot.x0));
    const z = X(cellM(lot.z0));
    const w = lot.w * CELL * ppm;
    const d = lot.d * CELL * ppm;
    if (lot.kind === 'park') {
      const g = ctx.createLinearGradient(x, z, x + w, z + d);
      g.addColorStop(0, '#46613a');
      g.addColorStop(1, '#3e5733');
      ctx.fillStyle = g;
      ctx.fillRect(x + 2.4 * ppm, z + 2.4 * ppm, w - 4.8 * ppm, d - 4.8 * ppm);
      speckle(ctx, x, z, w, d, 14000, true);
      speckle(ctx, x, z, w, d, 14000, false);
      // 園路
      ctx.strokeStyle = '#a79f8a';
      ctx.lineWidth = 2.4 * ppm;
      ctx.beginPath();
      ctx.moveTo(x + 2.4 * ppm, z + d / 2);
      ctx.lineTo(x + w - 2.4 * ppm, z + d / 2);
      ctx.moveTo(x + w / 2, z + 2.4 * ppm);
      ctx.lineTo(x + w / 2, z + d - 2.4 * ppm);
      ctx.stroke();
    } else if (lot.kind === 'plaza') {
      ctx.fillStyle = '#85827a';
      ctx.fillRect(x + 2.4 * ppm, z + 2.4 * ppm, w - 4.8 * ppm, d - 4.8 * ppm);
      ctx.strokeStyle = 'rgba(0,0,0,0.16)';
      ctx.lineWidth = 0.06 * ppm;
      for (let t = 2.4; t < lot.w * CELL - 2.4; t += 2.4) {
        ctx.beginPath();
        ctx.moveTo(x + t * ppm, z + 2.4 * ppm);
        ctx.lineTo(x + t * ppm, z + d - 2.4 * ppm);
        ctx.stroke();
      }
      for (let t = 2.4; t < lot.d * CELL - 2.4; t += 2.4) {
        ctx.beginPath();
        ctx.moveTo(x + 2.4 * ppm, z + t * ppm);
        ctx.lineTo(x + w - 2.4 * ppm, z + t * ppm);
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = '#5b5952';
      ctx.fillRect(x, z, w, d);
    }
  }

  // 路面標示
  const roadW = ROAD_CELLS * CELL;
  const dash = (x1: number, y1: number, x2: number, y2: number, on: number, off: number) => {
    ctx.setLineDash([on * ppm, off * ppm]);
    ctx.beginPath();
    ctx.moveTo(X(x1), X(y1));
    ctx.lineTo(X(x2), X(y2));
    ctx.stroke();
    ctx.setLineDash([]);
  };
  const ext = GROUND_EXTENT / 2;
  for (let i = 0; i <= BLOCKS; i++) {
    const m0 = cellM(i * PITCH);
    const mid = m0 + roadW / 2;
    // 中央線（二重の黄色）。交差点の中は途切れさせる
    ctx.strokeStyle = '#d9b43a';
    ctx.lineWidth = 0.16 * ppm;
    for (const off of [-0.22, 0.22]) {
      for (let j = -1; j <= BLOCKS; j++) {
        const a = j < 0 ? -ext : cellM(j * PITCH + ROAD_CELLS) + 6;
        const b = j >= BLOCKS ? ext : cellM((j + 1) * PITCH) - 6;
        dash(a, mid + off, b, mid + off, 99999, 0);
        dash(mid + off, a, mid + off, b, 99999, 0);
      }
    }
    // 車線境界の白破線
    ctx.strokeStyle = 'rgba(235,235,230,0.85)';
    ctx.lineWidth = 0.14 * ppm;
    for (const off of [-roadW / 4, roadW / 4]) {
      for (let j = -1; j <= BLOCKS; j++) {
        const a = j < 0 ? -ext : cellM(j * PITCH + ROAD_CELLS) + 9;
        const b = j >= BLOCKS ? ext : cellM((j + 1) * PITCH) - 9;
        dash(a, mid + off, b, mid + off, 3, 5);
        dash(mid + off, a, mid + off, b, 3, 5);
      }
    }
    // 路面の轍（走行跡）
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 0.9 * ppm;
    for (const off of [-roadW / 4 - 0.9, -roadW / 4 + 0.9, roadW / 4 - 0.9, roadW / 4 + 0.9]) {
      ctx.beginPath();
      ctx.moveTo(X(-ext), X(mid + off));
      ctx.lineTo(X(ext), X(mid + off));
      ctx.moveTo(X(mid + off), X(-ext));
      ctx.lineTo(X(mid + off), X(ext));
      ctx.stroke();
    }
  }
  // 横断歩道（交差点の各辺）と停止線
  ctx.fillStyle = 'rgba(236,236,230,0.92)';
  for (let i = 0; i <= BLOCKS; i++) {
    for (let j = 0; j <= BLOCKS; j++) {
      const ix0 = cellM(i * PITCH);
      const iz0 = cellM(j * PITCH);
      for (let k = 0; k < 14; k++) {
        const o = 0.9 + (k * (roadW - 1.8)) / 14;
        const sx = 0.55 * (roadW / 14);
        // 北辺・南辺
        ctx.fillRect(X(ix0 + o), X(iz0 - 3.4), sx * ppm, 2.6 * ppm);
        ctx.fillRect(X(ix0 + o), X(iz0 + roadW + 0.8), sx * ppm, 2.6 * ppm);
        // 西辺・東辺
        ctx.fillRect(X(ix0 - 3.4), X(iz0 + o), 2.6 * ppm, sx * ppm);
        ctx.fillRect(X(ix0 + roadW + 0.8), X(iz0 + o), 2.6 * ppm, sx * ppm);
      }
    }
  }

  // 全体に汚れ・タイヤ痕を薄く散らす
  speckle(ctx, 0, 0, size, size, 220000, false);
  speckle(ctx, 0, 0, size, size, 120000, true);
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(20,18,14,${rand.range(0.03, 0.09)})`;
    const r = rand.range(2, 9) * ppm;
    ctx.beginPath();
    ctx.ellipse(
      rand.next() * size,
      rand.next() * size,
      r * rand.range(1, 3),
      r,
      rand.next() * 3,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }

  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 16;
  map.generateMipmaps = true;
  map.minFilter = THREE.LinearMipmapLinearFilter;

  // 細かい凹凸: タイリングするノイズ
  const n = 512;
  const bc = document.createElement('canvas');
  bc.width = bc.height = n;
  const bctx = bc.getContext('2d')!;
  const img = bctx.createImageData(n, n);
  for (let i = 0; i < n * n; i++) {
    const v = 110 + Math.floor(rand.next() * 70);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  bctx.putImageData(img, 0, 0);
  bctx.filter = 'blur(0.8px)';
  bctx.drawImage(bc, 0, 0);
  const bump = new THREE.CanvasTexture(bc);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  bump.repeat.set(GROUND_EXTENT / 5, GROUND_EXTENT / 5);
  bump.anisotropy = 8;
  return { map, bump };
}

/**
 * 瓦礫の粉塵・キャタピラ跡・潰れた草などを動的に描き足す透明レイヤー。
 * 地面の上に薄く重ね、ライティング・影の影響を受ける。
 */
export class GroundDecals {
  readonly texture: THREE.CanvasTexture;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly canvas: HTMLCanvasElement;
  private readonly ppm: number;
  private dirty = false;
  private since = 0;

  constructor(size = 2048) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d')!;
    this.ppm = size / GROUND_EXTENT;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
  }

  private px(m: number) {
    return (m + GROUND_EXTENT / 2) * this.ppm;
  }

  /** 瓦礫の粉じんが降り積もった跡 */
  rubble(x: number, z: number, radius: number, alpha = 0.5) {
    const ctx = this.ctx;
    const g = ctx.createRadialGradient(
      this.px(x),
      this.px(z),
      0,
      this.px(x),
      this.px(z),
      radius * this.ppm
    );
    g.addColorStop(0, `rgba(84,76,66,${alpha})`);
    g.addColorStop(0.6, `rgba(92,84,74,${alpha * 0.55})`);
    g.addColorStop(1, 'rgba(92,84,74,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(this.px(x), this.px(z), radius * this.ppm, 0, Math.PI * 2);
    ctx.fill();
    this.dirty = true;
  }

  /** 履帯の跡。heading は +X 向きを 0 とする three の rotation.y */
  tread(x: number, z: number, heading: number, gauge: number, width: number, length: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(this.px(x), this.px(z));
    // three の rotation.y = h で +X は (cos h, -sin h) へ向く。キャンバスの y は +Z
    ctx.rotate(-heading);
    ctx.fillStyle = 'rgba(28,24,20,0.22)';
    for (const s of [-1, 1]) {
      ctx.fillRect(
        (-length / 2) * this.ppm,
        (s * gauge - width / 2) * this.ppm,
        length * this.ppm,
        width * this.ppm
      );
    }
    ctx.restore();
    this.dirty = true;
  }

  /** 一定間隔でテクスチャをアップロードする（毎フレームの転送を避ける） */
  flush(dt: number) {
    this.since += dt;
    if (!this.dirty || this.since < 0.12) return;
    this.since = 0;
    this.dirty = false;
    this.texture.needsUpdate = true;
  }
}
