import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CELL, GRID_N, HALF } from './config';
import { type PropSpec, isInRoadIntersection } from './layout';
import { createRng } from './rng';
import {
  cableGeometry,
  leafTexture,
  signalGeometries,
  treeGeometries,
  utilityPoleGeometry,
} from './propGeo';
import { swayify } from './wind';

function paint(g: THREE.BufferGeometry, r: number, gr: number, b: number): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  geo.deleteAttribute('uv');
  const n = geo.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    c[i * 3] = r;
    c[i * 3 + 1] = gr;
    c[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}

function box(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  col: [number, number, number]
) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return paint(g, ...col);
}

/** 側面図（x が前、y が上）の多角形を幅方向に押し出す */
function extrudeSide(pts: [number, number][], width: number, bevel: number): THREE.BufferGeometry {
  const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(sh, {
    depth: width - bevel * 2,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 4,
  });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.deleteAttribute('uv');
  return g.index ? g.toNonIndexed() : g;
}

/** 車: 塗装（インスタンスごとに色が変わる）と、ガラス・タイヤ・ライトなど（頂点色）に分ける */
function carGeometries(): { body: THREE.BufferGeometry; dark: THREE.BufferGeometry } {
  const paintParts: THREE.BufferGeometry[] = [];
  paintParts.push(
    extrudeSide(
      [
        [-2.2, 0.3],
        [2.2, 0.3],
        [2.32, 0.56],
        [2.22, 0.9],
        [1.4, 1.02],
        [0.9, 1.05],
        [-1.45, 1.05],
        [-2.22, 1.0],
        [-2.34, 0.7],
      ],
      1.84,
      0.1
    )
  );
  const roof = new RoundedBoxGeometry(1.5, 0.08, 1.7, 2, 0.03);
  roof.translate(-0.3, 1.6, 0);
  paintParts.push(roof.deleteAttribute('uv') && roof.toNonIndexed());
  for (const [x, y, h, tilt] of [
    [0.6, 1.32, 0.62, -0.62],
    [-0.28, 1.32, 0.52, 0],
    [-1.18, 1.34, 0.6, 0.62],
  ] as const) {
    const p = new THREE.BoxGeometry(0.1, h, 1.76);
    p.rotateZ(tilt);
    p.translate(x, y, 0);
    p.deleteAttribute('uv');
    paintParts.push(p.toNonIndexed());
  }
  const body = mergeGeometries(paintParts, false);
  body.computeBoundingSphere();

  const dark: THREE.BufferGeometry[] = [];
  const glass = extrudeSide(
    [
      [0.92, 1.05],
      [0.36, 1.58],
      [-1.0, 1.59],
      [-1.46, 1.07],
    ],
    1.72,
    0
  );
  dark.push(paint(glass, 0.025, 0.035, 0.05));
  for (const [x, z] of [
    [1.42, 0.92],
    [1.42, -0.92],
    [-1.42, 0.92],
    [-1.42, -0.92],
  ] as const) {
    const arch = new THREE.CylinderGeometry(0.5, 0.5, 0.3, 18);
    arch.rotateX(Math.PI / 2);
    arch.translate(x, 0.5, z * 0.97);
    dark.push(paint(arch, 0.012, 0.012, 0.014));
    const tire = new THREE.CylinderGeometry(0.4, 0.4, 0.28, 18);
    tire.rotateX(Math.PI / 2);
    tire.translate(x, 0.4, z);
    dark.push(paint(tire, 0.035, 0.035, 0.04));
    const rim = new THREE.CylinderGeometry(0.24, 0.24, 0.3, 10);
    rim.rotateX(Math.PI / 2);
    rim.translate(x, 0.4, z * 1.01);
    dark.push(paint(rim, 0.42, 0.43, 0.45));
  }
  dark.push(box(0.12, 0.16, 0.5, 2.3, 0.72, 0.62, [1, 0.95, 0.78]));
  dark.push(box(0.12, 0.16, 0.5, 2.3, 0.72, -0.62, [1, 0.95, 0.78]));
  dark.push(box(0.1, 0.14, 0.5, -2.34, 0.8, 0.6, [0.8, 0.04, 0.04]));
  dark.push(box(0.1, 0.14, 0.5, -2.34, 0.8, -0.6, [0.8, 0.04, 0.04]));
  dark.push(box(0.2, 0.2, 1.7, 2.3, 0.38, 0, [0.05, 0.05, 0.055]));
  dark.push(box(0.2, 0.2, 1.7, -2.3, 0.38, 0, [0.05, 0.05, 0.055]));
  dark.push(box(0.04, 0.12, 0.5, 2.35, 0.55, 0, [0.7, 0.7, 0.72]));
  const darkGeo = mergeGeometries(dark, false);
  darkGeo.computeBoundingSphere();
  return { body, dark: darkGeo };
}

