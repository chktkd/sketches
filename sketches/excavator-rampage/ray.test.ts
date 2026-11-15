import { describe, expect, it } from 'vitest';
import { clipRayToSquare } from './ray';

describe('clipRayToSquare', () => {
  it('範囲の内側から出るレイは、原点から出口までを返す', () => {
    const r = clipRayToSquare({ x: 0, z: 0 }, { x: 1, z: 0 }, 100, 1000)!;
    expect(r[0]).toBe(0);
    expect(r[1]).toBeCloseTo(100);
  });

  it('範囲の外から内側へ向かうレイは、入口から探索できる（ズームアウトしたカメラ）', () => {
    // 原点から z = +249 の位置で、街の中心 (0,0) の方を向く
    const r = clipRayToSquare({ x: 0, z: 249 }, { x: 0, z: -1 }, 199, 600)!;
    expect(r[0]).toBeCloseTo(50);
    expect(r[1]).toBeCloseTo(448);
  });

  it('範囲の外から外へ向かうレイは交差しない', () => {
    expect(clipRayToSquare({ x: 0, z: 249 }, { x: 0, z: 1 }, 199, 600)).toBeNull();
  });

  it('軸に平行で範囲の外を通るレイは交差しない', () => {
    expect(clipRayToSquare({ x: 300, z: 0 }, { x: 0, z: 1 }, 199, 600)).toBeNull();
  });

  it('届く距離より遠い入口は交差しない', () => {
    expect(clipRayToSquare({ x: 0, z: 800 }, { x: 0, z: -1 }, 199, 300)).toBeNull();
  });
});
