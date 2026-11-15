import type * as THREE from 'three';

/** 風の時間（秒）。全ての揺れる植物が共有する */
export const wind = { uTime: { value: 0 } };

/**
 * 木の幹は固定し、高い所ほど大きく揺らす頂点シェーダを差し込む。
 * インスタンスごとの位置から位相をずらすので、森全体がうねるように揺れる。
 */
export function swayify<T extends THREE.Material>(mat: T, amp = 0.05): T {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uWindTime = wind.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWindTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
{
  vec3 ip = vec3(0.0);
  #ifdef USE_INSTANCING
    ip = instanceMatrix[3].xyz;
  #endif
  float ph = ip.x * 0.071 + ip.z * 0.053;
  float hh = max(transformed.y, 0.0);
  float gust = sin(uWindTime * 0.45 + ip.x * 0.004 + ip.z * 0.003) * 0.5 + 0.8;
  float w = (sin(uWindTime * 1.35 + ph) + 0.5 * sin(uWindTime * 2.9 + ph * 1.9)) * ${amp.toFixed(3)} * hh * hh * 0.14 * gust;
  transformed.x += w;
  transformed.z += w * 0.55;
}`
      );
  };
  mat.customProgramCacheKey = () => `sway-${amp}`;
  return mat;
}
