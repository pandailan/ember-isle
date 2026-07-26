import type { GameState, Member, Dir } from "./types";
import { MAPS, ABONUS, SAVE_KEY, ENC_GRACE } from "./data";
import { visionRadius } from "./terrain";
import { migrateState, cleanupLend, spawnMobs } from "./cards";
import { worldCtx } from "./traits";
import type { Mob } from "./types";

export let state: GameState = null as unknown as GameState;
export function setState(s: GameState): void {
  state = s;
  if (s.vault) MAPS[5] = s.vault.map; // a vault in progress must exist for cellAt/render
}

export function newState(party: Member[]): GameState {
  return {version: 2, party, collection: [], visitors: [], visitorsDay: "",
          gold: 80, potions: 2, level: 0, x: 7, y: 5, dir: 0 as Dir,
          mobs: {1: spawnMobs(1), 2: spawnMobs(2), 3: spawnMobs(3), 4: spawnMobs(4)},
          opened: [], visited: {0: ["7,5"], 1: ["1,1"], 2: [], 3: [], 4: [], 5: []}, bossDown: false, heart: false,
          binder: [],
          steps: 0, kills: 0, graceLeft: ENC_GRACE, inDungeon: false,
          clock: 1230, weather: "clear", weatherLeft: 70}; // the story starts at half past eight, under stars
}

export function mobAt(lvl: number, x: number, y: number): Mob | null {
  return state.mobs?.[lvl]?.find(m => m.x === x && m.y === y) ?? null;
}

export const defOf = (m: Member) => m.def + ABONUS[m.aTier] + (state.charm ? 2 : 0)
  + (m.relic?.key === "stormglass" && worldCtx.wet ? 2 : 0);
export const alive = () => state.party.filter(m => !m.down);
export const allCards = () => [...state.party, ...state.collection];
export const xpNeed = (l: number) => l * l * 45;

let saveEnabled = true;
/** Guests mirror the host's state and must never clobber their own local save. */
export function setSaveEnabled(b: boolean): void { saveEnabled = b; }
export function isSaveEnabled(): boolean { return saveEnabled; }

export function save(): void {
  if (!saveEnabled) return;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch { /* private mode */ }
}
export function loadSave(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = migrateState(JSON.parse(raw));
    cleanupLend(s); // a loan that survived a reload belongs to a dead session
    return s;
  } catch { return null; }
}

/** Map cell with dynamic overlays: looted chests and the slain boss read as floor. */
export function cellAt(lvl: number, x: number, y: number): string {
  const m = MAPS[lvl];
  if (y < 0 || y >= m.length || x < 0 || x >= m[0].length) return "#";
  const c = m[y][x];
  if (c === "C" && state.opened.includes(lvl + ":" + x + "," + y)) return ".";
  if (c === "B" && state.bossDown) return ".";
  return c;
}

/** Reveal the cell underfoot — and, from high ground outdoors, the land around it. */
export function markVisited(): void {
  const arr = (state.visited[state.level] ??= []);
  const m = MAPS[state.level];
  const r = Math.max(1, visionRadius(state.level, state.x, state.y)) - 1;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const x = state.x + dx, y = state.y + dy;
    if (y < 0 || y >= m.length || x < 0 || x >= m[0].length) continue;
    const k = x + "," + y;
    if (!arr.includes(k)) arr.push(k);
  }
}