function lampPoleGeometry(): THREE.BufferGeometry {
  const pole = new THREE.CylinderGeometry(0.08, 0.15, 8, 8);
  pole.translate(0, 4, 0);
  const arm = new THREE.BoxGeometry(1.9, 0.1, 0.1);
  arm.translate(0.8, 7.9, 0);
  const g = mergeGeometries([pole.toNonIndexed(), arm.toNonIndexed()], false);
  return g;
}

type Kind = 'car' | 'tree' | 'lamp' | 'pole' | 'signal';

export interface PropItem {
  kind: Kind;
  x: number;
  z: number;
  /** 当たり判定の半径 */
  r: number;
  /** 高さ（当たり判定の上端） */
  h: number;
  yaw: number;
  /** 0 無傷 / 1 倒れている最中 / 2 倒れた */
  state: 0 | 1 | 2;
  t: number;
  dirX: number;
  dirZ: number;
  idx: number;
  v: number;
}

const CAR_COLORS = [0xd9d9d6, 0x1c1f24, 0xa3201c, 0x2a4a7c, 0x888d92, 0xe6c24d, 0x3b5a3a, 0xf2f2f0];

const RADIUS: Record<Kind, number> = { car: 2.4, tree: 1.4, lamp: 0.6, pole: 0.5, signal: 0.6 };
const HEIGHT: Record<Kind, number> = { car: 1.8, tree: 7.5, lamp: 8, pole: 10.4, signal: 6.2 };

/** 電線 1 区間（2 本の電柱の間） */
interface Span {
  a: PropItem;
  b: PropItem;
  idx: number;
  hidden: boolean;
}

export class Props {
  readonly group = new THREE.Group();
  readonly items: PropItem[] = [];
  readonly lampHeadMaterial = new THREE.MeshStandardMaterial({
    color: 0x222222,
    emissive: 0xffd9a0,
    emissiveIntensity: 0,
    roughness: 0.5,
  });
  /** 信号のレンズ（自発光）。時間帯で明るさを変える */
  readonly lensMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  /** 種類ごとのインスタンスメッシュ。同じ行列を共有する複数パーツ（車体とガラスなど）を持てる */
  private readonly parts: Record<Kind, THREE.InstancedMesh[]> = {
    car: [],
    tree: [],
    lamp: [],
    pole: [],
    signal: [],
  };
  private cables!: THREE.InstancedMesh;
  private spans: Span[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly axis = new THREE.Vector3();
  private readonly animating = new Set<PropItem>();

  constructor(specs: PropSpec[], leafCards = 480) {
    const rng = createRng(4242);
    const counts: Record<Kind, number> = { car: 0, tree: 0, lamp: 0, pole: 0, signal: 0 };
    for (const sp of specs) {
      if (sp.x < 0.5 || sp.z < 0.5 || sp.x > GRID_N - 0.5 || sp.z > GRID_N - 0.5) continue;
      if (sp.type === 'car' && isInRoadIntersection(sp.x, sp.z)) continue;
      const kind = sp.type;
      const idx = counts[kind]++;
      this.items.push({
        kind,
        x: sp.x * CELL - HALF,
        z: sp.z * CELL - HALF,
        r: RADIUS[kind],
        h: HEIGHT[kind],
        yaw:
          kind === 'pole' || kind === 'signal'
            ? sp.rot
            : sp.rot + (kind === 'car' ? (sp.v - 0.5) * 0.06 : sp.v * Math.PI * 2),
        state: 0,
        t: 0,
        dirX: 0,
        dirZ: 0,
        idx,
        v: sp.v,
      });
    }

    const mk = (kind: Kind, geo: THREE.BufferGeometry, mat: THREE.Material, castShadow = true) => {
      const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, counts[kind]));
      mesh.count = counts[kind];
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.parts[kind].push(mesh);
      return mesh;
    };
    const metal = (color: number, roughness = 0.55, metalness = 0.7) =>
      new THREE.MeshStandardMaterial({ color, roughness, metalness });

