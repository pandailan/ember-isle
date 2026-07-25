import type { Dir } from "./types";
import { state, save, cellAt, markVisited, allCards } from "./state";
import { app } from "./bus";
import { show, renderPlaques } from "./ui";
import { $, sleep, rnd, ri, reduceMotion } from "./util";
import { MAPS, CHESTS, GROUPS, ENC_RATE, ENC_GRACE, DIRV } from "./data";
import { potionHeal } from "./traits";
import { view, amap, renderView } from "./render";
import { net } from "./net";
import { setScene, sfx } from "./audio";

let logLines: string[] = [];
let flickerTimer: ReturnType<typeof setInterval> | null = null;

export function getLogLines(): string[] { return logLines; }
export function setLogLines(l: string[]): void { logLines = l; redrawLog(); }

export function redrawLog(): void {
  $("log").innerHTML = logLines
    .map((l, i) => i < logLines.length - 1 ? `<div class="old">${l}</div>` : `<div>${l}</div>`)
    .join("");
}
export function dlog(msg: string): void {
  logLines.push(msg); if (logLines.length > 3) logLines.shift();
  redrawLog();
}

export function enterDungeon(fresh: boolean): void {
  if (fresh && state.party.length < 4) {
    app.openTavern("The harbormaster bars the Stair: four must march. Fill the marching four first.");
    return;
  }
  state.inDungeon = true;
  setScene("dungeon");
  if (fresh) {
    state.level = 1; state.x = 1; state.y = 1; state.dir = 1; state.graceLeft = ENC_GRACE;
    logLines = []; dlog("The Old Stair ends in torch-dark. The air tastes of cinders.");
  } else {
    logLines = []; dlog("You take up your torches where you left them.");
  }
  markVisited(); save();
  show("scr-dungeon");
  renderPlaques("dg-plaques");
  renderView();
  if (!reduceMotion && !flickerTimer) flickerTimer = setInterval(() => {
    if ($("scr-dungeon").classList.contains("on")) renderView();
  }, 220);
}

export function turn(d: number): void { state.dir = ((state.dir + d + 4) % 4) as Dir; renderView(); }

export function step(back: boolean): void {
  const f = DIRV[state.dir], s = back ? -1 : 1;
  const nx = state.x + f[0] * s, ny = state.y + f[1] * s;
  if (cellAt(state.level, nx, ny) === "#") { sfx("bump"); dlog("Stone. You are not the first to test it."); renderView(); return; }
  state.x = nx; state.y = ny; state.steps++; markVisited();
  sfx("step");
  if (!reduceMotion) {
    const vw = view.parentElement!;
    vw.classList.remove("step"); void vw.offsetWidth; vw.classList.add("step");
  }
  const raw = MAPS[state.level][ny][nx];
  renderView();
  void onEnterCell(raw);
}

async function onEnterCell(raw: string): Promise<void> {
  const key = state.level + ":" + state.x + "," + state.y;
  if (raw === "C" && !state.opened.includes(key)) {
    const loot = CHESTS[key] || {gold: 30};
    state.opened.push(key);
    const got: string[] = [];
    if (loot.gold) { state.gold += loot.gold; got.push(loot.gold + " gold"); }
    if (loot.potions) { state.potions += loot.potions; got.push(loot.potions + " potion" + (loot.potions > 1 ? "s" : "")); }
    if (loot.charm) { state.charm = true; got.push("the Emberward Charm (DEF +2 for all)"); }
    sfx("chest");
    dlog(`You pry open ${loot.note || "a chest"} — ${got.join(", ")}.`);
    save(); renderView(); return;
  }
  if (raw === "F") {
    for (const m of state.party) { if (!m.down) { m.hp = m.maxhp; m.mp = m.maxmp; } }
    sfx("fountain");
    dlog("A spring of cold, clear water. The living drink deep and are made whole.");
    renderPlaques("dg-plaques"); save(); return;
  }
  if (raw === "S") {
    state.level = 2; state.x = 1; state.y = 1; state.dir = 2; state.graceLeft = ENC_GRACE;
    markVisited(); sfx("stairs"); dlog("The stair corkscrews down. The heat rises to meet you."); save(); renderView(); return;
  }
  if (raw === "U") {
    state.level = 1; state.x = 13; state.y = 9; state.dir = 3; state.graceLeft = ENC_GRACE;
    markVisited(); sfx("stairs"); dlog("You climb back toward cooler air."); save(); renderView(); return;
  }
  if (raw === "E") {
    dlog("Daylight."); await sleep(300);
    app.openTown("You climb out of the Old Stair, blinking against the grey sky."); return;
  }
  if (raw === "B" && !state.bossDown) {
    dlog("The dark ahead breathes. Something crowned in flame rises to its feet.");
    await sleep(700);
    app.startCombat(["boss"], true);
    return;
  }
  if (raw === ".") {
    if (state.graceLeft > 0) { state.graceLeft--; }
    else if (rnd() < ENC_RATE[state.level]) {
      const g = GROUPS[state.level][ri(GROUPS[state.level].length)];
      await sleep(150);
      app.startCombat(g, false);
    }
  }
}

