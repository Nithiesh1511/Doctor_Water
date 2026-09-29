import { useMemo } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';

const MAX = 160;
const MIN_SIZE = 0.028; // only drops big enough to catch a proper highlight

/**
 * Star-shaped specular glints riding on the larger drops: the hot spot where each drop
 * mirrors the key light, flared into a soft four-point sparkle that twinkles as the drop
 * wobbles. Reads the pour simulation (shared.current.drops) and the finale swirl
 * (shared.current.swirlDrops).
 */
export default function Glints({ shared }) {
  const dpr = useThree((s) => s.viewport.dpr);

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(MAX), 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(MAX), 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    return g;
  }, []);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uScale: { value: 1 } },
        vertexShader: /* glsl */ `
          attribute float aSize;
          attribute float aPhase;
          uniform float uTime;
          uniform float uScale;
          varying float vA;
          varying float vRot;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            float dist = max(-mv.z, 0.2);
            gl_PointSize = clamp(aSize * uScale * 1500.0 / dist, 0.0, 110.0);
            // twinkle: mostly steady, with an occasional bright flare
            float tw = 0.55 + 0.45 * sin(uTime * 2.1 + aPhase);
            vA = (0.35 + 0.65 * pow(tw, 3.0)) * clamp(gl_PointSize / 10.0, 0.0, 1.0);
            vRot = 0.35 + 0.25 * sin(aPhase);
          }
        `,
        fragmentShader: /* glsl */ `
          varying float vA;
          varying float vRot;
          void main() {
            vec2 c = gl_PointCoord - 0.5;
            float cs = cos(vRot), sn = sin(vRot);
            c = mat2(cs, -sn, sn, cs) * c;
            float r = length(c);
            float core = exp(-r * r * 160.0);
            float rays = exp(-abs(c.y) * 70.0) * exp(-abs(c.x) * 7.0)
                       + exp(-abs(c.x) * 70.0) * exp(-abs(c.y) * 7.0);
            float halo = exp(-r * r * 22.0) * 0.12;
            float star = core * 1.8 + rays * 0.9 + halo;
            gl_FragColor = vec4(vec3(1.0, 0.985, 0.95) * star * vA, 1.0);
          }
        `,
      }),
    []
  );

  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;
    material.uniforms.uScale.value = dpr * (state.size.height / 900);
    const sources = [shared.current.drops, shared.current.swirlDrops];
    const pos = geometry.attributes.position.array;
    const size = geometry.attributes.aSize.array;
    const phase = geometry.attributes.aPhase.array;
    // the highlight sits up-left on the side of the drop facing the camera
    const cam = state.camera.position;
    let n = 0;
    sources.forEach((sim, si) => {
      if (!sim) return;
      for (let i = 0; i < sim.alive.length && n < MAX; i++) {
        if (!sim.alive[i] || sim.size[i] < MIN_SIZE) continue;
        const k = i * 3;
        const s = sim.size[i];
        const x = sim.p[k];
        const y = sim.p[k + 1];
        const z = sim.p[k + 2];
        let dx = cam.x - x;
        let dy = cam.y - y;
        let dz = cam.z - z;
        const l = Math.hypot(dx, dy, dz) || 1;
        dx /= l;
        dy /= l;
        dz /= l;
        pos[n * 3] = x + dx * s * 1.05 - s * 0.32;
        pos[n * 3 + 1] = y + dy * s * 1.05 + s * 0.42;
        pos[n * 3 + 2] = z + dz * s * 1.05;
        size[n] = s * Math.min(1, sim.life[i] * 8); // fades in as the drop pinches free
        phase[n] = i * 2.399 + si * 1.3;
        n++;
      }
    });
    geometry.setDrawRange(0, n);
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.aSize.needsUpdate = true;
    geometry.attributes.aPhase.needsUpdate = true;
  });

  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={5} />;
}
