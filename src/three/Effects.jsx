import { EffectComposer, Bloom, Vignette, Noise } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';

export default function Effects() {
  return (
    <EffectComposer disableNormalPass multisampling={0}>
      {/* highlights glow softly against the dark studio */}
      <Bloom intensity={0.62} luminanceThreshold={0.82} luminanceSmoothing={0.2} mipmapBlur radius={0.65} />
      {/* a whisper of film grain: the cinematic, printed-ad finish */}
      <Noise premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.35} />
      <Vignette eskil={false} offset={0.24} darkness={0.78} />
    </EffectComposer>
  );
}
