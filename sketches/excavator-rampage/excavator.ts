import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { WorldBox } from './world';
import {
  BOOM_FOOT,
  LIMITS,
  L_BOOM,
  L_STICK,
  SWING_Y,
  type ArmAngles,
  clamp,
  forward,
} from './kinematics';

/* ───────────── マテリアル ───────────── */

function makeMaterials() {
  const paint = new THREE.MeshPhysicalMaterial({
    color: 0xf2b300,
    roughness: 0.4,
    metalness: 0.12,
    clearcoat: 0.55,
    clearcoatRoughness: 0.3,
  });
  const paintWorn = paint.clone();
  paintWorn.color.setHex(0xd99f00);
  paintWorn.roughness = 0.55;
  const dark = new THREE.MeshStandardMaterial({
    color: 0x23262a,
    roughness: 0.55,
    metalness: 0.75,
  });
  const darkPaint = new THREE.MeshPhysicalMaterial({
    color: 0x2f3338,
    roughness: 0.5,
    metalness: 0.3,
    clearcoat: 0.3,
    clearcoatRoughness: 0.5,
  });
  const steel = new THREE.MeshStandardMaterial({
    color: 0xb4bac2,
    roughness: 0.3,
    metalness: 0.95,
  });
  const bucketSteel = new THREE.MeshStandardMaterial({
    color: 0x5a5f66,
    roughness: 0.5,
    metalness: 0.9,
  });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0d0e10, roughness: 0.95, metalness: 0 });
  const pad = new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.6, metalness: 0.8 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x1b2e38,
    roughness: 0.03,
    metalness: 0.2,
    transparent: true,
    opacity: 0.38,
    envMapIntensity: 1.8,
    clearcoat: 1,
  });
  const lamp = new THREE.MeshStandardMaterial({
    color: 0xfff4d8,
    emissive: 0xfff0c0,
    emissiveIntensity: 1.2,
    roughness: 0.2,
  });
  const seat = new THREE.MeshStandardMaterial({ color: 0x1a1c1f, roughness: 0.85 });
  return { paint, paintWorn, dark, darkPaint, steel, bucketSteel, rubber, pad, glass, lamp, seat };
}
type Mats = ReturnType<typeof makeMaterials>;

/* ───────────── ヘルパー ───────────── */

