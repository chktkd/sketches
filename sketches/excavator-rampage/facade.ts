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
    // 割れた破片は面ごとに陰影をつける（平面で削った塊に見せる）。立方体のセルは元から平面なので変わらない
    flatShading: true,
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
attribute float aBreak;
varying vec3 vPat;
varying vec3 vLN;
varying float vCut;
flat varying vec4 vInfo;
flat varying float vBreak;
${SHATTER_GLSL}`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
// 損傷フラグ 2 は「半分に砕けた破片」。模様の大きさを半分にして元のセルの模様を引き継ぐ
float cs = aInfo.w > 1.5 ? ${(CELL / 2).toFixed(4)} : ${CELL.toFixed(4)};
vPat = aOrigin + position * cs;
vLN = normal;
vInfo = aInfo;
vBreak = aBreak;
{
  // 破片・欠けたセルの形を、平面で削った不規則な塊に変える（模様の座標は変形前の位置で決める）
  float cutAmt;
  transformed = shatter(position, aOrigin, aInfo, aBreak, cutAmt);
  vCut = cutAmt;
}`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uLit;
uniform float uLitGain;
varying vec3 vPat;
varying vec3 vLN;
varying float vCut;
flat varying vec4 vInfo;
flat varying float vBreak;
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
  facade(vPat, vLN, vInfo, vCut, vBreak, fAlb, fRough, fMetal, fEmit, fH);
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
  material.customProgramCacheKey = () => 'facade-v4';
  return { material, uniforms };
}

/**
 * 破片の形を変える頂点シェーダの部品（本体と影の描画で共有する）。
 *   モード 1・2（破片）: 立方体を、ランダムな 5 枚の平面で削って、割れた角のある塊にする
 *   モード 3（壊れた壁の欠けたセル）: 壊れて露出した面を、ノイズでギザギザに欠けさせる
 * 乱数はセルの元の位置とインスタンス番号から決まるので、生きている間は形が変わらない。
 */
const SHATTER_GLSL = /* glsl */ `
float hs11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
vec3 hs31(float p) {
  vec3 p3 = fract(vec3(p) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}
vec3 hs33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
float vn3d(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hs33(i).x;
  float b = hs33(i + vec3(1.0, 0.0, 0.0)).x;
  float c = hs33(i + vec3(0.0, 1.0, 0.0)).x;
  float d = hs33(i + vec3(1.0, 1.0, 0.0)).x;
  float e = hs33(i + vec3(0.0, 0.0, 1.0)).x;
  float g = hs33(i + vec3(1.0, 0.0, 1.0)).x;
  float h = hs33(i + vec3(0.0, 1.0, 1.0)).x;
  float k = hs33(i + vec3(1.0, 1.0, 1.0)).x;
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
}
vec3 shatter(vec3 q, vec3 origin, vec4 info, float brk, out float cut) {
  cut = 0.0;
  float mode = floor(info.w + 0.5);
  if (mode > 0.5 && mode < 2.5) {
    float sd = hs11(dot(origin, vec3(7.31, 5.17, 9.43)) + float(gl_InstanceID) * 0.137 + 0.5);
    vec3 p0 = q;
    for (int k = 0; k < 5; k++) {
      vec3 n = normalize(hs31(sd * 91.7 + float(k) * 1.713) - 0.5 + vec3(1e-4));
      float d = 0.27 + 0.2 * hs11(sd * 37.1 + float(k) * 3.7);
      float over = dot(q, n) - d;
      if (over > 0.0) q -= over * n;
    }
    q += (hs33(q * 17.0 + sd) - 0.5) * 0.05;
    cut = clamp(length(q - p0) * 6.0, 0.0, 1.0);
  } else if (mode > 2.5) {
    float m = floor(brk + 0.5);
    vec3 wp = origin + q * ${CELL.toFixed(3)};
    vec3 p0 = q;
    for (int a = 0; a < 3; a++) {
      for (int sg = 0; sg < 2; sg++) {
        float s = sg == 0 ? 1.0 : -1.0;
        float bit = float(a * 2 + sg);
        if (mod(floor(m / exp2(bit) + 0.001), 2.0) < 0.5) continue;
        if (p0[a] * s < 0.49) continue;
        // 世界座標のノイズなので、隣り合うセルの境界で欠け方が連続する
        float n = vn3d(wp * 1.15 + float(a) * 3.1) * 0.65 + vn3d(wp * 3.7) * 0.35;
        q[a] -= s * (0.04 + 0.62 * n * n);
        int t1 = (a + 1) % 3;
        int t2 = (a + 2) % 3;
        q[t1] += (vn3d(wp * 2.3 + 7.0) - 0.5) * 0.16;
        q[t2] += (vn3d(wp * 2.3 + 19.0) - 0.5) * 0.16;
      }
    }
    cut = clamp(length(q - p0) * 3.0, 0.0, 1.0);
  }
  return q;
}
`;

