import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { MeshTransmissionMaterial } from '@react-three/drei';
import { CAN, CAN_SLICES, canLathePoints, canWaterPoints, canRadiusAt, tiltedLevel } from './profiles';
import { makeLabelTexture } from './labelTexture';
import { WATER_MATERIAL } from './physics';
import { hideFromRefraction, registerRefractionBuffer } from './refraction';

export const CAN_SCALE = 0.8;
// Points in the can group's (unscaled) local space.
export const CAN_LIP = [-CAN.lipR * CAN_SCALE, CAN.neckTop * CAN_SCALE, 0]; // pour edge of the neck
export const CAN_MOUTH = [0, CAN.neckTop * CAN_SCALE, 0]; // centre of the opening

const SIDES = 16; // polygon approximating the round body for the water-surface cap
const BUBBLES = 28;
const BEADS = 150; // condensation on the chilled can
const TRICKLES = 9;
const UP = new THREE.Vector3(0, 1, 0);
const FLAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

function capGeometry() {
  // knurled screw cap, like the blue cap on a 20 L can
  const g = new THREE.CylinderGeometry(0.335, 0.345, 0.26, 96, 1, false);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 0.3 || Math.abs(p.getY(i)) > 0.125) continue; // leave the top face flat
    const a = Math.atan2(x, z);
    const k = 1 + 0.022 * Math.pow(Math.abs(Math.sin(a * 24)), 0.6);
    p.setX(i, x * k);
    p.setZ(i, z * k);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * The 20 L Doctor's Water can: clear blue PET with grip ribs, a sticker label and a blue
 * screw cap. The water inside keeps a level (volume-true) surface as the can tips, and air
 * glugs up through it while it pours.
 *   shared.current.capOpen  0..1  unscrew, then pop the cap off
 *   shared.current.canFill  0..1  fraction of the can holding water
 * Writes shared.current.pour.spill = neck under the waterline.
 */
