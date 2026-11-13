/**
 * ショベルカーのアーム（ブーム・アーム・バケット）の平面リンク機構。
 * 座標は旋回体のローカル平面: x = 前、y = 上。three には依存しない。
 */

/** 旋回体の基準面（旋回リング上面）の地上高 */
export const SWING_Y = 4.4;
/** ブーム根元のピン位置 */
export const BOOM_FOOT = { x: 2.9, y: 2.1 } as const;
/** ブームの弦長（根元ピン→先端ピン） */
export const L_BOOM = 17;
/** アームの弦長（肘ピン→手首ピン） */
export const L_STICK = 11;
/** バケット座標系での刃先位置 */
export const BUCKET_TIP = { x: 4.0, y: -2.65 } as const;

export interface JointLimits {
  min: number;
  max: number;
}
export const LIMITS = {
  swing: { min: -Math.PI, max: Math.PI },
  boom: { min: -0.32, max: 1.28 },
  stick: { min: -2.75, max: -0.42 },
  bucket: { min: -2.35, max: 0.65 },
} as const;

export interface ArmAngles {
  boom: number;
  stick: number;
  bucket: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

export interface ArmPose {
  elbow: Vec2;
  wrist: Vec2;
  tip: Vec2;
  /** バケットの絶対角 */
  bucketAbs: number;
}

const rot = (v: Vec2, a: number): Vec2 => ({
  x: v.x * Math.cos(a) - v.y * Math.sin(a),
  y: v.x * Math.sin(a) + v.y * Math.cos(a),
});

export function forward(a: ArmAngles): ArmPose {
  const elbow = {
    x: BOOM_FOOT.x + L_BOOM * Math.cos(a.boom),
    y: BOOM_FOOT.y + L_BOOM * Math.sin(a.boom),
  };
  const sAbs = a.boom + a.stick;
  const wrist = { x: elbow.x + L_STICK * Math.cos(sAbs), y: elbow.y + L_STICK * Math.sin(sAbs) };
  const bucketAbs = sAbs + a.bucket;
  const off = rot(BUCKET_TIP, bucketAbs);
  return { elbow, wrist, tip: { x: wrist.x + off.x, y: wrist.y + off.y }, bucketAbs };
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface IkResult extends ArmAngles {
  /** 関節の可動域・届く範囲に収まったか */
  reachable: boolean;
}

/**
 * 刃先を (target) に、バケットを絶対角 bucketAbs の向きにするための関節角を返す。
 * 肘が上に出る解を採る。
 */
export function inverse(target: Vec2, bucketAbs: number): IkResult {
  const off = rot(BUCKET_TIP, bucketAbs);
  const wx = target.x - off.x - BOOM_FOOT.x;
  const wy = target.y - off.y - BOOM_FOOT.y;
  let d = Math.hypot(wx, wy);
  let reachable = true;
  const dMin = Math.abs(L_BOOM - L_STICK) + 0.05;
  const dMax = L_BOOM + L_STICK - 0.05;
  if (d < dMin || d > dMax) {
    reachable = false;
    d = clamp(d, dMin, dMax);
  }
  const a = Math.atan2(wy, wx);
  const alpha = Math.acos(
    clamp((L_BOOM * L_BOOM + d * d - L_STICK * L_STICK) / (2 * L_BOOM * d), -1, 1)
  );
  const gamma = Math.acos(
    clamp((L_BOOM * L_BOOM + L_STICK * L_STICK - d * d) / (2 * L_BOOM * L_STICK), -1, 1)
  );
  let boom = a + alpha;
  let stick = -(Math.PI - gamma);
  let bucket = bucketAbs - boom - stick;
  const cb = clamp(boom, LIMITS.boom.min, LIMITS.boom.max);
  const cs = clamp(stick, LIMITS.stick.min, LIMITS.stick.max);
  const ck = clamp(bucket, LIMITS.bucket.min, LIMITS.bucket.max);
  if (cb !== boom || cs !== stick || ck !== bucket) reachable = false;
  boom = cb;
  stick = cs;
  bucket = ck;
  return { boom, stick, bucket, reachable };
}

/** 刃先が届く水平距離（旋回中心から）の目安。地面付近で届く範囲 */
export function groundReach(): { min: number; max: number } {
  // 刃先を地面（旋回体の基準面から見て y = -SWING_Y）の少し上に置いたときの距離
  const gy = -SWING_Y + 0.15;
  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  for (let x = 4; x < 40; x += 0.25) {
    const r = inverse({ x, y: gy }, -1.0);
    if (r.reachable) {
      min = Math.min(min, x);
      max = Math.max(max, x);
    }
  }
  return { min, max };
}

/**
 * クリック粉砕の接近フェーズで、旋回中心から目標までの距離をどの範囲に収めるか。
 * near より近ければ後退、far より遠ければ前進し、その間なら停止して構えに移る。
 * 高い目標ほど腕を立てるので近づくが、near との間には必ず停止できる幅（MIN_BAND）を残す。
 * （残さないと、前進と後退の境界が逆転して機体が前後に往復し続ける）
 */
export const MIN_BAND = 2.5;

export function approachBand(
  targetHeight: number,
  groundReachMin: number
): { near: number; far: number } {
  const near = Math.max(groundReachMin + 3, 11);
  const desired = clamp(20 - Math.max(0, targetHeight) * 0.35, 13, 21) + 1.2;
  return { near, far: Math.max(desired, near + MIN_BAND) };
}
