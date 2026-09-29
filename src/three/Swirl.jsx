import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { WATER_MATERIAL } from './physics';

const RINGS = 170;
const SEG = 18;
const DROPS = 140;
const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);

// One smooth, glassy ribbon wrapping up the bottle (relative to its base / axis).
const RIBBON = { turns: 1.25, th0: 0.5, y0: 0.25, y1: 2.55, r0: 0.68, r1: 0.86, width: 0.2, thick: 0.03 };

function makeTube() {
  const g = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(new Float32Array(RINGS * SEG * 3), 3);
  pos.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', pos);
  const idx = [];
  for (let i = 0; i < RINGS - 1; i++) {
    for (let j = 0; j < SEG; j++) {
      const a = i * SEG + j;
      const b = i * SEG + ((j + 1) % SEG);
      const c = (i + 1) * SEG + j;
      const d = (i + 1) * SEG + ((j + 1) % SEG);
      idx.push(a, c, b, b, c, d);
    }
  }
  g.setIndex(idx);
  return g;
}

/**
 * The hero splash: a big, smooth ribbon of water that wraps up and around the finished
 * bottle, its leading edge flinging droplets - the classic frozen product-shot splash.
 * Driven by scroll (shared.current.swirl 0..1), so it freezes when you stop and rewinds when
 * you scroll back. Publishes its droplets (shared.current.swirlDrops) for the glints.
 */
