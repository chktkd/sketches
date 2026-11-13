/** facade / weather で共有する GLSL（ノイズ・矩形マスク・法線の凹凸） */
export const NOISE_GLSL = /* glsl */ `
float h21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x),
             mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm2(vec2 p) {
  return vnoise(p) * 0.5 + vnoise(p * 2.07 + 17.3) * 0.3 + vnoise(p * 4.31 + 5.1) * 0.2;
}
// 3 平面のノイズを平均した擬似 3D ノイズ（立体物の表面に継ぎ目なく使える）
float n3(vec3 p) {
  return (vnoise(p.xy) + vnoise(p.yz + 7.3) + vnoise(p.zx + 13.7)) * 0.3333;
}
float rectMask(vec2 p, vec2 lo, vec2 hi, float aa) {
  vec2 a = smoothstep(lo - aa, lo + aa, p);
  vec2 b = 1.0 - smoothstep(hi - aa, hi + aa, p);
  return a.x * a.y * b.x * b.y;
}
`;

/**
 * 高さ h（画面空間で微分する）から法線を傾ける。three の perturbNormalArb と同じ式。
 * 画素あたりの高さ変化で傾くので、遠くでは自然に平らになる。
 */
export const BUMP_GLSL = /* glsl */ `
vec3 bumpNormal(vec3 surfPos, vec3 n, float h, float faceDir) {
  vec2 dH = vec2(dFdx(h), dFdy(h));
  vec3 sx = normalize(dFdx(surfPos));
  vec3 sy = normalize(dFdy(surfPos));
  vec3 r1 = cross(sy, n);
  vec3 r2 = cross(n, sx);
  float det = dot(sx, r1) * faceDir;
  vec3 grad = sign(det) * (dH.x * r1 + dH.y * r2);
  return normalize(abs(det) * n - grad);
}
`;
