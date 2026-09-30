import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { MeshTransmissionMaterial } from '@react-three/drei';
import { BOTTLE, bottleLathePoints, bottleRadiusAt, bottleInnerRadiusAt, bottleWaterPoints } from './profiles';
import { makeLabelTexture } from './labelTexture';
import { hideFromRefraction, registerRefractionBuffer } from './refraction';
import { BEAD_MATERIAL } from './physics';

const BEADS = 150;
const TRICKLES = 10;

function capGeometry() {
  const g = new THREE.CylinderGeometry(0.188, 0.195, 0.22, 96, 1, false);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    if (Math.hypot(x, z) < 0.17 || Math.abs(p.getY(i)) > 0.105) continue;
    const k = 1 + 0.03 * Math.pow(Math.abs(Math.sin(Math.atan2(x, z) * 30)), 0.6);
    p.setX(i, x * k);
    p.setZ(i, z * k);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * The PET drinking-water bottle being filled. Local origin at its base.
 *   shared.current.levelLocal  water height inside (local units)
 *   shared.current.surfaceY    same, in world space (clips the water body)
 *   shared.current.capDrop     0..1 drops the cap in and screws it down
 *   shared.current.bottle.wet  0..1 water beads left on it after it breaks the surface
 */
const Vessel = forwardRef(function Vessel({ shared }, ref) {
  const groupRef = useRef();
  const shellMat = useRef();
  const waterRef = useRef();
  const surfRef = useRef();
  const capRef = useRef();
  const beadsRef = useRef();
  useImperativeHandle(ref, () => groupRef.current, []);

  const shellGeo = useMemo(() => {
    const g = new THREE.LatheGeometry(bottleLathePoints(), 128);
    g.computeVertexNormals();
    return g;
  }, []);
  const waterGeo = useMemo(() => new THREE.LatheGeometry(bottleWaterPoints(), 64), []);
  const surfGeo = useMemo(() => new THREE.CircleGeometry(1, 48), []);
  const capGeo = useMemo(() => capGeometry(), []);
  const labelTex = useMemo(() => makeLabelTexture(), []);
  const level = useMemo(() => new THREE.Plane(new THREE.Vector3(0, -1, 0), 0), []);

  const beads = useMemo(() => {
    let seed = 23;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    return Array.from({ length: BEADS }, (_, i) => ({
      a: rnd() * Math.PI * 2,
      y: 0.18 + rnd() * 1.75,
      s: i < TRICKLES ? 0.02 + rnd() * 0.012 : 0.005 + Math.pow(rnd(), 2.4) * 0.02,
      speed: 0.12 + rnd() * 0.12,
      phase: rnd(),
    }));
  }, []);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((state) => {
    const g = groupRef.current;
    if (!g) return;
    const S = shared.current;
    const visible = g.visible;
    if (shellMat.current) {
      shellMat.current.visible = visible;
      registerRefractionBuffer(shellMat.current);
    }
    if (!visible) return;
    const t = state.clock.elapsedTime;

    // ---- water ----
    const lv = S.levelLocal;
    const hasWater = S.fill > 0.002;
    level.constant = S.surfaceY;
    if (waterRef.current) waterRef.current.visible = hasWater;
    if (surfRef.current) {
      const agitation = S.impact.active ? 1 : 0.2;
      surfRef.current.visible = hasWater;
      surfRef.current.position.y = lv;
      surfRef.current.scale.setScalar(bottleInnerRadiusAt(lv) * 0.995);
      surfRef.current.rotation.x = -Math.PI / 2 + Math.sin(t * 9.3) * 0.02 * agitation;
      surfRef.current.rotation.y = Math.cos(t * 7.1) * 0.02 * agitation;
    }

    // ---- cap drops in from above and spins down the thread ----
    if (capRef.current) {
      const c = S.capDrop;
      const settle = 1 - Math.pow(1 - c, 3);
      capRef.current.visible = c > 0.001;
      capRef.current.position.y = 2.63 + (1 - settle) * 2.2;
      capRef.current.rotation.y = (1 - c) * 10;
    }

    // ---- beads of water clinging to the bottle, a few running down ----
    const mesh = beadsRef.current;
    if (!mesh) return;
    const wet = S.bottle.wet;
    mesh.visible = wet > 0.01;
    if (!mesh.visible) return;
    for (let i = 0; i < BEADS; i++) {
      const b = beads[i];
      let y = b.y;
      let a = b.a;
      let stretch = 1;
      if (i < TRICKLES) {
        const k = (b.phase + t * b.speed) % 1;
        y = 1.9 - k * 1.75;
        a += Math.sin(k * 7 + i) * 0.05;
        stretch = 1.6;
      }
      const r = bottleRadiusAt(y) + 0.003;
      dummy.position.set(Math.sin(a) * r, y, Math.cos(a) * r);
      dummy.rotation.set(0, a, 0);
      const s = b.s * wet;
      dummy.scale.set(s, s * 1.1 * stretch, s * 0.45);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  const labelArc = (BOTTLE.labelH * 2) / 0.506;

  return (
    <group ref={groupRef}>
      {/* water body, cut at the (world) water level */}
      <mesh ref={waterRef} geometry={waterGeo} visible={false}>
        <meshPhysicalMaterial
          color="#f4fbff"
          transmission={1}
          roughness={0}
          thickness={0.9}
          ior={1.333}
          attenuationColor="#9ad8f7"
          attenuationDistance={1.8}
          specularIntensity={1}
          envMapIntensity={1.6}
          clippingPlanes={[level]}
        />
      </mesh>
      <mesh ref={surfRef} geometry={surfGeo} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <meshPhysicalMaterial
          color="#f4fbff"
          transmission={1}
          roughness={0.02}
          thickness={0.4}
          ior={1.333}
          attenuationColor="#9ad8f7"
          attenuationDistance={1.8}
          envMapIntensity={1.9}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* crystal-clear PET shell */}
      <mesh geometry={shellGeo}>
        <MeshTransmissionMaterial
          ref={shellMat}
          transmission={1}
          thickness={0.08}
          roughness={0.02}
          ior={1.45}
          chromaticAberration={0.04}
          anisotropy={0.1}
          distortion={0.04}
          distortionScale={0.3}
          temporalDistortion={0}
          samples={6}
          resolution={512}
          color="#eef8ff"
          attenuationColor="#bfe3fb"
          attenuationDistance={5}
          clearcoat={1}
          clearcoatRoughness={0.03}
          envMapIntensity={1.4}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* front label */}
      <mesh position={[0, BOTTLE.labelY, 0]} ref={hideFromRefraction}>
        <cylinderGeometry args={[0.506, 0.506, BOTTLE.labelH, 96, 1, true, -labelArc / 2, labelArc]} />
        <meshPhysicalMaterial map={labelTex} transparent alphaTest={0.5} roughness={0.3} clearcoat={0.8} clearcoatRoughness={0.12} side={THREE.DoubleSide} />
      </mesh>

      {/* cap (screwed on once it is full) */}
      <group ref={capRef} position={[0, 2.63, 0]} visible={false}>
        <mesh geometry={capGeo}>
          <meshPhysicalMaterial color="#0b2350" roughness={0.3} clearcoat={0.9} clearcoatRoughness={0.1} />
        </mesh>
        <mesh position={[0, 0.112, 0]}>
          <cylinderGeometry args={[0.165, 0.165, 0.008, 48]} />
          <meshPhysicalMaterial color="#1e9bd7" roughness={0.25} clearcoat={1} />
        </mesh>
      </group>

      {/* water beads */}
      <instancedMesh ref={beadsRef} args={[undefined, undefined, BEADS]} visible={false} frustumCulled={false}>
        <sphereGeometry args={[1, 14, 10]} />
        <meshPhysicalMaterial {...BEAD_MATERIAL} />
      </instancedMesh>
    </group>
  );
});

export default Vessel;
