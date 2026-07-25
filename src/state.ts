import type { GameState, Member, Dir } from "./types";
import { MAPS, ABONUS, SAVE_KEY, ENC_GRACE } from "./data";
import { migrateState } from "./cards";

export let state: GameState = null as unknown as GameState;
export function setState(s: GameState): void { state = s; }

export function newState(party: Member[]): GameState {
  return {version: 2, party, collection: [], visitors: [], visitorsDay: "",
          gold: 80, potions: 2, level: 1, x: 1, y: 1, dir: 1 as Dir,
          opened: [], visited: {1: ["1,1"], 2: []}, bossDown: false, heart: false,
          steps: 0, kills: 0, graceLeft: ENC_GRACE, inDungeon: false};
}

export const defOf = (m: Member) => m.def + ABONUS[m.aTier] + (state.charm ? 2 : 0);
export const alive = () => state.party.filter(m => !m.down);
export const allCards = () => [...state.party, ...state.collection];
export const xpNeed = (l: number) => l * l * 45;

let saveEnabled = true;
/** Guests mirror the host's state and must never clobber their own local save. */
export function setSaveEnabled(b: boolean): void { saveEnabled = b; }

export function save(): void {
  if (!saveEnabled) return;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch { /* private mode */ }
}
export function loadSave(): GameState | null {
  try {
    const s = localStorage.getItem(SAVE_KEY);
    return s ? migrateState(JSON.parse(s)) : null;
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

export function markVisited(): void {
  const k = state.x + "," + state.y;
  if (!state.visited[state.level].includes(k)) state.visited[state.level].push(k);
}
