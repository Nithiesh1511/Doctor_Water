import { useMemo } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';

const FAR = 90;
const NEAR = 26;

/**
 * Out-of-focus light specks floating through the scene. From far away they read as a soft
 * underwater haze; in the macro close-up they bloom into big lens bokeh around the drops.
 * `focus` is where the macro shot looks, so a cluster is seeded around it.
 */
export default function Bokeh({ focus = [0, 0, 0] }) {
  const dpr = useThree((s) => s.viewport.dpr);

  const geometry = useMemo(() => {
    const n = FAR + NEAR;
    const pos = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const alpha = new Float32Array(n);
    const phase = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (i < FAR) {
        pos[i * 3] = (Math.random() - 0.5) * 16;
        pos[i * 3 + 1] = (Math.random() - 0.5) * 14 - 1;
        pos[i * 3 + 2] = -2 - Math.random() * 8;
      } else {
        pos[i * 3] = focus[0] + (Math.random() - 0.5) * 3;
        pos[i * 3 + 1] = focus[1] + (Math.random() - 0.5) * 2.4;
        pos[i * 3 + 2] = focus[2] + (Math.random() - 0.6) * 2.2;
      }
      size[i] = 0.04 + Math.random() * 0.1;
      alpha[i] = 0.06 + Math.random() * 0.16;
      phase[i] = Math.random() * Math.PI * 2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    return g;
  }, [focus]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uScale: { value: 1 } },
        vertexShader: /* glsl */ `
          attribute float aSize;
          attribute float aAlpha;
          attribute float aPhase;
          uniform float uTime;
          uniform float uScale;
          varying float vAlpha;
          void main() {
            vec3 p = position;
            p.x += sin(uTime * 0.21 + aPhase) * 0.18;
            p.y += sin(uTime * 0.17 + aPhase * 1.7) * 0.22;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            float dist = max(-mv.z, 0.2);
            gl_PointSize = min(aSize * uScale * 900.0 / dist, 170.0);
            // closer = more defocused = dimmer per pixel
            vAlpha = aAlpha * clamp(2.2 / dist, 0.25, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          varying float vAlpha;
          void main() {
            float d = length(gl_PointCoord - 0.5) * 2.0;
            if (d > 1.0) discard;
            // soft disc with a faint brighter rim, like real lens bokeh
            float disc = smoothstep(1.0, 0.6, d);
            float rim = 0.75 + 0.25 * smoothstep(0.35, 0.85, d);
            gl_FragColor = vec4(vec3(0.35, 0.8, 1.0) * disc * rim * vAlpha, 1.0);
          }
        `,
      }),
    []
  );

  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;
    material.uniforms.uScale.value = dpr * (state.size.height / 900);
  });

  return <points geometry={geometry} material={material} frustumCulled={false} />;
}