export default function Swirl({ shared }) {
  const tubeRef = useRef();
  const dropsRef = useRef();
  const tube = useMemo(() => makeTube(), []);
  const drops = useMemo(() => {
    let seed = 91;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    return Array.from({ length: DROPS }, () => ({
      u: 0.04 + rnd() * 0.96,
      out: 0.22 + rnd() * 0.6,
      fwd: 0.1 + rnd() * 0.6,
      up: 0.1 + rnd() * 0.7,
      size: 0.01 + Math.pow(rnd(), 1.8) * 0.04,
      side: rnd() - 0.5,
      ph: rnd() * TAU,
    }));
  }, []);
  const pub = useMemo(
    () => ({ p: new Float32Array(DROPS * 3), size: new Float32Array(DROPS), alive: new Uint8Array(DROPS), life: new Float32Array(DROPS) }),
    []
  );
  const tmp = useMemo(
    () => ({
      c: new THREE.Vector3(),
      c2: new THREE.Vector3(),
      T: new THREE.Vector3(),
      N: new THREE.Vector3(),
      B: new THREE.Vector3(),
      dummy: new THREE.Object3D(),
    }),
    []
  );

  // centreline of the ribbon: a rising helix just outside the bottle wall
  const path = (u, bx, by, bz, time, out) => {
    const R = RIBBON;
    const th = R.th0 + u * TAU * R.turns;
    const r = THREE.MathUtils.lerp(R.r0, R.r1, u) + 0.07 * Math.sin(u * 11 + 1.2) + 0.014 * Math.sin(time * 1.3 + u * 6);
    const y = by + THREE.MathUtils.lerp(R.y0, R.y1, u) + 0.12 * Math.sin(u * 7.5) + 0.012 * Math.sin(time * 1.1 + u * 9);
    return out.set(bx + Math.sin(th) * r, y, bz + Math.cos(th) * r);
  };

  useFrame((state) => {
    const S = shared.current;
    const p = S.swirl;
    S.swirlDrops = pub;
    const tubeMesh = tubeRef.current;
    const dropMesh = dropsRef.current;
    if (!tubeMesh || !dropMesh) return;
    const on = p > 0.001 && S.bottle.present;
    tubeMesh.visible = on;
    dropMesh.visible = on;
    if (!on) {
      pub.alive.fill(0);
      return;
    }

    const time = state.clock.elapsedTime;
    const { x: bx, y: by, z: bz } = S.bottle;
    const head = p * 1.35;
    const uHead = Math.min(head, 1);
    const tail = THREE.MathUtils.clamp(head - 0.9, 0, 0.98);
    const span = Math.max(uHead - tail, 1e-4);
    const { c, c2, T, N, B, dummy } = tmp;

    const arr = tube.attributes.position.array;
    for (let i = 0; i < RINGS; i++) {
      const u = tail + (span * i) / (RINGS - 1);
      path(u, bx, by, bz, time, c);
      path(Math.min(u + 0.004, 1.2), bx, by, bz, time, c2);
      T.subVectors(c2, c).normalize();
      N.set(c.x - bx, 0, c.z - bz).normalize(); // outward from the bottle
      B.crossVectors(T, N).normalize(); // roughly vertical: the sheet's width

      const x = (u - tail) / span; // 0 at the tail, 1 at the head
      let env = Math.pow(Math.sin(Math.PI * Math.min(x * 1.08, 1)), 0.6);
      if (head <= 1) env *= Math.pow(THREE.MathUtils.smoothstep(1 - x, 0, 0.18), 0.5); // rounded leading lip
      const ripple = 1 + 0.2 * Math.sin(u * 46 - time * 2.4) + 0.08 * Math.sin(u * 93 + time * 3.1);
      const width = RIBBON.width * env * ripple * (0.7 + 0.6 * u);
      const thick = RIBBON.thick * env * (1 + 0.3 * Math.sin(u * 60 + time * 2));

      for (let j = 0; j < SEG; j++) {
        const phi = (j / SEG) * TAU;
        const k = (i * SEG + j) * 3;
        const a = Math.cos(phi) * thick;
        const b = Math.sin(phi) * width;
        arr[k] = c.x + N.x * a + B.x * b;
        arr[k + 1] = c.y + N.y * a + B.y * b;
        arr[k + 2] = c.z + N.z * a + B.z * b;
      }
    }
    tube.attributes.position.needsUpdate = true;
    tube.computeVertexNormals();
    tube.computeBoundingSphere();

    // droplets flung off the sheet once the head has swept past them (deterministic in p)
    for (let i = 0; i < DROPS; i++) {
      const d = drops[i];
      const age = (head - d.u) * 1.7;
      pub.alive[i] = 0;
      if (age <= 0 || age > 1.6) {
        dummy.scale.setScalar(0);
      } else {
        path(d.u, bx, by, bz, time, c);
        path(Math.min(d.u + 0.004, 1.2), bx, by, bz, time, c2);
        T.subVectors(c2, c).normalize();
        N.set(c.x - bx, 0, c.z - bz).normalize();
        const drift = age * (0.9 + 0.1 * Math.sin(time * 0.8 + d.ph));
        c.addScaledVector(N, d.out * drift)
          .addScaledVector(T, d.fwd * drift)
          .addScaledVector(UP, d.up * drift - 0.55 * drift * drift + d.side * 0.06);
        dummy.position.copy(c);
        T.copy(N).multiplyScalar(d.out).addScaledVector(UP, d.up - 1.1 * drift).normalize();
        dummy.quaternion.setFromUnitVectors(UP, T);
        const s = d.size * Math.min(1, age * 6) * (1 - THREE.MathUtils.smoothstep(age, 1.2, 1.6));
        dummy.scale.set(s, s * 1.15, s);
        if (s > 0.0005) {
          pub.alive[i] = 1;
          pub.p[i * 3] = c.x;
          pub.p[i * 3 + 1] = c.y;
          pub.p[i * 3 + 2] = c.z;
          pub.size[i] = s;
          pub.life[i] = age;
        }
      }
      dummy.updateMatrix();
      dropMesh.setMatrixAt(i, dummy.matrix);
    }
    dropMesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <mesh ref={tubeRef} geometry={tube} visible={false} frustumCulled={false}>
        <meshPhysicalMaterial {...WATER_MATERIAL} thickness={0.16} />
      </mesh>
      <instancedMesh ref={dropsRef} args={[undefined, undefined, DROPS]} visible={false} frustumCulled={false}>
        <sphereGeometry args={[1, 20, 16]} />
        <meshPhysicalMaterial {...WATER_MATERIAL} thickness={0.1} dispersion={0.6} />
      </instancedMesh>
    </group>
  );
}
