import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { type Rng, createRng } from './rng';

/* ───────────── 共通 ───────────── */

function toFlat(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  ng.deleteAttribute('uv');
  return ng;
}

function paint(g: THREE.BufferGeometry, r: number, gr: number, b: number): THREE.BufferGeometry {
  const ng = toFlat(g);
  const n = ng.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    c[i * 3] = r;
    c[i * 3 + 1] = gr;
    c[i * 3 + 2] = b;
  }
  ng.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return ng;
}

/* ───────────── 葉カードの木 ───────────── */

/** 葉の塊のテクスチャ（透明背景）。個々の葉・葉脈・小枝を描く */
export function leafTexture(): THREE.CanvasTexture {
  const n = 256;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d')!;
  const rng = createRng(1234);
  ctx.clearRect(0, 0, n, n);
  // 小枝
  ctx.strokeStyle = 'rgba(60,44,28,1)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(n * 0.5, n * 0.98);
  ctx.quadraticCurveTo(n * 0.46, n * 0.6, n * 0.52, n * 0.12);
  ctx.stroke();
  const leaf = (x: number, y: number, len: number, wid: number, rot: number, hue: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    const g = 0.7 + rng.next() * 0.5;
    const col = (k: number) =>
      `rgb(${Math.floor(hue * 0.62 * g * k)},${Math.floor(hue * 1.05 * g * k)},${Math.floor(hue * 0.3 * g * k)})`;
    ctx.fillStyle = col(1);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(wid, -len * 0.25, wid * 0.8, -len * 0.75, 0, -len);
    ctx.bezierCurveTo(-wid * 0.8, -len * 0.75, -wid, -len * 0.25, 0, 0);
    ctx.fill();
    ctx.strokeStyle = col(0.55);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // 葉脈
    ctx.strokeStyle = col(1.35);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, -2);
    ctx.lineTo(0, -len * 0.92);
    for (let k = 1; k < 4; k++) {
      const yy = -len * (0.2 + k * 0.18);
      ctx.moveTo(0, yy);
      ctx.lineTo(wid * 0.55, yy - len * 0.1);
      ctx.moveTo(0, yy);
      ctx.lineTo(-wid * 0.55, yy - len * 0.1);
    }
    ctx.stroke();
    ctx.restore();
  };
  // 奥の葉 → 手前の葉の順に重ねる
  for (let i = 0; i < 34; i++) {
    const a = rng.range(-1.2, 1.2);
    const r = rng.range(0.1, 0.46) * n;
    const x = n / 2 + Math.sin(a) * r * 0.9;
    const y = n * 0.9 - Math.abs(Math.cos(a)) * r * 1.5 - rng.next() * n * 0.1;
    const len = rng.range(0.2, 0.34) * n;
    leaf(
      x,
      y,
      len,
      len * rng.range(0.28, 0.4),
      a * 0.8 + rng.range(-0.6, 0.6),
      rng.range(110, 175)
    );
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  return t;
}

