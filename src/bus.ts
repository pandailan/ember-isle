import type { EnemyInst } from "./types";

/** Cross-screen actions, assigned once at boot (main.ts). Modules call through
    this registry instead of importing each other, keeping the graph acyclic. */
export interface AppBus {
  openTown(msg?: string): void;
  openTavern(msg?: string): void;
  openDraft(): void;
  enterDungeon(fresh: boolean): void;
  startCombat(groupKeys: string[], isBoss: boolean): void;
  backToDungeon(msg: string | null): void;
  showEnding(): void;
  // dungeon inputs relayed from a co-op guest
  turn(d: number): void;
  step(back: boolean): void;
  usePotionField(): void;
  /** Live combat view for co-op snapshots; null outside combat. */
  combatSnapshot(): {enemies: EnemyInst[]; log: string[]; title: string} | null;
}

export const app = {} as AppBus;
