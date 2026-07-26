/* Carrying: how much a card can bear, and where loot goes when it drops.
   Weight comes from equipment and pack items; capacity from STR, CON, and
   the backpack's frame. Kept free of card/trait imports so anyone may use it. */

import type { Member } from "./types";
import { ITEMS, PACKS } from "./data";

export const weaponW = (m: Member): number => 2 + m.wTier;
export const armorW = (m: Member): number => 3 + m.aTier * 2;

/** What the body can bear: strength pulls, constitution endures, the pack helps. */
export const carryMax = (m: Member): number =>
  Math.round((10 + m.str * 3 + m.con * 2) * PACKS[m.pack].mult);
export const carryW = (m: Member): number =>
  weaponW(m) + armorW(m) + m.items.reduce((a, id) => a + (ITEMS[id]?.w ?? 0), 0);
export const packUsed = (m: Member): number =>
  m.items.reduce((a, id) => a + (ITEMS[id]?.size ?? 0), 0);
export const packFree = (m: Member): number => PACKS[m.pack].slots - packUsed(m);
export const overloaded = (m: Member): boolean => carryW(m) > carryMax(m);

/** Who in the party can take this item home? Prefers the lightest-laden back. */
export function findCarrier(party: Member[], itemId: string): Member | null {
  const it = ITEMS[itemId];
  if (!it) return null;
  const able = party.filter(m => !m.down && packFree(m) >= it.size && carryW(m) + it.w <= carryMax(m));
  if (!able.length) return null;
  return able.sort((a, b) => (carryW(a) / carryMax(a)) - (carryW(b) / carryMax(b)))[0];
}
