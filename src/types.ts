export type Dir = 0 | 1 | 2 | 3;

export interface ClassGrowth { hp: number; mp: number; atk: number; def: number; spd: number; }

export interface ClassDef {
  hp: number; mp: number; atk: number; def: number; spd: number;
  g: ClassGrowth;
  spells: [string, number][];
  crit?: number;
}

export type SpellKind = "ally" | "allies" | "fallen" | "enemy" | "enemies";

export interface SpellDef {
  n: string; mp: number; kind: SpellKind;
  d: (m: Member) => number;
  txt: string; holy?: boolean;
}

export interface RosterEntry { name: string; cls: string; blurb: string; }

export interface EnemyDef {
  n: string; hp: number; atk: number; def: number; spd: number;
  xp: number; g: number; hue: string;
  undead?: boolean; pierce?: boolean; caster?: boolean; boss?: boolean;
}

export interface EnemyInst extends EnemyDef { maxhp: number; key: string; }

export interface Member {
  name: string; cls: string; lvl: number; xp: number;
  hp: number; maxhp: number; mp: number; maxmp: number;
  atk: number; def: number; spd: number;
  wTier: number; aTier: number; down: boolean;
  guard?: boolean;
}

export interface ChestLoot { gold?: number; potions?: number; charm?: boolean; note?: string; }

export interface GameState {
  party: Member[]; gold: number; potions: number;
  level: number; x: number; y: number; dir: Dir;
  opened: string[]; visited: Record<number, string[]>;
  bossDown: boolean; heart: boolean;
  steps: number; kills: number; graceLeft: number;
  inDungeon: boolean; charm?: boolean;
}

export interface CombatState {
  enemies: EnemyInst[]; isBoss: boolean;
  log: string[]; round: number; fled: boolean;
}

export interface PlayerCmd {
  m: Member;
  act: "atk" | "cast" | "pot" | "def" | "flee";
  s?: string;
  t?: number;
}
