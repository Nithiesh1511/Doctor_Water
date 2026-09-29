import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { BACKDROP_GLSL, BACKDROP_UNIFORMS } from './backdropShader';
import { FLOOR_Y } from './physics';

const MAX_RIPPLES = 24;
const RIPPLE_LIFE = 3.2;

/**
 * A still water surface the bottle stands on: a planar mirror of the scene (rendered once per
 * frame from a reflected camera), bent by analytic ripple rings wherever drops land, with
 * Fresnel falloff into the water and a horizon haze that melts into the backdrop.
 * Consumes shared.current.floorRipples ({ x, z, amp }).
 */
export default function WaterFloor({ shared }) {
  const meshRef = useRef();
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);

  const rt = useMemo(
    () => new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType, samples: 0 }),
    []
  );
  useEffect(() => () => rt.dispose(), [rt]);
  useEffect(() => {
    const dpr = gl.getPixelRatio();
    rt.setSize(Math.round((size.width * dpr) / 2), Math.round((size.height * dpr) / 2));
  }, [gl, size, rt]);

  const ripples = useMemo(() => Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, 99, 0)), []);
  const cursor = useRef(0);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        toneMapped: false,
        uniforms: {
          ...BACKDROP_UNIFORMS,
          tMirror: { value: rt.texture },
          textureMatrix: { value: new THREE.Matrix4() },
          uCam: { value: new THREE.Vector3() },
          uRip: { value: ripples },
          uWater: { value: new THREE.Color('#0b4f7e') },
          uSun: { value: new THREE.Vector3(0.3, 0.6, -1).normalize() },
        },
        vertexShader: /* glsl */ `
          uniform mat4 textureMatrix;
          varying vec4 vMirror;
          varying vec3 vWorld;
          void main() {
            vMirror = textureMatrix * vec4(position, 1.0);
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorld = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: /* glsl */ `
          ${BACKDROP_GLSL}
          uniform sampler2D tMirror;
          uniform vec3 uCam;
          uniform vec4 uRip[${MAX_RIPPLES}];
          uniform vec3 uWater;
          uniform vec3 uSun;
          varying vec4 vMirror;
          varying vec3 vWorld;

          // gradient of the surface height field: calm swell + expanding impact rings
          vec2 slope(vec2 p) {
            vec2 g = vec2(0.0);
            g += vec2(0.8, 0.3) * cos(dot(p, vec2(0.8, 0.3)) * 2.2 + uTime * 0.7) * 0.010;
            g += vec2(-0.4, 0.9) * cos(dot(p, vec2(-0.4, 0.9)) * 3.4 + uTime * 1.1) * 0.007;
            g += vec2(0.2, -1.0) * cos(dot(p, vec2(0.2, -1.0)) * 5.3 - uTime * 0.9) * 0.004;
            for (int i = 0; i < ${MAX_RIPPLES}; i++) {
              vec4 r = uRip[i];
              if (r.w <= 0.0) continue;
              vec2 d = p - r.xy;
              float dist = length(d) + 1e-4;
              // a packet of rings travelling outward, the trailing rings slower (dispersion)
              float x = dist - r.z * 0.75;
              float env = exp(-x * x * 5.0) * exp(-r.z * 1.1) * r.w / (1.0 + dist * 1.8);
              float dh = cos(x * 24.0 - r.z * 2.0) * env;
              g += (d / dist) * dh * 0.35;
            }
            return g;
          }

          void main() {
            vec2 g = slope(vWorld.xz);
            vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
            vec3 v = normalize(uCam - vWorld);
            float ndv = max(dot(n, v), 0.0);
            float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);

            vec2 uv = vMirror.xy / vMirror.w + n.xz * 0.05;
            vec3 refl = texture2D(tMirror, uv).rgb;

            // looking into the water: deep blue, lit a little from the key light
            vec3 below = uWater * (0.55 + 0.45 * max(dot(n, uGlowDir), 0.0));
            vec3 col = mix(below, refl, clamp(0.35 + fres * 0.9, 0.0, 1.0));

            // sharp glints of the key light on the ripple crests
            vec3 h = normalize(uSun + v);
            col += vec3(1.0) * pow(max(dot(n, h), 0.0), 420.0) * 2.2;

            // melt into the backdrop toward the horizon
            vec3 view = vWorld - uCam;
            float dist = length(view.xz);
            vec3 horizon = backdrop(normalize(vec3(view.x, 0.0, view.z)));
            col = mix(col, horizon, smoothstep(10.0, 60.0, dist));

            gl_FragColor = vec4(col, 1.0);
            #include <colorspace_fragment>
          }
        `,
      }),
    [rt, ripples]
  );

  const mirror = useMemo(
    () => ({
      cam: new THREE.PerspectiveCamera(),
      plane: new THREE.Plane(),
      normal: new THREE.Vector3(0, 1, 0),
      pos: new THREE.Vector3(),
      camPos: new THREE.Vector3(),
      rot: new THREE.Matrix4(),
      look: new THREE.Vector3(),
      target: new THREE.Vector3(),
      view: new THREE.Vector3(),
      clip: new THREE.Vector4(),
      q: new THREE.Vector4(),
    }),
    []
  );

  useFrame((state, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const S = shared.current;
    const sdt = Math.min(delta, 1 / 30) * S.time.scale;

    // ---------- ripple events ----------
    while (S.floorRipples.length) {
      const e = S.floorRipples.shift();
      const r = ripples[cursor.current];
      cursor.current = (cursor.current + 1) % MAX_RIPPLES;
      r.set(e.x, e.z, 0, Math.min(e.amp, 1.5));
    }
    for (const r of ripples) {
      r.z += sdt;
      if (r.z > RIPPLE_LIFE) r.w = 0;
    }

    // ---------- planar mirror from the reflected camera (after three.js' Reflector) ----------
    const camera = state.camera;
    const m = mirror;
    mesh.updateMatrixWorld();
    m.pos.setFromMatrixPosition(mesh.matrixWorld);
    m.camPos.setFromMatrixPosition(camera.matrixWorld);
    material.uniforms.uCam.value.copy(m.camPos);

    m.view.subVectors(m.pos, m.camPos);
    if (m.view.dot(m.normal) > 0) return; // camera below the surface
    m.view.reflect(m.normal).negate().add(m.pos);
    m.rot.extractRotation(camera.matrixWorld);
    m.look.set(0, 0, -1).applyMatrix4(m.rot).add(m.camPos);
    m.target.subVectors(m.pos, m.look).reflect(m.normal).negate().add(m.pos);

    const vc = m.cam;
    vc.position.copy(m.view);
    vc.up.set(0, 1, 0).applyMatrix4(m.rot).reflect(m.normal);
    vc.lookAt(m.target);
    vc.far = camera.far;
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(camera.projectionMatrix);

    const tm = material.uniforms.textureMatrix.value;
    tm.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    tm.multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse).multiply(mesh.matrixWorld);

    // oblique near plane so nothing under the water shows up in the reflection
    m.plane.setFromNormalAndCoplanarPoint(m.normal, m.pos).applyMatrix4(vc.matrixWorldInverse);
    m.clip.set(m.plane.normal.x, m.plane.normal.y, m.plane.normal.z, m.plane.constant);
    const e = vc.projectionMatrix.elements;
    m.q.set((Math.sign(m.clip.x) + e[8]) / e[0], (Math.sign(m.clip.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
    m.clip.multiplyScalar(2 / m.clip.dot(m.q));
    e[2] = m.clip.x;
    e[6] = m.clip.y;
    e[10] = m.clip.z + 1 - 0.003;
    e[14] = m.clip.w;

    mesh.visible = false;
    const prevRT = gl.getRenderTarget();
    const prevXr = gl.xr.enabled;
    gl.xr.enabled = false;
    gl.setRenderTarget(rt);
    gl.clear();
    gl.render(state.scene, vc);
    gl.setRenderTarget(prevRT);
    gl.xr.enabled = prevXr;
    mesh.visible = true;
  }, 0);

  return (
    <mesh ref={meshRef} material={material} position={[0, FLOOR_Y, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-5}>
      <planeGeometry args={[400, 400, 1, 1]} />
    </mesh>
  );
}
