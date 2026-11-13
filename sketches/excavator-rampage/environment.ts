import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { FacadeUniforms } from './facade';

export type TimeOfDay = 'day' | 'dusk' | 'night';
export const TIMES: TimeOfDay[] = ['dusk', 'day', 'night'];
export const TIME_LABEL: Record<TimeOfDay, string> = { day: '昼', dusk: '夕景', night: '夜' };

interface Preset {
  /** 太陽（夜は月）の高度・方位（度） */
  elev: number;
  az: number;
  sunColor: number;
  sunIntensity: number;
  /** 空の散乱パラメータ */
  turbidity: number;
  rayleigh: number;
  mie: number;
  mieG: number;
  /** IBL の強さ */
  envIntensity: number;
  exposure: number;
  fogColor: number;
  fogDensity: number;
  /** ビル窓の点灯率と発光 */
  lit: number;
  litGain: number;
  bloom: { strength: number; radius: number; threshold: number };
  /** 空の星の濃さ */
  stars: number;
  /** ヘッドライト・街灯の強さの係数 */
  lamps: number;
  hemi: { sky: number; ground: number; intensity: number };
  /** 雲量 0..1 */
  cloud: number;
  /** 最終パスの色調（コントラスト・彩度・色かぶり） */
  grade: { contrast: number; saturation: number; tint: [number, number, number] };
}

const PRESETS: Record<TimeOfDay, Preset> = {
  day: {
    elev: 46,
    az: 130,
    sunColor: 0xfff1de,
    sunIntensity: 2.5,
    turbidity: 3.2,
    rayleigh: 1.1,
    mie: 0.004,
    mieG: 0.8,
    envIntensity: 0.85,
    exposure: 0.5,
    fogColor: 0xb7c7d6,
    fogDensity: 0.0021,
    lit: 0.05,
    litGain: 1.2,
    bloom: { strength: 0.1, radius: 0.5, threshold: 1.7 },
    stars: 0,
    lamps: 0,
    hemi: { sky: 0xbfd9ff, ground: 0x6a6258, intensity: 0.25 },
    cloud: 0.46,
    grade: { contrast: 1.04, saturation: 1.06, tint: [1.0, 1.0, 1.0] },
  },
  dusk: {
    elev: 5.5,
    az: 246,
    sunColor: 0xffa860,
    sunIntensity: 4.6,
    turbidity: 6.5,
    rayleigh: 2.1,
    mie: 0.006,
    mieG: 0.86,
    envIntensity: 0.95,
    exposure: 0.55,
    fogColor: 0xd29a78,
    fogDensity: 0.0028,
    lit: 0.34,
    litGain: 2.0,
    bloom: { strength: 0.2, radius: 0.5, threshold: 1.25 },
    stars: 0,
    lamps: 0.7,
    hemi: { sky: 0xffc9a0, ground: 0x3a3340, intensity: 0.2 },
    cloud: 0.5,
    grade: { contrast: 1.1, saturation: 1.12, tint: [1.05, 1.0, 0.93] },
  },
  night: {
    elev: -8,
    az: 246,
    sunColor: 0x8fa8ff,
    sunIntensity: 0.9,
    turbidity: 2,
    rayleigh: 0.3,
    mie: 0.002,
    mieG: 0.7,
    envIntensity: 0.9,
    exposure: 1.0,
    fogColor: 0x0b1224,
    fogDensity: 0.0032,
    lit: 0.72,
    litGain: 3.0,
    bloom: { strength: 0.3, radius: 0.6, threshold: 1.6 },
    stars: 1,
    lamps: 1.6,
    hemi: { sky: 0x5a70b0, ground: 0x23232e, intensity: 0.9 },
    cloud: 0.46,
    grade: { contrast: 1.1, saturation: 0.95, tint: [0.92, 0.97, 1.07] },
  },
};

const SHADOW_EXTENT = 95;

