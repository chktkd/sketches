import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CELL, GRID_N, HALF } from './config';
import { type PropSpec, isInRoadIntersection } from './layout';
import { createRng } from './rng';

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

function treeGeometry(rng: ReturnType<typeof createRng>): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.2, 0.34, 3.4, 8);
  trunk.translate(0, 1.7, 0);
  parts.push(paint(trunk, 0.24, 0.17, 0.11));
  const blobs: [number, number, number, number, number][] = [
    [0, 4.6, 0, 2.2, 0],
    [1.1, 3.9, 0.5, 1.6, 1],
    [-1.0, 4.1, -0.6, 1.7, 2],
    [0.2, 5.8, -0.2, 1.5, 3],
  ];
  for (const [x, y, z, r, k] of blobs) {
    let ico: THREE.BufferGeometry = new THREE.IcosahedronGeometry(r, 2);
    ico.deleteAttribute('uv');
    ico.deleteAttribute('normal');
    ico = mergeVertices(ico, 1e-3);
    const pos = ico.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      const pz = pos.getZ(i);
      const len = Math.hypot(px, py, pz);
      const n =
        0.82 +
        0.3 *
          Math.abs(
            Math.sin(px * 2.3 + k) * Math.cos(pz * 2.1 - k) + Math.sin(py * 3.1 + k * 2) * 0.5
          );
      pos.setXYZ(i, (px / len) * r * n, (py / len) * r * n * 0.82, (pz / len) * r * n);
    }
    ico.computeVertexNormals();
    ico.translate(x, y, z);
    const shade = 0.82 + rng.next() * 0.3;
    // 頂点ごとに明るさをずらして、葉の塊に陰影の変化を出す
    const g = ico.toNonIndexed();
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const py = g.getAttribute('position').getY(i);
      const t = THREE.MathUtils.clamp((py - (y - r)) / (r * 2), 0, 1);
      const f = shade * (0.65 + 0.55 * t);
      col[i * 3] = 0.15 * f;
      col[i * 3 + 1] = 0.3 * f;
      col[i * 3 + 2] = 0.09 * f;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(g);
  }
  const g = mergeGeometries(parts, false);
  g.computeBoundingSphere();
  return g;
}

function lampPoleGeometry(): THREE.BufferGeometry {
  const pole = new THREE.CylinderGeometry(0.08, 0.15, 8, 8);
  pole.translate(0, 4, 0);
  const arm = new THREE.BoxGeometry(1.9, 0.1, 0.1);
  arm.translate(0.8, 7.9, 0);
  const g = mergeGeometries([pole.toNonIndexed(), arm.toNonIndexed()], false);
  return g;
}

type Kind = 'car' | 'tree' | 'lamp';

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

export class Props {
  readonly group = new THREE.Group();
  readonly items: PropItem[] = [];
  readonly lampHeadMaterial = new THREE.MeshStandardMaterial({
    color: 0x222222,
    emissive: 0xffd9a0,
    emissiveIntensity: 0,
    roughness: 0.5,
  });
  private readonly meshes: Record<Kind, THREE.InstancedMesh>;
  private readonly lampHeads: THREE.InstancedMesh;
  private readonly carDark: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly axis = new THREE.Vector3();
  private readonly animating = new Set<PropItem>();

