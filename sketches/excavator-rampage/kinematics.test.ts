import { describe, expect, it } from 'vitest';
import { LIMITS, MIN_BAND, approachBand, forward, groundReach, inverse } from './kinematics';

describe('kinematics', () => {
  it('逆運動学の解を順運動学に戻すと、目標の刃先位置・バケット角に一致する', () => {
    let checked = 0;
    for (let x = 8; x < 30; x += 2.5) {
      for (let y = -4; y < 22; y += 3) {
        const ik = inverse({ x, y }, -1.1);
        if (!ik.reachable) continue;
        const pose = forward(ik);
        expect(pose.tip.x).toBeCloseTo(x, 4);
        expect(pose.tip.y).toBeCloseTo(y, 4);
        expect(pose.bucketAbs).toBeCloseTo(-1.1, 4);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(15);
  });

  it('届かない目標でも可動域内の角度を返し、reachable=false になる', () => {
    const ik = inverse({ x: 80, y: 0 }, -1);
    expect(ik.reachable).toBe(false);
    expect(ik.boom).toBeGreaterThanOrEqual(LIMITS.boom.min);
    expect(ik.boom).toBeLessThanOrEqual(LIMITS.boom.max);
    expect(ik.stick).toBeGreaterThanOrEqual(LIMITS.stick.min);
    expect(ik.stick).toBeLessThanOrEqual(LIMITS.stick.max);
  });

  it('地面に届く水平距離の範囲が巨大機にふさわしく、近接は機体より外にある', () => {
    const r = groundReach();
    expect(r.max).toBeGreaterThan(24);
    expect(r.min).toBeGreaterThan(5);
    expect(r.min).toBeLessThan(r.max);
  });
});

describe('approachBand', () => {
  const reach = groundReach();

  it('どの高さの目標でも、後退と前進の境界の間に停止できる幅がある（前後に往復しない）', () => {
    for (let y = 0; y <= 45; y += 0.5) {
      const { near, far } = approachBand(y, reach.min);
      expect(far - near, `height ${y}`).toBeGreaterThanOrEqual(MIN_BAND);
    }
  });

  it('高い目標ほど遠い側の境界は近づくが、近い側の境界を下回らない', () => {
    const low = approachBand(0, reach.min);
    const high = approachBand(40, reach.min);
    expect(high.far).toBeLessThanOrEqual(low.far);
    expect(high.far).toBeGreaterThan(high.near);
    expect(high.near).toBe(low.near);
  });
});
