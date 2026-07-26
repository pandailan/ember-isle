import type { Member, TraitDef, SkillNode, SkillFlag, SpellDef } from "./types";
import { CLASSES, WBONUS } from "./data";
import { overloaded } from "./items";

/** What the world is doing right now — set by the dungeon so relics can care. */
export const worldCtx = {night: true, wet: false};
const relicIs = (m: Member, k: string) => m.relic?.key === k;

/* ============================== TRAITS ============================== */
/* Rolled onto cards at creation; every trait has a real mechanical hook. */
export const TRAITS: Record<string, TraitDef> = {
  torchblood: {n:"Torchblood",    desc:"+2 SPD while below half health"},
  stoneskin:  {n:"Stoneskin",     desc:"Every blow deals 1 less damage"},
  bloodletter:{n:"Bloodletter",   desc:"+12% critical chance"},
  emberward:  {n:"Emberward",     desc:"Flame deals a quarter less to them"},
  lightfoot:  {n:"Lightfoot",     desc:"+1 SPD, and escapes come easier"},
  scavenger:  {n:"Scavenger",     desc:"Party battle gold +15%"},
  blessed:    {n:"Blessed",       desc:"Healing received +25%"},
  grim:       {n:"Grim",          desc:"+2 ATK, but -1 SPD"},
  vigorous:   {n:"Vigorous",      desc:"+12% maximum health"},
  arcane:     {n:"Arcane Vessel", desc:"+20% maximum mana"},
};

/* ============================== SKILL TREES ============================== */
/* Two branches of three tiers per class; a node needs the previous tier of
   its branch. One skill point per node; points arrive on even levels. */
