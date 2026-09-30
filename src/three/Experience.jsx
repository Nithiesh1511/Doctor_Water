import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useScroll, Environment, Lightformer } from '@react-three/drei';
import Can, { CAN_LIP, CAN_MOUTH } from './Can';
import Vessel from './Vessel';
import PourStream from './PourStream';
import Bubbles from './Bubbles';
import Ripples from './Ripples';
import Crowns from './Crowns';
import Swirl from './Swirl';
import Glints from './Glints';
import WaterFloor from './WaterFloor';
import Backdrop from './Backdrop';
import Bokeh from './Bokeh';
import AutoClearWindow from './AutoClearWindow';
import { BACKDROP_UNIFORMS } from './backdropShader';
import { BOTTLE, bottleLevel } from './profiles';
import { G, FLOOR_Y, fallTime } from './physics';
import { PAGES } from '../story';

const TILT = 2.05; // can tilt while pouring (rad): neck well below the waterline
const POUR_SPEED = 0.55; // launch speed of water leaving the neck
const MACRO_DROP = 1.5; // how far below the lip the macro shot looks (just past pinch-off)
const FIT_TAN = Math.tan(THREE.MathUtils.degToRad(19)); // half of the 38° fov
const SUNK = 3.0; // how deep the bottle waits under the pool before it rises

/*
 * Timeline, in scroll "screens" (0..PAGES-1). Overlay block k is centred at screen k:
 *   0 hero · 1 uncap · 2 (pour) · 3 macro · 4 zoom out · 5 filling · 6 (filling) ·
 *   7 capped & tamper-proof · 8 specs · 9 contact
 */
const T = {
  capOpen: [0.35, 0.85],
  move: [0.4, 1.6],
  tip: [0.85, 1.6],
  canGone: 3.7, // once we zoom out the can is no longer shown
  rise: [4.1, 4.9], // shoulders break the surface ~4.2, when the camera has pulled back
  fill: [4.95, 6.45], // long, slow fill across "filling" and the spacer after it
  pourEnd: 6.5, // leaves the (slow-motion) tail time to clear the neck before the cap drops
  cap: [6.8, 7.15], // screwed on as "Capped & tamper-proof" comes into view
  finale: [7.3, 8.2],
  swirl: [7.9, 8.9],
};
const FILL_MAX = 0.93;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const range = (v, a, b) => clamp01((v - a) / (b - a));
const lerp = THREE.MathUtils.lerp;
const damp = THREE.MathUtils.damp;
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const smooth = (x) => x * x * (3 - 2 * x);

// Camera keyframes (screen, pose from `poses` below); holds are pairs of the same pose.
const CAMERA_TRACK = [
  [0.0, 'hero'],
  [0.5, 'hero'],
  [1.6, 'pour'],
  [2.4, 'pour'],
  [3.0, 'macro'],
  [3.5, 'macro'],
  [4.4, 'wide'],
  [7.3, 'wide'],
  [8.3, 'finale'],
  [PAGES - 1, 'finale'],
];

// Camera distance that keeps a region of half-width `hw` and half-height `hh` in view (never
// closer than `min`).
const fit = (aspect, hh, hw, min) => Math.max(min, hh / FIT_TAN, hw / (FIT_TAN * aspect));

// Hero framing: the can sits in the right half (copy on the left) at about half the visible
// half-width; on portraits it is centred under the copy.
function frameHero(aspect, narrow) {
  if (narrow) return { heroZ: fit(aspect, 0, 1.25, 8.6), heroX: 0 };
  const heroZ = fit(aspect, 2.0, 2.0, 6.4);
  const heroX = THREE.MathUtils.clamp(heroZ * FIT_TAN * aspect * 0.5, 1.1, 2.4);
  return { heroZ, heroX };
}

// Pour geometry that only depends on the layout: where the can sits, where its lip ends up,
// where the bottle must stand to catch the jet, and where the macro close-up looks.
function pourLayout(narrow) {
  const C = narrow ? [1.15, 3.25, 0] : [1.4, 3.1, 0];
  const c = Math.cos(TILT);
  const s = Math.sin(TILT);
  const lip = [C[0] + CAN_LIP[0] * c - CAN_LIP[1] * s, C[1] + CAN_LIP[0] * s + CAN_LIP[1] * c];
  const v0 = [-s * POUR_SPEED, c * POUR_SPEED];
  const neckY = FLOOR_Y + BOTTLE.neckTop;
  const tn = fallTime(v0[1], lip[1] - neckY);
  const bottleX = lip[0] + v0[0] * tn - 0.015; // jet drops straight down the neck
  const tf = fallTime(v0[1], MACRO_DROP);
  const focus = [lip[0] + v0[0] * tf, lip[1] + v0[1] * tf - 0.5 * G * tf * tf, 0];
  return { C, lip, bottleX, focus };
}

