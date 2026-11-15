import { BLOCKS, BLOCK_CELLS, GRID_N, LAYERS_PER_FLOOR, PITCH, ROAD_CELLS } from './config';
import { type Rng, createRng } from './rng';

export type FacadeStyle = 0 | 1 | 2 | 3; // 0 カーテンウォール / 1 打放し+punch窓 / 2 レンガ住宅 / 3 帯状窓

export interface BuildingSpec {
  /** グリッド上の左下セル */
  x0: number;
  z0: number;
  w: number;
  d: number;
  floors: number;
  /** floors * LAYERS_PER_FLOOR。屋根スラブは layers 番目の層に載る */
  layers: number;
  style: FacadeStyle;
  seed: number;
  tint: [number, number, number];
}

export interface Lot {
  x0: number;
  z0: number;
  w: number;
  d: number;
  kind: 'building' | 'park' | 'plaza';
}

export interface PropSpec {
  type: 'car' | 'tree' | 'lamp' | 'pole' | 'signal';
  x: number;
  z: number;
  /** ラジアン。0 で +X 向き */
  rot: number;
  /** 見た目のばらつき 0..1 */
  v: number;
}

export interface CityLayout {
  buildings: BuildingSpec[];
  lots: Lot[];
  props: PropSpec[];
}

const MAX_FLOORS = 14;

const TINTS: Record<FacadeStyle, [number, number, number][]> = {
  0: [
    [0.62, 0.78, 0.86],
    [0.55, 0.66, 0.78],
    [0.7, 0.82, 0.8],
    [0.5, 0.58, 0.66],
  ],
  1: [
    [0.86, 0.84, 0.78],
    [0.78, 0.78, 0.78],
    [0.92, 0.9, 0.84],
    [0.72, 0.7, 0.66],
  ],
  2: [
    [0.82, 0.5, 0.38],
    [0.72, 0.42, 0.32],
    [0.86, 0.66, 0.46],
    [0.6, 0.38, 0.3],
  ],
  3: [
    [0.88, 0.88, 0.86],
    [0.74, 0.78, 0.82],
    [0.9, 0.82, 0.7],
    [0.66, 0.7, 0.72],
  ],
};

function splitLot(rng: Rng, x0: number, z0: number, w: number, d: number, depth: number): Lot[] {
  const MIN = 10;
  const canX = w >= MIN * 2;
  const canZ = d >= MIN * 2;
  if (depth > 2 || (!canX && !canZ) || (depth > 0 && rng.chance(0.25))) {
    return [{ x0, z0, w, d, kind: 'building' }];
  }
  const alongX = canX && (!canZ || w >= d) ? true : !canZ;
  const gap = 2;
  if (alongX) {
    const cut = Math.round(rng.range(0.38, 0.62) * w);
    return [
      ...splitLot(rng, x0, z0, cut - gap / 2, d, depth + 1),
      ...splitLot(rng, x0 + cut + gap / 2, z0, w - cut - gap / 2, d, depth + 1),
    ].map((l) => ({ ...l, x0: Math.round(l.x0), w: Math.round(l.w) }));
  }
  const cut = Math.round(rng.range(0.38, 0.62) * d);
  return [
    ...splitLot(rng, x0, z0, w, cut - gap / 2, depth + 1),
    ...splitLot(rng, x0, z0 + cut + gap / 2, w, d - cut - gap / 2, depth + 1),
  ].map((l) => ({ ...l, z0: Math.round(l.z0), d: Math.round(l.d) }));
}

function styleFor(rng: Rng, floors: number): FacadeStyle {
  if (floors <= 3) return rng.chance(0.75) ? 2 : 1;
  if (floors <= 7) return rng.pick([1, 1, 3, 2, 0] as const);
  return rng.pick([0, 0, 3, 1] as const);
}

