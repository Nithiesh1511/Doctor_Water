import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { G, FLOOR_Y, fallTime, WATER_MATERIAL } from './physics';
import { BOTTLE, bottleRadiusAt, bottleInnerRadiusAt } from './profiles';

const RINGS = 140;
const SEG = 20;
const MAX_DROPS = 640;
const R0 = 0.095; // stream radius where it leaves the neck
const GLUG_HZ = 2.6; // air gulping back into the can pulses the flow
// Plateau–Rayleigh: the fastest-growing ripple on a falling jet has a wavelength of ~9 jet
// radii, so it pinches into evenly spaced pearls (~1.9 r by volume) with a tiny satellite
// between each pair. Softened slightly so the string reads as elegant beads, not blobs.
const RAYLEIGH = 9.0;
const PEARL = 1.45;
const UP = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;

// drop kinds
const FREE = 0; // in flight
const SPLASH_IN = 1; // splash thrown up inside the bottle
const SPRITZ = 2; // flicked off the neck when the cap pops
const SPRAY = 3; // splash-back / rebound: dies quietly, never splashes again

// where the jet ends
const END_FLOOR = 0;
const END_WATER = 1;
const END_GLASS = 2;

const sat = (v) => Math.min(1, Math.max(0, v));

function makeTube() {
  const g = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(new Float32Array(RINGS * SEG * 3), 3);
  pos.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', pos);
  const idx = [];
  for (let i = 0; i < RINGS - 1; i++) {
    for (let j = 0; j < SEG; j++) {
      const a = i * SEG + j;
      const b = i * SEG + ((j + 1) % SEG);
      const c = (i + 1) * SEG + j;
      const d = (i + 1) * SEG + ((j + 1) % SEG);
      idx.push(a, c, b, b, c, d);
    }
  }
  g.setIndex(idx);
  return g;
}

/**
 * The pour. Water leaves the neck of the tipped can as a ballistic jet: every ring of the tube
 * sits where a parcel of water would be after `tau` seconds of flight, so the stream bends,
 * accelerates and thins like a real pour. Glug pulses from air re-entering the can ride down
 * it, varicose ripples grow as it falls, and in free fall it pinches into droplets
 * (Plateau–Rayleigh). Wherever it lands - the pool, the bottle mouth or the glass - it
 * splashes, feeding ripples, crowns and bubbles.
 */
