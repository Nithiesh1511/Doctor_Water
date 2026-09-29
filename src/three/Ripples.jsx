import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { softDotTexture } from './physics';
import { bottleInnerRadiusAt } from './profiles';

const POOL = 16;
const LIFE = 1.1;

/**
 * Expanding rings on the water surface where the stream (and stray drops) land, plus a
 * churning patch of foam under the impact point. Consumes shared.current.ripples events.
 */
export default function Ripples({ shared }) {
  const ringRefs = useRef([]);
  const foamRef = useRef();
  const rings = useMemo(
    () => Array.from({ length: POOL }, () => ({ age: LIFE, x: 0, z: 0, s: 1 })),
    []
  );
  const cursor = useRef(0);
  const foamTex = useMemo(() => softDotTexture(THREE), []);

  useFrame((state, delta) => {
    const S = shared.current;
    const sdt = Math.min(delta, 1 / 30) * S.time.scale;
    const b = S.bottle;
    const hasWater = b.present && S.fill > 0.01;

    while (S.ripples.length) {
      const e = S.ripples.shift();
      const r = rings[cursor.current];
      cursor.current = (cursor.current + 1) % POOL;
      Object.assign(r, { age: 0, x: e.x, z: e.z, s: e.s });
    }

    for (let i = 0; i < POOL; i++) {
      const r = rings[i];
      const m = ringRefs.current[i];
      if (!m) continue;
      r.age += sdt;
      const k = r.age / LIFE;
      const off = Math.hypot(r.x - b.x, r.z - b.z);
      const radius = Math.min(0.02 + k * 0.5 * r.s, bottleInnerRadiusAt(S.levelLocal) * 0.97 - off);
      m.visible = hasWater && k < 1 && radius > 0.01;
      if (!m.visible) continue;
      m.position.set(r.x, S.surfaceY + 0.004, r.z);
      m.scale.setScalar(radius);
      m.material.opacity = (1 - k) * (1 - k) * 0.55 * r.s;
    }

    if (foamRef.current) {
      const on = hasWater && S.impact.active;
      foamRef.current.visible = on;
      if (on) {
        const t = S.time.sim;
        foamRef.current.position.set(S.impact.x, S.surfaceY + 0.006, S.impact.z);
        const inner = bottleInnerRadiusAt(S.levelLocal);
        foamRef.current.scale.setScalar(Math.min(0.2, inner * 1.2) * (1 + Math.sin(t * 23) * 0.1 + Math.sin(t * 37) * 0.075));
        foamRef.current.rotation.z = t * 2;
      }
    }
  });

  return (
    <group>
      {rings.map((_, i) => (
        <mesh key={i} ref={(el) => (ringRefs.current[i] = el)} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
          <ringGeometry args={[0.86, 1, 48]} />
          <meshBasicMaterial
            color="#d9f5ff"
            transparent
            opacity={0}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
      <mesh ref={foamRef} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          map={foamTex}
          color="#eafaff"
          transparent
          opacity={0.8}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}
