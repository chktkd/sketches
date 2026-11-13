import { describe, expect, it } from 'vitest';
import { GRID_N, LAYERS_PER_FLOOR } from './config';
import { generateCity } from './layout';
import { VoxelWorld } from './voxel';

const city = generateCity();

describe('generateCity', () => {
  it('同じシードなら同じ街になる', () => {
    const again = generateCity();
    expect(again.buildings.length).toBe(city.buildings.length);
    expect(again.buildings[3]).toEqual(city.buildings[3]);
  });

  it('ビルは 60 棟以上あり、グリッド内に収まり、互いに重ならない', () => {
    expect(city.buildings.length).toBeGreaterThan(60);
    const occ = new Set<number>();
    for (const b of city.buildings) {
      expect(b.x0).toBeGreaterThanOrEqual(0);
      expect(b.z0).toBeGreaterThanOrEqual(0);
      expect(b.x0 + b.w).toBeLessThanOrEqual(GRID_N);
      expect(b.z0 + b.d).toBeLessThanOrEqual(GRID_N);
      expect(b.layers).toBe(b.floors * LAYERS_PER_FLOOR);
      for (let x = b.x0; x < b.x0 + b.w; x++) {
        for (let z = b.z0; z < b.z0 + b.d; z++) {
          const k = x * GRID_N + z;
          expect(occ.has(k)).toBe(false);
          occ.add(k);
        }
      }
    }
  });
});

describe('VoxelWorld', () => {
  const world = new VoxelWorld(city.buildings);

  it('セル総数が現実的な範囲で、占有グリッドと属性が一致する', () => {
    expect(world.count).toBeGreaterThan(20000);
    expect(world.count).toBeLessThan(120000);
    for (let id = 0; id < world.count; id += 997) {
      expect(
        world.idAt(world.ix[id] as number, world.iy[id] as number, world.iz[id] as number)
      ).toBe(id);
    }
  });

  it('無傷のビルには支えを失ったセルがない', () => {
    for (let i = 0; i < world.buildings.length; i += 7) {
      expect(world.findUnsupported(i)).toEqual([]);
    }
  });

  it('1 階の外壁を一周ぶん壊すと、上の階がすべて落ちる', () => {
    const w2 = new VoxelWorld(city.buildings);
    const bi = city.buildings.findIndex((b) => b.floors >= 5);
    const b = w2.buildings[bi]!;
    for (let id = b.start; id < b.start + b.count; id++) {
      if (w2.iy[id] === 2 || w2.iy[id] === 3) w2.remove(id);
    }
    const falling = w2.findUnsupported(bi);
    const expectFalling = [...Array(b.count).keys()]
      .map((k) => b.start + k)
      .filter((id) => w2.alive[id] && (w2.iy[id] as number) >= 2);
    expect(falling.length).toBe(expectFalling.length);
    expect(new Set(falling)).toEqual(new Set(expectFalling));
  });

  it('壁を一部だけ壊してもスラブでつながっていれば落ちない', () => {
    const w3 = new VoxelWorld(city.buildings);
    const bi = city.buildings.findIndex((b) => b.floors >= 4 && b.w >= 6);
    const b = w3.buildings[bi]!;
    // 3 階の層に 2 セルの穴をあける
    let removed = 0;
    for (let id = b.start; id < b.start + b.count && removed < 2; id++) {
      if (w3.iy[id] === 5 && w3.kind[id] === 0) {
        w3.remove(id);
        removed++;
      }
    }
    expect(w3.findUnsupported(bi)).toEqual([]);
  });

  it('1 階のつながりを断たれた塊は落下対象になる', () => {
    const w4 = new VoxelWorld(city.buildings);
    const bi = city.buildings.findIndex((b) => b.floors >= 3);
    const b = w4.buildings[bi]!;
    // 0〜1 層を壁だけでなくスラブも含め全部壊す → 上は全部落下
    for (let id = b.start; id < b.start + b.count; id++)
      if ((w4.iy[id] as number) <= 1) w4.remove(id);
    const falling = w4.findUnsupported(bi);
    expect(falling.length).toBe(b.alive);
  });

  it('無傷のセルには、破壊で露出した面がない（中空の壁の内外の面は露出済みとみなす）', () => {
    const w5 = new VoxelWorld(city.buildings);
    for (let id = 0; id < w5.count; id += 211) expect(w5.fracturedFaces(id)).toBe(0);
  });

  it('隣のセルを壊すと、その方向の面だけが「破壊で露出した面」になる', () => {
    const w6 = new VoxelWorld(city.buildings);
    const b = w6.buildings[city.buildings.findIndex((x) => x.floors >= 4 && x.w >= 6)]!;
    // 外壁（種類 0）のセルで、+x 側にも壁が続くもの
    let target = -1;
    for (let id = b.start; id < b.start + b.count; id++) {
      const right = w6.idAt((w6.ix[id] as number) + 1, w6.iy[id] as number, w6.iz[id] as number);
      if (w6.kind[id] === 0 && right >= 0 && w6.kind[right] === 0 && (w6.iy[id] as number) > 2) {
        target = id;
        break;
      }
    }
    expect(target).toBeGreaterThanOrEqual(0);
    const right = w6.idAt(
      (w6.ix[target] as number) + 1,
      w6.iy[target] as number,
      w6.iz[target] as number
    );
    expect(w6.fracturedFaces(target)).toBe(0);
    w6.remove(right);
    expect(w6.fracturedFaces(target)).toBe(1); // +x のビットだけ
  });
});
