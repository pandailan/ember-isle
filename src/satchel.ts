/* The satchel: a wide-screen side panel showing the expedition's purse and
   the last few things it picked up, with a running tally of landmarks and
   chests. The feed lives in memory for the session; counts read straight
   from state, so re-rendering is always safe. */

import { state } from "./state";

export type LootKind = "gold" | "potion" | "card" | "item";

const GLYPH: Record<LootKind, string> = {
  gold: `<svg viewBox="0 0 10 10" width="11" height="11"><circle cx="5" cy="5" r="4" fill="#e0b24c"/><circle cx="5" cy="5" r="2.2" fill="#a3782c"/></svg>`,
  potion: `<svg viewBox="0 0 10 12" width="10" height="12"><rect x="3.4" y="0" width="3.2" height="3" fill="#8a7a52"/><path d="M3 3 h4 l1.5 3 v4.5 a1.5 1.5 0 0 1 -1.5 1.5 h-4 a1.5 1.5 0 0 1 -1.5 -1.5 v-4.5 z" fill="#c8502f"/></svg>`,
  card: `<span class="satglyph">✦</span>`,
  item: `<span class="satglyph dim">⬧</span>`,
};

const FEED_MAX = 5;
const feed: {kind: LootKind; text: string}[] = [];

/** Record a pickup in the recent-loot feed and refresh the panel. */
export function noteLoot(kind: LootKind, text: string): void {
  feed.unshift({kind, text});
  if (feed.length > FEED_MAX) feed.pop();
  renderSatchel();
}

/** A fresh expedition starts with an empty feed. */
export function clearLootFeed(): void {
  feed.length = 0;
  renderSatchel();
}

export function renderSatchel(): void {
  const host = document.getElementById("satchel");
  if (!host) return;
  const rows = feed.length
    ? feed.map(f => `<div class="satline">${GLYPH[f.kind]}<span>${f.text}</span></div>`).join("")
    : `<div class="satline dim"><span>Nothing yet — the isle owes you.</span></div>`;
  const landmarks = state.landmarks?.length ?? 0;
  const chests = state.opened?.length ?? 0;
  host.innerHTML = `
    <h3 class="sc">Satchel</h3>
    <div class="satrow">${GLYPH.gold}<b>${state.gold}</b><span class="dim">gold</span>
      ${GLYPH.potion}<b>${state.potions}</b><span class="dim">potions</span></div>
    <div class="satfeed">${rows}</div>
    <div class="sattally dim">◈ ${landmarks} landmark${landmarks === 1 ? "" : "s"} · ${chests} chest${chests === 1 ? "" : "s"} opened</div>`;
}
