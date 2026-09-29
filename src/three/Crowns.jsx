import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { WATER_MATERIAL } from './physics';

const POOL = 6;
const SEG = 64; // around
const ROWS = 12; // base -> rim
const TAU = Math.PI * 2;

function makeGrid() {
  const g = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(new Float32Array((SEG + 1) * ROWS * 3), 3);
  pos.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', pos);
  const idx = [];
  for (let i = 0; i < ROWS - 1; i++) {
    for (let j = 0; j < SEG; j++) {
      const a = i * (SEG + 1) + j;
      const b = a + 1;
      const c = a + SEG + 1;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  g.setIndex(idx);
  return g;
}

/**
 * Milk-drop style crown splashes: a thin sheet thrown up in a ring, its rim pulled into
 * jets that pinch off droplets, then collapsing back into the surface.
 * Consumes shared.current.crowns ({ x, y, z, r, strength }) and feeds tip droplets back to
 * the pour simulation through shared.current.dropQueue.
 */
export default function Crowns({ shared }) {
  const meshRefs = useRef([]);
  const geos = useMemo(() => Array.from({ length: POOL }, makeGrid), []);
  const crowns = useMemo(
    () => Array.from({ length: POOL }, () => ({ live: false, t: 0, x: 0, y: 0, z: 0, r: 0.1, s: 1, spikes: 14, ph: 0, shed: false })),
    []
  );
  const cursor = useRef(0);

  useFrame((state, delta) => {
    const S = shared.current;
    const sdt = Math.min(delta, 1 / 30) * S.time.scale;

    while (S.crowns.length) {
      const e = S.crowns.shift();
      const c = crowns[cursor.current];
      cursor.current = (cursor.current + 1) % POOL;
      Object.assign(c, {
        live: true,
        t: 0,
        x: e.x,
        y: e.y,
        z: e.z,
        r: e.r,
        s: e.strength,
        spikes: 11 + Math.floor(Math.random() * 7),
        ph: Math.random() * TAU,
        shed: false,
      });
    }

    for (let k = 0; k < POOL; k++) {
      const c = crowns[k];
      const mesh = meshRefs.current[k];
      if (!mesh) continue;
      if (!c.live) {
        mesh.visible = false;
        continue;
      }
      c.t += sdt;
      const life = 0.55 + 0.35 * c.s;
      const u = c.t / life;
      if (u >= 1) {
        c.live = false;
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;

      // rim races out and slows; the wall rises then slumps back
      const R = c.r + (0.1 + 0.42 * c.s) * (1 - Math.exp(-c.t * 7));
      const H = c.s * 0.34 * Math.pow(Math.sin(Math.PI * Math.min(u * 1.25, 1)), 0.8);
      const lean = 0.25 + 0.5 * u; // sheet flares outward as it ages
      const thin = 1 - THREE.MathUtils.smoothstep(u, 0.7, 1);

      const arr = geos[k].attributes.position.array;
      for (let i = 0; i < ROWS; i++) {
        const v = i / (ROWS - 1);
        for (let j = 0; j <= SEG; j++) {
          const a = (j / SEG) * TAU;
          const spike = Math.pow(0.5 + 0.5 * Math.cos(c.spikes * a + c.ph), 6);
          const wob = 1 + 0.04 * Math.sin(3 * a + c.ph) + 0.03 * Math.sin(5 * a - c.ph);
          const h = v * H * (1 + 0.55 * spike * v * v * v) * thin;
          const rr = (R + v * H * lean) * wob * (1 - 0.06 * spike * v);
          const q = (i * (SEG + 1) + j) * 3;
          arr[q] = c.x + Math.cos(a) * rr;
          arr[q + 1] = c.y + h;
          arr[q + 2] = c.z + Math.sin(a) * rr;
        }
      }
      geos[k].attributes.position.needsUpdate = true;
      geos[k].computeVertexNormals();
      geos[k].computeBoundingSphere();

      // the jets on the rim pinch off into beads near the top of the rise
      if (!c.shed && u > 0.32) {
        c.shed = true;
        for (let j = 0; j < c.spikes; j++) {
          const a = (j / c.spikes) * TAU - c.ph / c.spikes + (Math.random() - 0.5) * 0.15;
          const rr = R + H * lean;
          const up = (0.9 + Math.random() * 0.9) * c.s;
          const out = (0.25 + Math.random() * 0.45) * c.s;
          S.dropQueue.push([
            c.x + Math.cos(a) * rr,
            c.y + H * 1.4,
            c.z + Math.sin(a) * rr,
            Math.cos(a) * out,
            up * 1.6,
            Math.sin(a) * out,
            (0.012 + Math.random() * 0.022) * (0.6 + 0.5 * c.s),
            3,
          ]);
        }
      }
    }
  });

  return (
    <group>
      {geos.map((g, i) => (
        <mesh key={i} ref={(el) => (meshRefs.current[i] = el)} geometry={g} visible={false} frustumCulled={false}>
          <meshPhysicalMaterial {...WATER_MATERIAL} thickness={0.06} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}