export function usePotionField(): void {
  if (state.potions <= 0) { dlog("Your pack holds no more potions."); return; }
  const hurt = state.party.filter(m => !m.down && m.hp < m.maxhp);
  if (!hurt.length) { dlog("No one is bleeding. Yet."); return; }
  let worst = hurt[0]; for (const m of hurt) if (m.hp / m.maxhp < worst.hp / worst.maxhp) worst = m;
  const heal = potionHeal(state.party);
  state.potions--; worst.hp = Math.min(worst.maxhp, worst.hp + heal);
  sfx("heal");
  dlog(`${worst.name} drinks a potion. (+${heal} HP · ${state.potions} left)`);
  renderPlaques("dg-plaques"); save();
}

// Guests steer through the host: inputs travel the link, moves come back as synced state.
function doTurn(d: number): void {
  if (net.role === "guest") net.send({t: "input", a: d < 0 ? "left" : "right"});
  else turn(d);
}
function doStep(back: boolean): void {
  if (net.role === "guest") net.send({t: "input", a: back ? "back" : "fwd"});
  else step(back);
}

export function bindDungeonControls(): void {
  $("bt-left").onclick = () => doTurn(-1);
  $("bt-right").onclick = () => doTurn(1);
  $("bt-fwd").onclick = () => doStep(false);
  $("bt-back").onclick = () => doStep(true);
  $("bt-map").onclick = () => { amap.classList.toggle("on"); renderView(); };
  $("bt-potion").onclick = () => {
    if (net.role === "guest") net.send({t: "input", a: "potion"});
    else usePotionField();
  };
  $("bt-save").onclick = () => {
    if (net.role === "guest") { dlog("Only the torchbearer keeps the map. (Your host saves.)"); return; }
    save(); dlog("You scratch your progress into the map. (Saved.)");
  };
  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if (!$("scr-dungeon").classList.contains("on")) return;
    if (e.key === "ArrowUp" || e.key === "w") doStep(false);
    else if (e.key === "ArrowDown" || e.key === "s") doStep(true);
    else if (e.key === "ArrowLeft" || e.key === "a") doTurn(-1);
    else if (e.key === "ArrowRight" || e.key === "d") doTurn(1);
    else if (e.key === "m") $("bt-map").click();
  });
  // swipe on the viewport
  let tsx = 0, tsy = 0;
  view.addEventListener("touchstart", e => { tsx = e.touches[0].clientX; tsy = e.touches[0].clientY; }, {passive: true});
  view.addEventListener("touchend", e => {
    const dx = e.changedTouches[0].clientX - tsx, dy = e.changedTouches[0].clientY - tsy;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 30) return;
    if (Math.abs(dx) > Math.abs(dy)) doTurn(dx > 0 ? 1 : -1); else doStep(dy > 0);
  }, {passive: true});
}

export function backToDungeon(msg: string | null): void {
  setScene("dungeon");
  show("scr-dungeon");
  renderPlaques("dg-plaques");
  if (msg) dlog(msg);
  renderView();
}

/** After a wipe the fisherfolk drag every card home at a price. */
export function rescueParty(): void {
  for (const m of allCards()) { m.down = false; m.hp = Math.max(1, Math.floor(m.maxhp * 0.3)); }
  state.gold = Math.floor(state.gold * 0.5); state.inDungeon = false;
}