export function generateCity(seed = 20261113): CityLayout {
  const rng = createRng(seed);
  const buildings: BuildingSpec[] = [];
  const lots: Lot[] = [];
  const props: PropSpec[] = [];
  const center = GRID_N / 2;
  const maxDist = Math.hypot(center, center);

  for (let bx = 0; bx < BLOCKS; bx++) {
    for (let bz = 0; bz < BLOCKS; bz++) {
      const x0 = ROAD_CELLS + bx * PITCH;
      const z0 = ROAD_CELLS + bz * PITCH;
      // 中央ブロックは広場にして、最初に目に入る位置を開けておく（スポーン用）
      const isSpawn = bx === Math.floor(BLOCKS / 2) && bz === BLOCKS - 1;
      if (isSpawn) {
        lots.push({ x0, z0, w: BLOCK_CELLS, d: BLOCK_CELLS, kind: 'plaza' });
        continue;
      }
      if (rng.chance(0.09)) {
        lots.push({ x0, z0, w: BLOCK_CELLS, d: BLOCK_CELLS, kind: 'park' });
        continue;
      }
      const sub = splitLot(rng, x0, z0, BLOCK_CELLS, BLOCK_CELLS, 0);
      for (const lot of sub) {
        if (rng.chance(0.08)) {
          lots.push({ ...lot, kind: 'plaza' });
          continue;
        }
        const sbL = rng.int(1, 2);
        const sbR = rng.int(1, 2);
        const sbF = rng.int(1, 2);
        const sbB = rng.int(1, 2);
        const w = lot.w - sbL - sbR;
        const d = lot.d - sbF - sbB;
        if (w < 5 || d < 5) {
          lots.push({ ...lot, kind: 'plaza' });
          continue;
        }
        const cx = lot.x0 + lot.w / 2;
        const cz = lot.z0 + lot.d / 2;
        const dist = Math.hypot(cx - center, cz - center) / maxDist;
        const tall = 1 - Math.min(1, dist * 1.35);
        let floors = Math.round(2 + tall * 8 + rng.range(-1.5, 4.5));
        if (w >= 8 && d >= 8 && tall > 0.35 && rng.chance(0.5)) floors += 3;
        if (w <= 6 || d <= 6) floors = Math.min(floors, rng.int(2, 5));
        floors = Math.max(2, Math.min(MAX_FLOORS, floors));
        const style = styleFor(rng, floors);
        buildings.push({
          x0: lot.x0 + sbL,
          z0: lot.z0 + sbB,
          w,
          d,
          floors,
          layers: floors * LAYERS_PER_FLOOR,
          style,
          seed: rng.range(0, 1000),
          tint: rng.pick(TINTS[style]),
        });
        lots.push({ ...lot, kind: 'building' });
      }
    }
  }

  // 道路沿いの小物。道路は [ROAD_CELLS + i*PITCH - ROAD_CELLS, ...) の帯
  for (let i = 0; i <= BLOCKS; i++) {
    const roadStart = i * PITCH; // 道路の開始セル（幅 ROAD_CELLS）
    const roadMid = roadStart + ROAD_CELLS / 2;
    for (let c = 3; c < GRID_N - 3; c += 5) {
      if (rng.chance(0.5)) continue;
      const lane = rng.chance(0.5) ? -1 : 1;
      const off = lane * rng.range(1.6, 3.4);
      const dir = lane > 0 ? 0 : Math.PI;
      // 東西方向の道路
      props.push({ type: 'car', x: c, z: roadMid + off, rot: dir, v: rng.next() });
      // 南北方向の道路
      props.push({
        type: 'car',
        x: roadMid + off,
        z: c,
        rot: lane > 0 ? Math.PI / 2 : -Math.PI / 2,
        v: rng.next(),
      });
    }
    // 並木と街灯（歩道の位置: 道路の端から 0.7 セル内側）
    for (let c = 2; c < GRID_N - 2; c += 4) {
      // 交差する道路の上には置かない
      if (isRoadCoord(c)) continue;
      for (const edge of [roadStart - 0.8, roadStart + ROAD_CELLS + 0.8]) {
        const isLamp = Math.floor(c / 4) % 2 === 0;
        props.push({ type: isLamp ? 'lamp' : 'tree', x: c, z: edge, rot: 0, v: rng.next() });
        props.push({ type: isLamp ? 'lamp' : 'tree', x: edge, z: c, rot: 0, v: rng.next() });
      }
    }
  }
  // 電柱: 各道路の北・西側の歩道に 30m おき。街路樹・街灯（c が 4 で割って 2 余る位置）と重ならない
  for (let i = 0; i <= BLOCKS; i++) {
    const edge = i * PITCH - 0.8;
    for (let c = 4; c < GRID_N - 2; c += 20) {
      if (isRoadCoord(c)) continue;
      props.push({ type: 'pole', x: c, z: edge, rot: 0, v: rng.next() });
      props.push({ type: 'pole', x: edge, z: c, rot: Math.PI / 2, v: rng.next() });
    }
  }
  // 信号機: 各交差点の対角 2 か所。腕が車道の上へ張り出す
  for (let i = 0; i <= BLOCKS; i++) {
    for (let j = 0; j <= BLOCKS; j++) {
      const x0 = i * PITCH;
      const z0 = j * PITCH;
      props.push({ type: 'signal', x: x0 - 0.6, z: z0 - 0.6, rot: -Math.PI / 2, v: rng.next() });
      props.push({
        type: 'signal',
        x: x0 + ROAD_CELLS + 0.6,
        z: z0 + ROAD_CELLS + 0.6,
        rot: Math.PI / 2,
        v: rng.next(),
      });
    }
  }
  // 交差点の車は邪魔なので間引く: 交差点内の位置は後段（world）で弾く
  return { buildings, lots, props };
}

/** グリッド座標 c が道路（ブロックの間の帯）の中か */
export function isRoadCoord(c: number): boolean {
  const m = ((c % PITCH) + PITCH) % PITCH;
  return m < ROAD_CELLS;
}

export function isInRoadIntersection(gx: number, gz: number): boolean {
  return isRoadCoord(gx) && isRoadCoord(gz);
}
