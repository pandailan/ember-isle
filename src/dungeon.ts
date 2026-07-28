import type { Dir, Mob } from "./types";
import { state, save, cellAt, markVisited, allCards, mobAt, isSaveEnabled } from "./state";
import { app } from "./bus";
import { show, renderPlaques } from "./ui";
import { $, sleep, rnd, ri, reduceMotion } from "./util";
import { MAPS, CHESTS, ENEMIES, ENC_GRACE, DIRV, TOWN_SOLID, ITEMS, RELICS, EVENTS, AGGRO, AGGRO_DEF, AGGRO_COOL } from "./data";
import { groundLevelAt, hasElevation, landmarkAt, cellHash } from "./terrain";
import { vaultLoot, leaveVault, openBinder } from "./binder";
import { makeTCard } from "./cards";
import { findCarrier } from "./items";
import { potionHeal } from "./traits";
import { spawnMobs } from "./cards";
import { view, amap, renderView, foeAtX } from "./render";
import { net } from "./net";
import { setScene, setWeatherAudio, setDaylight, sfx } from "./audio";
import { phaseName, hourOf, WEATHER_MSGS, PHASE_MSGS } from "./daytime";
import type { Weather } from "./types";

const dungeonScene = () =>
  state.level === 0 ? "town" as const
  : state.level === 3 || state.level === 4 ? "moor" as const
  : state.level === 2 ? "deep" as const : "dungeon" as const;

let logLines: string[] = [];
let engagedMob: Mob | null = null;

const outdoors = () => state.level === 0 || state.level === 3 || state.level === 4;

/** Time passes with motion: the sky, the weather, and the log all follow. */
export function advanceTime(mins: number, weatherTicks = 1): void {
  const prevPhase = phaseName(state.clock);
  state.clock = (state.clock + mins) % 1440;
  const phase = phaseName(state.clock);
  if (phase !== prevPhase && outdoors() && PHASE_MSGS[phase]) dlog(PHASE_MSGS[phase]);
  state.weatherLeft -= weatherTicks;
  if (state.weatherLeft <= 0) rollWeather();
  const hr = hourOf(state.clock);
  setDaylight(hr >= 6 && hr < 19.5);
}

function rollWeather(): void {
  const prev = state.weather;
  const r = rnd() * 100;
  state.weather = r < 45 ? "clear" : r < 70 ? "mist" : r < 92 ? "rain" : "storm";
  state.weatherLeft = 45 + ri(50);
  if (state.weather !== prev && outdoors()) dlog(WEATHER_MSGS[state.weather]);
  setWeatherAudio(state.weather, outdoors());
}

/** Re-assert the weather soundscape when the walking view (re)opens. */
export function syncWeatherAudio(): void {
  setWeatherAudio(state.weather as Weather, outdoors());
  const hr = hourOf(state.clock);
  setDaylight(hr >= 6 && hr < 19.5);
}

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

export function updateHUD(): void {
  $("hud").innerHTML = `
    <span class="hudchip"><svg viewBox="0 0 10 10" width="11" height="11"><circle cx="5" cy="5" r="4" fill="#e0b24c"/><circle cx="5" cy="5" r="2.2" fill="#a3782c"/></svg>${state.gold}</span>
    <span class="hudchip"><svg viewBox="0 0 10 12" width="10" height="12"><rect x="3.4" y="0" width="3.2" height="3" fill="#8a7a52"/><path d="M3 3 h4 l1.5 3 v4.5 a1.5 1.5 0 0 1 -1.5 1.5 h-4 a1.5 1.5 0 0 1 -1.5 -1.5 v-4.5 z" fill="#c8502f"/></svg>${state.potions}</span>`;
}

export function enterDungeon(fresh: boolean): void {
  if (fresh && state.party.length < 4) {
    app.openTavern("The harbormaster bars the Stair: four must march. Fill the marching four first.");
    return;
  }
  state.inDungeon = true;
  setScene(dungeonScene());
  syncWeatherAudio();
  if (fresh) {
    state.level = 1; state.x = 1; state.y = 1; state.dir = 1; state.graceLeft = ENC_GRACE;
    // the caves refill while you're topside
    state.mobs[1] = spawnMobs(1, state.mobs[1]);
    state.mobs[2] = spawnMobs(2, state.mobs[2]);
    state.mobs[3] = spawnMobs(3, state.mobs[3]);
    logLines = []; dlog("The Old Stair ends in torch-dark. The air tastes of cinders.");
  } else {
    logLines = []; dlog("You take up your torches where you left them.");
  }
  markVisited(); save();
  show("scr-dungeon");
  renderPlaques("dg-plaques");
  updateHUD();
  renderView();
}

