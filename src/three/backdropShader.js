import * as THREE from 'three';

/*
 * Studio backdrop shared by the sky dome and the water floor's horizon haze, so the two
 * meet without a seam. Premium "midnight" set: a near-black navy studio with one soft cool
 * spotlight pooled behind the product, a warm champagne haze on the horizon and a faint
 * gold rim light — the classic luxury bottle shot, where the glass and water read through
 * crisp highlights and glowing edges rather than a bright background.
 *
 * Uniform objects are shared (not cloned) between materials, so updating them once drives both.
 */
export const BACKDROP_UNIFORMS = {
  uTime: { value: 0 },
  uGlowDir: { value: new THREE.Vector3(0.5, 0.18, -1).normalize() },
  uDeep: { value: new THREE.Color('#010307') },
  uMid: { value: new THREE.Color('#071629') },
  uLight: { value: new THREE.Color('#2a6e9e') },
  uHot: { value: new THREE.Color('#cfe9ff') },
  uGold: { value: new THREE.Color('#d9b87c') },
};

export const BACKDROP_GLSL = /* glsl */ `
  uniform float uTime;
  uniform vec3 uGlowDir;
  uniform vec3 uDeep;
  uniform vec3 uMid;
  uniform vec3 uLight;
  uniform vec3 uHot;
  uniform vec3 uGold;

  vec3 backdrop(vec3 d) {
    float h = max(d.y, 0.0);
    // midnight: deep navy at the horizon falling to near-black overhead
    vec3 col = mix(uMid, uDeep, smoothstep(0.0, 0.65, h));
    float g = max(dot(d, uGlowDir), 0.0);
    // a soft cool spotlight pooled behind the product, with a gentle bright core
    col += uLight * pow(g, 5.0) * 0.85;
    col += uHot * pow(g, 36.0) * 0.4;
    // warm champagne haze along the horizon, richest toward the spotlight
    col += uGold * exp(-h * h * 90.0) * (0.05 + 0.16 * pow(g, 3.0));
    // a faint gold rim light high on the left
    float r = max(dot(d, normalize(vec3(-0.8, 0.55, -0.6))), 0.0);
    col += uGold * pow(r, 12.0) * 0.16;
    // slow caustic shimmer, barely there
    float band = sin(d.x * 9.0 + uTime * 0.2 + sin(d.y * 6.0 + uTime * 0.15) * 1.5);
    col += uLight * 0.03 * smoothstep(0.75, 1.0, band) * smoothstep(0.05, 0.6, h);
    return col;
  }
`;
