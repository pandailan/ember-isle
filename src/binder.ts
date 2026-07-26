/* The card binder: where relic and event cards live, get equipped, and get
   played. Rendered into the shared card overlay so it works from the tavern
   and from the walking view alike. Event cards burn on play. */

import type { TCard, Member, Dir, ChestLoot } from "./types";
import { state, save, allCards } from "./state";
import { MAPS } from "./data";
import { tcardHTML, makeTCard, rollPackCard, spawnMobs, tcardDef } from "./cards";
import { app } from "./bus";
import { $, rnd, ri } from "./util";
import { net } from "./net";
import { sfx } from "./audio";

const inWalkView = () => $("scr-dungeon").classList.contains("on");

/** Where each event card may be played right now. */
function playState(c: TCard): {ok: boolean; label: string; note: string} {
  if (c.kind === "relic") return {ok: true, label: "Give to…", note: ""};
  if (c.key === "rite") {
    const fallen = allCards().filter(m => m.down);
    return fallen.length
      ? {ok: true, label: "Perform the Rite", note: ""}
      : {ok: false, label: "Perform the Rite", note: "No one is fallen. May it stay that way."};
  }
  if (c.key === "charter") {
    return state.level === 0 && inWalkView()
      ? {ok: true, label: "Set Sail", note: ""}
      : {ok: false, label: "Set Sail", note: "The smuggler waits in Vhalis — play this walking the harbor streets."};
  }
  if (c.key === "mappage") {
    return (state.level === 1 || state.level === 2) && inWalkView()
      ? {ok: true, label: "Unfold", note: ""}
      : {ok: false, label: "Unfold", note: "The page matches the Ember warrens — unfold it below ground."};
  }
  return {ok: false, label: "Play", note: ""};
}

let pickFor: string | null = null; // card id awaiting a target choice

export function openBinder(): void {
  const ov = $("card-overlay");
  ov.hidden = false;
  const guest = net.role === "guest";
  $("card-head").innerHTML = `
    <h3 style="color:var(--amber)">Card Binder</h3>
    <p class="dim" style="font-size:.85rem;">Relics are worn; event cards burn on play. All of them trade at the Post.${
      guest ? " (Your host's binder — look, don't touch.)" : ""}</p>`;
  const body = $("card-body");
  if (!state.binder.length) {
    body.innerHTML = `<p class="dim" style="font-size:.85rem;">Empty. The peddler at the Salted Gull sells sealed packs, and the deeps hide more.</p>`;
  } else {
    body.innerHTML = state.binder.map(c => {
      const ps = playState(c);
      let action = "";
      if (!guest) {
        if (pickFor === c.id && c.kind === "relic") {
          action = `<div class="btnrow">` + state.party.map(m =>
            `<button class="pickt" data-card="${c.id}" data-t="${m.id}">${m.name}</button>`).join("") + `</div>`;
        } else if (pickFor === c.id && c.key === "rite") {
          action = `<div class="btnrow">` + allCards().filter(m => m.down).map(m =>
            `<button class="pickt" data-card="${c.id}" data-t="${m.id}">${m.name}</button>`).join("") + `</div>`;
        } else {
          action = `<button class="tplay" data-card="${c.id}" ${ps.ok ? "" : "disabled"}>${ps.label}</button>` +
            (ps.note ? `<span class="rblurb">${ps.note}</span>` : "");
        }
      }
      return tcardHTML(c, action);
    }).join("");
  }
  body.querySelectorAll<HTMLButtonElement>(".tplay").forEach(b => {
    b.onclick = () => {
      const c = state.binder.find(x => x.id === b.dataset.card);
      if (!c) return;
      if (c.kind === "relic" || c.key === "rite") { pickFor = c.id; openBinder(); return; }
      if (c.key === "charter") playCharter(c);
      else if (c.key === "mappage") playMapPage(c);
    };
  });
  body.querySelectorAll<HTMLButtonElement>(".pickt").forEach(b => {
    b.onclick = () => {
      const c = state.binder.find(x => x.id === b.dataset.card);
      const target = allCards().find(m => m.id === b.dataset.t);
      pickFor = null;
      if (!c || !target) { openBinder(); return; }
      if (c.kind === "relic") equipRelic(c, target);
      else playRite(c, target);
    };
  });
  const actions = $("card-actions");
  actions.innerHTML = "";
  const close = document.createElement("button");
  close.textContent = "Close"; close.className = "primary";
  close.onclick = () => { pickFor = null; ov.hidden = true; };
  actions.appendChild(close);
}

function consume(c: TCard): void {
  state.binder = state.binder.filter(x => x.id !== c.id);
}

