import { Suspense, useLayoutEffect, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { ScrollControls, Scroll } from '@react-three/drei';
import Experience from './three/Experience';
import Effects from './three/Effects';
import Overlay from './ui/Overlay';
import Loader from './ui/Loader';
import { BRAND } from './brand';
import { PAGES } from './story';
import './ui/overlay.css';

function Instagram() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
      <circle cx="17.5" cy="6.5" r="1.4" fill="currentColor" />
    </svg>
  );
}

// Touch devices (phones/tablets) have very dense screens but modest GPUs: the refractive
// scene renders several passes per frame, so cap the pixel ratio there to keep it smooth.
const MAX_DPR =
  typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches ? 1.5 : 2;

export default function App() {
  const railRef = useRef();
  const hintRef = useRef();
  const wrapRef = useRef();

  // The scroll overlay moves by the canvas height, so each section must be exactly that tall
  // (100vh differs on mobile browsers with toolbars): publish it as --app-h.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty('--app-h', `${el.clientHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <>
      <div className="bg-gradient" />

      <div className="canvas-wrap" ref={wrapRef}>
        <Canvas
          dpr={[1, MAX_DPR]}
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
          camera={{ position: [0, 0.1, 6.4], fov: 38 }}
          onCreated={(state) => {
            state.gl.localClippingEnabled = true; // water surfaces inside the can and bottle
            if (import.meta.env.DEV) window.__three = state; // console debugging only
          }}
        >
          <Suspense fallback={null}>
            <ScrollControls pages={PAGES} damping={0.45}>
              <Experience railRef={railRef} hintRef={hintRef} />
              <Scroll html style={{ width: '100%' }}>
                <Overlay />
              </Scroll>
            </ScrollControls>
            <Effects />
          </Suspense>
        </Canvas>
      </div>

      {/* fixed chrome */}
      <header className="nav">
        <div className="nav__brand">
          <div className="nav__logo" />
          <div className="nav__name">
            <span>
              <b>DOCTOR'S WATER</b>
            </span>
            <span>
              <i>TASTE FOR THIRST</i>
            </span>
          </div>
        </div>
        <a className="nav__cta" href={BRAND.instagram} target="_blank" rel="noreferrer">
          <Instagram />
          <span className="hide-sm">@doctors_water</span>
        </a>
      </header>

      <div className="scroll-hint" ref={hintRef}>
        <div className="scroll-hint__mouse" />
        <span>Scroll to pour</span>
      </div>

      <div className="progress-rail">
        <span ref={railRef} style={{ height: '0%' }} />
      </div>

      <Loader />
    </>
  );
}
