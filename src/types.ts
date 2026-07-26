export type Dir = 0 | 1 | 2 | 3;

/** 0 common · 1 seasoned · 2 renowned · 3 legendary */
export type Rarity = 0 | 1 | 2 | 3;

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
  d?: (m: Member) => number;
  txt: string; holy?: boolean;
  /** physical art: damage derives from the user's weapon, not d() */
  phys?: boolean; hits?: number; mult?: number; critBonus?: number;
}

export interface EnemyDef {
  n: string; hp: number; atk: number; def: number; spd: number;
  xp: number; g: number; hue: string;
  undead?: boolean; pierce?: boolean; caster?: boolean; boss?: boolean;
  /** Trophy this creature may leave behind: [item id, chance 0..1]. */
  drop?: [string, number];
}

export interface EnemyInst extends EnemyDef { maxhp: number; key: string; }

/** A character card — the unit of collection, party play, and (later) trading. */
export interface Member {
  id: string;
  name: string; cls: string;
  rarity: Rarity;
  traits: string[];   // trait ids, rolled at creation
  skills: string[];   // purchased skill-tree node ids
  sp: number;         // unspent skill points
  lvl: number; xp: number;
  hp: number; maxhp: number; mp: number; maxmp: number;
  atk: number; def: number; spd: number;
  /** Body: strength and constitution set what a card can carry. */
  str: number; con: number;
  relic?: TCard;      // worn relic card (travels with the character when traded)
  ap: number;         // unspent attribute points (+1 per level)
  pack: number;       // backpack tier (index into PACKS)
  items: string[];    // carried item ids (ITEMS)
  wTier: number; aTier: number; down: boolean;
  guard?: boolean;
}

export interface ChestLoot { gold?: number; potions?: number; charm?: boolean; note?: string; items?: string[]; cards?: [CardKind, string][]; }

/** A monster pack living on the map — visible in the corridor, chases the party. */
export interface Mob { x: number; y: number; key: string; group: string[]; }

export type Weather = "clear" | "mist" | "rain" | "storm";

/* ============================== TRADEABLE CARDS ============================== */
/** Beyond characters, relics and one-shot events are cards too — all trade. */
export type CardKind = "relic" | "event";
export interface TCard { id: string; kind: CardKind; key: string; rarity: Rarity; }
export type AnyCard = Member | TCard;

export interface GameState {
  version: number;
  party: Member[];        // the marching four
  collection: Member[];   // benched cards
  visitors: Member[];     // tonight's recruitable cards at the tavern
  visitorsDay: string;    // date stamp of the current visitor roll
  gold: number; potions: number;
  level: number; x: number; y: number; dir: Dir;
  mobs: Record<number, Mob[]>;
  opened: string[]; visited: Record<number, string[]>;
  bossDown: boolean; heart: boolean;
  steps: number; kills: number; graceLeft: number;
  inDungeon: boolean; charm?: boolean;
  /** World clock in minutes (0..1439) and the weather front passing over the isle. */
  clock: number; weather: Weather; weatherLeft: number;
  /** The card binder: relics and event cards the expedition holds. */
  binder: TCard[];
  /** Outdoor map layout version, so saves survive redesigns of the wilds. */
  mapsV?: number;
  /** A vault opened by a Torn Map Page: its generated map and the way home. */
  vault?: {map: string[]; ret: {level: number; x: number; y: number; dir: Dir}};
  /** Co-op lending bookkeeping (host side): guest-owned card ids currently in
      the party, the host cards they displaced, and gold owed to the guest. */
  coopGuestIds?: string[];
  coopDisplacedIds?: string[];
  guestGoldOwed?: number;
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

export interface TraitDef { n: string; desc: string; }

export type SkillFlag =
  | "defendMaster" // Defend blocks 75% instead of 50%
  | "healPlus"     // healing dealt +25%
  | "goldPlus"     // party battle gold +15%
  | "spellPower"   // non-physical spell damage/healing +20%
  | "spellThrift"  // spells cost 1 less MP (min 1)
  | "dodge"        // 12% chance to evade physical blows
  | "fleePlus"     // +15% flee chance
  | "potionPlus";  // party potions restore +10

export interface SkillNode {
  n: string; desc: string;
  branch: string; tier: 0 | 1 | 2;
  stat?: Partial<{ hp: number; mp: number; atk: number; def: number; spd: number }>;
  crit?: number;
  spell?: string;
  flag?: SkillFlag;
}
