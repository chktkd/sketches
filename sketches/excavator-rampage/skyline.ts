import * as THREE from 'three';
import { MOUNTAIN_ANGLE } from './terrain';
import { createRng } from './rng';

/**
 * 地平線の向こうの街並み。ビルの影絵と窓明かりを 2 枚の円筒に描く。
 * 影絵はフォグで霞み、窓明かりは加算合成で時間帯に応じて灯る。
 */
export class Skyline {
  readonly group = new THREE.Group();
  private readonly body: THREE.MeshBasicMaterial;
  private readonly lights: THREE.MeshBasicMaterial;

  constructor() {
    const W = 8192;
    const H = 512;
    const rng = createRng(2468);
    const bc = document.createElement('canvas');
    bc.width = W;
    bc.height = H;
    const lc = document.createElement('canvas');
    lc.width = W;
    lc.height = H;
    const b = bc.getContext('2d')!;
    const l = lc.getContext('2d')!;
    // 円筒の u → 方位。three の円筒は x = r sinθ, z = r cosθ なので atan2(z, x) = π/2 - θ
    const angleAt = (px: number) => Math.PI / 2 - (px / W) * Math.PI * 2;
    const blocked = (px: number) => Math.cos(angleAt(px) - MOUNTAIN_ANGLE) > 0.0;
    let x = 0;
    while (x < W) {
      const w = Math.floor(rng.range(12, 46));
      // 都心（ある方角）ほど高く
      const dense = 0.5 + 0.5 * Math.cos(angleAt(x) - 0.9);
      const h = Math.floor(rng.range(30, 140) * (0.5 + dense * 1.4) * (rng.chance(0.12) ? 1.8 : 1));
      if (!blocked(x) && rng.chance(0.85)) {
        const top = H - Math.min(H - 8, h);
        const g = 0.2 + rng.next() * 0.2;
        b.fillStyle = `rgb(${Math.floor(g * 255)},${Math.floor((g + 0.04) * 255)},${Math.floor((g + 0.1) * 255)})`;
        b.fillRect(x, top, w, H - top);
        if (rng.chance(0.3)) b.fillRect(x + w * 0.3, top - rng.range(4, 18), w * 0.2, 20);
        // 窓明かり
        const cols = Math.max(2, Math.floor(w / 3));
        for (let cx = 0; cx < cols; cx++) {
          for (let cy = top + 4; cy < H - 2; cy += 4) {
            if (rng.next() < 0.22) {
              const t = rng.next();
              l.fillStyle = t < 0.7 ? 'rgba(255,196,120,0.95)' : 'rgba(190,220,255,0.9)';
              l.fillRect(x + 1 + cx * 3, cy, 2, 2);
            }
          }
        }
      }
      x += w + Math.floor(rng.range(0, 10));
    }
    const mk = (c: HTMLCanvasElement) => {
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      return t;
    };
    const geo = new THREE.CylinderGeometry(1900, 1900, 300, 128, 1, true);
    geo.translate(0, 135, 0);
    this.body = new THREE.MeshBasicMaterial({
      map: mk(bc),
      transparent: true,
      side: THREE.BackSide,
      depthWrite: false,
      fog: true,
    });
    this.lights = new THREE.MeshBasicMaterial({
      map: mk(lc),
      transparent: true,
      side: THREE.BackSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      opacity: 0.3,
    });
    const body = new THREE.Mesh(geo, this.body);
    const lights = new THREE.Mesh(geo, this.lights);
    for (const m of [body, lights]) {
      m.frustumCulled = false;
      this.group.add(m);
    }
    lights.renderOrder = 1;
  }

  /** tint: 影絵の色味、lit: 窓明かりの強さ */
  setLook(tint: THREE.ColorRepresentation, lit: number) {
    this.body.color.set(tint);
    this.lights.opacity = lit;
  }
}
