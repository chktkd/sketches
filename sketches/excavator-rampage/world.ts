import * as THREE from 'three';
import { CELL, GRID_N, GRID_Y, HALF, WORLD_SIZE, cellX, cellY, cellZ } from './config';
import { DebrisPool, DustSystem, type ImpactEvent, RubbleMap, SparkSystem } from './debris';
import { type FacadeUniforms, createFacadeDepthMaterial, createFacadeMaterial } from './facade';
import { GROUND_EXTENT, GroundDecals, paintGround } from './ground';
import { type CityLayout, generateCity } from './layout';
import { clipRayToSquare } from './ray';
import { Props } from './props';
import { SignBoards } from './signs';
import { createRng } from './rng';
import { VoxelWorld } from './voxel';
import { weatherize } from './weather';

export interface Quality {
  groundRes: number;
  decalRes: number;
  maxCells: number;
  /** 壊れた壁の断面（欠けたセル）の最大数 */
  maxBroken: number;
  maxShards: number;
  dust: number;
}

export const QUALITY_HIGH: Quality = {
  groundRes: 4096,
  decalRes: 2048,
  maxCells: 9000,
  maxBroken: 12000,
  maxShards: 16000,
  dust: 7000,
};
export const QUALITY_LOW: Quality = {
  groundRes: 2048,
  decalRes: 1024,
  maxCells: 4500,
  maxBroken: 6000,
  maxShards: 7000,
  dust: 3500,
};

export interface CityStats {
  totalCells: number;
  destroyedCells: number;
  buildings: number;
  buildingsDown: number;
}

/** ショベルカー側から渡す、ワールド空間の有向箱（OBB）の当たり判定 */
export interface WorldBox {
  center: THREE.Vector3;
  ax: THREE.Vector3;
  ay: THREE.Vector3;
  az: THREE.Vector3;
  half: THREE.Vector3;
}

interface RoofProp {
  /** 載っているセル（屋根スラブ）。これが壊れたら落ちる */
  cell: number;
  mesh: 'box' | 'cyl';
  idx: number;
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  color: [number, number, number];
  gone: boolean;
}

const UP_Y = new THREE.Vector3(0, 1, 0);
const v = new THREE.Vector3();
const vel = new THREE.Vector3();

export class City {
  readonly group = new THREE.Group();
  readonly layout: CityLayout;
  readonly voxels: VoxelWorld;
  readonly rubble = new RubbleMap();
  readonly props: Props;
  readonly dust: DustSystem;
  readonly sparks = new SparkSystem(1500);
  readonly signs: SignBoards;
  /** 崩壊したビルから立ちのぼる煙 */
  private smokes: { x: number; y: number; z: number; t: number; life: number; power: number }[] =
    [];
  readonly decals: GroundDecals;
  readonly facade: FacadeUniforms;
  readonly stats: CityStats;
  /** 衝撃の通知（音・画面揺れ用） */
  onImpact: (e: ImpactEvent) => void = () => {};
  /** 建物の崩壊の通知 */
  onCollapse: (x: number, z: number, cells: number) => void = () => {};

  private readonly staticMesh: THREE.InstancedMesh;
  private readonly cellPool: DebrisPool;
  private readonly shardPool: DebrisPool;
  private colors: Float32Array;
  private staticDirty = false;
  private dustBudget = 0;
  private readonly rng = createRng(9001);
  private readonly shardMat: THREE.MeshStandardMaterial;
  private roofProps: RoofProp[] = [];
  private roofBoxes!: THREE.InstancedMesh;
  private roofCyls!: THREE.InstancedMesh;
  private roofDirty = false;
  /** 静的なセルの aBreak（ひび割れの強さ 0..1） */
  private staticBreak!: THREE.InstancedBufferAttribute;
  private crackDirty = false;
  /** ビルごとの、これまでに壊れたセルの重心（倒れる向きを決める） */
  private dmgX!: Float32Array;
  private dmgZ!: Float32Array;
  private dmgN!: Float32Array;
  private brokenCell!: Int32Array;
  private brokenT!: Float32Array;
  private time = 0;
  /** 粉塵などを出す範囲の判定に使うカメラ位置（main が毎フレーム設定する） */
  readonly focus = new THREE.Vector3(1e9, 0, 1e9);
  private originArr!: Float32Array;
  private infoArr!: Float32Array;
  /** 壊れた壁に隣接して欠けた、断面を持つセル（静的メッシュから移して描画する） */
  private brokenMesh!: THREE.InstancedMesh;
  private brokenOrigin!: THREE.InstancedBufferAttribute;
  private brokenInfo!: THREE.InstancedBufferAttribute;
  private brokenBreak!: THREE.InstancedBufferAttribute;
  private brokenIndex!: Int32Array;
  private brokenFree: number[] = [];
  private brokenCount = 0;
  private brokenCap = 0;
  private brokenDirty = false;
  private rebarPool!: DebrisPool;
  /** 断面から突き出た鉄筋 */
  private stubMesh!: THREE.InstancedMesh;
  private stubCap = 0;
  private stubNext = 0;
  private stubOwner!: Int32Array;
  private stubsByCell = new Map<number, number[]>();
  private stubDirty = false;

