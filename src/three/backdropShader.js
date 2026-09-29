import * as THREE from 'three';

/*
 * Studio backdrop shared by the sky dome and the water floor's horizon haze, so the two
 * meet without a seam. The look follows the reference shots: saturated cerulean edges and
 * a huge soft white key light behind the water, which is what makes clear water read as
 * silver lenses with dark rims.
 *
 * Uniform objects are shared (not cloned) between materials, so updating them once drives both.
 */
export const BACKDROP_UNIFORMS = {
  uTime: { value: 0 },
  uGlowDir: { value: new THREE.Vector3(0.5, 0.18, -1).normalize() },
  uDeep: { value: new THREE.Color('#073559') },
  uMid: { value: new THREE.Color('#1a73aa') },
  uLight: { value: new THREE.Color('#a6dcf6') },
  uHot: { value: new THREE.Color('#f5fcff') },
};

export const BACKDROP_GLSL = /* glsl */ `
  uniform float uTime;
  uniform vec3 uGlowDir;
  uniform vec3 uDeep;
  uniform vec3 uMid;
  uniform vec3 uLight;
  uniform vec3 uHot;

  vec3 backdrop(vec3 d) {
    float h = max(d.y, 0.0);
    vec3 col = mix(uMid, uDeep, smoothstep(0.04, 0.85, h));
    float g = max(dot(d, uGlowDir), 0.0);
    // wide soft light, then a hot core
    col = mix(col, uLight, pow(g, 4.0) * 0.9);
    col = mix(col, uHot, pow(g, 18.0));
    // bright haze hugging the horizon, strongest toward the light
    col = mix(col, uLight, exp(-h * h * 70.0) * (0.25 + 0.55 * pow(g, 2.0)));
    // slow caustic shimmer high up
    float band = sin(d.x * 9.0 + uTime * 0.2 + sin(d.y * 6.0 + uTime * 0.15) * 1.5);
    col += uLight * 0.06 * smoothstep(0.7, 1.0, band) * smoothstep(0.05, 0.6, h);
    return col;
  }
`;