/** 木: 幹と枝（頂点色）+ 葉カードの樹冠 */
export function treeGeometries(
  rng: Rng,
  cards: number
): { trunk: THREE.BufferGeometry; leaves: THREE.BufferGeometry } {
  // ── 幹
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.15, 0.34, 5.6, 9, 8, true);
  trunk.translate(0, 2.8, 0);
  const tp = trunk.getAttribute('position');
  for (let i = 0; i < tp.count; i++) {
    const y = tp.getY(i);
    // 根元の張り出しと、ゆるい曲がり
    const flare = 1 + Math.max(0, 0.5 - y) * 0.9;
    tp.setX(i, tp.getX(i) * flare + Math.sin(y * 0.7) * 0.22);
    tp.setZ(i, tp.getZ(i) * flare + Math.cos(y * 0.5) * 0.12);
  }
  trunk.computeVertexNormals();
  parts.push(barkPaint(trunk, rng));
  const clusters: [number, number, number, number][] = [
    [0, 5.4, 0, 2.5],
    [1.5, 4.5, 0.6, 1.9],
    [-1.4, 4.7, -0.8, 2.0],
    [0.3, 6.7, -0.3, 1.7],
    [-0.4, 3.9, 1.4, 1.5],
  ];
  for (const [x, y, z] of clusters) {
    // 太い枝を樹冠の中心へ
    const len = Math.hypot(x, y - 3.5, z);
    const br = new THREE.CylinderGeometry(0.04, 0.12, len, 6, 1, true);
    br.translate(0, len / 2, 0);
    br.rotateZ(Math.atan2(Math.hypot(x, z), y - 3.5) * -1);
    br.rotateY(Math.atan2(-z, x));
    br.translate(0, 3.5, 0);
    parts.push(barkPaint(br, rng));
  }
  const trunkGeo = mergeGeometries(parts.map(toFlat), false);

  // ── 葉カード
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const totalR = clusters.reduce((s, c) => s + c[3] * c[3], 0);
  const u = new THREE.Vector3();
  const v = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const out = new THREE.Vector3();
  const rnd = new THREE.Vector3();
  for (const [cx, cy, cz, r] of clusters) {
    const n = Math.round((cards * r * r) / totalR);
    for (let k = 0; k < n; k++) {
      // 球殻寄りに分布（外側ほど密）
      const a = rng.next() * Math.PI * 2;
      const e = Math.acos(2 * rng.next() - 1);
      const rr = r * (0.35 + 0.65 * Math.cbrt(rng.next()));
      out.set(Math.sin(e) * Math.cos(a), Math.cos(e) * 0.85, Math.sin(e) * Math.sin(a)).normalize();
      const px = cx + out.x * rr;
      const py = cy + out.y * rr;
      const pz = cz + out.z * rr;
      // カードの向き: 外向きに寄せつつばらつかせる
      rnd.set(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1));
      nrm.copy(out).multiplyScalar(0.65).addScaledVector(rnd, 0.6).normalize();
      u.crossVectors(nrm, new THREE.Vector3(0, 1, 0));
      if (u.lengthSq() < 1e-3) u.set(1, 0, 0);
      u.normalize();
      v.crossVectors(nrm, u).normalize();
      // カードを葉の向き（枝先が外）にひねる
      const tw = rng.next() * Math.PI * 2;
      const cu = u.clone().multiplyScalar(Math.cos(tw)).addScaledVector(v, Math.sin(tw));
      const cv = v.clone().multiplyScalar(Math.cos(tw)).addScaledVector(u, -Math.sin(tw));
      const s = rng.range(1.0, 1.7);
      // 樹冠の内側ほど暗く（自己遮蔽）、上ほど明るく
      const ao = 0.42 + 0.58 * Math.pow(rr / r, 0.9);
      const light = Math.min(1.1, ao * (0.8 + 0.3 * Math.max(0, out.y)) * rng.range(0.9, 1.1));
      const lr = light * rng.range(0.92, 1.08);
      // 法線は外向きに寄せてふんわり陰影をつける
      const nx = out.x * 0.7 + nrm.x * 0.3;
      const ny = out.y * 0.7 + nrm.y * 0.3;
      const nz = out.z * 0.7 + nrm.z * 0.3;
      const nl = Math.hypot(nx, ny, nz) || 1;
      const corners: [number, number][] = [
        [-0.5, 0],
        [0.5, 0],
        [0.5, 1],
        [-0.5, 1],
      ];
      const vp = corners.map(([a1, b1]) => [
        px + cu.x * a1 * s + cv.x * (b1 - 0.5) * s,
        py + cu.y * a1 * s + cv.y * (b1 - 0.5) * s,
        pz + cu.z * a1 * s + cv.z * (b1 - 0.5) * s,
      ]);
      for (const idx of [0, 1, 2, 0, 2, 3]) {
        const p = vp[idx] as number[];
        pos.push(p[0] as number, p[1] as number, p[2] as number);
        nor.push(nx / nl, ny / nl, nz / nl);
        const c = corners[idx] as [number, number];
        uv.push(c[0] + 0.5, c[1]);
        col.push(lr, lr, lr);
      }
    }
  }
  const leaves = new THREE.BufferGeometry();
  leaves.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  leaves.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  leaves.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  leaves.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  leaves.computeBoundingSphere();
  return { trunk: trunkGeo, leaves };
}

function barkPaint(g: THREE.BufferGeometry, rng: Rng): THREE.BufferGeometry {
  const ng = toFlat(g);
  const n = ng.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 3) {
    const f = 0.7 + rng.next() * 0.55;
    for (let k = 0; k < 3; k++) {
      c[(i + k) * 3] = 0.21 * f;
      c[(i + k) * 3 + 1] = 0.155 * f;
      c[(i + k) * 3 + 2] = 0.11 * f;
    }
  }
  ng.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return ng;
}

/* ───────────── 電柱・電線 ───────────── */