  constructor(quality: Quality, seed?: number) {
    this.layout = generateCity(seed);
    this.voxels = new VoxelWorld(this.layout.buildings);
    const n = this.voxels.count;
    this.stats = {
      totalCells: n,
      destroyedCells: 0,
      buildings: this.layout.buildings.length,
      buildingsDown: 0,
    };

    const { material, uniforms } = createFacadeMaterial();
    this.facade = uniforms;

    // ── 静的なセル
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const origin = new Float32Array(n * 3);
    const info = new Float32Array(n * 4);
    this.colors = new Float32Array(n * 3);
    this.staticMesh = new THREE.InstancedMesh(geo, material, n);
    const mat = new THREE.Matrix4();
    const rnd = this.rng;
    for (let id = 0; id < n; id++) {
      const x = cellX(this.voxels.ix[id] as number);
      const y = cellY(this.voxels.iy[id] as number);
      const z = cellZ(this.voxels.iz[id] as number);
      const b = this.layout.buildings[this.voxels.bld[id] as number]!;
      mat.makeScale(CELL, CELL, CELL).setPosition(x, y, z);
      this.staticMesh.setMatrixAt(id, mat);
      origin[id * 3] = x;
      origin[id * 3 + 1] = y;
      origin[id * 3 + 2] = z;
      info[id * 4] = Math.floor(b.seed);
      info[id * 4 + 1] = b.style;
      info[id * 4 + 2] = this.voxels.kind[id] as number;
      info[id * 4 + 3] = 0;
      const j = 0.97 + rnd.next() * 0.06;
      // 床スラブ・柱は無塗装コンクリートの色
      const slab = this.voxels.kind[id] !== 0;
      const k = slab ? 0.35 : 1;
      this.colors[id * 3] = (b.tint[0] * k + (1 - k) * 0.85) * j;
      this.colors[id * 3 + 1] = (b.tint[1] * k + (1 - k) * 0.85) * j;
      this.colors[id * 3 + 2] = (b.tint[2] * k + (1 - k) * 0.85) * j;
    }
    this.staticMesh.instanceColor = new THREE.InstancedBufferAttribute(this.colors.slice(), 3);
    geo.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(origin, 3));
    geo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 4));
    this.staticBreak = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    geo.setAttribute('aBreak', this.staticBreak);
    this.dmgX = new Float32Array(this.layout.buildings.length);
    this.dmgZ = new Float32Array(this.layout.buildings.length);
    this.dmgN = new Float32Array(this.layout.buildings.length);
    this.originArr = origin;
    this.infoArr = info;
    this.staticMesh.castShadow = true;
    this.staticMesh.receiveShadow = true;
    this.staticMesh.frustumCulled = false;
    this.group.add(this.staticMesh);

    // ── 破片（セル）のプール
    // 割れた塊に変形できるよう、各面を 4 分割した立方体
    const dGeo = new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
    dGeo.setAttribute(
      'aBreak',
      new THREE.InstancedBufferAttribute(new Float32Array(quality.maxCells), 1)
    );
    dGeo.setAttribute(
      'aOrigin',
      new THREE.InstancedBufferAttribute(new Float32Array(quality.maxCells * 3), 3)
    );
    dGeo.setAttribute(
      'aInfo',
      new THREE.InstancedBufferAttribute(new Float32Array(quality.maxCells * 4), 4)
    );
    const cellMesh = new THREE.InstancedMesh(dGeo, material, quality.maxCells);
    cellMesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(quality.maxCells * 3),
      3
    );
    cellMesh.castShadow = true;
    cellMesh.receiveShadow = true;
    cellMesh.frustumCulled = false;
    cellMesh.customDepthMaterial = createFacadeDepthMaterial();
    this.group.add(cellMesh);

    // ── 壊れた壁の断面: ギザギザに欠けたセル
    this.brokenCap = quality.maxBroken;
    this.brokenIndex = new Int32Array(n).fill(-1);
    this.brokenCell = new Int32Array(quality.maxBroken).fill(-1);
    this.brokenT = new Float32Array(quality.maxBroken);
    const bGeo = new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
    this.brokenOrigin = new THREE.InstancedBufferAttribute(
      new Float32Array(quality.maxBroken * 3),
      3
    );
    this.brokenInfo = new THREE.InstancedBufferAttribute(
      new Float32Array(quality.maxBroken * 4),
      4
    );
    this.brokenBreak = new THREE.InstancedBufferAttribute(new Float32Array(quality.maxBroken), 1);
    bGeo.setAttribute('aOrigin', this.brokenOrigin);
    bGeo.setAttribute('aInfo', this.brokenInfo);
    bGeo.setAttribute('aBreak', this.brokenBreak);
    this.brokenMesh = new THREE.InstancedMesh(bGeo, material, quality.maxBroken);
    this.brokenMesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(quality.maxBroken * 3),
      3
    );
    (this.brokenMesh.instanceMatrix.array as Float32Array).fill(0);
    this.brokenMesh.count = 0;
    this.brokenMesh.castShadow = true;
    this.brokenMesh.receiveShadow = true;
    this.brokenMesh.frustumCulled = false;
    this.brokenMesh.customDepthMaterial = createFacadeDepthMaterial();
    this.group.add(this.brokenMesh);

    // ── 断面から突き出た鉄筋
    this.stubCap = 5000;
    this.stubOwner = new Int32Array(this.stubCap).fill(-1);
    const rebarGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 5);
    rebarGeo.translate(0, 0.5, 0);
    const rebarMat = new THREE.MeshStandardMaterial({
      color: 0x5b3b2a,
      roughness: 0.6,
      metalness: 0.65,
    });
    this.stubMesh = new THREE.InstancedMesh(rebarGeo, rebarMat, this.stubCap);
    (this.stubMesh.instanceMatrix.array as Float32Array).fill(0);
    this.stubMesh.count = this.stubCap;
    this.stubMesh.castShadow = true;
    this.stubMesh.frustumCulled = false;
    this.group.add(this.stubMesh);

    // ── 細かい破片
    this.shardMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.8,
      metalness: 0.05,
      flatShading: true,
    });
    const shardMesh = new THREE.InstancedMesh(
      // 角ばった不規則な小片（20 面体を非一様にスケールして使う）
      new THREE.IcosahedronGeometry(0.5, 0),
      this.shardMat,
      quality.maxShards
    );
    shardMesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(quality.maxShards * 3),
      3
    );
    shardMesh.castShadow = true;
    shardMesh.receiveShadow = true;
    shardMesh.frustumCulled = false;
    this.group.add(shardMesh);

    const impact = (e: ImpactEvent) => this.handleImpact(e);
    this.cellPool = new DebrisPool(cellMesh, this.voxels, this.rubble, impact, false, true);
    this.shardPool = new DebrisPool(shardMesh, this.voxels, this.rubble, impact, true);
    const barMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), rebarMat, 2500);
    barMesh.castShadow = true;
    barMesh.frustumCulled = false;
    this.group.add(barMesh);
    this.rebarPool = new DebrisPool(barMesh, this.voxels, this.rubble, impact, true, false, true);

    // ── 地面
    const { map, bump, rough } = paintGround(this.layout, quality.groundRes);
    const groundMat = new THREE.MeshStandardMaterial({
      map,
      bumpMap: bump,
      bumpScale: 1.6,
      roughnessMap: rough,
      roughness: 1,
      metalness: 0,
      envMapIntensity: 1.2,
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(GROUND_EXTENT, GROUND_EXTENT), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);
    this.decals = new GroundDecals(quality.decalRes);
    const decalMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(GROUND_EXTENT, GROUND_EXTENT),
      new THREE.MeshStandardMaterial({
        map: this.decals.texture,
        transparent: true,
        roughness: 1,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      })
    );
    decalMesh.rotation.x = -Math.PI / 2;
    decalMesh.position.y = 0.02;
    decalMesh.receiveShadow = true;
    decalMesh.renderOrder = 1;
    this.group.add(decalMesh);

    this.buildRoofProps();
    this.signs = new SignBoards(this.layout.buildings, this.voxels);
    this.group.add(this.signs.mesh);
    this.props = new Props(this.layout.props, quality === QUALITY_LOW ? 240 : 480);
    this.group.add(this.props.group);

    this.dust = new DustSystem(quality.dust);
    this.group.add(this.dust.points, this.sparks.points);
  }

  /** ワールド座標 (x,z) の真下に立っているセルの最上段の高さ。なければ 0 */
  solidTop(x: number, z: number): number {
    const ix = Math.floor((x + HALF) / CELL);
    const iz = Math.floor((z + HALF) / CELL);
    for (let iy = GRID_Y - 1; iy >= 0; iy--)
      if (this.voxels.idAt(ix, iy, iz) >= 0) return (iy + 1) * CELL;
    return 0;
  }

  /** 視線レイをボクセルと地面に対して進め、最初に当たった点を返す */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist = 600): THREE.Vector3 | null {
    // 街の外（ズームアウトしたカメラ）から入るレイは、街の範囲の入口から探索を始める
    const clip = clipRayToSquare(origin, dir, HALF + 40, maxDist);
    if (!clip) return null;
    const p = new THREE.Vector3();
    const step = 0.6;
    for (let t = clip[0]; t < clip[1]; t += step) {
      p.copy(origin).addScaledVector(dir, t);
      if (p.y <= 0.05) {
        // 地面に交差する点。入口より手前（街の外）で地面に着くなら、街には当たらない
        const k = (origin.y - 0.05) / Math.max(1e-4, -dir.y);
        if (k < clip[0] - 1e-3) return null;
        return origin.clone().addScaledVector(dir, k);
      }
      if (
        this.voxels.idAt(
          Math.floor((p.x + HALF) / CELL),
          Math.floor(p.y / CELL),
          Math.floor((p.z + HALF) / CELL)
        ) >= 0
      ) {
        // 面の手前に戻して返す（ビルの外側）
        return p.clone().addScaledVector(dir, 0.3);
      }
    }
    return null;
  }

  private handleImpact(e: ImpactEvent) {
    this.onImpact(e);
    if (this.dustBudget <= 0) return;
    this.dustBudget--;
    const k = Math.min(1, e.speed / 22);
    this.dust.emit({
      count: 1 + Math.floor(k * 4),
      x: e.x,
      y: e.y + 0.3,
      z: e.z,
      spread: e.size,
      speed: 1.5 + k * 5,
      size: e.size * (1.4 + k * 1.8),
      life: 1.8 + k * 2.6,
      tone: 0.74,
      alpha: 0.28 + k * 0.28,
    });
    if (k > 0.4) this.decals.rubble(e.x, e.z, 2.2 + k * 2.4, 0.07 + k * 0.08);
  }

  /** セルを壊して破片にする。破片の初速は呼び出し側が決める */
  destroyCell(
    id: number,
    vx: number,
    vy: number,
    vz: number,
    shards = true,
    ang?: [number, number, number]
  ): boolean {
    const vw = this.voxels;
    if (!vw.remove(id)) return false;
    (this.staticMesh.instanceMatrix.array as Float32Array).fill(0, id * 16, id * 16 + 16);
    this.staticDirty = true;
    this.stats.destroyedCells++;
    this.unbreak(id);
    this.markNeighborsBroken(id);
    this.spreadCracks(id);
    {
      const bi2 = vw.bld[id] as number;
      this.dmgX[bi2] = (this.dmgX[bi2] as number) + cellX(vw.ix[id] as number);
      this.dmgZ[bi2] = (this.dmgZ[bi2] as number) + cellZ(vw.iz[id] as number);
      this.dmgN[bi2] = (this.dmgN[bi2] as number) + 1;
    }
    const x = cellX(vw.ix[id] as number);
    const y = cellY(vw.iy[id] as number);
    const z = cellZ(vw.iz[id] as number);
    const b = this.layout.buildings[vw.bld[id] as number]!;
    const r = this.rng;
    const sp = Math.hypot(vx, vy, vz);
    const cap = sp > 42 ? 42 / sp : 1;
    vx *= cap;
    vy *= cap;
    vz *= cap;
    const rotK = 1 + Math.min(4, sp * 0.15);
    this.cellPool.spawn({
      x,
      y,
      z,
      vx,
      vy,
      vz,
      wx: ang ? ang[0] + (r.next() - 0.5) * 0.8 : (r.next() - 0.5) * 4 * rotK,
      wy: ang ? ang[1] + (r.next() - 0.5) * 0.8 : (r.next() - 0.5) * 4 * rotK,
      wz: ang ? ang[2] + (r.next() - 0.5) * 0.8 : (r.next() - 0.5) * 4 * rotK,
      // 立方体のままにしない: 床スラブは薄い板、壁は厚みのある壁板に近い寸法にばらつかせる
      sx:
        CELL *
        (vw.kind[id] === 1
          ? r.range(0.8, 1.05)
          : vw.kind[id] === 2
            ? r.range(0.65, 0.9)
            : r.range(0.7, 1.05)),
      sy:
        CELL *
        (vw.kind[id] === 1
          ? r.range(0.38, 0.62)
          : vw.kind[id] === 2
            ? r.range(0.9, 1.1)
            : r.range(0.7, 1.05)),
      sz:
        CELL *
        (vw.kind[id] === 1
          ? r.range(0.8, 1.05)
          : vw.kind[id] === 2
            ? r.range(0.65, 0.9)
            : r.range(0.5, 1.0)),
      q: [r.next() - 0.5, r.next() - 0.5, r.next() - 0.5, r.next() * 0.5 + 0.5],
      origin: [x, y, z],
      info: [Math.floor(b.seed), b.style, vw.kind[id] as number, 1],
      color: [
        this.colors[id * 3] as number,
        this.colors[id * 3 + 1] as number,
        this.colors[id * 3 + 2] as number,
      ],
    });
    if (shards) {
      const n = r.chance(0.5) ? 2 : 3;
      for (let i = 0; i < n; i++) {
        const s = 0.16 + r.next() * 0.34;
        const k = 0.5 + r.next() * 0.9;
        const g = 0.42 + r.next() * 0.35;
        this.shardPool.spawn({
          x: x + (r.next() - 0.5) * CELL,
          y: y + (r.next() - 0.5) * CELL,
          z: z + (r.next() - 0.5) * CELL,
          vx: vx * k + (r.next() - 0.5) * 7,
          vy: vy * k + r.next() * 6,
          vz: vz * k + (r.next() - 0.5) * 7,
          wx: (r.next() - 0.5) * 18,
          wy: (r.next() - 0.5) * 18,
          wz: (r.next() - 0.5) * 18,
          sx: s * (0.7 + r.next() * 0.8),
          sy: s * (0.5 + r.next() * 0.7),
          sz: s * (0.7 + r.next() * 0.8),
          color: [
            g * b.tint[0] * 0.5 + g * 0.5,
            g * b.tint[1] * 0.5 + g * 0.5,
            g * b.tint[2] * 0.5 + g * 0.5,
          ],
        });
      }
    }
    // 鉄筋が折れて飛ぶ
    if (r.chance(vw.kind[id] === 2 ? 0.55 : 0.2)) {
      const len = r.range(1.0, 2.6);
      const a = r.next() * Math.PI * 2;
      const ax = Math.cos(a);
      const az = Math.sin(a);
      const ang = r.range(0.2, 3.0);
      this.rebarPool.spawn({
        x,
        y,
        z,
        vx: vx * 0.8 + (r.next() - 0.5) * 6,
        vy: vy * 0.8 + r.next() * 4,
        vz: vz * 0.8 + (r.next() - 0.5) * 6,
        wx: (r.next() - 0.5) * 10,
        wy: (r.next() - 0.5) * 10,
        wz: (r.next() - 0.5) * 10,
        sx: 0.06,
        sy: len,
        sz: 0.06,
        q: [ax * Math.sin(ang / 2), 0.3, az * Math.sin(ang / 2), Math.cos(ang / 2)],
      });
    }
    // 窓ガラスの破片: 薄くて明るい青緑の欠片
    if (vw.kind[id] === 0 && (b.style === 0 || b.style === 3 || r.chance(0.35))) {
      for (let i = 0; i < 4; i++) {
        const s = r.range(0.12, 0.36);
        this.shardPool.spawn({
          x: x + (r.next() - 0.5) * CELL,
          y: y + (r.next() - 0.5) * CELL,
          z: z + (r.next() - 0.5) * CELL,
          vx: vx * 0.6 + (r.next() - 0.5) * 8,
          vy: vy * 0.6 + r.next() * 5,
          vz: vz * 0.6 + (r.next() - 0.5) * 8,
          wx: (r.next() - 0.5) * 22,
          wy: (r.next() - 0.5) * 22,
          wz: (r.next() - 0.5) * 22,
          sx: s * 1.4,
          sy: s * 0.07,
          sz: s,
          color: [0.55, 0.78, 0.9],
        });
      }
    }
    return true;
  }

  /* ───────── 壊れた壁の断面（欠けたセル）と鉄筋 ───────── */

  /** 壊れた箇所の周囲 2 セルにひびを走らせる（近いほど強い） */
  private spreadCracks(id: number) {
    const vw = this.voxels;
    const x = vw.ix[id] as number;
    const y = vw.iy[id] as number;
    const z = vw.iz[id] as number;
    const arr = this.staticBreak.array as Float32Array;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (!dx && !dy && !dz) continue;
          const nid = vw.idAt(x + dx, y + dy, z + dz);
          if (nid < 0 || (this.brokenIndex[nid] as number) >= 0) continue;
          const level = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) === 1 ? 1 : 0.55;
          if ((arr[nid] as number) < level) {
            arr[nid] = level;
            this.crackDirty = true;
          }
        }
      }
    }
  }

  /** 欠けた断面から、粉や小片がしばらくのあいだ崩れ続ける */
  private trickle(dt: number) {
    if (this.brokenCount === 0) return;
    for (let k = 0; k < 3; k++) {
      if (Math.random() > dt * 2.5) continue;
      const bi = Math.floor(Math.random() * this.brokenCount);
      const cell = this.brokenCell[bi] as number;
      if (cell < 0 || (this.brokenIndex[cell] as number) !== bi) continue;
      const age = this.time - (this.brokenT[bi] as number);
      if (age > 30) continue;
      const x = this.originArr[cell * 3] as number;
      const y = this.originArr[cell * 3 + 1] as number;
      const z = this.originArr[cell * 3 + 2] as number;
      if (Math.hypot(x - this.focus.x, z - this.focus.z) > 170) continue;
      const fade = 1 - age / 30;
      this.dust.emit({
        count: 1,
        x,
        y,
        z,
        spread: 1.4,
        speed: 0.5,
        size: 1.4,
        life: 2.8,
        tone: 0.72,
        alpha: 0.1 + 0.1 * fade,
      });
      if (Math.random() < 0.55) {
        const s = 0.08 + Math.random() * 0.16;
        this.shardPool.spawn({
          x: x + (Math.random() - 0.5),
          y,
          z: z + (Math.random() - 0.5),
          vx: (Math.random() - 0.5) * 1.2,
          vy: 0,
          vz: (Math.random() - 0.5) * 1.2,
          wx: (Math.random() - 0.5) * 6,
          wy: (Math.random() - 0.5) * 6,
          wz: (Math.random() - 0.5) * 6,
          sx: s * 1.3,
          sy: s,
          sz: s * 1.1,
          color: [0.5, 0.49, 0.46],
        });
      }
    }
  }

  /** 壊したセルの隣のうち、壊れて新しく面が露出したものを「欠けたセル」へ移す */
  private markNeighborsBroken(id: number) {
    const vw = this.voxels;
    const x = vw.ix[id] as number;
    const y = vw.iy[id] as number;
    const z = vw.iz[id] as number;
    for (const [dx, dy, dz] of [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ] as const) {
      const nid = vw.idAt(x + dx, y + dy, z + dz);
      if (nid >= 0) this.markBroken(nid);
    }
  }

  private markBroken(nid: number) {
    const vw = this.voxels;
    const mask = vw.fracturedFaces(nid);
    if (mask === 0) return;
    let bi = this.brokenIndex[nid] as number;
    if (bi < 0) {
      bi = this.brokenFree.pop() ?? (this.brokenCount < this.brokenCap ? this.brokenCount++ : -1);
      if (bi < 0) return; // 上限: 欠けずにそのまま残す
      this.brokenIndex[nid] = bi;
      this.brokenCell[bi] = nid;
      this.brokenT[bi] = this.time;
      const sm = this.staticMesh.instanceMatrix.array as Float32Array;
      (this.brokenMesh.instanceMatrix.array as Float32Array).set(
        sm.subarray(nid * 16, nid * 16 + 16),
        bi * 16
      );
      sm.fill(0, nid * 16, nid * 16 + 16);
      this.staticDirty = true;
      this.brokenOrigin.setXYZ(
        bi,
        this.originArr[nid * 3] as number,
        this.originArr[nid * 3 + 1] as number,
        this.originArr[nid * 3 + 2] as number
      );
      this.brokenInfo.setXYZW(
        bi,
        this.infoArr[nid * 4] as number,
        this.infoArr[nid * 4 + 1] as number,
        this.infoArr[nid * 4 + 2] as number,
        3
      );
      this.brokenMesh.instanceColor!.setXYZ(
        bi,
        this.colors[nid * 3] as number,
        this.colors[nid * 3 + 1] as number,
        this.colors[nid * 3 + 2] as number
      );
      this.brokenBreak.setX(bi, 0);
      this.brokenMesh.count = Math.max(this.brokenMesh.count, bi + 1);
    }
    const old = this.brokenBreak.getX(bi);
    if (old !== mask) {
      this.brokenBreak.setX(bi, mask);
      this.addStubs(nid, mask & ~old);
    }
    this.brokenDirty = true;
  }

  /** 欠けたセルが壊れたら、断面とそこから出た鉄筋も消す */
  private unbreak(id: number) {
    const bi = this.brokenIndex[id] as number;
    if (bi >= 0) {
      (this.brokenMesh.instanceMatrix.array as Float32Array).fill(0, bi * 16, bi * 16 + 16);
      this.brokenBreak.setX(bi, 0);
      this.brokenFree.push(bi);
      this.brokenCell[bi] = -1;
      this.brokenIndex[id] = -1;
      this.brokenDirty = true;
    }
    const stubs = this.stubsByCell.get(id);
    if (stubs) {
      for (const s of stubs) {
        (this.stubMesh.instanceMatrix.array as Float32Array).fill(0, s * 16, s * 16 + 16);
        this.stubOwner[s] = -1;
      }
      this.stubsByCell.delete(id);
      this.stubDirty = true;
    }
  }

  /** 新しく露出した面（ビット）から、鉄筋を何本か突き出させる */
  private addStubs(cell: number, bits: number) {
    const vw = this.voxels;
    const cx = cellX(vw.ix[cell] as number);
    const cy = cellY(vw.iy[cell] as number);
    const cz = cellZ(vw.iz[cell] as number);
    const r = this.rng;
    const axes = [0, 0, 1, 1, 2, 2];
    const signs = [1, -1, 1, -1, 1, -1];
    const n = new THREE.Vector3();
    const t = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const m4 = new THREE.Matrix4();
    const scl = new THREE.Vector3();
    for (let b = 0; b < 6; b++) {
      // 柱の断面は鉄筋が密に出る
      if (!(bits & (1 << b)) || !r.chance(vw.kind[cell] === 2 ? 0.95 : 0.5)) continue;
      const a = axes[b] as number;
      const sg = signs[b] as number;
      for (let k = vw.kind[cell] === 2 ? 3 : r.chance(0.5) ? 2 : 1; k > 0; k--) {
        n.set(a === 0 ? sg : 0, a === 1 ? sg : 0, a === 2 ? sg : 0);
        // 面の中で位置をずらし、断面の奥から外へ向けて少し傾けて出す
        pos.set(cx, cy, cz).addScaledVector(n, CELL / 2 - 0.35);
        for (const ax of [(a + 1) % 3, (a + 2) % 3]) {
          const off = (r.next() - 0.5) * 1.1;
          if (ax === 0) pos.x += off;
          else if (ax === 1) pos.y += off;
          else pos.z += off;
        }
        t.set(r.next() - 0.5, r.next() - 0.5, r.next() - 0.5);
        dir.copy(n).addScaledVector(t, 0.7).normalize();
        q.setFromUnitVectors(UP_Y, dir);
        scl.set(1, r.range(0.4, 1.5), 1);
        m4.compose(pos, q, scl);
        const slot = this.stubNext;
        this.stubNext = (this.stubNext + 1) % this.stubCap;
        const prev = this.stubOwner[slot] as number;
        if (prev >= 0) {
          const list = this.stubsByCell.get(prev);
          if (list) {
            const i = list.indexOf(slot);
            if (i >= 0) list.splice(i, 1);
          }
        }
        this.stubOwner[slot] = cell;
        const list = this.stubsByCell.get(cell) ?? [];
        list.push(slot);
        this.stubsByCell.set(cell, list);
        this.stubMesh.setMatrixAt(slot, m4);
        this.stubDirty = true;
      }
    }
  }

  /** 箱（OBB）に触れたセル・小物を壊す。壊したセルの数を返す */
  smashBox(
    box: WorldBox,
    velAt: (p: THREE.Vector3, out: THREE.Vector3) => void,
    opts: { margin?: number; kick?: boolean; sparks?: boolean } = {}
  ): number {
    const m = opts.margin ?? 0.5;
    const { center: c, ax, ay, az, half: h } = box;
    const ex = Math.abs(ax.x) * h.x + Math.abs(ay.x) * h.y + Math.abs(az.x) * h.z + m;
    const ey = Math.abs(ax.y) * h.x + Math.abs(ay.y) * h.y + Math.abs(az.y) * h.z + m;
    const ez = Math.abs(ax.z) * h.x + Math.abs(ay.z) * h.y + Math.abs(az.z) * h.z + m;
    const x0 = Math.max(0, Math.floor((c.x - ex + HALF) / CELL));
    const x1 = Math.min(GRID_N - 1, Math.floor((c.x + ex + HALF) / CELL));
    const y0 = Math.max(0, Math.floor((c.y - ey) / CELL));
    const y1 = Math.min(GRID_Y - 1, Math.floor((c.y + ey) / CELL));
    const z0 = Math.max(0, Math.floor((c.z - ez + HALF) / CELL));
    const z1 = Math.min(GRID_N - 1, Math.floor((c.z + ez + HALF) / CELL));
    let destroyed = 0;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let cvx = 0;
    let cvy = 0;
    let cvz = 0;
    const ids = this.voxels.ids;
    this.dustBudget = 14;
    for (let iy = y0; iy <= y1; iy++) {
      for (let iz = z0; iz <= z1; iz++) {
        for (let ix = x0; ix <= x1; ix++) {
          const id = ids[VoxelWorld.index(ix, iy, iz)] as number;
          if (id < 0) continue;
          v.set(cellX(ix) - c.x, cellY(iy) - c.y, cellZ(iz) - c.z);
          if (
            Math.abs(v.dot(ax)) > h.x + m ||
            Math.abs(v.dot(ay)) > h.y + m ||
            Math.abs(v.dot(az)) > h.z + m
          )
            continue;
          v.set(cellX(ix), cellY(iy), cellZ(iz));
          velAt(v, vel);
          const r = this.rng;
          // 押す向きに加えて、中心から外へ弾ける
          const out = Math.hypot(v.x - c.x, v.z - c.z) + 0.1;
          const sp = vel.length();
          const spray = 1.5 + Math.min(6, sp * 0.25);
          this.destroyCell(
            id,
            vel.x * 0.9 + ((v.x - c.x) / out) * spray + (r.next() - 0.5) * 3,
            vel.y * 0.9 + 1.5 + r.next() * (2 + Math.min(7, sp * 0.3)),
            vel.z * 0.9 + ((v.z - c.z) / out) * spray + (r.next() - 0.5) * 3
          );
          destroyed++;
          cx += v.x;
          cy += v.y;
          cz += v.z;
          cvx += vel.x;
          cvy += vel.y;
          cvz += vel.z;
        }
      }
    }
    // 鋼鉄の刃がコンクリートを砕く瞬間の火花
    if (opts.sparks && destroyed > 0) {
      const k = 1 / destroyed;
      const speed = Math.hypot(cvx, cvy, cvz) * k;
      if (speed > 6) {
        this.sparks.emit(
          cx * k,
          cy * k,
          cz * k,
          Math.min(70, 8 + destroyed * 3),
          cvx * k,
          cvy * k,
          cvz * k
        );
      }
    }

    // 車・街路樹・街灯
    const reach = Math.max(ex, ez) + 3;
    this.props.near(c.x, c.z, reach, (it) => {
      const ys = it.kind === 'car' ? [0.8] : [1, it.h * 0.7];
      for (const y of ys) {
        v.set(it.x - c.x, y - c.y, it.z - c.z);
        if (
          Math.abs(v.dot(ax)) <= h.x + it.r &&
          Math.abs(v.dot(ay)) <= h.y + 1 &&
          Math.abs(v.dot(az)) <= h.z + it.r
        ) {
          v.set(it.x, y, it.z);
          velAt(v, vel);
          this.props.knock(it, vel.x || it.x - c.x, vel.z || it.z - c.z);
          this.onImpact({
            x: it.x,
            y: 1,
            z: it.z,
            speed: it.kind === 'car' ? 14 : 8,
            size: it.kind === 'car' ? 3 : 2,
          });
          if (it.kind === 'car') {
            this.dust.emit({
              count: 5,
              x: it.x,
              y: 0.8,
              z: it.z,
              spread: 3,
              speed: 4,
              size: 2.4,
              life: 2.2,
              tone: 0.5,
              alpha: 0.4,
            });
          }
          break;
        }
      }
    });

    if (opts.kick) {
      velAt(c, vel);
      this.cellPool.kick(c.x, c.y, c.z, Math.max(h.x, h.y, h.z) + 1.2, vel.x, vel.y, vel.z);
      this.shardPool.kick(c.x, c.y, c.z, Math.max(h.x, h.y, h.z) + 1.2, vel.x, vel.y, vel.z);
    }
    if (destroyed > 0) {
      this.decals.rubble(c.x, c.z, 3, 0.06);
      if (destroyed > 3) {
        this.dust.emit({
          count: Math.min(8, 2 + (destroyed >> 2)),
          x: c.x,
          y: Math.max(1.5, c.y),
          z: c.z,
          spread: 4,
          speed: 4,
          size: 3.4,
          life: 3,
          tone: 0.8,
          alpha: 0.38,
        });
      }
    }
    return destroyed;
  }

  private collapseBudget = 0;

  update(
    dt: number,
    sun: THREE.Color,
    ambient: THREE.Color,
    fogColor: THREE.Color,
    fogDensity: number,
    screenScale: number
  ) {
    this.dustBudget = 10;
    // 崩壊のチェックは重いので、1 フレーム数棟まで
    this.collapseBudget += dt;
    let checked = 0;
    for (let bi = 0; bi < this.voxels.buildings.length && checked < 3; bi++) {
      const b = this.voxels.buildings[bi]!;
      if (!b.dirty) continue;
      checked++;
      const ids = this.voxels.findUnsupported(bi);
      if (ids.length === 0) continue;
      this.releaseCollapse(bi, ids);
    }

    this.cellPool.update(dt);
    this.shardPool.update(dt);
    this.rebarPool.update(dt);
    this.flushBroken();
    this.time += dt;
    this.trickle(dt);
    this.updateSmokes(dt);
    this.sparks.update(dt);
    this.updateRoofProps();
    this.signs.update(this.voxels, (m) => this.breakSign(m));
    this.props.update(dt);
    this.dust.update(dt);
    this.decals.flush(dt);
    if (this.staticDirty) {
      this.staticMesh.instanceMatrix.needsUpdate = true;
      this.staticDirty = false;
    }
    const u = this.dust.uniforms;
    u.uLight.value.copy(sun);
    u.uAmbient.value.copy(ambient);
    u.uFogColor.value.copy(fogColor);
    u.uFogDensity.value = fogDensity;
    u.uScale.value = screenScale;
    this.sparks.uniforms.uScale.value = screenScale;
  }

  /** 屋上の室外機・給水タンク・階段室・アンテナ */
  private buildRoofProps() {
    const r = createRng(31337);
    type Spec = Omit<RoofProp, 'idx' | 'gone'>;
    const specs: Spec[] = [];
    for (let bi = 0; bi < this.layout.buildings.length; bi++) {
      const b = this.layout.buildings[bi]!;
      const placed: [number, number][] = [];
      const n = 2 + Math.floor((b.w * b.d) / 30) + r.int(0, 2);
      const top = (b.layers + 1) * CELL;
      for (let k = 0; k < n; k++) {
        const pick = r.next();
        const type =
          k === 0 && b.w >= 7 && b.d >= 6
            ? 'bulk'
            : pick < 0.5
              ? 'ac'
              : pick < 0.78
                ? 'tank'
                : 'mast';
        const sx =
          type === 'bulk'
            ? r.range(3.2, 4.6)
            : type === 'ac'
              ? r.range(1.6, 2.8)
              : type === 'tank'
                ? r.range(2, 2.8)
                : 0.14;
        const sy =
          type === 'bulk'
            ? r.range(2.6, 3.2)
            : type === 'ac'
              ? r.range(1.0, 1.5)
              : type === 'tank'
                ? r.range(2.2, 3)
                : r.range(5, 10);
        const sz =
          type === 'bulk'
            ? r.range(3, 4.2)
            : type === 'ac'
              ? r.range(1.2, 2)
              : type === 'tank'
                ? sx
                : 0.14;
        for (let tries = 0; tries < 10; tries++) {
          const gx = b.x0 + 1.3 + r.next() * Math.max(0.1, b.w - 2.6);
          const gz = b.z0 + 1.3 + r.next() * Math.max(0.1, b.d - 2.6);
          if (placed.some(([px, pz]) => Math.hypot(px - gx, pz - gz) < 2.6)) continue;
          placed.push([gx, gz]);
          const cell = this.voxels.idAt(Math.floor(gx), b.layers, Math.floor(gz));
          if (cell < 0) break;
          const g =
            type === 'tank'
              ? [0.46, 0.5, 0.48]
              : type === 'mast'
                ? [0.6, 0.6, 0.62]
                : type === 'bulk'
                  ? [b.tint[0] * 0.85, b.tint[1] * 0.85, b.tint[2] * 0.85]
                  : [0.64 + r.next() * 0.08, 0.66 + r.next() * 0.08, 0.68 + r.next() * 0.08];
          specs.push({
            cell,
            mesh: type === 'tank' || type === 'mast' ? 'cyl' : 'box',
            x: gx * CELL - HALF,
            y: top + sy / 2,
            z: gz * CELL - HALF,
            sx,
            sy,
            sz,
            color: g as [number, number, number],
          });
          break;
        }
      }
    }
    const boxes = specs.filter((p) => p.mesh === 'box');
    const cyls = specs.filter((p) => p.mesh === 'cyl');
    const mat = weatherize(
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0.55 }),
      {
        dirt: 0.7,
        wear: 0.3,
        bump: 0.5,
        rust: 0.3,
        seed: 2.5,
      }
    );
    this.roofBoxes = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      mat,
      Math.max(1, boxes.length)
    );
    this.roofCyls = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.5, 0.5, 1, 20),
      mat,
      Math.max(1, cyls.length)
    );
    for (const m of [this.roofBoxes, this.roofCyls]) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      this.group.add(m);
    }
    this.roofBoxes.count = boxes.length;
    this.roofCyls.count = cyls.length;
    const mat4 = new THREE.Matrix4();
    const place = (list: Spec[], mesh: THREE.InstancedMesh, kind: 'box' | 'cyl') => {
      list.forEach((p, i) => {
        mat4.makeScale(p.sx, p.sy, p.sz).setPosition(p.x, p.y, p.z);
        mesh.setMatrixAt(i, mat4);
        mesh.setColorAt(i, new THREE.Color(p.color[0], p.color[1], p.color[2]));
        this.roofProps.push({ ...p, mesh: kind, idx: i, gone: false });
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };
    place(boxes, this.roofBoxes, 'box');
    place(cyls, this.roofCyls, 'cyl');
  }

  private flushBroken() {
    if (this.crackDirty) {
      this.staticBreak.needsUpdate = true;
      this.crackDirty = false;
    }
    if (this.brokenDirty) {
      this.brokenMesh.instanceMatrix.needsUpdate = true;
      this.brokenMesh.instanceColor!.needsUpdate = true;
      this.brokenOrigin.needsUpdate = true;
      this.brokenInfo.needsUpdate = true;
      this.brokenBreak.needsUpdate = true;
      this.brokenDirty = false;
    }
    if (this.stubDirty) {
      this.stubMesh.instanceMatrix.needsUpdate = true;
      this.stubDirty = false;
    }
  }

  /** 崩壊したビルの跡から、しばらく煙が立ち昇る */
  private updateSmokes(dt: number) {
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i]!;
      s.t += dt;
      if (s.t > s.life) {
        this.smokes.splice(i, 1);
        continue;
      }
      const fade = 1 - s.t / s.life;
      // 毎秒の粒子数は、威力と残り時間で決まる
      if (Math.random() < dt * 16 * s.power * (0.3 + fade)) {
        this.dust.emit({
          count: 1,
          x: s.x,
          y: s.y,
          z: s.z,
          spread: 7,
          speed: 1.2,
          vy: 11,
          size: 6 + s.power * 3,
          life: 6.5,
          tone: 0.3,
          alpha: 0.2 + 0.12 * fade,
        });
      }
    }
  }

  /** 看板が外れて落ちる: 板の破片と火花 */
  private breakSign(m: THREE.Matrix4) {
    const p = new THREE.Vector3().setFromMatrixPosition(m);
    const r = this.rng;
    for (let i = 0; i < 3; i++) {
      this.shardPool.spawn({
        x: p.x,
        y: p.y + (r.next() - 0.5) * 3,
        z: p.z,
        vx: (r.next() - 0.5) * 4,
        vy: r.next() * 2,
        vz: (r.next() - 0.5) * 4,
        wx: (r.next() - 0.5) * 8,
        wy: (r.next() - 0.5) * 8,
        wz: (r.next() - 0.5) * 8,
        sx: 0.9,
        sy: 1.4,
        sz: 0.05,
        color: [0.85, 0.5, 0.35],
      });
    }
    this.sparks.emit(p.x, p.y, p.z, 12, 0, 0, 0);
  }

  /** 載っている屋根が壊れた設備は、破片になって落ちる */
  private updateRoofProps() {
    for (const p of this.roofProps) {
      if (p.gone || this.voxels.alive[p.cell]) continue;
      p.gone = true;
      const mesh = p.mesh === 'box' ? this.roofBoxes : this.roofCyls;
      (mesh.instanceMatrix.array as Float32Array).fill(0, p.idx * 16, p.idx * 16 + 16);
      this.roofDirty = true;
      const r = this.rng;
      this.shardPool.spawn({
        x: p.x,
        y: p.y,
        z: p.z,
        vx: (r.next() - 0.5) * 3,
        vy: r.next() * 2,
        vz: (r.next() - 0.5) * 3,
        wx: (r.next() - 0.5) * 3,
        wy: (r.next() - 0.5) * 3,
        wz: (r.next() - 0.5) * 3,
        sx: p.sx,
        sy: Math.min(p.sy, 2.4),
        sz: p.sz,
        color: p.color,
      });
    }
    if (this.roofDirty) {
      this.roofBoxes.instanceMatrix.needsUpdate = true;
      this.roofCyls.instanceMatrix.needsUpdate = true;
      this.roofDirty = false;
    }
  }

  private releaseCollapse(bi: number, ids: number[]) {
    const b = this.voxels.buildings[bi]!;
    const sp = b.spec;
    const cx = cellX(sp.x0 + sp.w / 2 - 0.5);
    const cz = cellZ(sp.z0 + sp.d / 2 - 0.5);
    const r = this.rng;
    // 損傷が集中した側へ傾いて倒れる: 支えを失った上の部分が、反対側の縁を支点に回転する
    const n = this.dmgN[bi] as number;
    let dX = n > 0 ? (this.dmgX[bi] as number) / n - cx : 0;
    let dZ = n > 0 ? (this.dmgZ[bi] as number) / n - cz : 0;
    let dl = Math.hypot(dX, dZ);
    if (dl < 1.5) {
      const a = r.next() * Math.PI * 2;
      dX = Math.cos(a);
      dZ = Math.sin(a);
      dl = 1;
    }
    dX /= dl;
    dZ /= dl;
    let minY = 1e9;
    for (const id of ids) minY = Math.min(minY, cellY(this.voxels.iy[id] as number));
    const half = Math.max(sp.w, sp.d) * CELL * 0.4;
    const hx = cx - dX * half;
    const hz = cz - dZ * half;
    const k = Math.min(1, ids.length / 260) * (0.3 + r.next() * 0.22);
    const wa = k * dZ;
    const wb = -k * dX;
    for (const id of ids) {
      const x = cellX(this.voxels.ix[id] as number);
      const y = cellY(this.voxels.iy[id] as number);
      const z = cellZ(this.voxels.iz[id] as number);
      const rx = x - hx;
      const ry = y - minY;
      const rz = z - hz;
      // v = ω × r（ω は水平軸まわり）。高いほど大きく倒れ込む
      let vx = k * dX * ry;
      let vy = -k * (dX * rx + dZ * rz);
      let vz = k * dZ * ry;
      const sp2 = Math.hypot(vx, vy, vz);
      if (sp2 > 15) {
        vx *= 15 / sp2;
        vy *= 15 / sp2;
        vz *= 15 / sp2;
      }
      const ox = x - cx;
      const oz = z - cz;
      const ol = Math.hypot(ox, oz) + 0.5;
      this.destroyCell(
        id,
        vx + (ox / ol) * r.next() * 1.2,
        vy - r.next() * 1.5,
        vz + (oz / ol) * r.next() * 1.2,
        r.chance(0.3),
        [wa, 0, wb]
      );
    }
    const big = ids.length;
    if (big >= 24) {
      const plume = Math.min(70, big >> 1);
      this.dust.emit({
        count: plume,
        x: cx,
        y: 2.5,
        z: cz,
        spread: Math.max(sp.w, sp.d) * CELL,
        speed: 6,
        size: 7,
        life: 6,
        tone: 0.82,
        alpha: 0.5,
      });
      this.decals.rubble(cx, cz, Math.max(sp.w, sp.d) * CELL * 0.9, 0.45);
      this.smokes.push({
        x: cx,
        y: 2,
        z: cz,
        t: 0,
        life: 9 + Math.min(10, big / 40),
        power: Math.min(1.6, 0.5 + big / 300),
      });
      this.onCollapse(cx, cz, big);
    }
    if (!b.collapsed && b.alive < b.count * 0.18) {
      b.collapsed = true;
      this.stats.buildingsDown++;
    }
  }

  /** 街の外周（ショベルカーの行動範囲） */
  get bounds(): number {
    return WORLD_SIZE / 2 + 18;
  }
}
