import { useFrame } from '@react-three/fiber';

/**
 * postprocessing's EffectComposer switches `renderer.autoClear` off for the whole app. The
 * off-screen renders that happen earlier in the frame (drei's MeshTransmissionMaterial
 * buffers) rely on it: without a clear their depth buffer keeps frame 1's depth, every later
 * frame fails the depth test, and the refraction freezes on the first frame (ghost labels).
 * So auto-clear is on for the priority window [-0.5, 0.5] - where those renders run - and
 * handed back to the composer (priority 1) afterwards.
 */
export default function AutoClearWindow() {
  useFrame(({ gl }) => {
    gl.autoClear = true;
  }, -0.5);
  useFrame(({ gl }) => {
    gl.autoClear = false;
  }, 0.5);
  return null;
}