export const SKILL_TREES: Record<string, Record<string, SkillNode>> = {
  Knight: {
    kn_b0:{n:"Shield Drill", desc:"+3 DEF",                          branch:"Bulwark", tier:0, stat:{def:3}},
    kn_b1:{n:"Iron Blood",   desc:"+10 max HP",                      branch:"Bulwark", tier:1, stat:{hp:10}},
    kn_b2:{n:"Living Wall",  desc:"Defend blocks 75% of harm",       branch:"Bulwark", tier:2, flag:"defendMaster"},
    kn_w0:{n:"Heft",         desc:"+2 ATK",                          branch:"Warlord", tier:0, stat:{atk:2}},
    kn_w1:{n:"Cleave",       desc:"Art: strike every foe at once",   branch:"Warlord", tier:1, spell:"cleave"},
    kn_w2:{n:"Red Edge",     desc:"+10% critical chance",            branch:"Warlord", tier:2, crit:0.10},
  },
  Paladin: {
    pa_t0:{n:"Grace",        desc:"Healing dealt +25%",              branch:"Tide", tier:0, flag:"healPlus"},
    pa_t1:{n:"Deep Breath",  desc:"+8 max HP",                       branch:"Tide", tier:1, stat:{hp:8}},
    pa_t2:{n:"Litany",       desc:"Spell: Prayer (mend the party)",  branch:"Tide", tier:2, spell:"prayer"},
    pa_z0:{n:"Zeal",         desc:"+2 ATK",                          branch:"Oath", tier:0, stat:{atk:2}},
    pa_z1:{n:"Consecration", desc:"Spells 20% stronger",             branch:"Oath", tier:1, flag:"spellPower"},
    pa_z2:{n:"Aegis",        desc:"+3 DEF",                          branch:"Oath", tier:2, stat:{def:3}},
  },
  Ranger: {
    ra_h0:{n:"Deadeye",      desc:"+10% critical chance",            branch:"Hunt",   tier:0, crit:0.10},
    ra_h1:{n:"Double Shot",  desc:"Art: two arrows, one breath",     branch:"Hunt",   tier:1, spell:"dshot"},
    ra_h2:{n:"Heartseeker",  desc:"+2 ATK",                          branch:"Hunt",   tier:2, stat:{atk:2}},
    ra_w0:{n:"Fleet",        desc:"+2 SPD",                          branch:"Warden", tier:0, stat:{spd:2}},
    ra_w1:{n:"Pathfinder",   desc:"Escapes 15% likelier",            branch:"Warden", tier:1, flag:"fleePlus"},
    ra_w2:{n:"Thick Cloak",  desc:"+3 DEF",                          branch:"Warden", tier:2, stat:{def:3}},
  },
  Rogue: {
    ro_s0:{n:"Softstep",     desc:"+2 SPD",                          branch:"Shadow",   tier:0, stat:{spd:2}},
    ro_s1:{n:"Backstab",     desc:"Art: a blade where it hurts",     branch:"Shadow",   tier:1, spell:"bstab"},
    ro_s2:{n:"Opportunist",  desc:"+15% critical chance",            branch:"Shadow",   tier:2, crit:0.15},
    ro_c0:{n:"Sticky Palms", desc:"Party battle gold +15%",          branch:"Cutpurse", tier:0, flag:"goldPlus"},
    ro_c1:{n:"Field Medic",  desc:"Party potions restore +10",       branch:"Cutpurse", tier:1, flag:"potionPlus"},
    ro_c2:{n:"Untouchable",  desc:"12% chance to evade blows",       branch:"Cutpurse", tier:2, flag:"dodge"},
  },
  Cleric: {
    cl_m0:{n:"Kind Hands",   desc:"Healing dealt +25%",              branch:"Mercy", tier:0, flag:"healPlus"},
    cl_m1:{n:"Reservoir",    desc:"+6 max MP",                       branch:"Mercy", tier:1, stat:{mp:6}},
    cl_m2:{n:"Last Word",    desc:"Spell: Revive, learned early",    branch:"Mercy", tier:2, spell:"revive"},
    cl_w0:{n:"Cudgel Sense", desc:"+2 ATK",                          branch:"Wrath", tier:0, stat:{atk:2}},
    cl_w1:{n:"Smite",        desc:"Spell: holy fire for the dead",   branch:"Wrath", tier:1, spell:"smite"},
    cl_w2:{n:"Fervor",       desc:"Spells 20% stronger",             branch:"Wrath", tier:2, flag:"spellPower"},
  },
  Sorcerer: {
    so_p0:{n:"Kindling",     desc:"Spells 20% stronger",             branch:"Pyromancy", tier:0, flag:"spellPower"},
    so_p1:{n:"Flame Wave",   desc:"Spell: fire that fills the room", branch:"Pyromancy", tier:1, spell:"wave"},
    so_p2:{n:"Cinder Storm", desc:"Spell: the Ember's own wrath",    branch:"Pyromancy", tier:2, spell:"storm"},
    so_d0:{n:"Deep Well",    desc:"+8 max MP",                       branch:"Deepmind",  tier:0, stat:{mp:8}},
    so_d1:{n:"Frugal Weave", desc:"Spells cost 1 less MP",           branch:"Deepmind",  tier:1, flag:"spellThrift"},
    so_d2:{n:"Warded Robes", desc:"+3 DEF",                          branch:"Deepmind",  tier:2, stat:{def:3}},
  },
};

const NODE_BY_ID: Record<string, SkillNode> = {};
for (const tree of Object.values(SKILL_TREES))
  for (const [id, node] of Object.entries(tree)) NODE_BY_ID[id] = node;

export function nodeById(id: string): SkillNode | undefined { return NODE_BY_ID[id]; }

/* ============================== DERIVED STATS & HOOKS ============================== */
export const hasTrait = (m: Member, k: string) => m.traits.includes(k);
export const hasFlag = (m: Member, f: SkillFlag) =>
  m.skills.some(id => NODE_BY_ID[id]?.flag === f);
export const partyHasFlag = (party: Member[], f: SkillFlag) =>
  party.some(m => !m.down && hasFlag(m, f));

export const atkOf = (m: Member) => m.atk + WBONUS[m.wTier];

