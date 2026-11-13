import * as THREE from 'three';
import { CELL } from './config';
import { BUMP_GLSL, NOISE_GLSL } from './glsl';

export interface FacadeUniforms {
  /** 点灯している窓の割合 0..1 */
  uLit: { value: number };
  /** 点灯窓の発光の強さ */
  uLitGain: { value: number };
}

/**
 * ビルのセル用マテリアル。MeshStandardMaterial（PBR・シャドウ・IBL・フォグ）に、
 * 手続き生成のファサード（窓・サッシ・レンガ・コンクリート・汚れ・点灯）を差し込む。
 *
 * 模様の座標はセルの「元の位置 + セル内のローカル位置」で決まるので、
 * 破片になって飛んでも、模様はセルに貼りついたまま回転する。
 *
 * インスタンス属性:
 *   aOrigin (vec3)  セルの元のワールド座標（中心）
 *   aInfo   (vec4)  x: ビルのシード / y: 様式 0-3 / z: 種類 0 外壁 1 コンクリート / w: 損傷（破片は 1）
 */
export function createFacadeMaterial(): {
  material: THREE.MeshStandardMaterial;
  uniforms: FacadeUniforms;
} {
  const uniforms: FacadeUniforms = { uLit: { value: 0.3 }, uLitGain: { value: 2.2 } };
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.85,
    metalness: 0,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uLit = uniforms.uLit;
    shader.uniforms.uLitGain = uniforms.uLitGain;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec3 aOrigin;
attribute vec4 aInfo;
varying vec3 vPat;
varying vec3 vLN;
flat varying vec4 vInfo;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vPat = aOrigin + position * ${CELL.toFixed(4)};
vLN = normal;
vInfo = aInfo;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uLit;
uniform float uLitGain;
varying vec3 vPat;
varying vec3 vLN;
flat varying vec4 vInfo;
${NOISE_GLSL}
${BUMP_GLSL}
${FACADE_GLSL}`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float fRough = 0.85;
float fMetal = 0.0;
float fH = 0.0;
vec3 fEmit = vec3(0.0);
{
  vec3 fAlb;
  facade(vPat, vLN, vInfo, fAlb, fRough, fMetal, fEmit, fH);
  diffuseColor.rgb *= fAlb;
}`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = fRough;`
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
metalnessFactor = fMetal;`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
normal = bumpNormal(-vViewPosition, normal, fH, faceDirection);`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += fEmit;`
      );
  };
  material.customProgramCacheKey = () => 'facade-v2';
  return { material, uniforms };
}

