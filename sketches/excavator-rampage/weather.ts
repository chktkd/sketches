import * as THREE from 'three';
import { BUMP_GLSL, NOISE_GLSL } from './glsl';

export interface WeatherOptions {
  /** 泥・埃の汚れ 0..1 */
  dirt: number;
  /** 塗装の剥げ・擦り傷 0..1 */
  wear: number;
  /** 微細な凹凸の強さ */
  bump: number;
  /** 錆 0..1 */
  rust?: number;
  /** 模様の個体差 */
  seed?: number;
}

/**
 * 既存の PBR マテリアルに「使い込まれた質感」を足す。
 * 汚れ（地面に近いほど・上向きの面ほど溜まる）、雨だれ、塗装剥げ、擦り傷、錆、
 * オレンジピール状の微細な凹凸を、物体空間の位置から手続き生成する。
 */
export function weatherize<T extends THREE.MeshStandardMaterial>(mat: T, o: WeatherOptions): T {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uDirt = { value: o.dirt };
    shader.uniforms.uWear = { value: o.wear };
    shader.uniforms.uBump = { value: o.bump };
    shader.uniforms.uRust = { value: o.rust ?? 0 };
    shader.uniforms.uWSeed = { value: o.seed ?? 0 };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vObj;
varying vec3 vWPos;
varying vec3 vWN;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vObj = position;
vec4 wp_ = vec4(position, 1.0);
vec3 wn_ = normal;
#ifdef USE_INSTANCING
  wp_ = instanceMatrix * wp_;
  wn_ = mat3(instanceMatrix) * wn_;
#endif
vWPos = (modelMatrix * wp_).xyz;
vWN = normalize(mat3(modelMatrix) * wn_);`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uDirt;
uniform float uWear;
uniform float uBump;
uniform float uRust;
uniform float uWSeed;
varying vec3 vObj;
varying vec3 vWPos;
varying vec3 vWN;
${NOISE_GLSL}
${BUMP_GLSL}`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float wDirt = 0.0;
float wChip = 0.0;
float wHeight = 0.0;
{
  vec3 p = vObj + uWSeed;
  float big = n3(p * 0.35);
  float mid = n3(p * 1.7);
  float fine = n3(p * 9.0);
  float low = smoothstep(9.0, 0.4, vWPos.y);
  float up = clamp(vWN.y, 0.0, 1.0);
  // 雨だれ: 縦方向に伸びたノイズ（上向き面から流れ落ちる）
  float streak = vnoise(vec2((p.x + p.z) * 5.5, p.y * 0.22 + big * 2.0));
  streak = smoothstep(0.55, 0.9, streak) * (1.0 - up);
  float d = uDirt * (0.18 + 0.95 * low * low + 0.3 * up) * (0.4 + 1.1 * mid) + streak * uDirt * 0.5;
  // 足元の泥はねは粒状に
  d += uDirt * 0.6 * low * smoothstep(0.55, 0.8, fine) ;
  wDirt = clamp(d, 0.0, 0.93);
  // 塗装剥げ: 大きな塊のうち、さらに細かい欠け方をした所だけ地金が出る
  float chipMask = smoothstep(0.62 - uWear * 0.16, 0.7 - uWear * 0.12, big * 0.55 + mid * 0.45) *
                   smoothstep(0.4, 0.6, fine);
  // 擦り傷: 細い線
  float sc = abs(vnoise(vec2(dot(p.xy, vec2(0.9, 0.44)) * 38.0, dot(p.yz, vec2(0.3, 1.0)) * 2.4)) - 0.5);
  float scratch = (1.0 - smoothstep(0.0, 0.035, sc)) * smoothstep(0.45, 0.7, mid) * uWear;
  wChip = clamp(chipMask * uWear * 1.3 + scratch * 0.8, 0.0, 1.0);
  vec3 metal = vec3(0.5, 0.48, 0.45) * (0.7 + 0.5 * fine);
  vec3 rust = vec3(0.34, 0.15, 0.06) * (0.6 + 0.8 * mid);
  float rustMask = uRust * smoothstep(0.5, 0.75, big) * smoothstep(0.35, 0.65, mid);
  vec3 dirtCol = mix(vec3(0.17, 0.125, 0.085), vec3(0.3, 0.25, 0.19), mid) * 0.8;
  diffuseColor.rgb = mix(diffuseColor.rgb, metal, wChip);
  diffuseColor.rgb = mix(diffuseColor.rgb, rust, rustMask);
  diffuseColor.rgb = mix(diffuseColor.rgb, dirtCol, wDirt);
  wChip = max(wChip, rustMask * 0.3);
  // 微細な凹凸（オレンジピール）+ 傷の溝
  wHeight = (mid * 0.5 + fine * 0.5) * 0.03 * uBump - scratch * 0.012;
}`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.34, wChip * 0.7);
roughnessFactor = mix(roughnessFactor, 0.93, wDirt);`
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
metalnessFactor = mix(metalnessFactor, 0.85, wChip);
metalnessFactor = mix(metalnessFactor, 0.0, wDirt);`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
normal = bumpNormal(-vViewPosition, normal, wHeight, faceDirection);`
      );
  };
  mat.customProgramCacheKey = () => `weather-${o.dirt}-${o.wear}-${o.bump}-${o.rust ?? 0}`;
  return mat;
}