/** Show the walking view without changing where we are (town streets use this). */
export function enterWalk(msg: string | null): void {
  markVisited(); save();
  syncWeatherAudio();
  show("scr-dungeon");
  renderPlaques("dg-plaques");
  updateHUD();
  if (msg) dlog(msg); else redrawLog();
  renderView();
}

const fightingNow = () => document.body.classList.contains("fighting");

export function turn(d: number): void {
  if (fightingNow()) return;
  state.dir = ((state.dir + d + 4) % 4) as Dir; renderView();
}

function engage(mob: Mob): void {
  engagedMob = mob;
  // square up: turn to face where the attack comes from
  if (Math.abs(mob.x - state.x) + Math.abs(mob.y - state.y) === 1) {
    state.dir = (mob.x > state.x ? 1 : mob.x < state.x ? 3 : mob.y > state.y ? 2 : 0) as Dir;
    renderView();
  }
  sfx("combat");
  dlog(`${ENEMIES[mob.key]?.n ?? "Something"} lunges from the dark!`);
  app.startCombat(mob.group, false);
}

/** After the party moves, packs act on temperament: sighting you lights their
    heat (pursuit patience); each step of the hunt burns it down until the pack
    gives up and sulks. The dead never give up. Outdoors, hunters keep to the
    low ground and steep climbs make them scrabble — luring wolves uphill works. */
function moveMobs(): void {
  const mobs = state.mobs[state.level] ?? [];
  const occupied = new Set(mobs.map(m => m.x + "," + m.y));
  const lifted = hasElevation(state.level);
  let attacker: Mob | null = null;
  for (const m of mobs) {
    const a = AGGRO[m.key] ?? AGGRO_DEF;
    const dx = state.x - m.x, dy = state.y - m.y;
    const dist = Math.abs(dx) + Math.abs(dy);
    let lit = false;
    if (m.cool) { m.cool--; if (!m.cool) delete m.cool; }
    else if (!m.heat && dist > 0 && dist <= a.sight) {
      m.heat = a.chase; lit = true;
      dlog(`${ENEMIES[m.key]?.n ?? "Something"} has your scent!`);
    }
    if (m.heat && !lit && dist > 2) { // a hunter on your heels doesn't lose heart
      m.heat--;
      if (!m.heat) {
        delete m.heat; m.cool = AGGRO_COOL;
        if (dist <= a.sight + 4) dlog(`${ENEMIES[m.key]?.n ?? "Something"} loses interest in the chase.`);
      }
    }
    const hunting = !!m.heat && dist > 0;
    if (hunting && a.slow && state.steps % 2 === 0) continue; // lumbering things fall behind
    const steps: [number, number][] = [];
    if (hunting) {
      if (Math.abs(dx) >= Math.abs(dy)) steps.push([Math.sign(dx), 0], [0, Math.sign(dy)]);
      else steps.push([0, Math.sign(dy)], [Math.sign(dx), 0]);
      if (lifted && (steps[1][0] || steps[1][1])) { // prefer the gentler of the two paths
        const h = (s: [number, number]) => groundLevelAt(state.level, m.x + s[0] + 0.5, m.y + s[1] + 0.5);
        if (h(steps[0]) - h(steps[1]) > 0.055) steps.reverse();
      }
    } else if (rnd() < 0.2) {
      steps.push(DIRV[ri(4)] as unknown as [number, number]);
    }
    for (const [sx, sy] of steps) {
      if (!sx && !sy) continue;
      const tx = m.x + sx, ty = m.y + sy;
      if (tx === state.x && ty === state.y) { if (!attacker) attacker = m; break; }
      if (MAPS[state.level][ty]?.[tx] !== ".") continue;
      if (occupied.has(tx + "," + ty)) continue;
      if (hunting && lifted && rnd() < 0.4
          && groundLevelAt(state.level, tx + 0.5, ty + 0.5)
           - groundLevelAt(state.level, m.x + 0.5, m.y + 0.5) > 0.082) break; // scrabbles at the slope
      occupied.delete(m.x + "," + m.y);
      m.x = tx; m.y = ty;
      occupied.add(tx + "," + ty);
      break;
    }
  }
  if (attacker) engage(attacker);
}

