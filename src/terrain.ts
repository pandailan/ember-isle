/* Terrain elevation as game data: a deterministic heightfield shared by the
   renderer (the ground you see) and the rules (the ground that matters).
   Pure math over MAPS — no three.js, safe for the main bundle. */

import { MAPS } from "./data";
import { biomeFor } from "./biomes";

/** The one cell hash: seeds props, wilds, elevation, and landmark rolls.
    Renderer and rules must agree on it, so it lives here alone. */
export const cellHash = (x: number, y: number) => ((x * 7349 + y * 9151 + x * y * 41) >>> 0);
const latt = (ix: number, iz: number) => ((cellHash(ix + 101, iz + 57) >>> 3) % 997) / 997;
const smoothT = (t: number) => t * t * (3 - 2 * t);
function vnoise(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const sx = smoothT(x - ix), sz = smoothT(z - iz);
  const a = latt(ix, iz), b = latt(ix + 1, iz), c = latt(ix, iz + 1), d = latt(ix + 1, iz + 1);
  const top = a + (b - a) * sx, bot = c + (d - c) * sx;
  return top + (bot - top) * sz;
}

const ELEV_AMP: Record<string, number> = {harbor: 0.06, moor: 0.55, cove: 0.36};

interface Grid { w: number; h: number; c: Float32Array; }
const grids: Record<number, Grid | null | undefined> = {};

function gridFor(level: number): Grid | null {
  if (grids[level] !== undefined) return grids[level] ?? null;
  const biome = biomeFor(level);
  const amp = biome.sky ? ELEV_AMP[biome.id] ?? 0 : 0;
  const map = MAPS[level];
  if (!amp || !map) { grids[level] = null; return null; }
  const mw = map[0].length, mh = map.length;
  const w = mw + 1, h = mh + 1;
  const c = new Float32Array(w * h);
  const isWater = (x: number, y: number) => (map[y]?.[x] ?? "~") === "~";
  for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) {
    let wet = false, near = false;
    for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) {
      if (isWater(cx + dx, cy + dy)) wet = true;
    }
    for (let dy = -2; dy <= 1; dy++) for (let dx = -2; dx <= 1; dx++) {
      if (isWater(cx + dx, cy + dy)) near = true;
    }
    c[cy * w + cx] = wet ? 0 : vnoise(cx * 0.42, cy * 0.42) * amp * (near ? 0.35 : 1);
  }
  grids[level] = {w, h, c};
  return grids[level]!;
}

export function hasElevation(level: number): boolean { return gridFor(level) !== null; }

/** Ground height at any world point; matches the displaced floor mesh exactly. */
export function groundLevelAt(level: number, wx: number, wz: number): number {
  const g = gridFor(level);
  if (!g) return 0;
  const x = Math.min(Math.max(wx, 0), g.w - 1.001);
  const z = Math.min(Math.max(wz, 0), g.h - 1.001);
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const i = iz * g.w + ix;
  const a = g.c[i], b = g.c[i + 1], c2 = g.c[i + g.w], d = g.c[i + g.w + 1];
  const top = a + (b - a) * fx, bot = c2 + (d - c2) * fx;
  return top + (bot - top) * fz;
}

/** How far the eye carries from this cell: rises widen the map's reveal. */
export function visionRadius(level: number, x: number, y: number): number {
  if (!hasElevation(level)) return 0;
  const h0 = groundLevelAt(level, x + 0.5, y + 0.5);
  return h0 > 0.44 ? 3 : h0 > 0.27 ? 2 : 1;
}

/* ---------- landmarks as game data ---------- */
/** Prop ids that count as visitable landmarks (must exist in ASSETS). */
const LANDMARKS = new Set(["watchtower", "stoneCircle", "barrow", "wreck", "ruin"]);

/** Which landmark stands on this floor cell, replaying the renderer's
    first-match placement rules — or null for plain ground. */
export function landmarkAt(level: number, x: number, y: number): string | null {
  const m = MAPS[level];
  if (!m || m[y]?.[x] !== ".") return null;
  const h = cellHash(x, y);
  for (const place of biomeFor(level).floorProps) {
    if (h % place.mod !== place.rem) continue;
    return LANDMARKS.has(place.id) ? place.id : null;
  }
  return null;
}
