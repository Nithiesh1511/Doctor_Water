import * as THREE from 'three';

/*
 * Silhouettes for the two vessels, as [radius, y] pairs revolved with LatheGeometry.
 *  - CAN:    the 20 L Doctor's Water can (clear blue PET, two grip-rib bands, blue cap).
 *            Unscaled units, origin at the centre of the can.
 *  - BOTTLE: the PET drinking-water bottle it fills. Base at y = 0.
 */

const bump = (x) => Math.pow(Math.sin(Math.PI * x), 2);
const gauss = (x, c, w) => Math.exp(-(((x - c) / w) ** 2));

// Linear lookup of radius at height y on an ascending-y wall.
function lookup(wall, y) {
  if (y <= wall[0][1]) return wall[0][0];
  for (let i = 1; i < wall.length; i++) {
    const [r1, y1] = wall[i];
    if (y <= y1) {
      const [r0, y0] = wall[i - 1];
      return r0 + ((r1 - r0) * (y - y0)) / Math.max(y1 - y0, 1e-6);
    }
  }
  return wall[wall.length - 1][0];
}

function ribs(y, from, to, count, amp) {
  if (y < from || y > to) return 0;
  const k = ((y - from) / (to - from)) * count;
  return amp * bump(k - Math.floor(k));
}

/* ------------------------------------------------------------------ 20 L can */

function buildCanWall() {
  const w = [];
  // rounded heel of the base
  for (let i = 0; i <= 8; i++) {
    const a = -Math.PI / 2 + (i / 8) * (Math.PI / 2);
    w.push([0.86 + 0.14 * Math.cos(a), -1.31 + 0.14 * Math.sin(a)]);
  }
  // straight wall with the two grip-rib bands of a 20 L can
  for (let y = -1.29; y <= 0.8; y += 0.015) {
    let r = 1.0;
    r += ribs(y, -1.08, -0.56, 4, 0.034);
    r += ribs(y, 0.24, 0.76, 4, 0.034);
    r -= 0.012 * (gauss(y, -0.5, 0.018) + gauss(y, 0.18, 0.018)); // label-panel seams
    w.push([r, y]);
  }
  // domed shoulder into the neck
  for (let i = 1; i <= 16; i++) {
    const a = (i / 16) * (Math.PI / 2);
    w.push([0.33 + 0.67 * Math.pow(Math.cos(a), 0.85), 0.8 + 0.58 * Math.pow(Math.sin(a), 1.15)]);
  }
  // neck, support ring and finish
  w.push([0.31, 1.42], [0.3, 1.49], [0.4, 1.5], [0.41, 1.525], [0.4, 1.55], [0.3, 1.56], [0.3, 1.66], [0.285, 1.685]);
  return w;
}

export const CAN_WALL = buildCanWall();

export const CAN = {
  bodyR: 1.0,
  innerR: 0.955,
  baseY: -1.45,
  waterBase: -1.33,
  shoulderY: 0.8,
  neckTop: 1.69,
  mouthR: 0.25,
  lipR: 0.27,
};

export function canLathePoints() {
  const pts = [[0, -1.37], [0.35, -1.39], [0.7, -1.44], ...CAN_WALL, [0.26, 1.69], [0.24, 1.675]];
  return pts.map(([r, y]) => new THREE.Vector2(r, y));
}

export const canRadiusAt = (y) => lookup(CAN_WALL, y);
// interior radius; the neck bore is a plain tube (the support ring is solid plastic)
const canInnerAt = (y) => (y > 1.4 ? 0.27 : canRadiusAt(y) * 0.955 - 0.008);

// Closed inner volume of the can (for the water inside).
export function canWaterPoints() {
  const pts = [[0, CAN.waterBase]];
  const top = 1.62;
  const n = 90;
  for (let i = 0; i <= n; i++) {
    const y = CAN.waterBase + ((top - CAN.waterBase) * i) / n;
    pts.push([Math.max(0.01, canInnerAt(y)), y]);
  }
  pts.push([0, top]);
  return pts.map(([r, y]) => new THREE.Vector2(r, y));
}

// Slices of the can interior for the tilted-water solver: [localY, radius] (unscaled).
export const CAN_SLICES = (() => {
  const out = [];
  const n = 64;
  const top = 1.62;
  const dy = (top - CAN.waterBase) / n;
  for (let i = 0; i < n; i++) {
    const y = CAN.waterBase + (i + 0.5) * dy;
    out.push([y, canInnerAt(y)]);
  }
  return out;
})();

const segArea = (u) => (Math.PI - Math.acos(u) + u * Math.sqrt(1 - u * u)) / Math.PI;

/**
 * World-space height of a level water surface inside a tilted container.
 * `slices` are [axialY, radius] in world units, `cy` is the container origin's world height,
 * `ay` the world-y component of its axis. Returns { level, min, max }.
 */