export function step(back: boolean, byGuest = false): void {
  moveDir(back ? ((state.dir + 2) % 4) as Dir : state.dir, byGuest);
}

/** Sidestep without turning: the crawler's classic strafe. */
export function strafe(side: -1 | 1, byGuest = false): void {
  moveDir(((state.dir + (side === 1 ? 1 : 3)) % 4) as Dir, byGuest);
}

function moveDir(d: Dir, byGuest = false): void {
  if (fightingNow()) return; // no wandering off mid-melee
  const f = DIRV[d];
  const nx = state.x + f[0], ny = state.y + f[1];
  const cell = cellAt(state.level, nx, ny);
  if (cell === "~") {
    sfx("bump");
    dlog("Black water swallows the shingle. The isle ends here.");
    renderView(); return;
  }
  if (cell === "#") {
    sfx("bump");
    dlog(state.level === 0 ? "A shuttered wall. The town sleeps."
      : state.level === 3 ? "A thicket of thorn and stone. No way through."
      : state.level === 4 ? "Salt-worn rock. The cove keeps its secrets." : "Stone. You are not the first to test it.");
    renderView(); return;
  }
  if ((state.level === 0 || state.level === 3 || state.level === 4) && TOWN_SOLID.includes(cell)) {
    if (byGuest) { dlog("Your host must be the one to knock."); return; }
    sfx("tap");
    app.townDoor(cell);
    return;
  }
  const mob = mobAt(state.level, nx, ny);
  if (mob) { engage(mob); return; } // you charge them where they stand
  state.x = nx; state.y = ny; state.steps++; markVisited();
  advanceTime(2);
  sfx("step");
  const raw = MAPS[state.level][ny][nx];
  renderView();
  void onEnterCell(raw);
  if ($("scr-dungeon").classList.contains("on")) { moveMobs(); renderView(); }
}

/** Combat outcome hooks (wired through the bus). */
export function combatWon(): void {
  if (!engagedMob) return;
  const lvl = state.level;
  state.mobs[lvl] = (state.mobs[lvl] ?? []).filter(m => m !== engagedMob &&
    !(m.x === engagedMob!.x && m.y === engagedMob!.y));
  engagedMob = null;
  advanceTime(15, 4); // a fight is not a stroll
  save();
}
export function combatFled(): void { engagedMob = null; }

async function onEnterCell(raw: string): Promise<void> {
  const key = state.level + ":" + state.x + "," + state.y;
  if (raw === "C" && !state.opened.includes(key)) {
    const loot = state.level === 5 ? vaultLoot() : (CHESTS[key] || {gold: 30});
    state.opened.push(key);
    const got: string[] = [];
    if (loot.gold) { state.gold += loot.gold; got.push(loot.gold + " gold"); }
    if (loot.potions) { state.potions += loot.potions; got.push(loot.potions + " potion" + (loot.potions > 1 ? "s" : "")); }
    for (const [kind, ckey] of loot.cards ?? []) {
      state.binder.push(makeTCard(kind, ckey));
      got.push(`a sealed card: ${kind === "relic" ? RELICS[ckey]?.n : EVENTS[ckey]?.n}`);
    }
    const left: string[] = [];
    for (const id of loot.items ?? []) {
      const carrier = findCarrier(state.party, id);
      if (carrier) { carrier.items.push(id); got.push(`${ITEMS[id].n} (${carrier.name})`); }
      else left.push(ITEMS[id].n);
    }
    if (loot.charm) { state.charm = true; got.push("the Emberward Charm (DEF +2 for all)"); }
    sfx("chest");
    dlog(`You pry open ${loot.note || "a chest"} — ${got.join(", ")}.`);
    if (left.length) dlog(`No room to carry: ${left.join(", ")}. It stays in the chest's shadow.`);
    updateHUD(); save(); renderView(); return;
  }
  if (raw === "F") {
    for (const m of state.party) { if (!m.down) { m.hp = m.maxhp; m.mp = m.maxmp; } }
    sfx("fountain");
    dlog("A spring of cold, clear water. The living drink deep and are made whole.");
    renderPlaques("dg-plaques"); save(); return;
  }
  if (raw === "S") {
    state.level = 2; state.x = 1; state.y = 1; state.dir = 2; state.graceLeft = ENC_GRACE;
    markVisited(); sfx("stairs"); setScene(dungeonScene());
    dlog("The stair corkscrews down. The heat rises to meet you."); save(); renderView(); return;
  }
  if (raw === "U") {
    state.level = 1; state.x = 13; state.y = 9; state.dir = 3; state.graceLeft = ENC_GRACE;
    markVisited(); sfx("stairs"); setScene(dungeonScene());
    dlog("You climb back toward cooler air."); save(); renderView(); return;
  }
  if (raw === "X") { // the folded door out of a map-page vault
    leaveVault();
    return;
  }
  if (raw === "E") {
    dlog("Daylight."); await sleep(300);
    state.level = 0; state.x = 13; state.y = 2; state.dir = 2; // on the street, back to the stair door
    app.openTown("You climb out of the Old Stair into the harbor night."); return;
  }
  if (raw === "B" && !state.bossDown) {
    dlog("The dark ahead breathes. Something crowned in flame rises to its feet.");
    await sleep(700);
    app.startCombat(["boss"], true);
    return;
  }
  if (raw === ".") visitLandmark();
  // no unseen ambushes: every fight in these caves walks on visible feet
}