function add(
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x = 0,
  y = 0,
  z = 0
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
const rbox = (w: number, h: number, d: number, r = 0.2) =>
  new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
/** z 軸まわりの円柱（ピン・ローラー） */
function zcyl(r: number, len: number, seg = 24) {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateX(Math.PI / 2);
  return g;
}

function smoothShape(
  top: [number, number][],
  bottom: [number, number][],
  samples = 26
): THREE.Shape {
  const t = new THREE.SplineCurve(top.map(([x, y]) => new THREE.Vector2(x, y))).getPoints(samples);
  const b = new THREE.SplineCurve(bottom.map(([x, y]) => new THREE.Vector2(x, y))).getPoints(
    samples
  );
  const s = new THREE.Shape();
  s.moveTo(t[0]!.x, t[0]!.y);
  for (const p of t.slice(1)) s.lineTo(p.x, p.y);
  for (const p of b) s.lineTo(p.x, p.y);
  s.closePath();
  return s;
}

function extrude(shape: THREE.Shape, depth: number, bevel = 0.14): THREE.ExtrudeGeometry {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 12,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

function labelTexture(
  text: string,
  opts: { w: number; h: number; fg: string; bg?: string; font?: string }
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = opts.w;
  c.height = opts.h;
  const ctx = c.getContext('2d')!;
  if (opts.bg) {
    ctx.fillStyle = opts.bg;
    ctx.fillRect(0, 0, c.width, c.height);
  }
  ctx.fillStyle = opts.fg;
  ctx.font = opts.font ?? `800 ${Math.floor(opts.h * 0.7)}px "Arial Black", Impact, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, c.width / 2, c.height / 2 + opts.h * 0.04);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function hazardTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f2b300';
  ctx.fillRect(0, 0, 512, 64);
  ctx.fillStyle = '#16181a';
  for (let x = -64; x < 580; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 64);
    ctx.lineTo(x + 32, 64);
    ctx.lineTo(x + 64, 0);
    ctx.lineTo(x + 32, 0);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/* ───────────── 油圧シリンダーとリンク ───────────── */

class Cylinder {
  readonly group = new THREE.Group();
  private readonly barrel: THREE.Mesh;
  private readonly rod: THREE.Mesh;
  private readonly sleeve: THREE.Mesh;

  constructor(
    parent: THREE.Object3D,
    mats: Mats,
    private readonly barrelLen: number,
    rBarrel: number,
    rRod: number
  ) {
    // 円柱は +X 軸向き、長さ 1 の基準形を伸縮して使う
    const unit = (r: number) => {
      const g = new THREE.CylinderGeometry(r, r, 1, 20);
      g.rotateZ(-Math.PI / 2);
      g.translate(0.5, 0, 0);
      return g;
    };
    this.barrel = add(this.group, unit(rBarrel), mats.paintWorn);
    this.sleeve = add(this.group, unit(rBarrel * 1.18), mats.dark);
    this.rod = add(this.group, unit(rRod), mats.steel);
    parent.add(this.group);
  }

  /** a から b へ（親のローカル座標） */
  place(a: THREE.Vector3, b: THREE.Vector3) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    dir.divideScalar(len || 1);
    this.group.position.copy(a);
    this.group.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
    const bl = Math.min(this.barrelLen, len * 0.8);
    this.barrel.scale.x = bl;
    this.sleeve.scale.x = 0.9;
    this.sleeve.position.x = bl - 0.9;
    this.rod.scale.x = len - bl + 0.8;
    this.rod.position.x = bl - 0.8;
  }
}

class Bar {
  readonly mesh: THREE.Mesh;
  constructor(parent: THREE.Object3D, mat: THREE.Material, thick: number, depth: number) {
    const g = new RoundedBoxGeometry(1, thick, depth, 2, Math.min(thick, depth) * 0.45);
    g.translate(0.5, 0, 0);
    this.mesh = add(parent, g, mat);
  }
  place(a: THREE.Vector3, b: THREE.Vector3) {
    const d = new THREE.Vector3().subVectors(b, a);
    this.mesh.position.copy(a);
    this.mesh.rotation.set(0, 0, Math.atan2(d.y, d.x));
    this.mesh.scale.x = d.length();
  }
}

/* ───────────── 当たり判定 ───────────── */

export interface HitVolume {
  name: string;
  object: THREE.Object3D;
  center: THREE.Vector3;
  half: THREE.Vector3;
  /** 破片を押しのけるか */
  kick: boolean;
  prev: THREE.Matrix4;
  hasPrev: boolean;
}

/* ───────────── 関節 ───────────── */

interface Joint {
  angle: number;
  target: number;
  /** 追従の速さ（大きいほど目標に素早く合わせる） */
  k: number;
  maxRate: number;
  min: number;
  max: number;
}

const newJoint = (a: number, min: number, max: number): Joint => ({
  angle: a,
  target: a,
  k: 10,
  maxRate: 1,
  min,
  max,
});

export interface DriveInput {
  drive: number;
  turn: number;
  swing: number;
  boom: number;
  stick: number;
  bucket: number;
}

export const REST_POSE: ArmAngles = { boom: 0.62, stick: -1.55, bucket: -0.85 };

/* 履帯の寸法 */
const TRACK_Z = 4.95;
const TRACK_W = 3.0;
const SPR_X = 6.4;
const TR_R = 2.0;
const TR_CY = 2.1;
const PAD_N = 42;
const Z_AXIS = new THREE.Vector3(0, 0, 1);
/** 機体全体の拡大率。街のビルに対して「巨大」に見える大きさ */
export const MACHINE_SCALE = 1.35;
const STRAIGHT = 2 * SPR_X;
const ARC = Math.PI * TR_R;
const PATH_LEN = 2 * STRAIGHT + 2 * ARC;

/** 履帯の経路上の位置と進行方向。u 増加で下側の走行面が機体の後ろへ流れる */
function trackPath(u: number): { x: number; y: number; a: number } {
  let s = ((u % PATH_LEN) + PATH_LEN) % PATH_LEN;
  if (s < STRAIGHT) return { x: SPR_X - s, y: TR_CY - TR_R, a: Math.PI };
  s -= STRAIGHT;
  if (s < ARC) {
    const th = -Math.PI / 2 - s / TR_R;
    return { x: -SPR_X + TR_R * Math.cos(th), y: TR_CY + TR_R * Math.sin(th), a: th - Math.PI / 2 };
  }
  s -= ARC;
  if (s < STRAIGHT) return { x: -SPR_X + s, y: TR_CY + TR_R, a: 0 };
  s -= STRAIGHT;
  const th = Math.PI / 2 - s / TR_R;
  return { x: SPR_X + TR_R * Math.cos(th), y: TR_CY + TR_R * Math.sin(th), a: th - Math.PI / 2 };
}

export class Excavator {
  readonly root = new THREE.Group();
  readonly swingGroup = new THREE.Group();
  readonly boomGroup = new THREE.Group();
  readonly stickGroup = new THREE.Group();
  readonly bucketGroup = new THREE.Group();
  readonly headlights: THREE.SpotLight[] = [];
  readonly volumes: HitVolume[] = [];

  /** 車体の姿勢 */
  x = 0;
  z = 0;
  heading = 0;
  /** 左右の履帯速度（m/s）。前進が正 */
  vL = 0;
  vR = 0;
  /** 速度の抑制（破壊中は重くなる） */
  resist = 0;
  readonly joints = {
    swing: newJoint(0, LIMITS.swing.min, LIMITS.swing.max),
    boom: newJoint(REST_POSE.boom, LIMITS.boom.min, LIMITS.boom.max),
    stick: newJoint(REST_POSE.stick, LIMITS.stick.min, LIMITS.stick.max),
    bucket: newJoint(REST_POSE.bucket, LIMITS.bucket.min, LIMITS.bucket.max),
  };

  private readonly mats = makeMaterials();
  private readonly pads: THREE.InstancedMesh[] = [];
  private readonly padU = [0, 0];
  private readonly wheels: THREE.Object3D[][] = [[], []];
  private readonly boomCyls: Cylinder[] = [];
  private armCyl!: Cylinder;
  private bucketCyl!: Cylinder;
  private readonly bars: Bar[] = [];
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpV = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private cabLight!: THREE.Object3D;

  constructor() {
    const m = this.mats;
    this.root.add(this.swingGroup);
    this.root.scale.setScalar(MACHINE_SCALE);
    this.swingGroup.position.y = SWING_Y;
    this.buildUndercarriage(m);
    this.buildHouse(m);
    this.buildBoom(m);
    this.buildStick(m);
    this.buildBucket(m);
    this.buildCylinders(m);
    this.defineVolumes();
    this.applyPose();
  }

  /* ─────────── 下回り ─────────── */

  private buildUndercarriage(m: Mats) {
    const r = this.root;
    // 中央フレーム
    add(r, rbox(10.6, 1.7, 7.0, 0.4), m.darkPaint, 0, 2.9, 0);
    add(r, rbox(8.6, 0.9, 9.4, 0.3), m.dark, 0, 3.3, 0);
    // 旋回リング
    add(r, new THREE.CylinderGeometry(4.5, 4.7, 0.8, 48), m.dark, 0, 4.0, 0);
    add(r, new THREE.TorusGeometry(4.55, 0.16, 8, 64).rotateX(Math.PI / 2), m.steel, 0, 4.42, 0);

    // 履帯用のパッド形状
    const padParts: THREE.BufferGeometry[] = [];
    const plate = new THREE.BoxGeometry(0.86, 0.2, TRACK_W);
    padParts.push(plate.toNonIndexed());
    for (const gx of [-0.27, 0, 0.27]) {
      const rib = new THREE.BoxGeometry(0.11, 0.17, TRACK_W * 0.98);
      rib.translate(gx, 0.17, 0);
      padParts.push(rib.toNonIndexed());
    }
    for (const gx of [-0.43, 0.43]) {
      const pin = new THREE.CylinderGeometry(0.1, 0.1, TRACK_W + 0.12, 8);
      pin.rotateX(Math.PI / 2);
      pin.translate(gx, -0.02, 0);
      padParts.push(pin.toNonIndexed());
    }
    const padGeo = mergeGeometries(padParts, false);

    for (let si = 0; si < 2; si++) {
      const s = si === 0 ? -1 : 1;
      const z0 = s * TRACK_Z;
      const side = new THREE.Group();
      side.position.z = z0;
      r.add(side);
      // サイドフレーム（履帯の輪の内側）
      add(side, rbox(2 * SPR_X + 0.6, 1.9, 1.6, 0.4), m.darkPaint, 0, TR_CY, 0);
      // 上部のカバー
      add(
        side,
        rbox(2 * SPR_X - 1.2, 0.34, TRACK_W + 0.5, 0.12),
        m.paintWorn,
        0,
        TR_CY + TR_R + 0.55,
        0
      );
      // 起動輪とアイドラー
      for (const x of [-SPR_X, SPR_X]) {
        const w = new THREE.Group();
        w.position.set(x, TR_CY, 0);
        side.add(w);
        add(w, zcyl(TR_R - 0.35, TRACK_W - 0.5, 32), m.dark);
        for (const zz of [-TRACK_W / 2 + 0.18, TRACK_W / 2 - 0.18]) {
          add(w, zcyl(TR_R - 0.05, 0.3, 32), m.pad, 0, 0, zz);
        }
        add(w, zcyl(0.75, TRACK_W + 0.2, 20), m.steel);
        for (let b = 0; b < 8; b++) {
          const a = (b / 8) * Math.PI * 2;
          add(
            w,
            zcyl(0.1, 0.16, 8),
            m.steel,
            Math.cos(a) * 1.2,
            Math.sin(a) * 1.2,
            TRACK_W / 2 + 0.1
          );
          add(
            w,
            zcyl(0.1, 0.16, 8),
            m.steel,
            Math.cos(a) * 1.2,
            Math.sin(a) * 1.2,
            -TRACK_W / 2 - 0.1
          );
        }
        this.wheels[si]!.push(w);
      }
      // 下部転輪と上部転輪
      for (let i = 0; i < 7; i++) {
        const x = -4.8 + i * 1.6;
        const w = new THREE.Group();
        w.position.set(x, 1.0, 0);
        side.add(w);
        add(w, zcyl(0.66, 1.05, 20), m.dark);
        add(w, zcyl(0.9, 0.18, 20), m.pad, 0, 0, 0.5);
        add(w, zcyl(0.9, 0.18, 20), m.pad, 0, 0, -0.5);
        add(w, zcyl(0.25, 1.3, 12), m.steel);
        this.wheels[si]!.push(w);
      }
      for (const x of [-2.6, 2.6]) {
        const w = new THREE.Group();
        w.position.set(x, TR_CY + TR_R - 0.55, 0);
        side.add(w);
        add(w, zcyl(0.46, 1.0, 16), m.dark);
        this.wheels[si]!.push(w);
      }
      // パッド
      const pads = new THREE.InstancedMesh(padGeo, m.pad, PAD_N);
      pads.castShadow = true;
      pads.receiveShadow = true;
      pads.frustumCulled = false;
      pads.position.z = z0;
      r.add(pads);
      this.pads.push(pads);
    }
    this.updateTracks(0, 0);
  }

  private updateTracks(dL: number, dR: number) {
    const dist = [dL, dR];
    for (let si = 0; si < 2; si++) {
      this.padU[si] = ((this.padU[si] as number) + (dist[si] as number)) % PATH_LEN;
      const pads = this.pads[si]!;
      for (let i = 0; i < PAD_N; i++) {
        const p = trackPath((this.padU[si] as number) + (i * PATH_LEN) / PAD_N);
        this.tmpQ.setFromAxisAngle(Z_AXIS, p.a);
        this.tmpM.compose(this.tmpV.set(p.x, p.y, 0), this.tmpQ, this.one);
        pads.setMatrixAt(i, this.tmpM);
      }
      pads.instanceMatrix.needsUpdate = true;
      for (const w of this.wheels[si]!) w.rotation.z -= (dist[si] as number) / 0.9;
    }
  }

  /* ─────────── 旋回体 ─────────── */

  private buildHouse(m: Mats) {
    const h = this.swingGroup;
    // 床板
    add(h, rbox(13.4, 0.9, 10.2, 0.3), m.darkPaint, -0.9, 0.45, 0);
    add(h, rbox(13.0, 0.18, 9.8, 0.08), m.dark, -0.9, 0.95, 0);
    // カウンターウェイト
    add(h, rbox(3.5, 4.4, 9.6, 0.6), m.paintWorn, -7.2, 3.1, 0);
    const hz = new THREE.Mesh(
      new THREE.PlaneGeometry(8.4, 1.05),
      new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.6, metalness: 0.1 })
    );
    hz.position.set(-8.98, 1.55, 0);
    hz.rotation.y = -Math.PI / 2;
    h.add(hz);
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(6.6, 1.5),
      new THREE.MeshStandardMaterial({
        map: labelTexture('CHKTKD', { w: 1024, h: 230, fg: '#17191b' }),
        transparent: true,
        roughness: 0.5,
      })
    );
    label.position.set(-8.99, 3.6, 0);
    label.rotation.y = -Math.PI / 2;
    h.add(label);
    // 機械室（右側）
    add(h, rbox(6.4, 3.7, 4.4, 0.5), m.paint, -3.2, 2.85, 2.6);
    add(h, rbox(5.2, 0.25, 3.4, 0.1), m.darkPaint, -3.2, 4.8, 2.6);
    for (let i = 0; i < 7; i++) {
      add(h, new THREE.BoxGeometry(0.16, 1.5, 0.1), m.dark, -5.4 + i * 0.5, 3.4, 4.83);
    }
    for (let i = 0; i < 5; i++) {
      add(h, new THREE.BoxGeometry(0.16, 0.1, 3.2), m.dark, -4.8 + i * 0.5, 4.78, 2.6);
    }
    const sideLabel = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 0.62),
      new THREE.MeshStandardMaterial({
        map: labelTexture('RAMPAGE-9000', {
          w: 1024,
          h: 190,
          fg: '#16181a',
          font: '800 130px "Arial Black", Impact, sans-serif',
        }),
        transparent: true,
        roughness: 0.5,
      })
    );
    sideLabel.position.set(-1.5, 2.2, 4.83);
    h.add(sideLabel);
    // 排気管
    add(h, new THREE.CylinderGeometry(0.28, 0.32, 2.6, 14), m.dark, -5.3, 6.4, 3.6);
    add(h, new THREE.CylinderGeometry(0.4, 0.28, 0.35, 14), m.steel, -5.3, 7.8, 3.6);
    // 作動油タンク・燃料タンク
    add(h, rbox(3.0, 1.9, 1.6, 0.35), m.paint, 1.9, 1.95, 3.9);
    add(h, rbox(2.2, 0.35, 1.2, 0.1), m.dark, 1.9, 3.0, 3.9);
    // 手すり
    for (let i = 0; i < 6; i++) {
      add(h, new THREE.CylinderGeometry(0.07, 0.07, 1.3, 8), m.steel, -1.4 + i * 1.0, 1.65, 4.95);
    }
    const rail = new THREE.CylinderGeometry(0.07, 0.07, 5.2, 8);
    rail.rotateZ(Math.PI / 2);
    add(h, rail, m.steel, 1.2, 2.3, 4.95);

    // 運転席
    const cab = new THREE.Group();
    cab.position.set(1.4, 0, -2.85);
    h.add(cab);
    add(cab, rbox(4.8, 0.3, 3.7, 0.1), m.dark, 0.1, 1.05, 0);
    // ピラー・ルーフ
    for (const [x, z] of [
      [-2.2, -1.75],
      [-2.2, 1.75],
      [2.3, -1.75],
      [2.3, 1.75],
    ] as const) {
      add(cab, new RoundedBoxGeometry(0.26, 4.2, 0.26, 2, 0.08), m.paint, x, 3.2, z);
    }
    add(cab, rbox(5.4, 0.38, 4.2, 0.15), m.paint, 0.2, 5.4, 0);
    add(cab, rbox(5.0, 0.12, 3.8, 0.05), m.darkPaint, 0.2, 5.1, 0);
    // ガラス
    add(cab, new THREE.BoxGeometry(0.05, 3.9, 3.5), m.glass, 2.3, 3.2, 0);
    add(cab, new THREE.BoxGeometry(0.05, 3.9, 3.5), m.glass, -2.2, 3.2, 0);
    add(cab, new THREE.BoxGeometry(4.5, 3.9, 0.05), m.glass, 0.05, 3.2, -1.75);
    add(cab, new THREE.BoxGeometry(4.5, 3.9, 0.05), m.glass, 0.05, 3.2, 1.75);
    // 内装: シート・レバー・計器
    add(cab, rbox(1.4, 0.9, 1.5, 0.2), m.seat, -0.6, 1.7, 0);
    add(cab, rbox(0.4, 2.0, 1.4, 0.15), m.seat, -1.3, 2.7, 0);
    add(cab, rbox(0.9, 0.6, 3.0, 0.1), m.dark, 1.7, 1.9, 0);
    for (const z of [-0.9, 0.9]) {
      add(cab, new THREE.CylinderGeometry(0.05, 0.05, 1.1, 8), m.dark, 0.6, 2.2, z);
      add(cab, new THREE.SphereGeometry(0.16, 12, 8), m.seat, 0.6, 2.8, z);
    }
    // ライト
    for (const z of [-1.5, 1.5]) {
      add(cab, rbox(0.35, 0.34, 0.7, 0.08), m.lamp, 2.55, 5.45, z);
    }
    for (const z of [-3.0, -0.8]) {
      add(h, rbox(0.4, 0.34, 0.8, 0.08), m.lamp, 0.6, 5.6, z - 0.2);
    }
    this.cabLight = cab;
    // ヘッドライト（実際に周りを照らす）
    for (const z of [-4.2, -1.5]) {
      const sp = new THREE.SpotLight(0xfff0d0, 0, 180, 0.62, 0.7, 1.4);
      sp.position.set(4.0, 6.4, z);
      sp.target.position.set(40, -2, z * 0.6);
      h.add(sp, sp.target);
      this.headlights.push(sp);
    }

    // ブーム根元のブラケット
    for (const z of [-1.35, 1.35]) {
      add(h, rbox(2.6, 3.4, 0.55, 0.2), m.paint, BOOM_FOOT.x - 0.3, 1.9, z);
    }
    add(h, zcyl(0.5, 3.6, 20), m.steel, BOOM_FOOT.x, BOOM_FOOT.y, 0);
    add(h, rbox(1.4, 1.0, 3.4, 0.2), m.darkPaint, 1.0, 1.4, 0);
  }

  /* ─────────── ブーム・アーム・バケット ─────────── */

  private buildBoom(m: Mats) {
    const g = this.boomGroup;
    g.position.set(BOOM_FOOT.x, BOOM_FOOT.y, 0);
    this.swingGroup.add(g);
    const shape = smoothShape(
      [
        [-0.7, 1.3],
        [3.0, 2.8],
        [7.0, 4.0],
        [11.0, 3.8],
        [14.5, 2.5],
        [17.6, 1.0],
      ],
      [
        [17.6, -1.0],
        [14.0, -0.35],
        [10.0, 0.75],
        [6.0, 0.55],
        [2.5, -0.15],
        [-0.7, -1.25],
      ]
    );
    add(g, extrude(shape, 1.7, 0.16), m.paint);
    // 先端・根元のピン
    add(g, zcyl(0.62, 2.4), m.steel, L_BOOM, 0, 0);
    add(g, zcyl(0.7, 2.4), m.steel, 0, 0, 0);
    // シリンダー用のラグ
    add(g, rbox(0.9, 0.7, 2.2, 0.15), m.darkPaint, 3.6, -0.55, 0);
    add(g, rbox(1.0, 0.9, 1.6, 0.15), m.darkPaint, 11.6, 4.15, 0);
    for (const s of [-1, 1]) {
      const label = new THREE.Mesh(
        new THREE.PlaneGeometry(6.2, 1.1),
        new THREE.MeshStandardMaterial({
          map: labelTexture('CHKTKD', { w: 1024, h: 180, fg: '#17191b' }),
          transparent: true,
          roughness: 0.5,
          polygonOffset: true,
          polygonOffsetFactor: -1,
        })
      );
      label.position.set(8.0, 2.35, s * 1.03);
      label.rotation.set(0, s > 0 ? 0 : Math.PI, Math.atan2(-0.02, 1));
      g.add(label);
    }
  }

  private buildStick(m: Mats) {
    const g = this.stickGroup;
    g.position.set(L_BOOM, 0, 0);
    this.boomGroup.add(g);
    const shape = smoothShape(
      [
        [-1.3, 0.95],
        [1.5, 1.7],
        [5.0, 1.35],
        [9.5, 0.85],
        [11.8, 0.7],
      ],
      [
        [11.8, -0.7],
        [9.0, -0.7],
        [5.0, -1.05],
        [1.5, -1.3],
        [-1.3, -0.95],
      ]
    );
    add(g, extrude(shape, 1.25, 0.14), m.paint);
    add(g, zcyl(0.55, 2.0), m.steel, L_STICK, 0, 0);
    add(g, zcyl(0.6, 2.4), m.steel, 0, 0, 0);
    add(g, rbox(0.9, 0.8, 1.7, 0.15), m.darkPaint, 0.3, 1.85, 0);
    add(g, rbox(1.0, 0.8, 1.6, 0.15), m.darkPaint, 6.4, 1.7, 0);
    add(g, rbox(1.0, 0.6, 1.9, 0.15), m.darkPaint, 10.2, -0.5, 0);
  }

  private buildBucket(m: Mats) {
    const g = this.bucketGroup;
    g.position.set(L_STICK, 0, 0);
    this.stickGroup.add(g);

    // 背面の曲線（バケットのローカル座標）。ピンを原点に、刃先は BUCKET_TIP 付近
    const outerCtrl = [
      new THREE.Vector2(-0.95, 1.0),
      new THREE.Vector2(-1.3, -0.2),
      new THREE.Vector2(-0.95, -1.4),
      new THREE.Vector2(-0.05, -2.3),
      new THREE.Vector2(1.4, -2.85),
      new THREE.Vector2(3.0, -2.9),
      new THREE.Vector2(3.55, -2.78),
    ];
    const outer = new THREE.SplineCurve(outerCtrl).getPoints(36);
    const inner = outer.map((p, i) => {
      const a = outer[Math.max(0, i - 1)]!;
      const b = outer[Math.min(outer.length - 1, i + 1)]!;
      const tx = b.x - a.x;
      const ty = b.y - a.y;
      const l = Math.hypot(tx, ty) || 1;
      return new THREE.Vector2(p.x + (-ty / l) * 0.24, p.y + (tx / l) * 0.24);
    });
    const shell = new THREE.Shape();
    shell.moveTo(outer[0]!.x, outer[0]!.y);
    for (const p of outer.slice(1)) shell.lineTo(p.x, p.y);
    for (const p of [...inner].reverse()) shell.lineTo(p.x, p.y);
    shell.closePath();
    const W = 4.5;
    add(g, extrude(shell, W - 0.4, 0.06), m.bucketSteel);

    // サイドプレート: 背面の曲線 + 口を結ぶ線
    const side = new THREE.Shape();
    side.moveTo(outer[0]!.x, outer[0]!.y);
    for (const p of outer.slice(1)) side.lineTo(p.x, p.y);
    side.lineTo(3.4, -2.2);
    side.lineTo(-0.2, 0.75);
    side.closePath();
    for (const z of [-W / 2 + 0.08, W / 2 - 0.08]) {
      const sg = extrude(side, 0.26, 0.05);
      add(g, sg, m.bucketSteel, 0, 0, z);
    }
    // 補強リブ
    for (const z of [-1.4, 0, 1.4]) {
      const rib = extrude(
        smoothShape(
          [
            [-0.95, 1.05],
            [-1.4, -0.2],
            [-1.05, -1.45],
            [-0.1, -2.4],
            [1.4, -2.98],
          ],
          [
            [1.4, -2.85],
            [-0.05, -2.3],
            [-0.95, -1.4],
            [-1.3, -0.2],
            [-0.95, 1.0],
          ],
          10
        ),
        0.2,
        0.03
      );
      add(g, rib, m.darkPaint, 0, 0, z);
    }
    // 刃先のアダプターと爪
    add(g, new THREE.BoxGeometry(0.5, 0.34, W - 0.2), m.bucketSteel, 3.4, -2.82, 0).rotation.z =
      0.12;
    const toothShape = new THREE.Shape();
    toothShape.moveTo(0, -0.26);
    toothShape.lineTo(0.78, -0.04);
    toothShape.lineTo(0.78, 0.04);
    toothShape.lineTo(0, 0.26);
    toothShape.closePath();
    const toothGeo = extrude(toothShape, 0.34, 0.04);
    const n = 6;
    for (let i = 0; i < n; i++) {
      const z = (i - (n - 1) / 2) * 0.78;
      const t = add(g, toothGeo, m.steel, 3.55, -2.76, z);
      t.rotation.z = 0.12;
    }
    // ピンの耳
    for (const z of [-0.8, 0.8]) {
      add(g, rbox(1.5, 1.7, 0.4, 0.15), m.bucketSteel, -0.25, 0.25, z);
    }
    add(g, zcyl(0.5, 2.2), m.steel, 0, 0, 0);
    add(g, zcyl(0.42, 2.0), m.steel, -0.85, 1.05, 0);
  }

  private buildCylinders(m: Mats) {
    const h = this.swingGroup;
    for (let i = 0; i < 2; i++) this.boomCyls.push(new Cylinder(h, m, 4.2, 0.55, 0.34));
    this.armCyl = new Cylinder(h, m, 5.6, 0.5, 0.32);
    this.bucketCyl = new Cylinder(h, m, 3.4, 0.42, 0.28);
    for (let i = 0; i < 4; i++) {
      this.bars.push(new Bar(h, m.darkPaint, 0.34, 0.5));
    }
  }

  /* ─────────── 姿勢の反映 ─────────── */

  private readonly P = {
    boomBase: new THREE.Vector3(),
    boomRod: new THREE.Vector3(),
    armBase: new THREE.Vector3(),
    armRod: new THREE.Vector3(),
    bkBase: new THREE.Vector3(),
    T: new THREE.Vector3(),
    Q: new THREE.Vector3(),
    J: new THREE.Vector3(),
  };

  /** 平面（x 前・y 上）の点を、旋回体の座標へ。回転 a と原点 o の変換 */
  private static pt(
    out: THREE.Vector3,
    o: { x: number; y: number },
    a: number,
    lx: number,
    ly: number,
    z = 0
  ) {
    out.set(
      o.x + lx * Math.cos(a) - ly * Math.sin(a),
      o.y + lx * Math.sin(a) + ly * Math.cos(a),
      z
    );
  }

  private applyPose() {
    const j = this.joints;
    this.root.position.set(this.x, 0, this.z);
    this.root.rotation.y = this.heading;
    this.swingGroup.rotation.y = j.swing.angle;
    this.boomGroup.rotation.z = j.boom.angle;
    this.stickGroup.rotation.z = j.stick.angle;
    this.bucketGroup.rotation.z = j.bucket.angle;

    const a1 = j.boom.angle;
    const a2 = a1 + j.stick.angle;
    const a3 = a2 + j.bucket.angle;
    const foot = BOOM_FOOT;
    const elbow = { x: foot.x + L_BOOM * Math.cos(a1), y: foot.y + L_BOOM * Math.sin(a1) };
    const wrist = { x: elbow.x + L_STICK * Math.cos(a2), y: elbow.y + L_STICK * Math.sin(a2) };
    const P = this.P;
    const pt = Excavator.pt;
    P.boomBase.set(1.4, 1.1, 0);
    pt(P.boomRod, foot, a1, 3.6, -0.6);
    pt(P.armBase, foot, a1, 11.6, 4.7);
    pt(P.armRod, elbow, a2, 0.3, 2.3);
    pt(P.bkBase, elbow, a2, 6.4, 2.2);
    pt(P.T, elbow, a2, 10.2, -0.5);
    pt(P.Q, wrist, a3, -0.85, 1.05);
    // バケットリンクの先端 J: T を中心とする半径 A の円と、Q を中心とする半径 B の円の交点
    const A = 1.85;
    const B = 2.2;
    const dx = P.Q.x - P.T.x;
    const dy = P.Q.y - P.T.y;
    const d = Math.max(0.05, Math.hypot(dx, dy));
    const aa = (A * A - B * B + d * d) / (2 * d);
    const hh = Math.sqrt(Math.max(0, A * A - aa * aa));
    P.J.set(P.T.x + (aa * dx) / d + (hh * dy) / d, P.T.y + (aa * dy) / d - (hh * dx) / d, 0);

    const zs = [-1.25, 1.25];
    this.boomCyls.forEach((c, i) => {
      const z = zs[i] as number;
      c.place(
        this.tmpV.set(P.boomBase.x, P.boomBase.y, z),
        new THREE.Vector3(P.boomRod.x, P.boomRod.y, z)
      );
    });
    this.armCyl.place(P.armBase, P.armRod);
    this.bucketCyl.place(P.bkBase, P.J);
    // リンク: T→J, J→Q（左右 2 枚ずつ）, 黒い補助バー
    const off = (v: THREE.Vector3, z: number) => new THREE.Vector3(v.x, v.y, z);
    this.bars[0]!.place(off(P.T, -0.55), off(P.J, -0.55));
    this.bars[1]!.place(off(P.T, 0.55), off(P.J, 0.55));
    this.bars[2]!.place(off(P.J, -0.55), off(P.Q, -0.55));
    this.bars[3]!.place(off(P.J, 0.55), off(P.Q, 0.55));

    this.root.updateMatrixWorld(true);
  }

  /* ─────────── 当たり判定 ─────────── */

  private defineVolumes() {
    const v = (
      name: string,
      object: THREE.Object3D,
      cx: number,
      cy: number,
      cz: number,
      hx: number,
      hy: number,
      hz: number,
      kick = false
    ) =>
      this.volumes.push({
        name,
        object,
        center: new THREE.Vector3(cx, cy, cz),
        half: new THREE.Vector3(hx, hy, hz),
        kick,
        prev: new THREE.Matrix4(),
        hasPrev: false,
      });
    v('bucket', this.bucketGroup, 1.4, -1.0, 0, 2.7, 2.0, 2.4, true);
    v('stick', this.stickGroup, 5.0, 0, 0, 6.2, 1.3, 1.0);
    v('boom', this.boomGroup, 8.8, 1.6, 0, 9.2, 2.1, 1.0);
    v('house', this.swingGroup, -1.8, 3.0, 0, 6.8, 3.0, 5.0);
    v('trackL', this.root, 0, 2.1, -TRACK_Z, SPR_X + 2.0, 2.1, TRACK_W / 2, true);
    v('trackR', this.root, 0, 2.1, TRACK_Z, SPR_X + 2.0, 2.1, TRACK_W / 2, true);
    v('chassis', this.root, 0, 3.2, 0, 5.4, 1.2, 3.6);
  }

  /** 体積 vol のワールド OBB を out に書く */
  worldBox(vol: HitVolume, out: WorldBox) {
    const e = vol.object.matrixWorld.elements;
    out.ax.set(e[0]!, e[1]!, e[2]!);
    out.ay.set(e[4]!, e[5]!, e[6]!);
    out.az.set(e[8]!, e[9]!, e[10]!);
    const sx = out.ax.length();
    const sy = out.ay.length();
    const sz = out.az.length();
    out.ax.divideScalar(sx || 1);
    out.ay.divideScalar(sy || 1);
    out.az.divideScalar(sz || 1);
    out.center.copy(vol.center).applyMatrix4(vol.object.matrixWorld);
    out.half.copy(vol.half).multiplyScalar(MACHINE_SCALE);
  }

  /** vol 上の点の速度を、前フレームの行列との差から求める */
  velocityOf(vol: HitVolume, dt: number): (p: THREE.Vector3, out: THREE.Vector3) => void {
    const inv = new THREE.Matrix4().copy(vol.object.matrixWorld).invert();
    const rel = new THREE.Matrix4().multiplyMatrices(vol.prev, inv);
    const hasPrev = vol.hasPrev;
    const q = new THREE.Vector3();
    const idt = 1 / Math.max(dt, 1 / 120);
    return (p, out) => {
      if (!hasPrev) {
        out.set(0, 0, 0);
        return;
      }
      q.copy(p).applyMatrix4(rel);
      out.subVectors(p, q).multiplyScalar(idt);
      const l = out.length();
      if (l > 45) out.multiplyScalar(45 / l);
    };
  }

  commitVolumes() {
    for (const vol of this.volumes) {
      vol.prev.copy(vol.object.matrixWorld);
      vol.hasPrev = true;
    }
  }

  /* ─────────── 更新 ─────────── */

  /** 刃先・バケット底など、地面にめり込ませたくない点のワールド座標の高さの最小値 */
  private lowestPoint(a: ArmAngles): number {
    const pose = forward(a);
    const pts = [pose.tip.y];
    const rot = (x: number, y: number) =>
      x * Math.sin(pose.bucketAbs) + y * Math.cos(pose.bucketAbs);
    pts.push(pose.wrist.y + rot(1.4, -2.85));
    pts.push(pose.wrist.y + rot(-0.2, -2.4));
    pts.push(pose.wrist.y - 0.6);
    return (SWING_Y + Math.min(...pts)) * MACHINE_SCALE;
  }

  update(dt: number, input: DriveInput, bounds: number) {
    const j = this.joints;
    const rates = { swing: 0.95, boom: 0.62, stick: 0.85, bucket: 1.15 };
    if (input.swing)
      j.swing.target = clamp(
        j.swing.target + input.swing * rates.swing * dt,
        j.swing.min,
        j.swing.max
      );
    if (input.boom)
      j.boom.target = clamp(j.boom.target + input.boom * rates.boom * dt, j.boom.min, j.boom.max);
    if (input.stick)
      j.stick.target = clamp(
        j.stick.target + input.stick * rates.stick * dt,
        j.stick.min,
        j.stick.max
      );
    if (input.bucket)
      j.bucket.target = clamp(
        j.bucket.target + input.bucket * rates.bucket * dt,
        j.bucket.min,
        j.bucket.max
      );

    const prev = { boom: j.boom.angle, stick: j.stick.angle, bucket: j.bucket.angle };
    for (const k of ['swing', 'boom', 'stick', 'bucket'] as const) {
      const jt = j[k];
      const err = jt.target - jt.angle;
      const want = err * (1 - Math.exp(-jt.k * dt));
      const lim = jt.maxRate * dt;
      jt.angle += clamp(want, -lim, lim);
    }
    // 地面にめり込む動きは止める（目標も戻す）。すでにめり込み気味でも、持ち上げる動きは許す
    const now = this.lowestPoint({
      boom: j.boom.angle,
      stick: j.stick.angle,
      bucket: j.bucket.angle,
    });
    if (now < 0.25 && now < this.lowestPoint(prev)) {
      j.boom.angle = prev.boom;
      j.stick.angle = prev.stick;
      j.bucket.angle = prev.bucket;
      j.boom.target = prev.boom;
      j.stick.target = prev.stick;
      j.bucket.target = prev.bucket;
    }

    // 走行: 左右の履帯
    const maxV = 8.6;
    const slow = 1 / (1 + this.resist * 0.9);
    const tl = clamp(input.drive + input.turn * 0.62, -1, 1) * maxV * slow;
    const tr = clamp(input.drive - input.turn * 0.62, -1, 1) * maxV * slow;
    const acc = 1 - Math.exp(-2.2 * dt);
    this.vL += (tl - this.vL) * acc;
    this.vR += (tr - this.vR) * acc;
    const gauge = TRACK_Z * 2 * MACHINE_SCALE;
    const v = (this.vL + this.vR) / 2;
    this.heading += ((this.vR - this.vL) / gauge) * dt;
    this.x += Math.cos(this.heading) * v * dt;
    this.z -= Math.sin(this.heading) * v * dt;
    this.x = clamp(this.x, -bounds, bounds);
    this.z = clamp(this.z, -bounds, bounds);
    this.updateTracks((this.vL * dt) / MACHINE_SCALE, (this.vR * dt) / MACHINE_SCALE);
    this.applyPose();
  }

  /** 車体前方の単位ベクトル（ワールド XZ） */
  get forwardDir(): THREE.Vector2 {
    return new THREE.Vector2(Math.cos(this.heading), -Math.sin(this.heading));
  }

  /** 旋回体の向き（ワールド）。0 で +X */
  get swingHeading(): number {
    return this.heading + this.joints.swing.angle;
  }

  get speed(): number {
    return (this.vL + this.vR) / 2;
  }

  /** 旋回体の中心（ワールド） */
  swingPivot(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.x, SWING_Y * MACHINE_SCALE, this.z);
  }

  /** バケット刃先のワールド座標 */
  bucketTip(out: THREE.Vector3): THREE.Vector3 {
    const pose = forward({
      boom: this.joints.boom.angle,
      stick: this.joints.stick.angle,
      bucket: this.joints.bucket.angle,
    });
    const h = this.swingHeading;
    const S = MACHINE_SCALE;
    return out.set(
      this.x + Math.cos(h) * pose.tip.x * S,
      (SWING_Y + pose.tip.y) * S,
      this.z - Math.sin(h) * pose.tip.x * S
    );
  }

  /** ヘッドライトの強さ（時間帯） */
  setLights(level: number) {
    for (const s of this.headlights) s.intensity = level * 2400;
    this.mats.lamp.emissiveIntensity = 0.7 + level * 4;
  }

  /** 全ジョイントを指定角へ向かわせる（クリック粉砕などの自動動作用） */
  setTargets(
    t: Partial<Record<'swing' | 'boom' | 'stick' | 'bucket', number>>,
    k: number,
    rateScale: number
  ) {
    const rates = { swing: 1.2, boom: 1.0, stick: 1.3, bucket: 1.6 };
    for (const key of Object.keys(t) as (keyof typeof t)[]) {
      const jt = this.joints[key];
      jt.target = clamp(t[key] as number, jt.min, jt.max);
      jt.k = k;
      jt.maxRate = rates[key] * rateScale;
    }
  }

  /** 手動操作の追従設定に戻す */
  resetJointFeel() {
    const rates = { swing: 1.3, boom: 0.85, stick: 1.1, bucket: 1.4 };
    for (const key of ['swing', 'boom', 'stick', 'bucket'] as const) {
      this.joints[key].k = 9;
      this.joints[key].maxRate = rates[key];
    }
  }

  get cabObject(): THREE.Object3D {
    return this.cabLight;
  }
}
