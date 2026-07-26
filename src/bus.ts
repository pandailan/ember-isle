import type { EnemyInst } from "./types";

/** Cross-screen actions, assigned once at boot (main.ts). Modules call through
    this registry instead of importing each other, keeping the graph acyclic. */
export interface AppBus {
  openTown(msg?: string): void;
  openTavern(msg?: string): void;
  openDraft(): void;
  openTrade(): void;
  enterDungeon(fresh: boolean): void;
  startCombat(groupKeys: string[], isBoss: boolean): void;
  backToDungeon(msg: string | null): void;
  showEnding(): void;
  // dungeon inputs relayed from a co-op guest
  turn(d: number): void;
  step(back: boolean, byGuest?: boolean): void;
  usePotionField(): void;
  /** Walking into a town door/prop cell. */
  townDoor(c: string): void;
  /** Message line in the walking view. */
  dlog(msg: string): void;
  /** Show the first-person walking view for the current level/position. */
  enterWalk(msg: string | null): void;
  /** Live combat view for co-op snapshots; null outside combat. */
  combatSnapshot(): {enemies: EnemyInst[]; log: string[]; title: string} | null;
  /** Outcome hooks so the dungeon can settle the engaged mob. */
  combatWon(): void;
  combatFled(): void;
  /** Host migration: rebuild a synced fight locally and carry on. */
  adoptCombat(enemies: EnemyInst[]): void;
}

export const app = {} as AppBus;
