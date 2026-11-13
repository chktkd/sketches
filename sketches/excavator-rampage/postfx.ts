import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/** トーンマップ後（sRGB）にかける最終パス: ビネット・微小な色収差・フィルムグレイン */
const FinishShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: 0.42 },
    uGrain: { value: 0.035 },
    uAberration: { value: 0.0005 },
    uContrast: { value: 1.0 },
    uSaturation: { value: 1.0 },
    uTint: { value: new THREE.Vector3(1, 1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain, uAberration, uContrast, uSaturation;
    uniform vec3 uTint;
    varying vec2 vUv;
    float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 ab = c * r2 * uAberration * 14.0;
      vec3 col = vec3(
        texture2D(tDiffuse, vUv + ab).r,
        texture2D(tDiffuse, vUv).g,
        texture2D(tDiffuse, vUv - ab).b);
      // カラーグレーディング: 色かぶり・彩度・S 字コントラスト
      col *= uTint;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation);
      col = clamp(col, 0.0, 1.0);
      col = mix(col, col * col * (3.0 - 2.0 * col), clamp((uContrast - 1.0) * 4.0, 0.0, 1.0));
      col = (col - 0.5) * uContrast + 0.5;
      col *= 1.0 - uVignette * smoothstep(0.1, 0.62, r2 * 1.9);
      float g = hash(gl_FragCoord.xy + fract(uTime) * 91.7) - 0.5;
      col += g * uGrain * (1.0 - 0.6 * dot(col, vec3(0.333)));
      gl_FragColor = vec4(col, 1.0);
    }`,
};

/** 指定のオブジェクトの表示を切り替えるだけのパス（AO の法線描画から粒子や空を外す用） */
class VisibilityPass extends Pass {
  constructor(
    private readonly objects: THREE.Object3D[],
    private readonly show: boolean
  ) {
    super();
    this.needsSwap = false;
  }
  override render() {
    for (const o of this.objects) o.visible = this.show;
  }
}

/** 光源の鏡面ハイライトなどの外れ値（数百〜数千）がブルームで画面全体に広がるのを防ぐ */
const ClampShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, uMax: { value: 6.0 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uMax;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      gl_FragColor = vec4(min(c.rgb, vec3(uMax)), c.a);
    }`,
};

export class PostFX {
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  private readonly finish: ShaderPass;
  private readonly gtao: GTAOPass;
  private readonly hideA: VisibilityPass;
  private readonly showA: VisibilityPass;
  private readonly renderPass: RenderPass;
  private enabled = true;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    /** AO の法線パスに映したくないもの（粒子・雲） */
    private readonly skipInAO: THREE.Object3D[] = []
  ) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.3, 0.6, 0.9);
    this.finish = new ShaderPass(FinishShader);
    this.hideA = new VisibilityPass(this.skipInAO, false);
    this.showA = new VisibilityPass(this.skipInAO, true);
    this.gtao = new GTAOPass(scene, camera as THREE.PerspectiveCamera, size.x, size.y);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    this.gtao.blendIntensity = 1.0;
    this.gtao.updateGtaoMaterial({
      radius: 3.2,
      distanceExponent: 1.6,
      thickness: 2.5,
      scale: 1.25,
      samples: 14,
      distanceFallOff: 1.0,
      screenSpaceRadius: false,
    });
    this.gtao.updatePdMaterial({
      lumaPhi: 10,
      depthPhi: 2,
      normalPhi: 3,
      radius: 6,
      rings: 2,
      samples: 12,
    });
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.hideA);
    this.composer.addPass(this.gtao);
    this.composer.addPass(this.showA);
    this.composer.addPass(new ShaderPass(ClampShader));
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(this.finish);
  }

  setSize(w: number, h: number, pixelRatio: number) {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
  }

  setGrade(g: { contrast: number; saturation: number; tint: [number, number, number] }) {
    const u = this.finish.uniforms as typeof FinishShader.uniforms;
    u.uContrast.value = g.contrast;
    u.uSaturation.value = g.saturation;
    u.uTint.value.set(...g.tint);
  }

  setBloom(strength: number, radius: number, threshold: number) {
    this.bloom.strength = strength;
    this.bloom.radius = radius;
    this.bloom.threshold = threshold;
  }

  /** 低品質モード: ブルームと最終パスを切る */
  setEnabled(on: boolean) {
    this.enabled = on;
    this.bloom.enabled = on;
    this.gtao.enabled = on;
    this.finish.enabled = on;
  }

  /** 検証用: 個別のパスを切る */
  debugToggle(name: 'gtao' | 'bloom' | 'finish', on: boolean) {
    if (name === 'gtao') this.gtao.enabled = on;
    else if (name === 'bloom') this.bloom.enabled = on;
    else this.finish.enabled = on;
  }

  get isEnabled() {
    return this.enabled;
  }

  render(dt: number, time: number) {
    (this.finish.uniforms as typeof FinishShader.uniforms).uTime.value = time;
    this.composer.render(dt);
  }
}