const FACADE_GLSL = /* glsl */ `
void facade(vec3 p, vec3 ln, vec4 info, out vec3 alb, out float rou, out float met, out vec3 emi, out float hgt) {
  vec3 an = abs(ln);
  // 属性は整数値で持ち、補間誤差でハッシュが画素ごとに変わらないよう丸める
  float seed = floor(info.x + 0.5);
  float style = floor(info.y + 0.5);
  float kind = floor(info.z + 0.5);
  float dmg = floor(info.w + 0.5);
  bool side = an.y < 0.5;
  vec2 uv = an.x > 0.5 ? vec2(p.z, p.y) : (an.z > 0.5 ? vec2(p.x, p.y) : p.xz);
  float aa = max(max(fwidth(uv.x), fwidth(uv.y)) * 0.75, 0.003);

  float n1 = fbm2(uv * 1.9 + seed * 3.7);
  float n2 = vnoise(uv * 14.0 + seed);
  vec3 concrete = vec3(0.64, 0.635, 0.62) * (0.80 + 0.32 * n1) * (0.94 + 0.12 * n2);
  alb = concrete;
  rou = 0.9;
  met = 0.0;
  emi = vec3(0.0);
  hgt = 0.02 * n1 + 0.006 * n2;

  if (kind > 0.5 || !side) {
    // 床スラブ・屋根・上面: 無塗装コンクリート。屋根の上面は防水シート風に暗く
    if (!side) alb *= mix(0.58, 0.92, fbm2(uv * 0.7 + seed));
    // スラブの小口にだけ打ち継ぎの筋
    alb *= 1.0 - 0.18 * smoothstep(0.46, 0.5, abs(fract(uv.y / 3.0) - 0.5));
  } else {
    float floorH = 3.0;
    float fy = mod(uv.y, floorH);
    float fi = floor(uv.y / floorH);
    float glass = 0.0;
    float frame = 0.0;
    vec3 wall = concrete;
    float litRoll = 1.0;
    float litTone = h21(vec2(fi * 3.1, seed));
    float mortarH = 0.0;

    if (style < 0.5) {
      // カーテンウォール: 1.5m ピッチの縦框、階ごとにスパンドレル
      float bay = 1.5;
      float bu = floor(uv.x / bay);
      float fu = uv.x - bu * bay;
      float mull = 1.0 - rectMask(vec2(fu, 1.0), vec2(0.06, 0.0), vec2(bay - 0.06, 2.0), aa);
      float zone = rectMask(vec2(1.0, fy), vec2(0.0, 0.62), vec2(2.0, 2.86), aa);
      glass = zone * (1.0 - mull);
      frame = zone * mull + (1.0 - zone) * 0.8;
      wall = vec3(0.16, 0.19, 0.21) * (0.9 + 0.2 * n1);
      float panel = h21(vec2(bu, fi) + seed);
      float cluster = floor(uv.x / (bay * (2.0 + floor(h21(vec2(fi, seed)) * 3.0))));
      litRoll = h21(vec2(cluster, fi + seed * 7.0));
      alb = mix(wall, vec3(0.025, 0.05, 0.07) * (0.75 + 0.5 * panel), glass);
      alb = mix(alb, vec3(0.09, 0.1, 0.11), frame * (1.0 - glass));
    } else if (style < 1.5) {
      // 打放しコンクリート + 窓: 3m ピッチ
      float bay = 3.0;
      float bu = floor(uv.x / bay);
      float fu = uv.x - bu * bay;
      float win = rectMask(vec2(fu, fy), vec2(0.55, 0.78), vec2(2.45, 2.55), aa);
      float inner = rectMask(vec2(fu, fy), vec2(0.66, 0.89), vec2(2.34, 2.44), aa);
      float mull = 1.0 - rectMask(vec2(fu, 1.0), vec2(1.455, 0.0), vec2(1.545, 2.0), aa);
      float trans = 1.0 - rectMask(vec2(1.0, fy), vec2(0.0, 1.66), vec2(2.0, 1.72), aa);
      glass = inner * mull * trans;
      frame = win - glass;
      float sill = rectMask(vec2(1.0, fy), vec2(0.0, 0.7), vec2(2.0, 0.78), aa) * rectMask(vec2(fu, 1.0), vec2(0.45, 0.0), vec2(2.55, 2.0), aa);
      wall = concrete * (1.0 - 0.14 * smoothstep(0.02, 0.0, fy)) * (1.0 + 0.1 * sill);
      litRoll = h21(vec2(bu, fi) + seed * 11.0);
      alb = mix(wall, vec3(0.03, 0.045, 0.06), glass);
      alb = mix(alb, vec3(0.12, 0.12, 0.13), clamp(frame, 0.0, 1.0));
    } else if (style < 2.5) {
      // レンガの住宅: レンガ積み + 白いサッシ
      float bay = 2.4;
      float bu = floor(uv.x / bay);
      float fu = uv.x - bu * bay;
      float rowH = 0.09;
      float rr = floor(uv.y / rowH);
      float off = mod(rr, 2.0) * 0.14;
      float cu = floor((uv.x + off) / 0.28);
      vec2 bf = vec2(fract((uv.x + off) / 0.28), fract(uv.y / rowH));
      float mortar = max(step(bf.x, 0.06), step(bf.y, 0.14));
      float tone = 0.78 + 0.4 * h21(vec2(cu, rr) + seed);
      float fade = smoothstep(0.02, 0.07, max(fwidth(uv.x), fwidth(uv.y)));
      vec3 brick = vec3(1.0) * tone;
      vec3 mort = vec3(0.72, 0.7, 0.66);
      mortarH = mortar * (1.0 - fade);
      wall = mix(mix(brick, mort, mortar), vec3(0.88), fade);
      wall *= 0.9 + 0.2 * n1;
      float win = rectMask(vec2(fu, fy), vec2(0.62, 0.8), vec2(1.78, 2.5), aa);
      float inner = rectMask(vec2(fu, fy), vec2(0.72, 0.9), vec2(1.68, 2.4), aa);
      float bar = 1.0 - rectMask(vec2(fu, 1.0), vec2(1.17, 0.0), vec2(1.23, 2.0), aa);
      glass = inner * bar;
      frame = win - glass;
      float sill = rectMask(vec2(fu, fy), vec2(0.5, 0.72), vec2(1.9, 0.8), aa);
      float lintel = rectMask(vec2(fu, fy), vec2(0.5, 2.5), vec2(1.9, 2.62), aa);
      wall = mix(wall, vec3(0.78, 0.76, 0.72), max(sill, lintel));
      litRoll = h21(vec2(bu, fi) + seed * 5.0);
      alb = mix(wall, vec3(0.03, 0.04, 0.05), glass);
      alb = mix(alb, vec3(0.85, 0.85, 0.82), clamp(frame, 0.0, 1.0));
    } else {
      // 帯状窓のオフィス: 水平連続窓 + 6m ごとの柱型
      float bay = 1.5;
      float bu = floor(uv.x / bay);
      float fu = uv.x - bu * bay;
      float pier = rectMask(vec2(mod(uv.x, 6.0), 1.0), vec2(0.0, 0.0), vec2(0.7, 2.0), aa);
      float band = rectMask(vec2(1.0, fy), vec2(0.0, 0.72), vec2(2.0, 2.52), aa);
      float mull = 1.0 - rectMask(vec2(fu, 1.0), vec2(0.045, 0.0), vec2(bay - 0.045, 2.0), aa);
      glass = band * (1.0 - pier) * (1.0 - mull);
      frame = band * (1.0 - pier) * mull;
      wall = concrete * mix(1.0, 0.9, pier);
      float cluster = floor(uv.x / (bay * 3.0));
      litRoll = h21(vec2(cluster, fi + seed * 3.0));
      alb = mix(wall, vec3(0.03, 0.05, 0.065) * (0.8 + 0.4 * h21(vec2(bu, fi))), glass);
      alb = mix(alb, vec3(0.1, 0.1, 0.11), frame);
    }

    vec3 signEmi = vec3(0.0);
    if (fi < 0.5 && style < 1.5 || (fi < 0.5 && style > 2.5)) {
      // 1 階は店舗: 大きなガラス面・柱・看板帯・石の巾木
      float sb = 3.0;
      float sbay = floor(uv.x / sb);
      float su = uv.x - sbay * sb;
      float shop = rectMask(vec2(su, fy), vec2(0.16, 0.45), vec2(sb - 0.16, 2.6), aa);
      float mu = fract(uv.x / 1.5) * 1.5;
      float mullS = 1.0 - rectMask(vec2(mu, 1.0), vec2(0.045, 0.0), vec2(1.455, 2.0), aa);
      glass = shop * (1.0 - mullS);
      frame = shop * mullS;
      float signBand = rectMask(vec2(1.0, fy), vec2(0.0, 2.66), vec2(2.0, 2.96), aa);
      float plinth = 1.0 - smoothstep(0.4, 0.46, fy);
      vec3 sc = 0.5 + 0.5 * cos(6.2831 * (h21(vec2(sbay, seed)) + vec3(0.0, 0.33, 0.67)));
      wall = mix(concrete * 0.8, vec3(0.2, 0.19, 0.18) * (0.8 + 0.4 * n1), plinth);
      alb = mix(wall, vec3(0.025, 0.04, 0.055), glass);
      alb = mix(alb, vec3(0.1, 0.1, 0.11), frame);
      alb = mix(alb, sc * 0.55, signBand);
      litRoll = h21(vec2(sbay, 3.0 + seed)) * 0.7;
      float night = smoothstep(0.08, 0.3, uLit);
      signEmi = sc * signBand * uLitGain * (0.25 + 0.9 * night);
    }

    // 汚れ: 窓の下の雨だれと、足元の黒ずみ
    float streak = fbm2(vec2(uv.x * 2.6 + seed, uv.y * 0.22));
    alb *= 1.0 - 0.3 * smoothstep(0.55, 0.9, streak) * (1.0 - glass);
    alb *= mix(0.55, 1.0, smoothstep(0.0, 3.2, p.y));

    float lit = step(litRoll, uLit * (0.6 + 0.8 * litTone)) * glass;
    vec3 warm = mix(vec3(1.0, 0.72, 0.4), vec3(0.75, 0.88, 1.0), step(0.72, h21(vec2(litRoll * 91.0, fi))));
    float room = 0.55 + 0.45 * h21(vec2(floor(uv.x * 2.0), fi + seed));
    float blinds = 0.82 + 0.18 * step(0.5, fract(uv.y * 5.0));
    float ceil_ = 0.65 + 0.5 * smoothstep(0.0, 2.8, fy);
    emi = warm * lit * uLitGain * room * blinds * ceil_ + signEmi;

    float sheen = clamp(glass, 0.0, 1.0);
    rou = mix(0.86, style < 0.5 ? 0.17 : 0.2, sheen);
    met = mix(0.0, style < 0.5 ? 0.9 : 0.75, sheen);
    rou = mix(rou, 0.45, clamp(frame, 0.0, 1.0) * (1.0 - sheen));

    hgt += -0.1 * clamp(glass, 0.0, 1.0) + 0.03 * clamp(frame, 0.0, 1.0);
    if (style > 1.5 && style < 2.5) hgt -= 0.02 * mortarH;
    // 遠くでは窓の細かい模様が 1 画素より小さくなってちらつくので、平均した見た目へ寄せる
    float px = max(fwidth(uv.x), fwidth(uv.y));
    float lod = smoothstep(0.07, 0.5, px);
    float gf = style < 0.5 ? 0.78 : (style < 1.5 ? 0.36 : (style < 2.5 ? 0.22 : 0.5));
    vec3 avgWall = style < 0.5 ? vec3(0.17, 0.2, 0.22) : (style < 2.5 && style > 1.5 ? vec3(0.8, 0.78, 0.74) : concrete);
    vec3 avgAlb = mix(avgWall, vec3(0.03, 0.05, 0.07), gf) * mix(0.55, 1.0, smoothstep(0.0, 3.2, p.y));
    alb = mix(alb, avgAlb, lod);
    rou = mix(rou, 0.5, lod);
    met = mix(met, 0.3 * gf, lod);
    emi = mix(emi, vec3(1.0, 0.76, 0.5) * uLit * gf * 0.5 * uLitGain * 0.7, lod);
  }

  // 破片になったセル: ほこりをかぶり、ガラスは割れて光らない
  if (dmg > 0.5) {
    vec3 dust = vec3(0.56, 0.53, 0.48) * (0.7 + 0.5 * n1);
    alb = mix(alb, dust, 0.32);
    emi *= 0.35;
    rou = max(rou, 0.7);
    met *= 0.4;
  }
}
`;