  constructor(specs: PropSpec[]) {
    const rng = createRng(4242);
    const counts: Record<Kind, number> = { car: 0, tree: 0, lamp: 0 };
    for (const sp of specs) {
      if (sp.x < 0.5 || sp.z < 0.5 || sp.x > GRID_N - 0.5 || sp.z > GRID_N - 0.5) continue;
      if (sp.type === 'car' && isInRoadIntersection(sp.x, sp.z)) continue;
      const kind = sp.type;
      const idx = counts[kind]++;
      this.items.push({
        kind,
        x: sp.x * CELL - HALF,
        z: sp.z * CELL - HALF,
        r: kind === 'car' ? 2.4 : kind === 'tree' ? 1.4 : 0.6,
        h: kind === 'car' ? 1.8 : kind === 'tree' ? 7.5 : 8,
        yaw: sp.rot + (kind === 'car' ? (sp.v - 0.5) * 0.06 : sp.v * Math.PI * 2),
        state: 0,
        t: 0,
        dirX: 0,
        dirZ: 0,
        idx,
        v: sp.v,
      });
    }

    const carMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.38,
      metalness: 0.55,
      clearcoat: 1,
      clearcoatRoughness: 0.16,
    });
    const carDarkMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.28,
      metalness: 0.35,
    });
    const car = carGeometries();
    const treeMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0,
    });
    const poleMat = new THREE.MeshStandardMaterial({
      color: 0x3b4046,
      roughness: 0.55,
      metalness: 0.7,
    });
    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number) => {
      const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return mesh;
    };
    this.meshes = {
      car: mk(car.body, carMat, counts.car),
      tree: mk(treeGeometry(rng), treeMat, counts.tree),
      lamp: mk(lampPoleGeometry(), poleMat, counts.lamp),
    };
    const head = new THREE.BoxGeometry(0.9, 0.16, 0.45);
    head.translate(1.6, 7.82, 0);
    this.lampHeads = new THREE.InstancedMesh(head, this.lampHeadMaterial, Math.max(1, counts.lamp));
    this.lampHeads.frustumCulled = false;
    this.group.add(this.lampHeads);
    this.carDark = mk(car.dark, carDarkMat, counts.car);
    for (const k of ['car', 'tree', 'lamp'] as const) this.meshes[k].count = counts[k];
    this.carDark.count = counts.car;
    this.lampHeads.count = counts.lamp;

    const col = new THREE.Color();
    for (const it of this.items) {
      this.compose(it);
      if (it.kind === 'car') {
        col.setHex(CAR_COLORS[Math.floor(it.v * 997) % CAR_COLORS.length] as number);
        this.meshes.car.setColorAt(it.idx, col);
      } else if (it.kind === 'tree') {
        const f = 0.78 + ((it.v * 31) % 1) * 0.5;
        this.meshes.tree.setColorAt(
          it.idx,
          col.setRGB(f, f * (0.95 + ((it.v * 7) % 1) * 0.15), f * 0.9)
        );
      }
    }
    for (const k of ['car', 'tree'] as const) {
      this.meshes[k].instanceColor!.needsUpdate = true;
    }
    for (const k of ['car', 'tree', 'lamp'] as const)
      this.meshes[k].instanceMatrix.needsUpdate = true;
    this.lampHeads.instanceMatrix.needsUpdate = true;
    this.carDark.instanceMatrix.needsUpdate = true;
  }

  private compose(it: PropItem) {
    const mesh = this.meshes[it.kind];
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
    mesh.setMatrixAt(it.idx, this.m);
    if (it.kind === 'car') this.carDark.setMatrixAt(it.idx, this.m);
    if (it.kind === 'lamp') this.lampHeads.setMatrixAt(it.idx, this.m);
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

  /** 倒す・潰す。倒した小物の種類を返す */
  knock(it: PropItem, dirX: number, dirZ: number) {
    if (it.state !== 0) return;
    it.state = 1;
    it.t = 0;
    const len = Math.hypot(dirX, dirZ) || 1;
    it.dirX = dirX / len;
    it.dirZ = dirZ / len;
    this.animating.add(it);
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
    for (const k of ['car', 'tree', 'lamp'] as const)
      this.meshes[k].instanceMatrix.needsUpdate = true;
    this.lampHeads.instanceMatrix.needsUpdate = true;
    this.carDark.instanceMatrix.needsUpdate = true;
  }

  /** 街灯の点灯具合（時間帯） */
  setLampLevel(level: number) {
    this.lampHeadMaterial.emissiveIntensity = level * 2.2;
  }
}