/** Standing where older hands built something: each landmark rewards its
    first visit, once per save. */
function visitLandmark(): void {
  const lm = landmarkAt(state.level, state.x, state.y);
  if (!lm) return;
  const key = state.level + ":" + state.x + "," + state.y;
  const claimed = (state.landmarks ??= []);
  if (claimed.includes(key)) return;
  claimed.push(key);
  const h = cellHash(state.x, state.y);
  if (lm === "watchtower") {
    // the crown shows the land: a wide sweep of the map opens
    const m = MAPS[state.level];
    const arr = (state.visited[state.level] ??= []);
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const x = state.x + dx, y = state.y + dy;
      if (y < 0 || y >= m.length || x < 0 || x >= m[0].length) continue;
      const k = x + "," + y;
      if (!arr.includes(k)) arr.push(k);
    }
    sfx("stairs");
    dlog("You climb the hollow stair to the broken crown. The land lays itself out below.");
    amap.classList.add("on");
  } else if (lm === "stoneCircle") {
    for (const m of state.party) if (!m.down) { m.hp = m.maxhp; m.mp = m.maxmp; }
    sfx("fountain");
    dlog("You step inside the ring. The stones hum an old warmth — the living are made whole.");
    renderPlaques("dg-plaques");
  } else if (lm === "barrow") {
    const gold = 60 + (h % 41);
    state.gold += gold;
    const got = [gold + " gold"];
    const carrier = findCarrier(state.party, "relic");
    if (carrier) { carrier.items.push("relic"); got.push(`${ITEMS.relic.n} (${carrier.name})`); }
    sfx("chest");
    dlog(`You duck under the lintel. Grave-goods in the dark: ${got.join(", ")}.`);
    if ((h >> 4) % 2 === 0) {
      dlog("Behind you, bone scrapes stone — the sleepers want it back.");
      window.setTimeout(() => { // unless another fight found you first
        if (!fightingNow()) app.startCombat(["ske", "ske"], false);
      }, 650);
    }
  } else if (lm === "wreck") {
    const gold = 30 + (h % 31);
    state.gold += gold; state.potions += 2;
    sfx("chest");
    dlog(`You pick through the hull's ribs — ${gold} gold in a rotted purse, and 2 stoppered potions.`);
  } else if (lm === "ruin") {
    const gold = 10 + (h % 21);
    state.gold += gold;
    sfx("tap");
    dlog(`You turn over the old stones. Someone's small hoard: ${gold} gold.`);
  }
  updateHUD(); save(); renderView();
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
  renderPlaques("dg-plaques"); updateHUD(); save();
}