export default function PourStream({ shared }) {
  const tubeRef = useRef();
  const dropsRef = useRef();
  const tube = useMemo(() => makeTube(), []);

  const sim = useMemo(
    () => ({
      live: false,
      stopping: false,
      head: 0,
      tail: 0,
      spritzed: false,
      brkPhase: null, // ripple phase at the break point last frame (drives pearl pinch-off)
      lip: new THREE.Vector3(),
      v0: new THREE.Vector3(),
      acc: { brk: 0, spray: 0, splash: 0, ripple: 0, floor: 0, crown: 0 },
      cursor: 0,
      p: new Float32Array(MAX_DROPS * 3),
      v: new Float32Array(MAX_DROPS * 3),
      size: new Float32Array(MAX_DROPS),
      life: new Float32Array(MAX_DROPS),
      phase: new Float32Array(MAX_DROPS),
      kind: new Uint8Array(MAX_DROPS),
      alive: new Uint8Array(MAX_DROPS),
    }),
    []
  );

  const tmp = useMemo(
    () => ({
      c: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      n: new THREE.Vector3(),
      dummy: new THREE.Object3D(),
      dir: new THREE.Vector3(),
    }),
    []
  );

  const pathAt = (tau, out) => {
    const { lip, v0 } = sim;
    return out.set(lip.x + v0.x * tau, lip.y + v0.y * tau - 0.5 * G * tau * tau, lip.z + v0.z * tau);
  };
  const velAt = (tau, out) => out.set(sim.v0.x, sim.v0.y - G * tau, sim.v0.z);
  const radiusAt = (tau, st) => {
    const v0l = sim.v0.length();
    const vy = sim.v0.y - G * tau;
    const vl = Math.sqrt(sim.v0.x * sim.v0.x + vy * vy + sim.v0.z * sim.v0.z);
    // glug: the parcel at `tau` left the neck at st - tau, when the flow was pulsing
    const glug = 1 + 0.2 * Math.sin(TAU * GLUG_HZ * (st - tau)) + 0.06 * Math.sin(TAU * GLUG_HZ * 2.3 * (st - tau));
    // continuity thins the jet as it speeds up (softened for readability)
    return R0 * glug * Math.pow(v0l / Math.max(vl, 1e-3), 0.25);
  };

  const spawn = (x, y, z, vx, vy, vz, size, kind, phase = Math.random() * TAU) => {
    const i = sim.cursor;
    sim.cursor = (sim.cursor + 1) % MAX_DROPS;
    sim.p[i * 3] = x;
    sim.p[i * 3 + 1] = y;
    sim.p[i * 3 + 2] = z;
    sim.v[i * 3] = vx;
    sim.v[i * 3 + 1] = vy;
    sim.v[i * 3 + 2] = vz;
    sim.size[i] = size;
    sim.life[i] = 0;
    sim.phase[i] = phase;
    sim.kind[i] = kind;
    sim.alive[i] = 1;
  };

  // a drop hitting the pool: rings, a few rebound beads, sometimes a small crown
  const hitFloor = (S, x, z, size, vy) => {
    const rnd = Math.random;
    const e = Math.min(1, Math.abs(vy) / 6);
    if (size > 0.008 || rnd() < 0.3) S.floorRipples.push({ x, z, amp: Math.min(0.9, 0.12 + size * 22 * (0.5 + e)) });
    if (size > 0.02) {
      const n = 2 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) {
        const a = rnd() * TAU;
        const out = 0.2 + rnd() * 0.5;
        spawn(x, FLOOR_Y + 0.01, z, Math.cos(a) * out, (0.6 + rnd() * 1.1) * (0.5 + e), Math.sin(a) * out, size * (0.2 + rnd() * 0.25), SPRAY);
      }
      if (size > 0.032 && rnd() < 0.18) S.crowns.push({ x, y: FLOOR_Y, z, r: size * 1.5, strength: 0.22 + e * 0.2 });
    }
  };

  useFrame((state, delta) => {
    const S = shared.current;
    const P = S.pour;
    const dt = Math.min(delta, 1 / 30);
    const sdt = dt * S.time.scale;
    const st = S.time.sim;
    const rnd = Math.random;
    S.drops = sim; // read by the glints

    // drops handed over by the crowns
    while (S.dropQueue.length) spawn(...S.dropQueue.shift());

    // ---------------- pour state machine ----------------
    if (P.on) {
      if (!sim.live || sim.stopping) {
        sim.live = true;
        sim.stopping = false;
        sim.head = 0;
        sim.tail = 0;
      }
      sim.lip.copy(P.lip);
      sim.v0.copy(P.v0);
      sim.head += sdt;
    } else if (sim.live && !sim.stopping) {
      sim.stopping = true;
      sim.tail = 0;
    }
    if (sim.stopping) {
      sim.head += sdt;
      sim.tail += sdt;
    }

    // ---------------- where does the jet end? ----------------
    const bottle = S.bottle;
    const lipY = sim.lip.y;
    let tEnd = fallTime(sim.v0.y, lipY - FLOOR_Y);
    let endKind = END_FLOOR;
    const bottleUp = bottle.present && bottle.y + BOTTLE.neckTop > FLOOR_Y + 0.02;
    if (bottleUp) {
      const topY = bottle.y + BOTTLE.neckTop;
      const tn = fallTime(sim.v0.y, lipY - topY);
      pathAt(tn, tmp.c);
      const off = Math.hypot(tmp.c.x - bottle.x, tmp.c.z - bottle.z);
      if (off < BOTTLE.mouthR - 0.02) {
        tEnd = fallTime(sim.v0.y, lipY - (S.surfaceY - 0.03));
        endKind = END_WATER;
      } else if (off < BOTTLE.bodyR + 0.05 && tn < tEnd) {
        tEnd = tn;
        endKind = END_GLASS;
      }
    }
    // (only a gentle drift: a jumpy break point would bunch the pearls up)
    const breakD = S.breakLen * (1 + 0.025 * Math.sin(st * 3.1) + 0.012 * Math.sin(st * 7.3));
    const tBreak = fallTime(sim.v0.y, breakD);
    const intact = tEnd < tBreak; // reaches its target before breaking up
    const tLimit = Math.min(tEnd, tBreak);
    const t1 = Math.min(sim.head, tLimit);
    const t0 = sim.stopping ? sim.tail : 0;
    const headFree = sim.head < tLimit;
    if (sim.stopping && sim.tail >= tLimit) sim.live = false;
    const visible = sim.live && t1 - t0 > 0.002;
    // how long the jet has been flowing (lets the scene hold slow-mo until it is developed)
    S.pourAge = sim.live && !sim.stopping ? sim.head / Math.max(tLimit, 1e-3) : 0;

    // The ripple is imposed at the neck at a fixed frequency and carried down with the water,
    // so its crests spread apart as the jet accelerates and arrive at the break point exactly
    // one Rayleigh wavelength apart - where each crest pinches off as a pearl.
    velAt(tBreak, tmp.vel);
    const vBreak = Math.max(tmp.vel.length(), 1e-3);
    const rBreak = R0 * Math.pow(sim.v0.length() / vBreak, 0.25);
    const rippleHz = vBreak / (RAYLEIGH * rBreak);

    // ---------------- build the jet ----------------
    if (tubeRef.current) {
      tubeRef.current.visible = visible;
      if (visible) {
        const arr = tube.attributes.position.array;
        const varAmp = THREE.MathUtils.lerp(0.16, 0.035, bottle.presence);
        for (let i = 0; i < RINGS; i++) {
          const tau = t0 + ((t1 - t0) * i) / (RINGS - 1);
          pathAt(tau, tmp.c);
          velAt(tau, tmp.vel);
          const speed = tmp.vel.length();
          tmp.dir.copy(tmp.vel).normalize();
          tmp.n.set(tmp.dir.y, -tmp.dir.x, 0).normalize();

          const d = lipY - tmp.c.y; // distance fallen
          let r = radiusAt(tau, st);
          // ribbon leaving the lip, contracting into a round jet
          const sheet = Math.exp(-d * 7);
          const rN = 1 - 0.35 * sheet;
          const rB = 1 + 1.4 * sheet;

          // varicose instability, growing with the fall
          let A = Math.min(0.3, 0.02 + d * varAmp);
          let f = 1;
          if (!intact && !headFree) {
            // pinch-off zone right above the break point: one last bead on a thinning neck
            const rel = sat((breakD - d) / 0.26);
            A += (1 - rel) * 0.3;
            f *= Math.pow(rel, 0.45);
          }
          if (headFree) {
            // rounded leading blob
            const u = ((t1 - tau) * speed) / (r * 2.4);
            f *= Math.sqrt(sat(u)) * (1 + 0.25 * Math.exp(-Math.pow(u - 1.3, 2) * 2));
          }
          if (t0 > 0) {
            // detached tail thins into a string
            const u = ((tau - t0) * speed) / 0.3;
            f *= Math.pow(sat(u), 0.7);
          }
          // advected ripple (parcel phase), with a harmonic that sharpens crests into beads and
          // troughs into thin necks - the teardrop shape just before pinch-off
          const ph = TAU * rippleHz * (st - tau);
          const wave = 1 + A * Math.sin(ph) + 0.35 * A * Math.sin(2 * ph - Math.PI / 2);
          r *= f * Math.max(wave, 0.05);

          for (let j = 0; j < SEG; j++) {
            const phi = (j / SEG) * TAU;
            const az =
              1 +
              0.05 * Math.sin(2 * phi + 6 * d - 5 * st) +
              0.03 * Math.sin(3 * phi - 9 * d + 7 * st) +
              0.015 * Math.sin(5 * phi + 13 * d + 4 * st);
            const cn = Math.cos(phi) * r * rN * az;
            const cb = Math.sin(phi) * r * rB * az;
            const k = (i * SEG + j) * 3;
            arr[k] = tmp.c.x + tmp.n.x * cn;
            arr[k + 1] = tmp.c.y + tmp.n.y * cn;
            arr[k + 2] = tmp.c.z + cb;
          }
        }
        tube.attributes.position.needsUpdate = true;
        tube.computeVertexNormals();
      }
    }

    // ---------------- emit droplets ----------------
    // break-up: each ripple crest that reaches the break point pinches off as one pearl,
    // and the thin neck behind it snaps into a tiny satellite half a wavelength later
    const breaking = visible && !headFree && !intact && t0 < tBreak;
    const brkPhase = rippleHz * (st - tBreak);
    if (breaking && sim.brkPhase !== null) {
      pathAt(tBreak, tmp.c);
      velAt(tBreak, tmp.vel);
      const rb = radiusAt(tBreak, st);
      const emit = (size, jitter) =>
        spawn(
          tmp.c.x + (rnd() - 0.5) * 0.01,
          tmp.c.y,
          tmp.c.z + (rnd() - 0.5) * 0.01,
          tmp.vel.x + (rnd() - 0.5) * jitter,
          tmp.vel.y * (0.985 + rnd() * 0.03),
          tmp.vel.z + (rnd() - 0.5) * jitter,
          size,
          FREE,
          -Math.PI / 2 // born stretched along its fall, then wobbles round
        );
      const crossed = (p0, p1, at) => Math.min(3, Math.floor(p1 - at) - Math.floor(p0 - at));
      for (let n = crossed(sim.brkPhase, brkPhase, 0.25); n > 0; n--) emit(rb * PEARL * (0.9 + rnd() * 0.22), 0.1);
      for (let n = crossed(sim.brkPhase, brkPhase, 0.75); n > 0; n--) emit(rb * (0.32 + rnd() * 0.16), 0.18);
    }
    sim.brkPhase = breaking ? brkPhase : null;
    // fine spray peeling off the jet
    if (visible) {
      sim.acc.spray += 9 * sdt * sat((t1 - t0) / 0.3);
      while (sim.acc.spray >= 1) {
        sim.acc.spray -= 1;
        const tau = t0 + rnd() * (t1 - t0);
        pathAt(tau, tmp.c);
        velAt(tau, tmp.vel);
        const a = rnd() * TAU;
        const nx = Math.cos(a);
        const nz = Math.sin(a);
        const r = radiusAt(tau, st);
        const kick = 0.25 + rnd() * 0.5;
        spawn(tmp.c.x + nx * r, tmp.c.y, tmp.c.z + nz * r, tmp.vel.x + nx * kick, tmp.vel.y, tmp.vel.z + nz * kick, 0.006 + rnd() * 0.012, FREE);
      }
    }

    // ---------------- the jet lands ----------------
    const landing = visible && intact && !headFree && t0 < tEnd;
    S.impact.active = landing && endKind === END_WATER;
    if (landing) {
      pathAt(tEnd, tmp.c);
      velAt(tEnd, tmp.vel);
      if (endKind === END_WATER) {
        // inside the bottle: splash + ripples + bubble plume
        S.impact.x = tmp.c.x;
        S.impact.y = S.surfaceY;
        S.impact.z = tmp.c.z;
        sim.acc.splash += 70 * sdt;
        const inner = bottleInnerRadiusAt(S.levelLocal);
        while (sim.acc.splash >= 1) {
          sim.acc.splash -= 1;
          const a = rnd() * TAU;
          const out = (0.2 + rnd() * 0.8) * Math.min(1, inner / 0.35);
          spawn(tmp.c.x + Math.cos(a) * 0.04, S.surfaceY + 0.02, tmp.c.z + Math.sin(a) * 0.04, Math.cos(a) * out, 0.8 + rnd() * 1.6, Math.sin(a) * out, 0.007 + rnd() * 0.02, SPLASH_IN);
        }
        sim.acc.ripple += sdt;
        if (sim.acc.ripple > 0.09) {
          sim.acc.ripple = 0;
          S.ripples.push({ x: tmp.c.x, z: tmp.c.z, s: 1 });
        }
      } else if (endKind === END_FLOOR) {
        // straight into the pool: a churning splash, rings and crowns
        sim.acc.floor += 55 * sdt;
        while (sim.acc.floor >= 1) {
          sim.acc.floor -= 1;
          const a = rnd() * TAU;
          const out = 0.3 + rnd() * 1.0;
          spawn(tmp.c.x + Math.cos(a) * 0.05, FLOOR_Y + 0.02, tmp.c.z + Math.sin(a) * 0.05, Math.cos(a) * out, 1.0 + rnd() * 2.2, Math.sin(a) * out, 0.008 + rnd() * 0.022, SPRAY);
        }
        sim.acc.ripple += sdt;
        if (sim.acc.ripple > 0.07) {
          sim.acc.ripple = 0;
          S.floorRipples.push({ x: tmp.c.x, z: tmp.c.z, amp: 1 });
        }
        sim.acc.crown += sdt;
        if (sim.acc.crown > 0.32) {
          sim.acc.crown = 0;
          S.crowns.push({ x: tmp.c.x, y: FLOOR_Y, z: tmp.c.z, r: 0.06, strength: 0.6 });
        }
      } else {
        // clipped the shoulder / rim: sheet off the glass
        sim.acc.splash += 60 * sdt;
        while (sim.acc.splash >= 1) {
          sim.acc.splash -= 1;
          const dx = tmp.c.x - bottle.x;
          const dz = tmp.c.z - bottle.z;
          const l = Math.hypot(dx, dz) || 1;
          const out = 0.6 + rnd() * 1.2;
          spawn(tmp.c.x, tmp.c.y + 0.01, tmp.c.z, (dx / l) * out + (rnd() - 0.5) * 0.4, 0.3 + rnd() * 1.2, (dz / l) * out + (rnd() - 0.5) * 0.4, 0.008 + rnd() * 0.02, SPRAY);
        }
      }
    }

    // spritz flicked off the neck when the cap pops
    if (S.capOpen > 0.6 && !sim.spritzed) {
      sim.spritzed = true;
      const m = S.mouth;
      const u = S.canUp;
      for (let i = 0; i < 30; i++) {
        const sp = 0.6 + rnd() * 1.4;
        spawn(m.x + (rnd() - 0.5) * 0.3, m.y + 0.02, m.z + (rnd() - 0.5) * 0.2, u.x * sp + (rnd() - 0.5) * 0.9, u.y * sp + rnd() * 0.6, u.z * sp + (rnd() - 0.5) * 0.9, 0.006 + rnd() * 0.016, SPRITZ);
      }
    }
    if (S.capOpen < 0.3) sim.spritzed = false;

    // ---------------- integrate & collide ----------------
    const mesh = dropsRef.current;
    if (!mesh) return;
    const { dummy } = tmp;
    const bx = bottle.x;
    const by = bottle.y;
    const bz = bottle.z;
    for (let i = 0; i < MAX_DROPS; i++) {
      if (!sim.alive[i]) {
        dummy.position.set(0, -100, 0);
        dummy.scale.setScalar(0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        continue;
      }
      const k = i * 3;
      const size = sim.size[i];
      const kind = sim.kind[i];
      // gentle air drag on the smallest droplets
      const drag = size < 0.012 ? 1 - 0.6 * sdt : 1;
      sim.v[k] *= drag;
      sim.v[k + 2] *= drag;
      sim.v[k + 1] -= G * sdt;
      sim.p[k] += sim.v[k] * sdt;
      sim.p[k + 1] += sim.v[k + 1] * sdt;
      sim.p[k + 2] += sim.v[k + 2] * sdt;
      sim.life[i] += sdt;

      const x = sim.p[k];
      const y = sim.p[k + 1];
      const z = sim.p[k + 2];
      const vy = sim.v[k + 1];
      let dead = sim.life[i] > 6;

      if (!dead && bottleUp) {
        const rad = Math.hypot(x - bx, z - bz);
        const ly = y - by;
        if (kind === SPLASH_IN) {
          // splash stays inside: dies on the wall, in the neck or back in the water
          if (rad > bottleInnerRadiusAt(ly) || ly > BOTTLE.neckTop || (y < S.surfaceY && vy < 0)) dead = true;
        } else if (ly > 0 && ly < BOTTLE.neckTop + 0.03) {
          if (rad < BOTTLE.mouthR) {
            if (y < S.surfaceY) {
              dead = true; // dropped into the bottle
              if (size > 0.02 && rnd() < 0.25) S.ripples.push({ x, z, s: 0.5 });
            }
          } else if (rad < bottleRadiusAt(ly) + size * 0.5) {
            dead = true; // hit the outside of the bottle: glance off it
            if (kind !== SPRAY && size > 0.01) {
              const l = rad || 1;
              const nx = (x - bx) / l;
              const nz = (z - bz) / l;
              const n = 1 + Math.floor(rnd() * 2);
              for (let s = 0; s < n; s++) {
                const out = 0.4 + rnd() * 0.8;
                spawn(x + nx * 0.01, y, z + nz * 0.01, nx * out + (rnd() - 0.5) * 0.3, Math.abs(vy) * (0.08 + rnd() * 0.15), nz * out + (rnd() - 0.5) * 0.3, size * (0.4 + rnd() * 0.4), SPRAY);
              }
            }
          }
        }
      }
      if (!dead && y < FLOOR_Y + size * 0.3) {
        dead = true;
        if (kind === SPRAY) {
          if (size > 0.01 && rnd() < 0.4) S.floorRipples.push({ x, z, amp: 0.15 });
        } else if (kind !== SPLASH_IN) {
          hitFloor(S, x, z, size, vy);
        }
      }
      if (dead) {
        sim.alive[i] = 0;
        dummy.scale.setScalar(0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        continue;
      }

      // orient along velocity and wobble like a real drop settling after pinch-off:
      // prolate <-> oblate, decaying (surface tension), barely stretched by speed
      tmp.dir.set(sim.v[k], vy, sim.v[k + 2]);
      const speed = tmp.dir.length();
      if (speed > 1e-4) dummy.quaternion.setFromUnitVectors(UP, tmp.dir.multiplyScalar(1 / speed));
      const wob = Math.sin(sim.phase[i] + sim.life[i] * 30) * 0.26 * Math.exp(-sim.life[i] * 2.2);
      const stretch = 1 + Math.min(speed * 0.01, 0.1);
      dummy.position.set(x, y, z);
      dummy.scale.set(size * (1 + wob), size * (1 - wob) * stretch, size * (1 + wob));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <mesh ref={tubeRef} geometry={tube} frustumCulled={false} visible={false}>
        <meshPhysicalMaterial {...WATER_MATERIAL} />
      </mesh>
      <instancedMesh ref={dropsRef} args={[undefined, undefined, MAX_DROPS]} frustumCulled={false}>
        <sphereGeometry args={[1, 32, 24]} />
        {/* a touch of dispersion: faint prism fringes on the rims of each drop */}
        <meshPhysicalMaterial {...WATER_MATERIAL} thickness={0.16} dispersion={0.9} />
      </instancedMesh>
    </group>
  );
}
