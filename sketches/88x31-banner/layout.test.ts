import { describe, expect, it } from 'vitest';
import { anchorPoint, type InkMetrics, layoutText, reanchor } from './layout';

/** 内部余白のあるフォントを想定：字形は原点より 1px 右から始まり、高さ 7px（上 6 / 下 1） */
const m: InkMetrics = { left: -1, right: 21, ascent: 6, descent: 1 };

describe('layoutText', () => {
  it('左上基準では、字形の左上が (x, y) にそろう', () => {
    const r = layoutText({ x: 10, y: 5, sx: 100, fx: 'none' }, m);
    expect(r.bb).toEqual({ x: 10, y: 5, w: 20, h: 7 });
    // 原点は字形の左端より 1px 左、ベースラインは上端から ascent 下
    expect(r.originX).toBe(9);
    expect(r.originY).toBe(11);
  });

  it('中央基準では、字形の中心が (x, y) に来る', () => {
    const r = layoutText({ x: 44, y: 15.5, ax: 'center', ay: 'middle', sx: 100, fx: 'none' }, m);
    expect(r.bb.x + r.bb.w / 2).toBe(44);
    expect(r.bb.y + r.bb.h / 2).toBe(15.5);
  });

  it('右下基準では、字形の右下が (x, y) にそろう', () => {
    const r = layoutText({ x: 86, y: 29, ax: 'right', ay: 'bottom', sx: 100, fx: 'none' }, m);
    expect(r.bb.x + r.bb.w).toBe(86);
    expect(r.bb.y + r.bb.h).toBe(29);
  });

  it('字形の左上は整数ピクセルに丸める（奇数幅を中央に置いても格子からずれない）', () => {
    const odd: InkMetrics = { left: 0, right: 7, ascent: 5, descent: 0 };
    const r = layoutText({ x: 44, y: 15, ax: 'center', ay: 'middle', sx: 100, fx: 'none' }, odd);
    expect(Number.isInteger(r.bb.x)).toBe(true);
    expect(Number.isInteger(r.bb.y)).toBe(true);
  });

  it('横幅の拡縮は幅と原点の両方に効く', () => {
    const r = layoutText({ x: 0, y: 0, sx: 50, fx: 'none' }, m);
    expect(r.bb.w).toBe(10);
    expect(r.originX).toBe(-0.5);
  });

  it('縁取りは上下左右に 1px、影は右下に 1px 当たり判定を広げる', () => {
    const base = { x: 10, y: 5, sx: 100 };
    expect(layoutText({ ...base, fx: 'outline' }, m).bb).toEqual({ x: 9, y: 4, w: 22, h: 9 });
    expect(layoutText({ ...base, fx: 'shadow' }, m).bb).toEqual({ x: 10, y: 5, w: 21, h: 8 });
  });
});

describe('anchorPoint', () => {
  const anchors = (['left', 'center', 'right'] as const).flatMap((ax) =>
    (['top', 'middle', 'bottom'] as const).map((ay) => [ax, ay] as const)
  );
  /* 横幅の拡縮で字形幅が小数になるケースを含める（20px × 66% = 13.2px） */
  const sizes: [string, InkMetrics, number][] = [
    ['等倍', m, 100],
    ['縮小で小数幅', { left: 0, right: 20, ascent: 6, descent: 1 }, 66],
    ['拡大で小数幅', { left: 0.4, right: 9.3, ascent: 5.5, descent: 1.2 }, 133],
  ];

  it.each(sizes)('%s: どの基準点に付け替えても位置が変わらない', (_, metrics, sx) => {
    for (const fx of ['none', 'shadow', 'outline'] as const) {
      const before = layoutText({ x: 10, y: 5, sx, fx }, metrics);
      for (const [ax, ay] of anchors) {
        const p = anchorPoint(before.ink, ax, ay);
        const after = layoutText({ ...p, ax, ay, sx, fx }, metrics);
        expect(after.bb, `${ax}/${ay}/${fx}`).toEqual(before.bb);
      }
    }
  });

  it('連動フレームの位置（小数部が違っても）から付け替えても、そのフレームの見た目は変わらない', () => {
    const metrics: InkMetrics = { left: 0, right: 20, ascent: 6, descent: 1 };
    const sx = 66;
    const size = layoutText({ x: 0, y: 0, sx, fx: 'none' }, metrics).ink;
    for (const x of [30, 30.5, 57.25, -12, 0.75]) {
      for (const y of [5, 15.5, 22.25]) {
        const frame = { x, y, ax: 'center', ay: 'middle', sx, fx: 'none' } as const;
        const before = layoutText(frame, metrics).bb;
        for (const [ax, ay] of anchors) {
          const p = reanchor(frame, size, ax, ay);
          expect(
            layoutText({ ...frame, ...p, ax, ay }, metrics).bb,
            `${x},${y} ${ax}/${ay}`
          ).toEqual(before);
        }
      }
    }
  });
});