export default function Experience({ railRef, hintRef }) {
  const scroll = useScroll();
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const canRef = useRef();
  const bottleRef = useRef();

  const aspect = size.width / size.height;
  const narrow = aspect < 0.85;
  const layout = useMemo(() => pourLayout(narrow), [narrow]);

  const shared = useRef({
    fill: 0,
    levelLocal: BOTTLE.waterBase,
    canFill: 0.82,
    capOpen: 0,
    capDrop: 0,
    swirl: 0,
    breakLen: 1.4,
    surfaceY: -20,
    pourAge: 0,
    time: { scale: 1, sim: 0 },
    bottle: { x: 0, y: -20, z: 0, present: false, presence: 0, wet: 0 },
    pour: { on: false, spill: false, lip: new THREE.Vector3(), v0: new THREE.Vector3() },
    impact: { active: false, x: 0, y: 0, z: 0 },
    mouth: new THREE.Vector3(),
    canUp: new THREE.Vector3(0, 1, 0),
    ripples: [],
    floorRipples: [],
    crowns: [],
    dropQueue: [],
  });

  const tmp = useMemo(
    () => ({
      lipLocal: new THREE.Vector3(...CAN_LIP),
      mouthLocal: new THREE.Vector3(...CAN_MOUTH),
      q: new THREE.Quaternion(),
      pos: new THREE.Vector3(),
      tgt: new THREE.Vector3(),
      prevBy: FLOOR_Y - SUNK,
      poses: Object.fromEntries(
        ['hero', 'pour', 'macro', 'wide', 'finale'].map((k) => [k, { p: new THREE.Vector3(), t: new THREE.Vector3() }])
      ),
    }),
    []
  );

  // hero intro state; the loader fires dw:reveal as it lifts
  const intro = useRef({ start: null, pending: false, frames: 0, splashed: false, tiltX: 0, tiltZ: 0 });
  const sweepRef = useRef();
  useEffect(() => {
    const onReveal = () => (intro.current.pending = true);
    window.addEventListener('dw:reveal', onReveal);
    return () => window.removeEventListener('dw:reveal', onReveal);
  }, []);

  // Dev helper: open http://localhost:5173/#o=0.35 to jump straight to a scroll position.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const m = window.location.hash.match(/o=([\d.]+)/);
    if (!m || !scroll.el) return;
    const go = () => {
      scroll.el.scrollTop = parseFloat(m[1]) * (scroll.el.scrollHeight - scroll.el.clientHeight);
    };
    go();
    const id = setTimeout(go, 300);
    return () => clearTimeout(id);
  }, [scroll]);

  useFrame((state, delta) => {
    const o = scroll.offset;
    const sc = o * (PAGES - 1); // scroll position in screens
    const at = (span) => range(sc, span[0], span[1]);
    const t = state.clock.elapsedTime;
    const dt = Math.min(delta, 1 / 30);
    const S = shared.current;
    const { C, lip, bottleX, focus } = layout;

    // ---------- time ----------
    // the whole pour runs in gentle slow motion (heavier, calmer water), and the macro shot
    // drops to near-freeze once the jet has fallen far enough to fill the close-up
    const pouring = ease(range(sc, 1.2, 1.8)) * (1 - ease(range(sc, T.pourEnd, T.pourEnd + 0.6)));
    const macro = ease(clamp01(range(sc, 2.4, 3.0) - range(sc, 3.5, 4.0)));
    const developed = range(S.pourAge, 0.8, 1.3);
    S.time.scale = lerp(lerp(1, 0.6, pouring), 0.07, macro * developed);
    S.time.sim += dt * S.time.scale;

    // ---------- hero intro: starts when the loader lifts (dw:reveal) ----------
    const I = intro.current;
    if (I.frames < 20 && ++I.frames === 20) window.dispatchEvent(new Event('dw:ready')); // scene has rendered
    if (I.pending) {
      I.start = t;
      I.pending = false;
    }
    const tau = I.start === null ? -1 : t - I.start; // seconds since reveal
    // drop in from above, one decelerating turn to face front, land with a wobble + bounce
    const fall = tau < 0 ? 1 : 1 - easeOut(Math.min(tau / 1.1, 1));
    const landed = Math.max(tau - 1.05, 0);
    const settle = tau < 1.05 ? 0 : Math.exp(-landed * 3.2);
    const introY = fall * 5.4 - settle * Math.sin(landed * 10) * 0.16;
    const introSpin = (tau < 0 ? 1 : 1 - easeOut(Math.min(tau / 1.7, 1))) * Math.PI * 2;
    const introWobble = settle * Math.sin(landed * 8) * 0.14;
    // the can leans gently toward the pointer while it floats
    I.tiltX = damp(I.tiltX, -state.pointer.y * 0.14, 3, dt);
    I.tiltZ = damp(I.tiltZ, -state.pointer.x * 0.12, 3, dt);

    // ---------- the 20 L can: hero float -> uncap -> tip -> pour (then out of shot) ----------
    const can = canRef.current;
    if (can) {
      const hero = narrow ? [0, -0.55, 0] : [frameHero(aspect, narrow).heroX, -0.1, 0];
      const move = ease(at(T.move));
      const tip = ease(at(T.tip));
      const idle = 1 - move;
      S.capOpen = at(T.capOpen);
      S.canFill = lerp(0.82, 0.66, range(sc, 1.5, T.canGone));

      can.rotation.order = 'ZYX'; // spin about its own axis, then tip over
      can.position.set(
        lerp(hero[0], C[0], move),
        lerp(hero[1], C[1], move) + Math.sin(move * Math.PI) * 0.35 + (Math.sin(t * 1.1) * 0.06 + introY) * idle,
        0
      );
      can.rotation.set(
        (Math.sin(t * 0.7) * 0.05 + I.tiltX) * idle,
        (Math.sin(t * 0.5) * 0.5 - 0.2 + introSpin) * idle,
        lerp(-0.12 + (introWobble + I.tiltZ) * idle, TILT, tip)
      );

      // landing: a burst of spray flung off the can that rains onto the pool below
      if (!I.splashed && tau >= 1.05 && sc < 0.5) {
        I.splashed = true;
        for (let k = 0; k < 90; k++) {
          const ang = Math.random() * Math.PI * 2;
          const r = 0.84;
          const out = 0.9 + Math.random() * 2.2;
          S.dropQueue.push([
            can.position.x + Math.sin(ang) * r,
            can.position.y + (-0.9 + Math.random() * 1.6) * 0.8,
            Math.cos(ang) * r,
            Math.sin(ang) * out,
            1.4 + Math.random() * 3,
            Math.cos(ang) * out,
            0.008 + Math.pow(Math.random(), 1.6) * 0.05,
            0,
          ]);
        }
      }

      // a studio light sweeps across the ribs every few seconds
      if (sweepRef.current) {
        const k = tau < 0 ? 1 : ((tau + 3.6) % 6.5) / 1.8;
        const on = k < 1 ? Math.sin(Math.PI * k) : 0;
        sweepRef.current.position.set(can.position.x - 2.6 + 5.2 * ease(Math.min(k, 1)), can.position.y + 0.7, 2.4);
        sweepRef.current.intensity = on * 14 * idle;
      }
      can.visible = sc < T.canGone;
      can.updateMatrixWorld();

      S.pour.lip.copy(tmp.lipLocal);
      can.localToWorld(S.pour.lip);
      S.mouth.copy(tmp.mouthLocal);
      can.localToWorld(S.mouth);
      can.getWorldQuaternion(tmp.q);
      S.canUp.set(0, 1, 0).applyQuaternion(tmp.q);
      S.pour.v0.copy(S.canUp).multiplyScalar(POUR_SPEED);
      // flows as soon as the cap is off and the neck dips under the waterline
      S.pour.on = sc > T.tip[0] && sc < T.pourEnd && S.capOpen >= 1 && (S.pour.spill || sc >= T.canGone);
    }

    // ---------- the bottle rises out of the pool under the stream ----------
    // (timed so the camera has pulled back to the wide shot as the shoulders break the surface)
    const rise = easeOut(at(T.rise));
    const finale = ease(at(T.finale));
    const by = lerp(FLOOR_Y - SUNK, FLOOR_Y, rise);
    if (bottleRef.current) {
      bottleRef.current.position.set(bottleX, by, 0);
      bottleRef.current.rotation.y = (1 - rise) * 1.2 + Math.sin(t * 0.4) * 0.3 * finale;
      bottleRef.current.visible = rise > 0.001;
    }
    // breaking the surface: the neck pokes through, then the shoulders throw up a crown
    const prev = tmp.prevBy;
    if (by > prev) {
      const cross = (h) => prev + h < FLOOR_Y && by + h >= FLOOR_Y;
      if (cross(BOTTLE.neckTop)) {
        S.crowns.push({ x: bottleX, y: FLOOR_Y, z: 0, r: 0.2, strength: 0.45 });
        S.floorRipples.push({ x: bottleX, z: 0, amp: 0.8 });
      }
      if (cross(BOTTLE.shoulderY)) {
        S.crowns.push({ x: bottleX, y: FLOOR_Y, z: 0, r: 0.52, strength: 1.15 });
        S.floorRipples.push({ x: bottleX, z: 0, amp: 1.5 });
        S.floorRipples.push({ x: bottleX + 0.2, z: 0.15, amp: 1.0 });
      }
      // water sheeting off the shoulders while it is still coming up
      if (by + BOTTLE.shoulderY > FLOOR_Y && by < FLOOR_Y && Math.random() < Math.min(1, (by - prev) * 60)) {
        const a = Math.random() * Math.PI * 2;
        const r = 0.52;
        S.dropQueue.push([bottleX + Math.cos(a) * r, FLOOR_Y + 0.02, Math.sin(a) * r, Math.cos(a) * 0.4, 0.8 + Math.random() * 1.2, Math.sin(a) * 0.4, 0.012 + Math.random() * 0.02, 3]);
      }
    }
    tmp.prevBy = by;

    // Fill and cap glide toward their scroll targets instead of tracking the scrollbar 1:1,
    // so a flick of the wheel still gives a steady rise and a soft landing.
    S.fill = damp(S.fill, FILL_MAX * smooth(at(T.fill)), 2.2, dt);
    S.levelLocal = bottleLevel(S.fill);
    S.capDrop = damp(S.capDrop, at(T.cap), 5, dt);
    S.swirl = damp(S.swirl, ease(at(T.swirl)), 4, dt);
    S.bottle.x = bottleX;
    S.bottle.y = by;
    S.bottle.present = rise > 0.001;
    S.bottle.presence = rise;
    S.bottle.wet = THREE.MathUtils.smoothstep(rise, 0.7, 1);
    S.surfaceY = by + S.levelLocal;
    // with nothing below, the jet breaks into drops quickly; into the bottle it stays glassy
    S.breakLen = lerp(1.4, 9, rise);

    // ---------- the key light follows the action (text keeps the darker side) ----------
    const gA = ease(range(sc, 2.7, 4.9));
    const gB = ease(range(sc, T.finale[0], T.finale[1] + 0.1));
    BACKDROP_UNIFORMS.uGlowDir.value
      .set(lerp(lerp(0.55, -0.05, gA), -0.4, gB), lerp(0.2, 0.1, gA), -1)
      .normalize();

    // ---------- camera ----------
    // Every shot is framed from the aspect ratio: fit() backs the camera off just enough to
    // keep a half-width / half-height region in view, and objects are placed as a fraction
    // of the visible width - so phones, tablets, square windows and ultra-wides all frame well.
    const P = tmp.poses;
    const { heroZ } = frameHero(aspect, narrow);
    if (narrow) {
      // short portrait phones: the copy takes more of the screen, so frame the can lower
      const lift = size.height < 700 ? 0.4 : 0;
      P.hero.t.set(0, 0.2 + lift, 0);
      P.hero.p.set(0, 0.4 + lift, heroZ);
    } else {
      P.hero.t.set(0, 0, 0);
      P.hero.p.set(0, 0.1, heroZ);
    }
    P.pour.t.set(lip[0] + (narrow ? 0.3 : 0.5), lip[1] + 0.3, 0);
    P.pour.p.copy(P.pour.t).add(tmp.pos.set(0.1, 0.3, narrow ? fit(aspect, 2.4, 1.7, 8.4) : fit(aspect, 2.1, 2.2, 6.6)));
    P.macro.t.set(focus[0] - (narrow ? 0 : 0.14), focus[1] - 0.05, 0);
    P.macro.p.copy(P.macro.t).add(tmp.pos.set(narrow ? 0.2 : 0.38, 0.18, narrow ? fit(aspect, 0.6, 0.35, 1.9) : 1.45));
    const zWide = fit(aspect, 2.35, narrow ? 1.2 : 1.9, 0);
    const wideShift = narrow ? 0 : THREE.MathUtils.clamp(zWide * FIT_TAN * aspect * 0.25, 0.5, 1.0);
    // on portraits the copy sits at the top, so the bottle is framed lower on screen
    P.wide.t.set(bottleX + wideShift, FLOOR_Y + (narrow ? 1.9 : 1.45), 0);
    P.wide.p.set(P.wide.t.x, FLOOR_Y + (narrow ? 2.7 : 2.35), zWide);
    if (narrow) {
      // on a portrait screen the swirl plays in the band between the specs cards leaving at the
      // top and the contact card arriving at the bottom: centre bottle + swirl in the frame
      // (some flung drops may leave the frame - that just reads as more splash)
      const zf = fit(aspect, 2.9, 1.5, 9);
      P.finale.t.set(bottleX, FLOOR_Y + 1.65, 0);
      P.finale.p.set(bottleX, FLOOR_Y + 2.05, zf);
    } else {
      // bottle + swirl in the left part of the frame, clear of the cards
      const zf = fit(aspect, 2.2, 3.2, 6.4);
      const halfW = zf * FIT_TAN * aspect;
      const shift = THREE.MathUtils.clamp(halfW * 0.5, 1.2, 2.4);
      P.finale.t.set(bottleX + shift, FLOOR_Y + 1.5, 0);
      P.finale.p.set(bottleX + shift, FLOOR_Y + 1.95, zf);
    }

    let i = 0;
    while (i < CAMERA_TRACK.length - 2 && sc > CAMERA_TRACK[i + 1][0]) i++;
    const [s0, k0] = CAMERA_TRACK[i];
    const [s1, k1] = CAMERA_TRACK[i + 1];
    const a = ease(range(sc, s0, s1));
    tmp.pos.lerpVectors(P[k0].p, P[k1].p, a);
    tmp.tgt.lerpVectors(P[k0].t, P[k1].t, a);
    // subtle hand-held parallax that scales with shot distance
    const dist = tmp.pos.distanceTo(tmp.tgt);
    tmp.pos.x += state.pointer.x * dist * 0.02;
    tmp.pos.y += state.pointer.y * dist * 0.015;
    camera.position.copy(tmp.pos);
    camera.lookAt(tmp.tgt);

    // ---------- external DOM chrome ----------
    if (railRef?.current) railRef.current.style.height = `${clamp01(o) * 100}%`;
    if (hintRef?.current) hintRef.current.classList.toggle('gone', o > 0.03);
  }, -1);

  return (
    <>
      <AutoClearWindow />
      <Backdrop />
      <WaterFloor shared={shared} />
      <Bokeh focus={layout.focus} />

      {/* lighting */}
      <ambientLight intensity={0.6} />
      <directionalLight position={[4, 8, 5]} intensity={1.8} color="#ffffff" />
      <directionalLight position={[-5, 2, -3]} intensity={0.7} color="#9fdcff" />
      <pointLight position={[0, -1, 3]} intensity={1.6} color="#bfe8ff" distance={12} />
      <pointLight ref={sweepRef} intensity={0} color="#ffffff" distance={7} />

      {/* reflections come from the same studio: the backdrop dome plus crisp strip lights.
          Rendered once: re-baking every frame regenerates the PMREM mid-render, which leaves
          the plastic's refraction buffers stale (ghost labels) and costs ~40 passes a frame. */}
      <Environment resolution={256} frames={1}>
        <Backdrop />
        <Lightformer intensity={3} position={[0, 4, 3]} scale={[8, 3, 1]} color="#ffffff" />
        <Lightformer intensity={5} position={[3, 0, 3]} rotation-y={-Math.PI / 4} scale={[0.4, 8, 1]} color="#ffffff" />
        <Lightformer intensity={3.5} position={[-3, 0, 3]} rotation-y={Math.PI / 4} scale={[0.25, 8, 1]} color="#e6f7ff" />
        {/* warm champagne rims: the luxury edge glow on the glass and water */}
        <Lightformer intensity={3} position={[-4, 1, -1]} rotation-y={Math.PI / 2.4} scale={[0.35, 7, 1]} color="#f0c878" />
        <Lightformer intensity={2} position={[4, 1.5, -1.5]} rotation-y={-Math.PI / 2.4} scale={[0.25, 6, 1]} color="#e9bf73" />
        <Lightformer form="ring" intensity={3} position={[0, 2, 5]} scale={1.4} color="#ffffff" />
      </Environment>

      <Can ref={canRef} shared={shared} />
      <Vessel ref={bottleRef} shared={shared} />
      <PourStream shared={shared} />
      <Glints shared={shared} />
      <Bubbles shared={shared} />
      <Ripples shared={shared} />
      <Crowns shared={shared} />
      <Swirl shared={shared} />
    </>
  );
}
