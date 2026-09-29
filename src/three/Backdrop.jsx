import { useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { BACKDROP_GLSL, BACKDROP_UNIFORMS } from './backdropShader';

/**
 * In-scene studio dome. The water is refractive, so it needs a real backdrop inside the
 * scene to bend (a CSS background behind a transparent canvas would refract as black).
 */
export default function Backdrop() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        toneMapped: false,
        uniforms: BACKDROP_UNIFORMS,
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          ${BACKDROP_GLSL}
          varying vec3 vDir;
          void main() {
            gl_FragColor = vec4(backdrop(normalize(vDir)), 1.0);
            #include <colorspace_fragment>
          }
        `,
      }),
    []
  );

  useFrame((state) => {
    BACKDROP_UNIFORMS.uTime.value = state.clock.elapsedTime;
  });

  // Centred on the camera so the horizon never shifts as the camera travels.
  return (
    <mesh
      material={material}
      renderOrder={-10}
      frustumCulled={false}
      ref={(m) => {
        if (!m) return;
        m.onBeforeRender = (gl, scene, camera) => {
          m.position.copy(camera.position);
          m.updateMatrixWorld();
        };
      }}
    >
      <sphereGeometry args={[250, 48, 32]} />
    </mesh>
  );
}
