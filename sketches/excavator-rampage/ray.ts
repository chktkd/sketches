/**
 * 原点 o・向き d のレイを、XZ 平面の正方形 [-half, half]² に切り取る。
 * 区間 [t0, t1]（0 <= t0 <= t1 <= maxDist）を返し、交差しなければ null。
 * 原点が範囲の外でも、範囲の内側へ向かうなら入口から探索を始められる。
 */
export function clipRayToSquare(
  o: { x: number; z: number },
  d: { x: number; z: number },
  half: number,
  maxDist: number
): [number, number] | null {
  let t0 = 0;
  let t1 = maxDist;
  for (const [oc, dc] of [
    [o.x, d.x],
    [o.z, d.z],
  ] as const) {
    if (Math.abs(dc) < 1e-9) {
      // 軸に平行: 範囲の外にいるならずっと交差しない
      if (Math.abs(oc) > half) return null;
      continue;
    }
    const a = (-half - oc) / dc;
    const b = (half - oc) / dc;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
    if (t0 > t1) return null;
  }
  return [t0, t1];
}
