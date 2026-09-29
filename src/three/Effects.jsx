import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';

export default function Effects() {
  return (
    <EffectComposer disableNormalPass multisampling={0}>
      {/* only the hottest glints bloom, so the bright studio backdrop stays crisp */}
      <Bloom intensity={0.45} luminanceThreshold={0.9} luminanceSmoothing={0.15} mipmapBlur radius={0.6} />
      <Vignette eskil={false} offset={0.28} darkness={0.6} />
    </EffectComposer>
  );
}