export class Environment {
  readonly sun = new THREE.DirectionalLight(0xffffff, 1);
  readonly hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.2);
  readonly fog = new THREE.FogExp2(0xb7c7d6, 0.002);
  /** ヘッドライト・街灯の係数（時間帯で変わる） */
  lamps = 0;
  bloom = { strength: 0.2, radius: 0.5, threshold: 0.9 };
  grade: Preset['grade'] = { contrast: 1, saturation: 1, tint: [1, 1, 1] };
  time: TimeOfDay = 'dusk';
  private readonly sky = new Sky();
  private readonly envSky = new Sky();
  private readonly envScene = new THREE.Scene();
  private readonly pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private readonly stars: THREE.Points;
  private readonly sunDir = new THREE.Vector3();

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly facade: FacadeUniforms
  ) {
    scene.fog = this.fog;
    // 太陽付近の空は HDR で非常に明るく、ブルームが画面全体に広がる。見える空だけ上限をかける
    const clampSky = (sky: Sky, max: number) => {
      sky.material.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          'gl_FragColor = vec4( texColor, 1.0 );',
          `gl_FragColor = vec4( min( texColor, vec3( ${max.toFixed(2)} ) ), 1.0 );`
        );
      };
      sky.material.customProgramCacheKey = () => `sky-clamp-${max}`;
    };
    clampSky(this.sky, 1.1);
    clampSky(this.envSky, 8);
    this.sky.scale.setScalar(450000);
    this.envSky.scale.setScalar(450000);
    scene.add(this.sky);
    this.envScene.add(this.envSky);
    this.pmrem = new THREE.PMREMGenerator(renderer);

    this.sun.castShadow = true;
    this.sun.shadow.camera.left = -SHADOW_EXTENT;
    this.sun.shadow.camera.right = SHADOW_EXTENT;
    this.sun.shadow.camera.top = SHADOW_EXTENT;
    this.sun.shadow.camera.bottom = -SHADOW_EXTENT;
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 600;
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.35;
    this.setShadowSize(4096);
    scene.add(this.sun, this.sun.target, this.hemi);

    const n = 1800;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1;
      const t = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      // 上半球に寄せる
      pos[i * 3] = r * Math.cos(t) * 3000;
      pos[i * 3 + 1] = Math.abs(u) * 3000 * 0.95 + 60;
      pos[i * 3 + 2] = r * Math.sin(t) * 3000;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0xffffff,
        size: 1.8,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0,
        fog: false,
        depthWrite: false,
      })
    );
    this.stars.frustumCulled = false;
    scene.add(this.stars);
    this.setTime('dusk');
  }

  setShadowSize(size: number) {
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
  }

  setTime(t: TimeOfDay) {
    this.time = t;
    const p = PRESETS[t];
    const phi = THREE.MathUtils.degToRad(90 - p.elev);
    const theta = THREE.MathUtils.degToRad(p.az);
    this.sunDir.setFromSphericalCoords(1, phi, theta);

    for (const sky of [this.sky, this.envSky]) {
      const u = sky.material.uniforms;
      u.turbidity!.value = p.turbidity;
      u.rayleigh!.value = p.rayleigh;
      u.mieCoefficient!.value = p.mie;
      u.mieDirectionalG!.value = p.mieG;
      // 夜は月の位置に光の源を置く（空は暗いまま）
      u.sunPosition!.value.copy(this.sunDir);
      // 太陽円盤は HDR で極端に明るく、ブルームが画面全体に広がるので抑える
      u.showSunDisc!.value = 0;
      u.cloudCoverage!.value = p.cloud;
      u.cloudDensity!.value = 0.55;
      u.cloudElevation!.value = 0.55;
    }
    if (t === 'night') {
      // 月: 太陽が地平線の下でも、月の向きから光を当てる
      this.sunDir.setFromSphericalCoords(
        1,
        THREE.MathUtils.degToRad(48),
        THREE.MathUtils.degToRad(210)
      );
    }
    this.sun.color.setHex(p.sunColor);
    this.sun.intensity = p.sunIntensity;
    this.hemi.color.setHex(p.hemi.sky);
    this.hemi.groundColor.setHex(p.hemi.ground);
    this.hemi.intensity = p.hemi.intensity;
    this.fog.color.setHex(p.fogColor);
    this.fog.density = p.fogDensity;
    this.scene.environmentIntensity = p.envIntensity;
    this.renderer.toneMappingExposure = p.exposure;
    this.facade.uLit.value = p.lit;
    this.facade.uLitGain.value = p.litGain;
    this.bloom = { ...p.bloom };
    this.lamps = p.lamps;
    this.grade = p.grade;
    (this.stars.material as THREE.PointsMaterial).opacity = p.stars;

    this.envRT?.dispose();
    this.envRT = this.pmrem.fromScene(this.envScene, 0.02);
    this.scene.environment = this.envRT.texture;
  }

  private readonly tmpRight = new THREE.Vector3();
  private readonly tmpUp = new THREE.Vector3();
  private readonly tmpSnap = new THREE.Vector3();

  /** 影の範囲を target（ショベルカー）に追従させる。テクセルにスナップして影のちらつきを防ぐ */
  followShadow(target: THREE.Vector3) {
    const texel = (SHADOW_EXTENT * 2) / this.sun.shadow.mapSize.x;
    const L = this.sunDir;
    // 光源カメラの右・上の基底（光は target から L の向きにあり、-L を見下ろす）
    const right = this.tmpRight.crossVectors(THREE.Object3D.DEFAULT_UP, L).normalize();
    const up = this.tmpUp.crossVectors(L, right).normalize();
    const px = target.dot(right);
    const py = target.dot(up);
    const snapped = this.tmpSnap
      .copy(target)
      .addScaledVector(right, Math.round(px / texel) * texel - px)
      .addScaledVector(up, Math.round(py / texel) * texel - py);
    this.sun.target.position.copy(snapped);
    this.sun.position.copy(snapped).addScaledVector(L, 260);
  }

  update(time: number) {
    this.sky.material.uniforms.time!.value = time;
    this.envSky.material.uniforms.time!.value = time;
  }

  get sunDirection(): THREE.Vector3 {
    return this.sunDir;
  }

  /** パーティクルの着色に使う、現在の太陽光の色 */
  sunTint(out: THREE.Color): THREE.Color {
    return out.copy(this.sun.color).multiplyScalar(Math.min(1, this.sun.intensity / 3));
  }
}