/** コンクリート電柱 + 腕金 + がいし + 柱上変圧器 */
export function utilityPoleGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const pole = new THREE.CylinderGeometry(0.13, 0.22, 10.4, 10, 1);
  pole.translate(0, 5.2, 0);
  parts.push(paint(pole, 0.5, 0.5, 0.48));
  // 腕金（線路と直交 = ローカル Z 方向）
  parts.push(paint(new THREE.BoxGeometry(0.12, 0.12, 2.5).translate(0, 9.55, 0), 0.16, 0.16, 0.17));
  parts.push(paint(new THREE.BoxGeometry(0.12, 0.12, 1.9).translate(0, 8.9, 0), 0.16, 0.16, 0.17));
  for (const z of [-1.1, 0, 1.1]) {
    const ins = new THREE.CylinderGeometry(0.06, 0.09, 0.24, 8);
    ins.translate(0, 9.72, z);
    parts.push(paint(ins, 0.62, 0.58, 0.5));
  }
  // 変圧器
  const tr = new THREE.CylinderGeometry(0.36, 0.36, 0.95, 14);
  tr.translate(0.52, 8.3, 0);
  parts.push(paint(tr, 0.42, 0.45, 0.43));
  parts.push(
    paint(new THREE.CylinderGeometry(0.4, 0.4, 0.08, 14).translate(0.52, 8.82, 0), 0.25, 0.26, 0.27)
  );
  // 足場ボルト
  for (let i = 0; i < 6; i++) {
    parts.push(
      paint(new THREE.BoxGeometry(0.34, 0.03, 0.03).translate(0, 2.6 + i * 0.7, 0), 0.2, 0.2, 0.2)
    );
  }
  const g = mergeGeometries(parts, false);
  g.computeBoundingSphere();
  return g;
}

/** 電線: 柱から柱へ垂れ下がる 3 本。ローカル +X 方向に長さ span */
export function cableGeometry(span = 30, sag = 1.1): THREE.BufferGeometry {
  const tubes: THREE.BufferGeometry[] = [];
  for (const [y, z] of [
    [9.75, -1.1],
    [9.75, 0],
    [9.75, 1.1],
  ] as const) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 10; i++) {
      const s = i / 10;
      pts.push(new THREE.Vector3(s * span, y - sag * 4 * s * (1 - s), z));
    }
    const t = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.035, 5, false);
    tubes.push(paint(t, 0.04, 0.04, 0.045));
  }
  return mergeGeometries(tubes, false);
}

/* ───────────── 信号機 ───────────── */

/** 片持ち式の信号柱: 柱・腕・灯器（レンズは別メッシュ） */
export function signalGeometries(): { body: THREE.BufferGeometry; lens: THREE.BufferGeometry } {
  const parts: THREE.BufferGeometry[] = [];
  const pole = new THREE.CylinderGeometry(0.1, 0.16, 6.2, 10);
  pole.translate(0, 3.1, 0);
  parts.push(paint(pole, 0.55, 0.57, 0.58));
  const arm = new THREE.CylinderGeometry(0.07, 0.1, 5.6, 8);
  arm.rotateZ(Math.PI / 2);
  arm.translate(2.8, 5.9, 0);
  parts.push(paint(arm, 0.55, 0.57, 0.58));
  const lens: THREE.BufferGeometry[] = [];
  for (const x of [2.2, 4.6]) {
    // 灯器: 黒い箱 + ひさし
    parts.push(
      paint(new THREE.BoxGeometry(1.15, 0.38, 0.34).translate(x, 5.45, 0), 0.05, 0.06, 0.06)
    );
    for (const lx of [-0.37, 0, 0.37]) {
      for (const side of [-1, 1]) {
        parts.push(
          paint(
            new THREE.BoxGeometry(0.3, 0.05, 0.14).translate(x + lx, 5.67, side * 0.2),
            0.04,
            0.05,
            0.05
          )
        );
      }
    }
    // 点灯しているレンズ 1 枚（色はインスタンスごとに赤か青）。灯器の両面に付ける
    for (const side of [-1, 1]) {
      const d = new THREE.CylinderGeometry(0.12, 0.12, 0.04, 14);
      d.rotateX(Math.PI / 2);
      d.translate(x + 0.37, 5.45, side * 0.18);
      lens.push(toFlat(d));
    }
  }
  const body = mergeGeometries(parts, false);
  const lensGeo = mergeGeometries(lens, false);
  return { body, lens: lensGeo };
}