const Can = forwardRef(function Can({ shared }, ref) {
  const groupRef = useRef();
  const shellMat = useRef();
  const waterRef = useRef();
  const surfRef = useRef();
  const capRef = useRef();
  const bubblesRef = useRef();
  const beadsRef = useRef();
  useImperativeHandle(ref, () => groupRef.current, []);

  // instances start as identity (a unit sphere at the origin) until the first update
  useLayoutEffect(() => {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const [mesh, count] of [[bubblesRef.current, BUBBLES], [beadsRef.current, BEADS]]) {
      if (!mesh) continue;
      for (let i = 0; i < count; i++) mesh.setMatrixAt(i, zero);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }, []);

  const beads = useMemo(() => {
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    return Array.from({ length: BEADS }, (_, i) => ({
      a: rnd() * Math.PI * 2,
      y: -1.2 + rnd() * 1.95,
      s: i < TRICKLES ? 0.03 + rnd() * 0.012 : 0.008 + Math.pow(rnd(), 2.3) * 0.028,
      speed: 0.05 + rnd() * 0.05,
      phase: rnd(),
    }));
  }, []);

  // slosh state (the water's lean, in world x/z)
  const sl = useMemo(
    () => ({
      init: false,
      cm: new THREE.Vector3(),
      prev: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      v2: new THREE.Vector3(),
      s: { x: 0, z: 0 },
      sv: { x: 0, z: 0 },
    }),
    []
  );

  const shellGeo = useMemo(() => {
    const g = new THREE.LatheGeometry(canLathePoints(), 128);
    g.computeVertexNormals();
    return g;
  }, []);
  const waterGeo = useMemo(() => new THREE.LatheGeometry(canWaterPoints(), 64), []);
  const capGeo = useMemo(() => capGeometry(), []);
  const labelTex = useMemo(() => makeLabelTexture(), []);
  const slices = useMemo(() => CAN_SLICES.map(([y, r]) => [y * CAN_SCALE, r * CAN_SCALE]), []);

  // world-space clipping: the water body is cut at the level plane, and the level "lid"
  // is trimmed to the inside of the can (round body + domed shoulder + two end planes)
  const clip = useMemo(() => {
    const level = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
    const cap = Array.from({ length: SIDES * 2 + 2 }, () => new THREE.Plane());
    return { level, cap };
  }, []);

  const tmp = useMemo(
    () => ({
      C: new THREE.Vector3(),
      q: new THREE.Quaternion(),
      a: new THREE.Vector3(),
      u: new THREE.Vector3(),
      w: new THREE.Vector3(),
      d: new THREE.Vector3(),
      n: new THREE.Vector3(),
      lip: new THREE.Vector3(),
      perp: new THREE.Vector3(),
      side: new THREE.Vector3(),
      up: new THREE.Vector3(0, 1, 0),
      dummy: new THREE.Object3D(),
    }),
    []
  );

  const glug = useMemo(
    () => ({
      acc: 0,
      cursor: 0,
      s: new Float32Array(BUBBLES), // distance travelled along the axis
      off: new Float32Array(BUBBLES), // drift toward the upper wall
      size: new Float32Array(BUBBLES),
      ph: new Float32Array(BUBBLES),
      ang: new Float32Array(BUBBLES),
      alive: new Uint8Array(BUBBLES),
    }),
    []
  );

  useFrame((state, delta) => {
    const g = groupRef.current;
    if (!g) return;
    const S = shared.current;
    const visible = g.visible;
    // lets drei skip the extra transmission render while the can is off screen
    if (shellMat.current) {
      shellMat.current.visible = visible;
      registerRefractionBuffer(shellMat.current);
    }
    if (surfRef.current) surfRef.current.visible = visible;
    if (bubblesRef.current) bubblesRef.current.visible = visible;

    // ---- cap: unscrew two turns, then pop off and tumble away ----
    if (capRef.current) {
      const open = S.capOpen;
      const twist = THREE.MathUtils.smoothstep(open, 0, 0.55);
      const pop = THREE.MathUtils.clamp((open - 0.55) / 0.45, 0, 1);
      const fly = 1 - Math.pow(1 - pop, 2);
      const c = capRef.current;
      c.position.set(1.3 * fly, 1.69 + 0.12 * twist + 2.6 * fly - 1.2 * pop * pop, 0.55 * fly);
      c.rotation.set(fly * 4.2, -twist * Math.PI * 4, -fly * 2.6);
      c.scale.setScalar(1 - THREE.MathUtils.smoothstep(pop, 0.75, 1));
      c.visible = pop < 1;
    }
    if (!visible) return;

    // ---- slosh: the water's "up" leans with the can's acceleration, then springs back ----
    // (a damped pendulum mode, forced by how the water's centre of mass is being shoved)
    const { C, q, a, u, w, d, n, lip, perp, up } = tmp;
    g.updateMatrixWorld();
    const dt = Math.min(Math.max(delta, 1e-4), 1 / 30);
    const cm = sl.cm.set(0, -0.3 * CAN_SCALE, 0);
    g.localToWorld(cm);
    if (!sl.init) {
      sl.prev.copy(cm);
      sl.vel.set(0, 0, 0);
      sl.init = true;
    }
    sl.v2.subVectors(cm, sl.prev).divideScalar(dt);
    const ax = (sl.v2.x - sl.vel.x) / dt;
    const az = (sl.v2.z - sl.vel.z) / dt;
    sl.vel.copy(sl.v2);
    sl.prev.copy(cm);
    for (const [key, acc] of [['x', ax], ['z', az]]) {
      const target = THREE.MathUtils.clamp(acc * 0.05, -0.45, 0.45);
      sl.sv[key] += ((target - sl.s[key]) * 38 - sl.sv[key] * 2.4) * dt;
      sl.s[key] = THREE.MathUtils.clamp(sl.s[key] + sl.sv[key] * dt, -0.35, 0.35);
    }
    up.set(sl.s.x, 1, sl.s.z).normalize();

    // ---- level water surface inside the tilted can (heights measured along the water's up) ----
    g.getWorldPosition(C);
    g.getWorldQuaternion(q);
    a.copy(UP).applyQuaternion(q);
    u.set(1, 0, 0).applyQuaternion(q);
    w.set(0, 0, 1).applyQuaternion(q);
    const ay = a.dot(up);
    const { level } = tiltedLevel(slices, C.dot(up), ay, S.canFill);
    clip.level.normal.copy(up).negate();
    clip.level.constant = level;

    const rIn = CAN.innerR * CAN_SCALE * 0.992;
    const s0 = CAN.shoulderY * CAN_SCALE;
    const slope = ((0.33 - 1.0) / 0.58) * 0.955; // shoulder cone: dr/ds
    const aC = a.dot(C);
    for (let k = 0; k < SIDES; k++) {
      const phi = (k / SIDES) * Math.PI * 2;
      d.copy(u).multiplyScalar(Math.cos(phi)).addScaledVector(w, Math.sin(phi));
      // round body:  d·(p-C) <= rIn
      clip.cap[k].normal.copy(d).negate();
      clip.cap[k].constant = d.dot(C) + rIn;
      // shoulder cone: (d - slope·a)·(p-C) <= rIn - slope·s0
      n.copy(d).addScaledVector(a, -slope);
      clip.cap[SIDES + k].normal.copy(n).negate();
      clip.cap[SIDES + k].constant = n.dot(C) + rIn - slope * s0;
    }
    clip.cap[SIDES * 2].normal.copy(a);
    clip.cap[SIDES * 2].constant = -(aC + CAN.waterBase * CAN_SCALE);
    clip.cap[SIDES * 2 + 1].normal.copy(a).negate();
    clip.cap[SIDES * 2 + 1].constant = aC + 1.6 * CAN_SCALE;

    if (surfRef.current) {
      const sAx = Math.abs(ay) > 0.02 ? (level - C.dot(up)) / ay : 0;
      const sc = THREE.MathUtils.clamp(sAx, CAN.waterBase * CAN_SCALE, 1.5 * CAN_SCALE);
      surfRef.current.position.copy(C).addScaledVector(a, sc).addScaledVector(up, level + 0.001 - C.dot(up) - ay * sc);
      surfRef.current.quaternion.setFromUnitVectors(UP, up).multiply(FLAT);
      surfRef.current.visible = S.canFill > 0.01;
    }

    // is the neck under the waterline? (then the can is actually pouring)
    lip.set(...CAN_LIP);
    g.localToWorld(lip);
    S.pour.spill = lip.dot(up) < level - 0.03;

    // ---- condensation: beads on the chilled plastic, a few running down ----
    const beadMesh = beadsRef.current;
    if (beadMesh) {
      const bt = state.clock.elapsedTime;
      const { dummy } = tmp;
      for (let i = 0; i < BEADS; i++) {
        const b = beads[i];
        let y = b.y;
        let ang = b.a;
        let stretch = 1;
        if (i < TRICKLES) {
          const k = (b.phase + bt * b.speed) % 1;
          y = 0.72 - k * 1.95;
          ang += Math.sin(k * 7 + i) * 0.04;
          stretch = 1.6;
        }
        const r = canRadiusAt(y) + 0.006;
        dummy.position.set(Math.sin(ang) * r, y, Math.cos(ang) * r);
        dummy.rotation.set(0, ang, 0);
        dummy.scale.set(b.s, b.s * 1.1 * stretch, b.s * 0.45);
        dummy.updateMatrix();
        beadMesh.setMatrixAt(i, dummy.matrix);
      }
      beadMesh.instanceMatrix.needsUpdate = true;
    }

    // ---- glug: air gulps in through the neck and rolls up along the top wall ----
    const mesh = bubblesRef.current;
    if (!mesh) return;
    const sdt = Math.min(delta, 1 / 30) * S.time.scale;
    const t = S.time.sim;
    perp.copy(UP).addScaledVector(a, -a.y); // world up, perpendicular to the axis
    const pl = perp.length();
    if (pl > 1e-3) perp.multiplyScalar(1 / pl);
    if (S.pour.on && S.pour.spill) {
      glug.acc += sdt * 2.6; // ~2.6 gulps a second, in sim time
      while (glug.acc >= 1) {
        glug.acc -= 1;
        for (let b = 0; b < 4; b++) {
          const i = glug.cursor;
          glug.cursor = (glug.cursor + 1) % BUBBLES;
          glug.alive[i] = 1;
          glug.s[i] = -b * 0.05;
          glug.off[i] = 0;
          glug.size[i] = b === 0 ? 0.075 + Math.random() * 0.05 : 0.02 + Math.random() * 0.03;
          glug.ph[i] = Math.random() * Math.PI * 2;
          glug.ang[i] = (Math.random() - 0.5) * 0.9;
        }
      }
    }
    const { dummy, side } = tmp;
    side.crossVectors(a, perp);
    const neckS = CAN.neckTop * CAN_SCALE - 0.05;
    for (let i = 0; i < BUBBLES; i++) {
      if (glug.alive[i]) {
        const big = glug.size[i] > 0.06;
        glug.s[i] += sdt * (big ? 1.25 : 0.95);
        glug.off[i] = Math.min(glug.off[i] + sdt * 1.6, rIn - glug.size[i] - 0.03);
        const along = neckS - Math.max(glug.s[i], 0);
        // radial position: from the axis toward the upper wall, fanned a little sideways
        const across = glug.off[i] * Math.min(1, Math.max(0, (neckS - along - 0.25) / 0.3));
        d.copy(perp).multiplyScalar(Math.cos(glug.ang[i])).addScaledVector(side, Math.sin(glug.ang[i]));
        dummy.position.copy(C).addScaledVector(a, along).addScaledVector(d, across);
        if (dummy.position.dot(up) > level - glug.size[i] * 0.6 || along < CAN.waterBase * CAN_SCALE) glug.alive[i] = 0;
      }
      if (!glug.alive[i]) {
        dummy.scale.setScalar(0);
      } else {
        const s = glug.size[i];
        const wob = Math.sin(t * 22 + glug.ph[i]) * 0.18;
        dummy.quaternion.setFromUnitVectors(UP, a);
        dummy.scale.set(s * (1.25 + wob), s * (0.7 - wob * 0.5), s * (1.25 - wob));
      }
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <group ref={groupRef}>
        <group scale={CAN_SCALE}>
          {/* water */}
          <mesh ref={waterRef} geometry={waterGeo}>
            <meshPhysicalMaterial
              color="#f2fbff"
              transmission={1}
              roughness={0}
              thickness={1.4}
              ior={1.333}
              attenuationColor="#8fd0f5"
              attenuationDistance={2.6}
              specularIntensity={1}
              envMapIntensity={1.6}
              clippingPlanes={[clip.level]}
            />
          </mesh>

          {/* clear blue PET shell */}
          <mesh geometry={shellGeo}>
            <MeshTransmissionMaterial
              ref={shellMat}
              transmission={1}
              thickness={0.04}
              roughness={0.03}
              ior={1.45}
              chromaticAberration={0.035}
              anisotropy={0.1}
              distortion={0.05}
              distortionScale={0.3}
              temporalDistortion={0}
              samples={6}
              resolution={512}
              color="#d4ecff"
              attenuationColor="#86c4f0"
              attenuationDistance={4}
              clearcoat={1}
              clearcoatRoughness={0.04}
              envMapIntensity={1.4}
              side={THREE.DoubleSide}
            />
          </mesh>

          {/* sticker label on the smooth panel between the grip ribs */}
          <mesh position={[0, -0.16, 0]} ref={hideFromRefraction}>
            <cylinderGeometry args={[1.014, 1.014, 0.6, 96, 1, true, -0.62, 1.24]} />
            {/* kept out of the refraction buffers, so it never ghosts "through" the plastic */}
            <meshPhysicalMaterial map={labelTex} transparent alphaTest={0.5} roughness={0.35} clearcoat={0.7} clearcoatRoughness={0.15} side={THREE.DoubleSide} />
          </mesh>

          {/* condensation beads */}
          <instancedMesh ref={beadsRef} args={[undefined, undefined, BEADS]} frustumCulled={false}>
            <sphereGeometry args={[1, 14, 10]} />
            <meshPhysicalMaterial {...WATER_MATERIAL} thickness={0.04} />
          </instancedMesh>

          {/* screw cap */}
          <group ref={capRef} position={[0, 1.69, 0]}>
            <mesh geometry={capGeo} position={[0, 0.02, 0]}>
              <meshPhysicalMaterial color="#1b5fc4" roughness={0.28} clearcoat={0.9} clearcoatRoughness={0.12} />
            </mesh>
            <mesh position={[0, 0.152, 0]}>
              <cylinderGeometry args={[0.3, 0.3, 0.012, 64]} />
              <meshPhysicalMaterial color="#2a74d8" roughness={0.2} clearcoat={1} />
            </mesh>
          </group>
        </group>
      </group>

      {/* level water surface (world space, trimmed to the can's interior) */}
      <mesh ref={surfRef} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <planeGeometry args={[5, 5]} />
        <meshPhysicalMaterial
          color="#f2fbff"
          transmission={1}
          roughness={0.02}
          thickness={0.6}
          ior={1.333}
          attenuationColor="#8fd0f5"
          attenuationDistance={2.6}
          envMapIntensity={1.8}
          clippingPlanes={clip.cap}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* air bubbles glugging in while it pours */}
      <instancedMesh ref={bubblesRef} args={[undefined, undefined, BUBBLES]} frustumCulled={false}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshStandardMaterial color="#e6f7ff" metalness={1} roughness={0.06} envMapIntensity={1.4} />
      </instancedMesh>
    </>
  );
});

export default Can;