    // ── 車
    const car = carGeometries();
    const carBody = mk(
      'car',
      car.body,
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        roughness: 0.38,
        metalness: 0.55,
        clearcoat: 1,
        clearcoatRoughness: 0.16,
      })
    );
    mk(
      'car',
      car.dark,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.35 })
    );

    // ── 木: 幹と、葉カードの樹冠
    const tg = treeGeometries(rng, leafCards);
    mk(
      'tree',
      tg.trunk,
      swayify(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), 0.04)
    );
    const leafMat = new THREE.MeshStandardMaterial({
      map: leafTexture(),
      vertexColors: true,
      alphaTest: 0.5,
      alphaToCoverage: true,
      side: THREE.DoubleSide,
      roughness: 0.78,
      metalness: 0,
    });
    // 葉は薄く光を透かすので、裏面でも法線を反転させない（外向きの陰影のまま）
    leafMat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', '')
      );
    };
    const leaves = mk('tree', tg.leaves, swayify(leafMat, 0.09));

    // ── 街灯
    mk('lamp', lampPoleGeometry(), metal(0x3b4046));
    const head = new THREE.BoxGeometry(0.9, 0.16, 0.45);
    head.translate(1.6, 7.82, 0);
    mk('lamp', head, this.lampHeadMaterial, false);

    // ── 電柱と電線
    mk(
      'pole',
      utilityPoleGeometry(),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.15 })
    );
    this.buildCables();

    // ── 信号機
    const sg = signalGeometries();
    mk(
      'signal',
      sg.body,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.5 })
    );
    const lens = mk('signal', sg.lens, this.lensMaterial, false);

    const col = new THREE.Color();
    for (const it of this.items) {
      this.compose(it);
      if (it.kind === 'car') {
        col.setHex(CAR_COLORS[Math.floor(it.v * 997) % CAR_COLORS.length] as number);
        carBody.setColorAt(it.idx, col);
      } else if (it.kind === 'tree') {
        const f = 0.82 + ((it.v * 31) % 1) * 0.4;
        // 少し黄緑寄り・青緑寄りに振って、木ごとの個体差を出す
        const warm = (it.v * 7) % 1;
        leaves.setColorAt(
          it.idx,
          col.setRGB(f * (0.92 + warm * 0.3), f, f * (0.85 + (1 - warm) * 0.2))
        );
      } else if (it.kind === 'signal') {
        // 赤（>1 の HDR）か青信号
        lens.setColorAt(
          it.idx,
          it.v < 0.45 ? col.setRGB(3.2, 0.12, 0.08) : col.setRGB(0.1, 2.6, 1.2)
        );
      }
    }
    carBody.instanceColor!.needsUpdate = true;
    leaves.instanceColor!.needsUpdate = true;
    lens.instanceColor!.needsUpdate = true;
    for (const list of Object.values(this.parts))
      for (const mesh of list) mesh.instanceMatrix.needsUpdate = true;
  }

  /** 同じ線路上の隣り合う電柱を、垂れ下がる電線でつなぐ */
  private buildCables() {
    const poles = this.items.filter((i) => i.kind === 'pole');
    // 線路: yaw が 0（X 方向）なら z が、π/2（Z 方向）なら x が同じ柱同士
    const lines = new Map<string, PropItem[]>();
    for (const p of poles) {
      const alongX = Math.abs(Math.sin(p.yaw)) < 0.5;
      const key = alongX ? `x:${Math.round(p.z * 4)}` : `z:${Math.round(p.x * 4)}`;
      const arr = lines.get(key) ?? [];
      arr.push(p);
      lines.set(key, arr);
    }
    const SPAN = 30;
    for (const [key, arr] of lines) {
      const alongX = key.startsWith('x:');
      arr.sort((a, b) => (alongX ? a.x - b.x : a.z - b.z));
      for (let i = 0; i + 1 < arr.length; i++) {
        const a = arr[i]!;
        const b = arr[i + 1]!;
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        if (len > 62) continue;
        this.spans.push({ a, b, idx: this.spans.length, hidden: false });
      }
    }
    this.cables = new THREE.InstancedMesh(
      cableGeometry(SPAN),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3 }),
      Math.max(1, this.spans.length)
    );
    this.cables.count = this.spans.length;
    this.cables.castShadow = true;
    this.cables.frustumCulled = false;
    this.group.add(this.cables);
    for (const s of this.spans) this.placeSpan(s);
    this.cables.instanceMatrix.needsUpdate = true;
  }

  private placeSpan(s: Span) {
    if (s.hidden) {
      this.cables.setMatrixAt(s.idx, this.m.makeScale(0, 0, 0));
      return;
    }
    const dx = s.b.x - s.a.x;
    const dz = s.b.z - s.a.z;
    const len = Math.hypot(dx, dz);
    const k = len / 30;
    this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.atan2(-dz, dx));
    // たるみは長さの 2 乗に比例させる
    this.s.set(k, k * k, 1);
    this.p.set(s.a.x, 0, s.a.z);
    this.cables.setMatrixAt(s.idx, this.m.compose(this.p, this.q, this.s));
  }

  private compose(it: PropItem) {
    this.p.set(it.x, 0, it.z);
    this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, it.yaw);
    this.s.set(1, 1, 1);
    if (it.kind === 'car') {
      const c = it.state === 0 ? 0 : Math.min(1, it.t / 0.28);
      const e = 1 - (1 - c) * (1 - c);
      this.s.y = 1 - 0.82 * e;
      this.s.x = 1 + 0.1 * e;
      this.s.z = 1 + 0.1 * e;
      // 潰れながら少しねじれる
      this.q2.setFromAxisAngle(this.axis.set(1, 0, 0), (it.v - 0.5) * 0.14 * e);
      this.q.multiply(this.q2);
    } else if (it.state !== 0) {
      const t = Math.min(1, it.t / 0.95);
      const e = t * t * (1.6 - 0.6 * t); // 倒れ始めはゆっくり、後半で加速
      const ang = e * 1.5;
      // 倒れる軸: 上向き × 倒れる方向
      this.axis
        .set(0, 1, 0)
        .cross(this.p.set(it.dirX, 0, it.dirZ))
        .normalize();
      this.q2.setFromAxisAngle(this.axis, ang);
      this.q.premultiply(this.q2);
      this.p.set(it.x, 0, it.z);
    }
    this.m.compose(this.p, this.q, this.s);
    for (const mesh of this.parts[it.kind]) mesh.setMatrixAt(it.idx, this.m);
  }

  /** 周囲の小物を列挙する（ショベルカーの当たり判定用） */
  near(x: number, z: number, radius: number, fn: (it: PropItem) => void) {
    const r2 = radius * radius;
    for (const it of this.items) {
      if (it.state !== 0) continue;
      const dx = it.x - x;
      const dz = it.z - z;
      if (dx * dx + dz * dz <= r2) fn(it);
    }
  }

  /** 倒す・潰す。電柱が倒れたら、つながった電線も切れる */
  knock(it: PropItem, dirX: number, dirZ: number) {
    if (it.state !== 0) return;
    it.state = 1;
    it.t = 0;
    const len = Math.hypot(dirX, dirZ) || 1;
    it.dirX = dirX / len;
    it.dirZ = dirZ / len;
    this.animating.add(it);
    if (it.kind === 'pole') {
      for (const s of this.spans) {
        if (!s.hidden && (s.a === it || s.b === it)) {
          s.hidden = true;
          this.placeSpan(s);
          this.cables.instanceMatrix.needsUpdate = true;
        }
      }
    }
  }

  update(dt: number) {
    if (this.animating.size === 0) return;
    for (const it of this.animating) {
      it.t += dt;
      this.compose(it);
      const done = it.kind === 'car' ? it.t >= 0.28 : it.t >= 0.95;
      if (done) {
        it.state = 2;
        this.animating.delete(it);
      }
    }
    for (const list of Object.values(this.parts))
      for (const mesh of list) mesh.instanceMatrix.needsUpdate = true;
  }

  /** 街灯・信号の点灯具合（時間帯） */
  setLampLevel(level: number) {
    this.lampHeadMaterial.emissiveIntensity = level * 2.2;
    // 信号は昼でも点いている。夜はにじんで見えるよう強める
    this.lensMaterial.color.setScalar(0.55 + level * 0.5);
  }
}
