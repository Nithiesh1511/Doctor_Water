import { useEffect, useRef, useState } from 'react';
import { useProgress } from '@react-three/drei';
import './loader.css';

// Droplet silhouette (viewBox 0 0 120 150): pointed tip at the top, round belly at the bottom.
const DROP = 'M60 8 C60 8 18 62 18 96 A42 42 0 0 0 102 96 C102 62 60 8 60 8 Z';
// Two wavelengths wider than the drop so sliding it one wavelength loops seamlessly.
const WAVE = 'M-60 6 Q-45 0 -30 6 T0 6 T30 6 T60 6 T90 6 T120 6 T150 6 T180 6 V170 H-60 Z';
const WORD = "DOCTOR'S WATER".split('');
const BUBBLES = [
  { x: 42, r: 2.6, d: 0 },
  { x: 70, r: 1.8, d: 0.7 },
  { x: 55, r: 3.2, d: 1.3 },
  { x: 80, r: 2.2, d: 1.9 },
  { x: 36, r: 1.6, d: 2.4 },
];

/**
 * Intro loader: a glass droplet fills with water as the scene gets ready, a drip falls in with
 * a ripple, the wordmark rises letter by letter - then the curtain lifts away on a wave.
 *
 * The scene is procedural (almost nothing for useProgress to count), so the level eases up on
 * its own and only completes once the 3D scene has actually rendered (`dw:ready` from
 * Experience). When it lifts it fires `dw:reveal`, which starts the hero intro.
 */
export default function Loader() {
  const { progress: loaded } = useProgress();
  const loadedRef = useRef(0);
  loadedRef.current = loaded;
  const [pct, setPct] = useState(0);
  const [phase, setPhase] = useState('loading'); // loading -> full -> exit -> gone

  useEffect(() => {
    let ready = false;
    const onReady = () => (ready = true);
    window.addEventListener('dw:ready', onReady);
    const fallback = setTimeout(onReady, 9000); // never hang on the loader

    const t0 = performance.now();
    let v = 0;
    let raf;
    const tick = () => {
      const s = (performance.now() - t0) / 1000;
      const drift = 86 * (1 - Math.exp(-s / 1.4)); // eases toward ~86% while we wait
      const target = ready && s > 1.6 ? 100 : Math.max(drift, Math.min(loadedRef.current, 86));
      v += (target - v) * (target === 100 ? 0.06 : 0.1);
      if (target === 100 && v > 99.6) v = 100;
      setPct(v);
      if (v >= 100) {
        setPhase('full');
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(fallback);
      window.removeEventListener('dw:ready', onReady);
    };
  }, []);

  useEffect(() => {
    if (phase === 'full') {
      const id = setTimeout(() => {
        setPhase('exit');
        document.body.classList.add('is-revealed');
        window.dispatchEvent(new Event('dw:reveal'));
      }, 550);
      return () => clearTimeout(id);
    }
    if (phase === 'exit') {
      const id = setTimeout(() => setPhase('gone'), 1400);
      return () => clearTimeout(id);
    }
  }, [phase]);

  if (phase === 'gone') return null;
  // water surface height inside the drop: from the belly (y≈138) up to just under the tip
  const level = 138 - (pct / 100) * 128;

  return (
    <div className={`loader loader--${phase}`} role="status" aria-label={`Loading ${Math.round(pct)}%`}>
      <div className="loader__panel">
        <svg className="loader__edge" viewBox="0 0 1200 120" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 0 H1200 V40 Q1125 110 1050 40 T900 40 T750 40 T600 40 T450 40 T300 40 T150 40 T0 40 Z" />
        </svg>
      </div>

      <div className="loader__content">
        <div className="loader__stage">
          <span className="loader__drip" />
          <svg className="loader__drop" viewBox="0 0 120 150" aria-hidden="true">
            <defs>
              <clipPath id="ldClip">
                <path d={DROP} />
              </clipPath>
              <linearGradient id="ldWater" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#8fdcfb" />
                <stop offset="0.45" stopColor="#2bb7ec" />
                <stop offset="1" stopColor="#1273c4" />
              </linearGradient>
              <radialGradient id="ldGlass" cx="0.38" cy="0.62" r="0.7">
                <stop offset="0" stopColor="#ffffff" stopOpacity="0.55" />
                <stop offset="1" stopColor="#ffffff" stopOpacity="0.08" />
              </radialGradient>
            </defs>
            <path d={DROP} fill="url(#ldGlass)" />
            <g clipPath="url(#ldClip)">
              <g transform={`translate(0 ${level})`}>
                <path className="loader__wave loader__wave--back" d={WAVE} />
                <path className="loader__wave loader__wave--front" d={WAVE} fill="url(#ldWater)" />
                <ellipse className="loader__ripple" cx="60" cy="6" rx="16" ry="3.5" />
                {BUBBLES.map((b, i) => (
                  <circle key={i} className="loader__bubble" cx={b.x} cy="120" r={b.r} style={{ animationDelay: `${b.d}s` }} />
                ))}
              </g>
            </g>
            <path d={DROP} className="loader__rim" />
            <path className="loader__shine" d="M40 70 C34 84 32 96 36 110" />
          </svg>
        </div>

        <div className="loader__pct">
          {Math.round(pct)}
          <span>%</span>
        </div>
        <div className="loader__word" aria-hidden="true">
          {WORD.map((ch, i) => (
            <span key={i} style={{ animationDelay: `${0.15 + i * 0.05}s` }}>
              {ch === ' ' ? ' ' : ch}
            </span>
          ))}
        </div>
        <div className="loader__tag">Taste for Thirst</div>
      </div>
    </div>
  );
}