function equipRelic(c: TCard, target: Member): void {
  consume(c);
  if (target.relic) state.binder.push(target.relic); // the old one comes off
  target.relic = c;
  save(); sfx("recruit");
  openBinder();
}

/** Take a worn relic off a character, back into the binder. */
export function unequipRelic(m: Member): void {
  if (!m.relic) return;
  state.binder.push(m.relic);
  m.relic = undefined;
  save(); sfx("tap");
}

function playRite(c: TCard, target: Member): void {
  if (!target.down) { openBinder(); return; }
  consume(c);
  target.down = false; target.hp = target.maxhp; target.mp = target.maxmp;
  save(); sfx("heal");
  $("card-overlay").hidden = true;
  const msg = `The Rite of Return burns to ash. ${target.name} draws breath.`;
  if (inWalkView()) app.dlog(msg); else app.openTavern(msg);
}

function playCharter(c: TCard): void {
  consume(c);
  state.level = 4; state.x = 3; state.y = 2; state.dir = 1 as Dir;
  state.inDungeon = true;
  state.mobs[4] = spawnMobs(4); // the cove restocks for every crossing
  save(); sfx("stairs");
  $("card-overlay").hidden = true;
  app.enterWalk("The smuggler's skiff slips the harbor chain and grinds onto hidden sand. He keeps the charter.");
}

/* ---------- torn map pages: a vault dreamed out of the card ---------- */
function seeded(id: string): () => number {
  let s = 2166136261;
  for (let i = 0; i < id.length; i++) { s ^= id.charCodeAt(i); s = Math.imul(s, 16777619); }
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 10000) / 10000; };
}

/** Carve a small vault from the card's id — the same page opens the same vault. */
export function genVault(seed: string): string[] {
  const W = 9, H = 7;
  const r = seeded(seed);
  const g: string[][] = Array.from({length: H}, () => Array.from({length: W}, () => "#"));
  let x = 1, y = 1;
  g[y][x] = ".";
  const carved: [number, number][] = [[1, 1]];
  for (let i = 0; i < 70; i++) {
    const [dx, dy] = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(r() * 4)];
    const nx = x + dx, ny = y + dy;
    if (nx < 1 || ny < 1 || nx > W - 2 || ny > H - 2) continue;
    x = nx; y = ny;
    if (g[y][x] === "#") { g[y][x] = "."; carved.push([x, y]); }
  }
  // chests in the two farthest corners of the carving
  carved.sort((a, b) => (Math.abs(b[0] - 1) + Math.abs(b[1] - 1)) - (Math.abs(a[0] - 1) + Math.abs(a[1] - 1)));
  for (const [cx, cy] of carved.slice(0, 2)) if (!(cx === 1 && cy === 1)) g[cy][cx] = "C";
  g[1][1] = "X"; // the way back out
  return g.map(row => row.join(""));
}

function playMapPage(c: TCard): void {
  consume(c);
  const map = genVault(c.id);
  state.vault = {map, ret: {level: state.level, x: state.x, y: state.y, dir: state.dir}};
  MAPS[5] = map;
  state.level = 5; state.x = 1; state.y = 1; state.dir = 1 as Dir;
  state.mobs[5] = spawnMobs(5);
  save(); sfx("spell");
  $("card-overlay").hidden = true;
  app.enterWalk("The page ignites in your hand — and a door that was never built stands open. Something waited for a reader.");
}

/** What a vault chest holds: decent gold, and sometimes another card. */
export function vaultLoot(): ChestLoot {
  const loot: ChestLoot = {gold: 50 + ri(70), note: "a vault cache"};
  if (rnd() < 0.35) loot.potions = 1;
  if (rnd() < 0.3) {
    const card = rollPackCard();
    state.binder.push(card);
    loot.note = `a vault cache — inside, a sealed card: ${tcardDef(card)?.n}`;
  }
  return loot;
}

/** Step back through the folded door. */
export function leaveVault(): void {
  const ret = state.vault?.ret;
  state.vault = undefined;
  state.mobs[5] = [];
  if (ret) { state.level = ret.level; state.x = ret.x; state.y = ret.y; state.dir = ret.dir as Dir; }
  else { state.level = 1; state.x = 1; state.y = 1; state.dir = 1 as Dir; }
  save(); sfx("stairs");
  app.enterWalk("The passage folds shut behind you as if ashamed of having existed.");
}

/** Boss spoils: the Pyrelord guards a Rite of Return. */
export function grantBossCard(): TCard {
  const card = makeTCard("event", "rite");
  state.binder.push(card);
  return card;
}

/** Buy a sealed pack from the peddler. */
export function buyPack(): TCard | null {
  if (state.gold < 40) return null;
  state.gold -= 40;
  const card = rollPackCard();
  state.binder.push(card);
  save();
  return card;
}
