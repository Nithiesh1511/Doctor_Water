import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

const COUNT = 140;

/**
 * Air entrained by the pour: a plume of bubbles is driven down under the impact point and
 * wobbles back up to the surface, plus a light fizz from the bottom once there is water.
 * Simulated in world space from shared.current.bottle / impact.
 */
export default function Bubbles({ shared }) {
  const ref = useRef();
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const sim = useMemo(
    () => ({
      cursor: 0,
      acc: 0,
      ambient: 0,
      p: new Float32Array(COUNT * 3),
      vy: new Float32Array(COUNT),
      size: new Float32Array(COUNT),
      phase: new Float32Array(COUNT),
      alive: new Uint8Array(COUNT),
    }),
    []
  );

  const spawn = (x, y, z, vy, size) => {
    const i = sim.cursor;
    sim.cursor = (sim.cursor + 1) % COUNT;
    sim.p[i * 3] = x;
    sim.p[i * 3 + 1] = y;
    sim.p[i * 3 + 2] = z;
    sim.vy[i] = vy;
    sim.size[i] = size;
    sim.phase[i] = Math.random() * Math.PI * 2;
    sim.alive[i] = 1;
  };

  useFrame((state, delta) => {
    const mesh = ref.current;
    if (!mesh) return;
    const S = shared.current;
    const sdt = Math.min(delta, 1 / 30) * S.time.scale;
    const t = S.time.sim;
    const b = S.bottle;
    const depth = S.surfaceY - (b.y + 0.08);
    const hasWater = b.present && depth > 0.05;
    const rnd = Math.random;

    if (hasWater && S.impact.active) {
      sim.acc += 90 * sdt;
      while (sim.acc >= 1) {
        sim.acc -= 1;
        const a = rnd() * Math.PI * 2;
        const r = rnd() * 0.09;
        spawn(
          S.impact.x + Math.cos(a) * r,
          S.surfaceY - Math.min(depth, 0.15 + rnd() * 0.9) * rnd(),
          S.impact.z + Math.sin(a) * r,
          0.35 + rnd() * 0.5,
          0.006 + rnd() * 0.02
        );
      }
    }
    if (hasWater) {
      sim.ambient += 5 * sdt;
      while (sim.ambient >= 1) {
        sim.ambient -= 1;
        const a = rnd() * Math.PI * 2;
        const r = Math.sqrt(rnd()) * 0.34;
        spawn(b.x + Math.cos(a) * r, b.y + 0.1, b.z + Math.sin(a) * r, 0.2 + rnd() * 0.25, 0.006 + rnd() * 0.01);
      }
    }

    for (let i = 0; i < COUNT; i++) {
      const k = i * 3;
      if (sim.alive[i]) {
        // bubbles accelerate slightly as they rise, and spiral
        sim.vy[i] = Math.min(sim.vy[i] + 0.25 * sdt, 1.1);
        sim.p[k + 1] += sim.vy[i] * sdt;
        sim.p[k] += Math.sin(t * 9 + sim.phase[i]) * 0.12 * sdt;
        sim.p[k + 2] += Math.cos(t * 8 + sim.phase[i]) * 0.12 * sdt;
        if (!hasWater || sim.p[k + 1] > S.surfaceY - 0.01) sim.alive[i] = 0;
      }
      if (!sim.alive[i]) {
        dummy.scale.setScalar(0);
      } else {
        dummy.position.set(sim.p[k], sim.p[k + 1], sim.p[k + 2]);
        const s = sim.size[i];
        const w = Math.sin(t * 20 + sim.phase[i]) * 0.12;
        dummy.scale.set(s * (1 + w), s * (1 - w), s);
      }
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.visible = hasWater;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, COUNT]} frustumCulled={false}>
      <sphereGeometry args={[1, 10, 8]} />
      <meshStandardMaterial
        color="#e6f8ff"
        roughness={0.1}
        transparent
        opacity={0.55}
        emissive="#8bdcf8"
        emissiveIntensity={0.5}
        depthWrite={false}
      />
    </instancedMesh>
  );
}