export function critOf(m: Member): number {
  let c = CLASSES[m.cls].crit ?? 0.08;
  if (hasTrait(m, "bloodletter")) c += 0.12;
  for (const id of m.skills) c += NODE_BY_ID[id]?.crit ?? 0;
  return c;
}

export function spdOf(m: Member): number {
  const base = m.spd + (hasTrait(m, "torchblood") && m.hp < m.maxhp / 2 ? 2 : 0)
    + (relicIs(m, "wolfsbane") && worldCtx.night ? 2 : 0);
  return overloaded(m) ? Math.max(1, Math.round(base * 0.75)) : base; // a heavy pack drags
}

/** Damage arriving at a card, after guard, stoneskin and fire wards. */
export function mitigate(m: Member, dmg: number, fire = false): number {
  if (fire && hasTrait(m, "emberward")) dmg = Math.round(dmg * 0.75);
  if (m.guard) dmg = hasFlag(m, "defendMaster") ? Math.ceil(dmg / 4) : Math.ceil(dmg / 2);
  if (hasTrait(m, "stoneskin")) dmg -= 1;
  return Math.max(1, dmg);
}

/** Healing amount from caster to target, with both sides' bonuses. */
export function healAmount(base: number, caster: Member, target: Member): number {
  let h = base;
  if (hasFlag(caster, "healPlus")) h *= 1.25;
  if (hasFlag(caster, "spellPower")) h *= 1.2;
  if (hasTrait(target, "blessed")) h *= 1.25;
  return Math.round(h);
}

export function spellPower(m: Member, base: number): number {
  return Math.round(base * (hasFlag(m, "spellPower") ? 1.2 : 1) * (relicIs(m, "emberheart") ? 1.15 : 1));
}

export function spellCost(m: Member, def: SpellDef): number {
  if (def.mp === 0) return 0;
  return Math.max(1, def.mp - (hasFlag(m, "spellThrift") ? 1 : 0));
}

export function fleeBonus(m: Member): number {
  return (hasTrait(m, "lightfoot") ? 0.10 : 0) + (hasFlag(m, "fleePlus") ? 0.15 : 0)
    + (relicIs(m, "gullfeather") ? 0.25 : 0);
}

export function goldMult(party: Member[]): number {
  let g = 1;
  if (party.some(m => !m.down && hasTrait(m, "scavenger"))) g += 0.15;
  if (partyHasFlag(party, "goldPlus")) g += 0.15;
  return g;
}

export function potionHeal(party: Member[]): number {
  return 35 + (partyHasFlag(party, "potionPlus") ? 10 : 0);
}

/** All spells and arts a card can use right now. */
export function spellsOf(m: Member): string[] {
  const fromClass = CLASSES[m.cls].spells.filter(([, l]) => m.lvl >= l).map(([s]) => s);
  const fromSkills = m.skills.map(id => NODE_BY_ID[id]?.spell).filter((s): s is string => !!s);
  return [...new Set([...fromClass, ...fromSkills])];
}

/** Spend a skill point on a node. Returns an error message, or null on success. */
export function buySkill(m: Member, nodeId: string): string | null {
  const tree = SKILL_TREES[m.cls];
  const node = tree?.[nodeId];
  if (!node) return "That art is not taught here.";
  if (m.skills.includes(nodeId)) return "Already mastered.";
  if (m.sp <= 0) return "No skill points to spend.";
  if (node.tier > 0) {
    const prereq = Object.entries(tree).find(([, n]) => n.branch === node.branch && n.tier === node.tier - 1);
    if (prereq && !m.skills.includes(prereq[0])) return `Requires ${prereq[1].n} first.`;
  }
  m.sp--; m.skills.push(nodeId);
  if (node.stat) {
    if (node.stat.hp) { m.maxhp += node.stat.hp; m.hp += node.stat.hp; }
    if (node.stat.mp) { m.maxmp += node.stat.mp; m.mp += node.stat.mp; }
    m.atk += node.stat.atk ?? 0; m.def += node.stat.def ?? 0; m.spd += node.stat.spd ?? 0;
  }
  return null;
}