/** 影の描画にも同じ変形をかける（影が立方体のままだと、破片の形と食い違う） */
export function createFacadeDepthMaterial(): THREE.MeshDepthMaterial {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec3 aOrigin;
attribute vec4 aInfo;
attribute float aBreak;
${SHATTER_GLSL}`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
{
  float cutAmt;
  transformed = shatter(position, aOrigin, aInfo, aBreak, cutAmt);
}`
      );
  };
  m.customProgramCacheKey = () => 'facade-depth-v1';
  return m;
}

const FACADE_GLSL = /* glsl */ `
void facade(vec3 p, vec3 ln, vec4 info, float cut, float brk, out vec3 alb, out float rou, out float met, out vec3 emi, out float hgt) {
  vec3 an = abs(ln);
  // 属性は整数値で持ち、補間誤差でハッシュが画素ごとに変わらないよう丸める
  float seed = floor(info.x + 0.5);
  float style = floor(info.y + 0.5);
  float kind = floor(info.z + 0.5);
  float dmg = floor(info.w + 0.5);
  float mode0 = dmg;
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

  // ひび割れ: 壊れた箇所の周囲のセル（静的なセルでは aBreak がひびの強さ 0..1）に、細い亀裂を走らせる。
  // 線の太さは一定にし、現れる範囲を世界座標のノイズで切るので、セルの境界で急に途切れない
  if (mode0 < 0.5 && brk > 0.01) {
    vec2 cuv = an.y > 0.5 ? p.xz : uv;
    float c1 = fbm2(cuv * 1.5 + seed * 0.37);
    float c2 = fbm2(cuv * 3.1 + 41.0 + seed);
    float l1 = 1.0 - smoothstep(0.004, 0.011 + fwidth(c1) * 1.5, abs(c1 - 0.5));
    float l2 = (1.0 - smoothstep(0.003, 0.008 + fwidth(c2) * 1.5, abs(c2 - 0.5))) * 0.8;
    float reach = smoothstep(0.5, 0.68, fbm2(cuv * 0.55 + seed + 9.0) + brk * 0.3);
    float crack = max(l1, l2) * reach;
    alb = mix(alb, vec3(0.05, 0.045, 0.04), crack * 0.9);
    hgt -= crack * 0.035;
    emi *= 1.0 - crack * 0.5;
    rou = mix(rou, 0.9, crack);
  }

  // 破断面: 割れた面・壊れて露出した面は、骨材の見えるコンクリートの断面にする
  float fr = 0.0;
  float mode = floor(info.w + 0.5);
  if (mode > 0.5 && mode < 2.5) {
    fr = smoothstep(0.1, 0.45, cut);
  } else if (mode > 2.5) {
    float bi = an.x > 0.5 ? (ln.x > 0.0 ? 0.0 : 1.0) : (an.y > 0.5 ? (ln.y > 0.0 ? 2.0 : 3.0) : (ln.z > 0.0 ? 4.0 : 5.0));
    fr = mod(floor(brk / exp2(bi) + 0.001), 2.0) > 0.5 ? 1.0 : 0.0;
  }
  if (fr > 0.0) {
    float agg = n3(p * 14.0);
    float peb = step(0.8, h21(floor(vec2(p.x + p.z, p.y) * 44.0)));
    float peb2 = step(0.9, h21(floor(vec2(p.y, p.x - p.z) * 71.0 + 5.0)));
    vec3 cement = vec3(0.34, 0.33, 0.315) * (0.6 + 0.7 * agg);
    cement = mix(cement, vec3(0.5, 0.48, 0.44), peb * 0.65);
    cement = mix(cement, vec3(0.2, 0.19, 0.18), peb2 * 0.6);
    alb = mix(alb, cement, fr);
    rou = mix(rou, 0.97, fr);
    met = mix(met, 0.0, fr);
    emi *= 1.0 - fr;
    hgt = mix(hgt, 0.09 * n3(p * 10.0) + 0.04 * n3(p * 30.0), fr);
  }

  // 破片: ほこりをかぶり、ガラスは割れて光らない。欠けて残ったセルは薄く粉をかぶる
  float dustAmt = dmg > 2.5 ? 0.12 : (dmg > 0.5 ? 0.32 : 0.0);
  if (dustAmt > 0.0) {
    vec3 dustCol = vec3(0.56, 0.53, 0.48) * (0.7 + 0.5 * n1);
    alb = mix(alb, dustCol, dustAmt);
    emi *= dmg > 2.5 ? 0.6 : 0.35;
    rou = max(rou, 0.7);
    met *= 0.4;
  }
}
`;
