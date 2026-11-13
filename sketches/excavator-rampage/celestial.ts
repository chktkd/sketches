import * as THREE from 'three';
import { createRng } from './rng';

function glowTexture(core: number): THREE.CanvasTexture {
  const n = 256;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(core, 'rgba(255,255,255,1)');
  g.addColorStop(core + 0.05, 'rgba(255,255,255,0.45)');
  g.addColorStop(0.42, 'rgba(255,255,255,0.1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, n, n);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function moonTexture(): THREE.CanvasTexture {
  const n = 256;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d')!;
  const rng = createRng(99);
  const halo = ctx.createRadialGradient(n / 2, n / 2, n * 0.12, n / 2, n / 2, n / 2);
  halo.addColorStop(0, 'rgba(200,215,255,0.35)');
  halo.addColorStop(1, 'rgba(200,215,255,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, n, n);
  ctx.save();
  ctx.beginPath();
  ctx.arc(n / 2, n / 2, n * 0.14, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#e9edf5';
  ctx.fillRect(0, 0, n, n);
  // 海とクレーター
  for (let i = 0; i < 26; i++) {
    const r = rng.range(2, 9);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, `rgba(120,128,150,${rng.range(0.25, 0.5)})`);
    g.addColorStop(1, 'rgba(120,128,150,0)');
    ctx.save();
    ctx.translate(n / 2 + rng.range(-34, 34), n / 2 + rng.range(-34, 34));
    ctx.fillStyle = g;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.restore();
  }
  ctx.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 空に浮かぶ太陽と月。カメラに追従し、常に遠方に置く */
export class Celestial {
  readonly group = new THREE.Group();
  private readonly sun: THREE.Sprite;
  private readonly moon: THREE.Sprite;
  private readonly sunDir = new THREE.Vector3(0, 1, 0);
  private readonly moonDir = new THREE.Vector3(0, 1, 0);

  constructor() {
    const mk = (tex: THREE.Texture) => {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: tex,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          fog: false,
        })
      );
      s.frustumCulled = false;
      this.group.add(s);
      return s;
    };
    this.sun = mk(glowTexture(0.07));
    this.moon = mk(moonTexture());
  }

  setLook(time: 'day' | 'dusk' | 'night', sunDir: THREE.Vector3, moonDir: THREE.Vector3) {
    this.sunDir.copy(sunDir);
    this.moonDir.copy(moonDir);
    const sm = this.sun.material as THREE.SpriteMaterial;
    if (time === 'day') {
      sm.color.setRGB(5, 4.6, 4);
      this.sun.scale.setScalar(620);
    } else if (time === 'dusk') {
      sm.color.setRGB(4.6, 2.3, 0.95);
      this.sun.scale.setScalar(1000);
    }
    this.sun.visible = time !== 'night';
    this.moon.visible = time === 'night';
    (this.moon.material as THREE.SpriteMaterial).color.setRGB(2.2, 2.3, 2.7);
    this.moon.scale.setScalar(900);
  }

  update(camPos: THREE.Vector3) {
    this.sun.position.copy(camPos).addScaledVector(this.sunDir, 4200);
    this.moon.position.copy(camPos).addScaledVector(this.moonDir, 4200);
  }
}
