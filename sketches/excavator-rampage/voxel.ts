import { GRID_N, GRID_Y } from './config';
import type { BuildingSpec, FacadeStyle } from './layout';

/** セルの種類: 0 外壁（窓つき）/ 1 コンクリート（床スラブ・屋根） */
export const KIND_WALL = 0;
export const KIND_SLAB = 1;

export interface BuildingRange {
  spec: BuildingSpec;
  /** このビルのセル id は [start, start + count) */
  start: number;
  count: number;
  alive: number;
  /** 層ごとの初期セル数 / 現在のセル数 */
  layerTotal: Uint16Array;
  layerAlive: Uint16Array;
  /** 崩壊チェック待ちフラグ */
  dirty: boolean;
  collapsed: boolean;
}

/**
 * 街全体のボクセル占有グリッドと、セルごとの属性。
 * three には依存しない（テスト可能にするため）。
 */
export class VoxelWorld {
  readonly ids = new Int32Array(GRID_N * GRID_Y * GRID_N).fill(-1);
  readonly buildings: BuildingRange[] = [];
  count = 0;
  ix: Int16Array;
  iy: Int16Array;
  iz: Int16Array;
  kind: Uint8Array;
  bld: Uint16Array;
  alive: Uint8Array;
  private stamp: Uint32Array;
  private stampNo = 0;

  constructor(specs: BuildingSpec[]) {
    // 先にセル総数を数えてから配列を確保する
    let total = 0;
    for (const s of specs) total += countCells(s);
    this.ix = new Int16Array(total);
    this.iy = new Int16Array(total);
    this.iz = new Int16Array(total);
    this.kind = new Uint8Array(total);
    this.bld = new Uint16Array(total);
    this.alive = new Uint8Array(total);
    this.stamp = new Uint32Array(total);
    specs.forEach((s, bi) => this.addBuilding(s, bi));
  }

  static index(ix: number, iy: number, iz: number): number {
    return (iy * GRID_N + iz) * GRID_N + ix;
  }

  static inBounds(ix: number, iy: number, iz: number): boolean {
    return ix >= 0 && iz >= 0 && iy >= 0 && ix < GRID_N && iz < GRID_N && iy < GRID_Y;
  }

  idAt(ix: number, iy: number, iz: number): number {
    if (!VoxelWorld.inBounds(ix, iy, iz)) return -1;
    return this.ids[VoxelWorld.index(ix, iy, iz)] as number;
  }

  private addBuilding(s: BuildingSpec, bi: number) {
    const start = this.count;
    const layerTotal = new Uint16Array(s.layers + 1);
    for (let y = 0; y <= s.layers; y++) {
      for (let z = 0; z < s.d; z++) {
        for (let x = 0; x < s.w; x++) {
          const k = cellKind(s, x, y, z);
          if (k < 0) continue;
          const id = this.count++;
          const gx = s.x0 + x;
          const gz = s.z0 + z;
          this.ix[id] = gx;
          this.iy[id] = y;
          this.iz[id] = gz;
          this.kind[id] = k;
          this.bld[id] = bi;
          this.alive[id] = 1;
          this.ids[VoxelWorld.index(gx, y, gz)] = id;
          layerTotal[y] = (layerTotal[y] as number) + 1;
        }
      }
    }
    this.buildings.push({
      spec: s,
      start,
      count: this.count - start,
      alive: this.count - start,
      layerTotal,
      layerAlive: layerTotal.slice(),
      dirty: false,
      collapsed: false,
    });
  }

  /** セルを取り除く。すでに無ければ false */
  remove(id: number): boolean {
    if (!this.alive[id]) return false;
    this.alive[id] = 0;
    this.ids[
      VoxelWorld.index(this.ix[id] as number, this.iy[id] as number, this.iz[id] as number)
    ] = -1;
    const b = this.buildings[this.bld[id] as number] as BuildingRange;
    b.alive--;
    const layer = this.iy[id] as number;
    b.layerAlive[layer] = (b.layerAlive[layer] as number) - 1;
    b.dirty = true;
    return true;
  }

  /**
   * 支えを失ったセル id を返す（取り除きはしない）。
   * 1) ある層の残りが 34% を切ったら、その層より上はすべて落ちる（階が潰れる）
   * 2) 1 階の層から 6 近傍でつながっていないセルは落ちる
   */
  findUnsupported(bi: number): number[] {
    const b = this.buildings[bi] as BuildingRange;
    b.dirty = false;
    const out: number[] = [];
    if (b.alive === 0) return out;

    let weak = -1;
    for (let y = 1; y < b.layerTotal.length; y++) {
      const total = b.layerTotal[y] as number;
      if (total > 0 && (b.layerAlive[y] as number) < total * 0.34) {
        weak = y;
        break;
      }
    }
    const end = b.start + b.count;
    if (weak >= 0) {
      for (let id = b.start; id < end; id++) {
        if (this.alive[id] && (this.iy[id] as number) >= weak) out.push(id);
      }
    }

    // 1 階の層から幅優先で到達できるセルが「支えられている」
    const stamp = ++this.stampNo;
    const queue: number[] = [];
    for (let id = b.start; id < end; id++) {
      if (this.alive[id] && this.iy[id] === 0) {
        this.stamp[id] = stamp;
        queue.push(id);
      }
    }
    // 落下確定のセルは経路として使わない
    const dropping = new Set(out);
    for (let head = 0; head < queue.length; head++) {
      const id = queue[head] as number;
      const x = this.ix[id] as number;
      const y = this.iy[id] as number;
      const z = this.iz[id] as number;
      for (let n = 0; n < 6; n++) {
        const nx = x + (n === 0 ? 1 : n === 1 ? -1 : 0);
        const ny = y + (n === 2 ? 1 : n === 3 ? -1 : 0);
        const nz = z + (n === 4 ? 1 : n === 5 ? -1 : 0);
        const nid = this.idAt(nx, ny, nz);
        if (nid < b.start || nid >= end || this.stamp[nid] === stamp || dropping.has(nid)) continue;
        this.stamp[nid] = stamp;
        queue.push(nid);
      }
    }
    for (let id = b.start; id < end; id++) {
      if (this.alive[id] && this.stamp[id] !== stamp && !dropping.has(id)) out.push(id);
    }
    return out;
  }
}

/** セル (x,y,z) はビル内ローカル座標。-1 ならセルなし */
function cellKind(s: BuildingSpec, x: number, y: number, z: number): number {
  if (y === s.layers) return KIND_SLAB; // 屋根スラブ
  const perimeter = x === 0 || z === 0 || x === s.w - 1 || z === s.d - 1;
  if (perimeter) return KIND_WALL;
  // 各階の床スラブ（偶数層）。奇数層の内部は空洞
  if (y % 2 === 0) return KIND_SLAB;
  return -1;
}

function countCells(s: BuildingSpec): number {
  let n = 0;
  for (let y = 0; y <= s.layers; y++)
    for (let z = 0; z < s.d; z++) for (let x = 0; x < s.w; x++) if (cellKind(s, x, y, z) >= 0) n++;
  return n;
}

export type { FacadeStyle };
