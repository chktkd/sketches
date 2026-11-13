import * as THREE from 'three';
import { CELL, GRID_N, GRID_Y, HALF, WORLD_SIZE, cellX, cellY, cellZ } from './config';
import { DebrisPool, DustSystem, type ImpactEvent, RubbleMap } from './debris';
import { createFacadeMaterial, type FacadeUniforms } from './facade';
import { GROUND_EXTENT, GroundDecals, paintGround } from './ground';
import { type CityLayout, generateCity } from './layout';
import { Props } from './props';
import { createRng } from './rng';
import { VoxelWorld } from './voxel';
import { weatherize } from './weather';

export interface Quality {
  groundRes: number;
  decalRes: number;
  maxCells: number;
  maxShards: number;
  dust: number;
}

export const QUALITY_HIGH: Quality = {
  groundRes: 4096,
  decalRes: 2048,
  maxCells: 14000,
  maxShards: 16000,
  dust: 7000,
};
export const QUALITY_LOW: Quality = {
  groundRes: 2048,
  decalRes: 1024,
  maxCells: 7000,
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

const v = new THREE.Vector3();
const vel = new THREE.Vector3();

export class City {
  readonly group = new THREE.Group();
  readonly layout: CityLayout;
  readonly voxels: VoxelWorld;
  readonly rubble = new RubbleMap();
  readonly props: Props;
  readonly dust: DustSystem;
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
      const slab = this.voxels.kind[id] === 1;
      const k = slab ? 0.35 : 1;
      this.colors[id * 3] = (b.tint[0] * k + (1 - k) * 0.85) * j;
      this.colors[id * 3 + 1] = (b.tint[1] * k + (1 - k) * 0.85) * j;
      this.colors[id * 3 + 2] = (b.tint[2] * k + (1 - k) * 0.85) * j;
    }
    this.staticMesh.instanceColor = new THREE.InstancedBufferAttribute(this.colors.slice(), 3);
    geo.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(origin, 3));
    geo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 4));
    this.staticMesh.castShadow = true;
    this.staticMesh.receiveShadow = true;
    this.staticMesh.frustumCulled = false;
    this.group.add(this.staticMesh);

    // ── 破片（セル）のプール
    const dGeo = new THREE.BoxGeometry(1, 1, 1);
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
    this.group.add(cellMesh);

    // ── 細かい破片
    this.shardMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.92,
      metalness: 0,
    });
    const shardMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
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
    this.cellPool = new DebrisPool(cellMesh, this.voxels, this.rubble, impact);
    this.shardPool = new DebrisPool(shardMesh, this.voxels, this.rubble, impact, true);

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
    this.props = new Props(this.layout.props);
    this.group.add(this.props.group);

    this.dust = new DustSystem(quality.dust);
    this.group.add(this.dust.points);
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
    const p = new THREE.Vector3();
    const step = 0.6;
    for (let t = 0; t < maxDist; t += step) {
      p.copy(origin).addScaledVector(dir, t);
      if (p.y <= 0.05) {
        // 地面に交差する直前を精密に
        const k = (origin.y - 0.05) / Math.max(1e-4, -dir.y);
        return origin.clone().addScaledVector(dir, k);
      }
      if (Math.abs(p.x) > HALF + 40 || Math.abs(p.z) > HALF + 40) return null;
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
  destroyCell(id: number, vx: number, vy: number, vz: number, shards = true): boolean {
    const vw = this.voxels;
    if (!vw.remove(id)) return false;
    (this.staticMesh.instanceMatrix.array as Float32Array).fill(0, id * 16, id * 16 + 16);
    this.staticDirty = true;
    this.stats.destroyedCells++;
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
      wx: (r.next() - 0.5) * 4 * rotK,
      wy: (r.next() - 0.5) * 4 * rotK,
      wz: (r.next() - 0.5) * 4 * rotK,
      sx: CELL,
      sy: CELL,
      sz: CELL,
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
    return true;
  }

  /** 箱（OBB）に触れたセル・小物を壊す。壊したセルの数を返す */
  smashBox(
    box: WorldBox,
    velAt: (p: THREE.Vector3, out: THREE.Vector3) => void,
    opts: { margin?: number; kick?: boolean } = {}
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
        }
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
    this.updateRoofProps();
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
    for (const id of ids) {
      const x = cellX(this.voxels.ix[id] as number);
      const z = cellZ(this.voxels.iz[id] as number);
      const dx = x - cx;
      const dz = z - cz;
      const len = Math.hypot(dx, dz) + 0.5;
      // 中心から外へ少し膨らみながら崩れ落ちる
      this.destroyCell(
        id,
        (dx / len) * (1 + r.next() * 3),
        -r.next() * 2,
        (dz / len) * (1 + r.next() * 3),
        r.chance(0.3)
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