export function tiltedLevel(slices, cy, ay, fraction) {
  const s = Math.sqrt(Math.max(0, 1 - ay * ay));
  let total = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (const [y, r] of slices) {
    total += r * r;
    const h = cy + ay * y;
    lo = Math.min(lo, h - r * s);
    hi = Math.max(hi, h + r * s);
  }
  const target = total * THREE.MathUtils.clamp(fraction, 0, 1);
  let a = lo;
  let b = hi;
  for (let it = 0; it < 28; it++) {
    const L = (a + b) / 2;
    let v = 0;
    for (const [y, r] of slices) {
      const e = r * s;
      const d = L - (cy + ay * y);
      const u = e < 1e-5 ? (d > 0 ? 1 : -1) : THREE.MathUtils.clamp(d / e, -1, 1);
      v += r * r * segArea(u);
    }
    if (v < target) a = L;
    else b = L;
  }
  return { level: (a + b) / 2, min: lo, max: hi };
}

/* ------------------------------------------------------------------ PET bottle */

function buildBottleWall() {
  const w = [];
  for (let i = 0; i <= 6; i++) {
    const a = -Math.PI / 2 + (i / 6) * (Math.PI / 2);
    w.push([0.43 + 0.07 * Math.cos(a), 0.1 + 0.07 * Math.sin(a)]);
  }
  for (let y = 0.11; y <= 1.95; y += 0.012) {
    let r = 0.5;
    r -= ribs(y, 0.32, 0.84, 4, 0.024); // grip rings
    r -= ribs(y, 1.6, 1.9, 2, 0.018);
    r -= 0.006 * THREE.MathUtils.smoothstep(y, 0.9, 0.93) * (1 - THREE.MathUtils.smoothstep(y, 1.52, 1.55)); // label panel
    w.push([r, y]);
  }
  for (let i = 1; i <= 16; i++) {
    const a = (i / 16) * (Math.PI / 2);
    w.push([0.165 + 0.335 * Math.pow(Math.cos(a), 1.25), 1.95 + 0.42 * Math.sin(a)]);
  }
  w.push([0.165, 2.44], [0.215, 2.45], [0.222, 2.475], [0.215, 2.5], [0.16, 2.505], [0.16, 2.66], [0.15, 2.68]);
  return w;
}

export const BOTTLE_WALL = buildBottleWall();

export const BOTTLE = {
  bodyR: 0.5,
  waterBase: 0.07,
  shoulderY: 1.95,
  neckTop: 2.68,
  mouthR: 0.13,
  capTop: 2.74,
  labelY: 1.22,
  labelH: 0.56,
};

export function bottleLathePoints() {
  const pts = [[0, 0.06], [0.2, 0.02], [0.36, 0.0], ...BOTTLE_WALL, [0.13, 2.68], [0.125, 2.66]];
  return pts.map(([r, y]) => new THREE.Vector2(r, y));
}

export const bottleRadiusAt = (y) => lookup(BOTTLE_WALL, y);
export const bottleInnerRadiusAt = (y) => (y > 2.43 ? 0.145 : Math.max(0.02, bottleRadiusAt(y) - 0.014));

export function bottleWaterPoints() {
  const pts = [[0, BOTTLE.waterBase]];
  const top = 2.62;
  const n = 110;
  for (let i = 0; i <= n; i++) {
    const y = BOTTLE.waterBase + ((top - BOTTLE.waterBase) * i) / n;
    pts.push([bottleInnerRadiusAt(y), y]);
  }
  pts.push([0, top]);
  return pts.map(([r, y]) => new THREE.Vector2(r, y));
}

// Volume-true fill: fraction of the bottle's capacity -> local water height.
// The level creeps up the wide body and races up the narrow neck, like a real fill.
const BOTTLE_VOL = (() => {
  const n = 220;
  const top = 2.62;
  const ys = [];
  const vs = [0];
  const dy = (top - BOTTLE.waterBase) / n;
  for (let i = 0; i <= n; i++) ys.push(BOTTLE.waterBase + i * dy);
  for (let i = 0; i < n; i++) {
    const r = bottleInnerRadiusAt(ys[i] + dy / 2);
    vs.push(vs[i] + r * r * dy);
  }
  return { ys, vs, total: vs[n] };
})();

export function bottleLevel(fraction) {
  const target = THREE.MathUtils.clamp(fraction, 0, 1) * BOTTLE_VOL.total;
  const { ys, vs } = BOTTLE_VOL;
  let i = 1;
  while (i < vs.length - 1 && vs[i] < target) i++;
  const k = (target - vs[i - 1]) / Math.max(vs[i] - vs[i - 1], 1e-9);
  return ys[i - 1] + (ys[i] - ys[i - 1]) * k;
}