// Guests steer through the host: inputs travel the link, moves come back as synced state.
function doStrafe(side: -1 | 1): void {
  if (net.role === "guest") { net.send({t: "input", a: side < 0 ? "sleft" : "sright"}); return; }
  strafe(side);
}
function doTurn(d: number): void {
  if (net.role === "guest") net.send({t: "input", a: d < 0 ? "left" : "right"});
  else turn(d);
}
function doStep(back: boolean): void {
  if (net.role === "guest") {
    // a guest bumping the trading stall opens their own side of the post
    if (state?.level === 0) {
      const f = DIRV[state.dir], s = back ? -1 : 1;
      if (cellAt(0, state.x + f[0] * s, state.y + f[1] * s) === "R") { app.openTrade(); return; }
    }
    net.send({t: "input", a: back ? "back" : "fwd"});
    return;
  }
  step(back);
}

export function bindDungeonControls(): void {
  // movement buttons act on press and repeat while held; the trailing
  // synthetic click is swallowed so nothing fires twice
  const heldMove = (id: string, fn: () => void) => {
    const el = $(id);
    let timer = 0, held = false;
    el.addEventListener("pointerdown", e => {
      e.preventDefault();
      held = true; fn();
      const go = () => { fn(); timer = window.setTimeout(go, 210); };
      timer = window.setTimeout(go, 380);
    });
    for (const ev of ["pointerup", "pointerleave", "pointercancel"] as const) {
      el.addEventListener(ev, () => { window.clearTimeout(timer); });
    }
    el.onclick = () => { if (held) { held = false; return; } fn(); }; // synthetic clicks still work
  };
  heldMove("bt-left", () => doTurn(-1));
  heldMove("bt-right", () => doTurn(1));
  heldMove("bt-fwd", () => doStep(false));
  heldMove("bt-back", () => doStep(true));
  heldMove("bt-sleft", () => doStrafe(-1));
  heldMove("bt-sright", () => doStrafe(1));
  $("bt-map").onclick = () => { amap.classList.toggle("on"); renderView(); };
  $("bt-cards").onclick = () => { sfx("tap"); openBinder(); };
  $("bt-potion").onclick = () => {
    if (net.role === "guest") net.send({t: "input", a: "potion"});
    else usePotionField();
  };
  $("bt-save").onclick = () => {
    if (net.role === "guest") { dlog("Only the torchbearer keeps the map. (Your host saves.)"); return; }
    save();
    dlog(isSaveEnabled()
      ? "You scratch your progress into the map. (Saved.)"
      : "A borrowed expedition writes no maps — but your cards remember everything.");
  };
  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if (!$("scr-dungeon").classList.contains("on")) return;
    if (e.key === "ArrowUp" || e.key === "w") doStep(false);
    else if (e.key === "ArrowDown" || e.key === "s") doStep(true);
    else if (e.key === "ArrowLeft" || e.key === "a") doTurn(-1);
    else if (e.key === "ArrowRight" || e.key === "d") doTurn(1);
    else if (e.key === "q") doStrafe(-1);
    else if (e.key === "e") doStrafe(1);
    else if (e.key === "m") $("bt-map").click();
  });
  // swipe on the viewport: flick up walks, down retreats, sideways turns
  let tsx = 0, tsy = 0, tst = 0;
  view.addEventListener("touchstart", e => {
    tsx = e.touches[0].clientX; tsy = e.touches[0].clientY; tst = performance.now();
  }, {passive: true});
  view.addEventListener("touchend", e => {
    if (performance.now() - tst > 500) return; // a lingering finger is not a flick
    const t = e.changedTouches[0];
    const dx = t.clientX - tsx, dy = t.clientY - tsy;
    if (fightingNow()) { // in a fight, a flick or a plain tap at a foe strikes them
      const r = view.getBoundingClientRect();
      const i = foeAtX((t.clientX - r.left) / r.width);
      if (i != null) app.combatSwipe(i);
      return;
    }
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 26) return;
    if (Math.abs(dx) > Math.abs(dy)) doTurn(dx > 0 ? 1 : -1); else doStep(dy > 0);
  }, {passive: true});
}

export function backToDungeon(msg: string | null): void {
  setScene(dungeonScene());
  show("scr-dungeon");
  renderPlaques("dg-plaques");
  updateHUD();
  if (msg) dlog(msg);
  renderView();
}

/** After a wipe the fisherfolk drag every card home at a price. */
export function rescueParty(): void {
  for (const m of allCards()) { m.down = false; m.hp = Math.max(1, Math.floor(m.maxhp * 0.3)); }
  state.gold = Math.floor(state.gold * 0.5); state.inDungeon = false;
}
