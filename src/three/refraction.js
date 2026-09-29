import * as THREE from 'three';

/*
 * drei's MeshTransmissionMaterial renders the scene into its own buffer and refracts that.
 * Anything sitting *outside* the plastic (the sticker labels) would then show up as a
 * displaced ghost copy "through" the shell. Meshes marked with hideFromRefraction() skip
 * those buffer renders but still draw normally everywhere else.
 */
const BUFFERS = new Set();

// Call every frame with the shell material ref: its buffer texture can be swapped by drei.
export function registerRefractionBuffer(material) {
  const tex = material?.uniforms?.buffer?.value;
  if (tex) BUFFERS.add(tex);
}

export function hideFromRefraction(mesh) {
  if (!mesh || mesh.userData.refractionHidden) return;
  mesh.userData.refractionHidden = true;
  const saved = new THREE.Matrix4();
  let hidden = false;
  // three computes modelViewMatrix from matrixWorld right after onBeforeRender,
  // so collapsing matrixWorld here drops the mesh from just this draw.
  mesh.onBeforeRender = (gl) => {
    const rt = gl.getRenderTarget();
    if (rt && BUFFERS.has(rt.texture)) {
      saved.copy(mesh.matrixWorld);
      mesh.matrixWorld.makeScale(0, 0, 0);
      hidden = true;
    }
  };
  mesh.onAfterRender = () => {
    if (hidden) {
      mesh.matrixWorld.copy(saved);
      hidden = false;
    }
  };
}
