// Shared constants for the pour simulation.
// Gravity is stylised (a touch slower than "real" at this scene scale) for a cinematic fall.
export const G = 14;

// Height of the reflective water floor the bottle stands on.
export const FLOOR_Y = -3.2;

// Time of flight for a projectile with vertical launch speed `v0y` (negative = downward)
// to drop a vertical distance `drop`.
export function fallTime(v0y, drop) {
  return (v0y + Math.sqrt(v0y * v0y + 2 * G * Math.max(drop, 0))) / G;
}

// Crystal-clear water: almost no tint, so drops read as lenses that flip the bright studio
// backdrop, with dark refracted rims and hot specular glints.
export const WATER_MATERIAL = {
  color: '#ffffff',
  metalness: 0,
  roughness: 0,
  transmission: 1,
  thickness: 0.3,
  ior: 1.333,
  clearcoat: 1,
  clearcoatRoughness: 0,
  attenuationColor: '#cdeeff',
  attenuationDistance: 1.4,
  specularIntensity: 1,
  specularColor: '#ffffff',
  envMapIntensity: 2,
};

// Soft round sprite used for bokeh and foam.
let dotTex;
export function softDotTexture(THREE) {
  if (dotTex) return dotTex;
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  dotTex = new THREE.CanvasTexture(c);
  return dotTex;
}
