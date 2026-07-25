import type { Member, EnemyInst, CombatState, PlayerCmd, Dir, GameState } from "./types";
import {
  CLASSES, SPELLS, ROSTER, ENEMIES, GROUPS, MAPS, CHESTS,
  WBONUS, WCOST, WNAME, ABONUS, ACOST, ANAME,
  ENC_RATE, ENC_GRACE, DIRV,
} from "./data";
import {
  state, setState, newMember, newState, atkOf, defOf, alive, spellsOf, xpNeed,
  save, loadSave, cellAt, markVisited, setSaveEnabled,
} from "./state";
import { view, amap, renderView, drawMonster } from "./render";
import { $, sleep, rnd, ri, reduceMotion } from "./util";
import { net, type NetMsg } from "./net";

let combat: CombatState = null as unknown as CombatState;
let choiceResolve: ((v: unknown) => void) | null = null;
let logLines: string[] = [];
let flickerTimer: ReturnType<typeof setInterval> | null = null;
let currentScreen = "scr-title";

/* ============================== ROUTER ============================== */
function show(id: string): void {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("on"));
  $(id).classList.add("on");
  currentScreen = id;
}

/* ============================== TITLE ============================== */
function initTitle(): void {
  if (loadSave()) $("bt-continue").style.display = "";
  $("bt-new").onclick = () => { openTavern(); };
  $("bt-continue").onclick = () => {
    const s = loadSave();
    if (!s) { openTavern(); return; }
    setState(s);
    if (state.inDungeon) enterDungeon(false); else openTown();
  };
}

/* ============================== TAVERN ============================== */
let picked: number[] = [];
function openTavern(): void {
  picked = [];
  const box = $("roster"); box.innerHTML = "";
  ROSTER.forEach((r, i) => {
    const c = CLASSES[r.cls];
    const d = document.createElement("div");
    d.className = "rcard"; d.id = "rc" + i;
    d.innerHTML = `<span class="rname">${r.name}</span><span class="rcls">${r.cls}</span>
      <span class="rblurb">${r.blurb}</span>
      <span class="rstats">HP ${c.hp} · MP ${c.mp} · ATK ${c.atk} · DEF ${c.def} · SPD ${c.spd}</span>`;
    d.onclick = () => {
      const at = picked.indexOf(i);
      if (at >= 0) picked.splice(at, 1);
      else if (picked.length < 4) picked.push(i);
      ROSTER.forEach((_, j) => $("rc" + j).classList.toggle("sel", picked.includes(j)));
      const bt = $("bt-setout") as HTMLButtonElement;
      bt.disabled = picked.length !== 4;
      bt.textContent = `Set Out (${picked.length} / 4)`;
    };
    box.appendChild(d);
  });
  const bt = $("bt-setout") as HTMLButtonElement;
  bt.disabled = true; bt.textContent = "Set Out (0 / 4)";
  bt.onclick = () => {
    setState(newState(picked.map(i => newMember(ROSTER[i]))));
    save(); openTown("You shoulder your packs. The Salted Gull's door swings shut behind you.");
  };
  show("scr-tavern");
}

/* ============================== PARTY PLAQUES ============================== */
function plaqueHTML(m: Member): string {
  return `<div class="plaque${m.down ? " down" : ""}">
    <span class="pname">${m.name}</span>
    <div class="bar hp"><i style="width:${Math.max(0, 100 * m.hp / m.maxhp)}%"></i></div>
    ${m.maxmp > 0 ? `<div class="bar mp"><i style="width:${Math.max(0, 100 * m.mp / m.maxmp)}%"></i></div>` : ""}
    <span class="pnum">${m.down ? "fallen" : `${m.hp}/${m.maxhp}${m.maxmp > 0 ? " · " + m.mp + "m" : ""}`} · L${m.lvl}</span>
  </div>`;
}
function renderPlaques(elId: string): void {
  $(elId).innerHTML = state.party.map(m => plaqueHTML(m)).join("");
}

/* ============================== TOWN ============================== */
function openTown(msg?: string): void {
  state.inDungeon = false; save();
  $("town-gold").textContent = String(state.gold);
  $("town-potions").textContent = String(state.potions);
  $("town-msg").textContent = msg || "";
  renderPlaques("town-plaques");
  const menu = $("town-menu"); menu.innerHTML = "";
  const opts: [string, string, () => void][] = [
    ["The Salted Gull", "rest & drink — 12 g", townRest],
    ["Ember & Anchor Provisions", "potions & gear", openShop],
    ["Temple of the Tide", "raise the fallen", () => openTemple()],
    ["The Old Stair", "descend into the caves", () => enterDungeon(true)],
    ["The Harbor", state.heart ? "a ship waits" : "no ship will sail", townHarbor],
    ["The Signal Fire",
      net.role === "host" ? (net.connected ? "companion linked" : `code ${net.code} — waiting`) : "invite a friend (co-op)",
      townSignal],
  ];
  for (const [t, h, fn] of opts) {
    const b = document.createElement("button");
    b.innerHTML = `<span>${t}</span><span class="hint">${h}</span>`;
    b.onclick = fn; menu.appendChild(b);
  }
  show("scr-town");
}
function townRest(): void {
  if (state.gold < 12) { $("town-msg").textContent = "The innkeep eyes your empty purse. No coin, no bed."; return; }
  state.gold -= 12;
  for (const m of state.party) { if (!m.down) { m.hp = m.maxhp; m.mp = m.maxmp; } }
  save(); openTown("Hot stew, a real bed, and no dreams. The living wake restored.");
}
function townSignal(): void {
  if (net.role === "host") {
    $("town-msg").textContent = net.connected
      ? "The fire burns steady. Your companion walks with you."
      : `The fire is lit — share the code ${net.code}. On another device, choose “Join a Friend” on the title screen.`;
    return;
  }
  $("town-msg").textContent = "You stack driftwood and strike flint…";
  net.host((codeOrErr, ok) => {
    if (ok) openTown(`The signal fire burns. Share the code ${codeOrErr} — a friend can now Join from their title screen while you play. They'll command your rear two adventurers in battle.`);
    else openTown("The fire gutters out — the far shore does not answer. (Co-op needs an internet connection.)");
  });
}
function townHarbor(): void {
  if (state.heart) { showEnding(); }
  else $("town-msg").textContent = "The harbormaster shakes his head. “While the Ember burns below, the fog holds the bay. Bring me proof it's out.”";
}
function showEnding(): void {
  $("end-stats").innerHTML = `steps taken ${state.steps} · foes felled ${state.kills} · gold ${state.gold}<br>` +
    state.party.map(m => `${m.name} — level ${m.lvl} ${m.cls}`).join("<br>");
  show("scr-end");
}

/* ============================== SHOP ============================== */
function openShop(): void {
  $("shop-gold").textContent = String(state.gold);
  $("shop-potions").textContent = String(state.potions);
  const list = $("shop-list"); list.innerHTML = "";
  function row(info: string, dim: string, btn: string, cost: number, fn: () => void): void {
    const d = document.createElement("div"); d.className = "shoprow";
    d.innerHTML = `<span class="sinfo"><span>${info}</span><span class="dim">${dim}</span></span>`;
    const b = document.createElement("button"); b.textContent = btn;
    b.disabled = cost > state.gold; b.onclick = () => { fn(); openShop(); };
    d.appendChild(b); list.appendChild(d);
  }
  row("Healing Potion", "restores 35 HP, anywhere", "Buy · 25 g", 25, () => { state.gold -= 25; state.potions++; save(); });
  for (const m of state.party) {
    if (m.wTier < 3) {
      const c = WCOST[m.wTier];
      row(`${m.name} — ${WNAME[m.wTier + 1]}`, `weapon · ATK +${WBONUS[m.wTier + 1] - WBONUS[m.wTier]}`, `${c} g`, c,
        () => { state.gold -= c; m.wTier++; save(); });
    }
    if (m.aTier < 3) {
      const c = ACOST[m.aTier];
      row(`${m.name} — ${ANAME[m.aTier + 1]}`, `armor · DEF +${ABONUS[m.aTier + 1] - ABONUS[m.aTier]}`, `${c} g`, c,
        () => { state.gold -= c; m.aTier++; save(); });
    }
  }
  show("scr-shop");
}

/* ============================== TEMPLE ============================== */
function openTemple(msg?: string): void {
  $("temple-gold").textContent = String(state.gold);
  $("temple-msg").textContent = msg || "";
  const list = $("temple-list"); list.innerHTML = "";
  const fallen = state.party.filter(m => m.down);
  if (!fallen.length) {
    const p = document.createElement("p"); p.className = "dim";
    p.textContent = "The priestess bows. “The tide owes you nothing today. Go gently.”";
    list.appendChild(p);
  }
  for (const m of fallen) {
    const b = document.createElement("button");
    b.innerHTML = `<span>Raise ${m.name}</span><span class="hint">50 g</span>`;
    b.disabled = state.gold < 50;
    b.onclick = () => {
      state.gold -= 50; m.down = false; m.hp = m.maxhp; m.mp = m.maxmp; save();
      openTemple(`${m.name} draws a long breath, tasting salt.`);
    };
    list.appendChild(b);
  }
  show("scr-temple");
}

/* ============================== DUNGEON ============================== */
function redrawLog(): void {
  $("log").innerHTML = logLines
    .map((l, i) => i < logLines.length - 1 ? `<div class="old">${l}</div>` : `<div>${l}</div>`)
    .join("");
}
function dlog(msg: string): void {
  logLines.push(msg); if (logLines.length > 3) logLines.shift();
  redrawLog();
}
function enterDungeon(fresh: boolean): void {
  state.inDungeon = true;
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
function turn(d: number): void { state.dir = ((state.dir + d + 4) % 4) as Dir; renderView(); }
function step(back: boolean): void {
  const f = DIRV[state.dir], s = back ? -1 : 1;
  const nx = state.x + f[0] * s, ny = state.y + f[1] * s;
  if (cellAt(state.level, nx, ny) === "#") { dlog("Stone. You are not the first to test it."); renderView(); return; }
  state.x = nx; state.y = ny; state.steps++; markVisited();
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
    dlog(`You pry open ${loot.note || "a chest"} — ${got.join(", ")}.`);
    save(); renderView(); return;
  }
  if (raw === "F") {
    for (const m of state.party) { if (!m.down) { m.hp = m.maxhp; m.mp = m.maxmp; } }
    dlog("A spring of cold, clear water. The living drink deep and are made whole.");
    renderPlaques("dg-plaques"); save(); return;
  }
  if (raw === "S") {
    state.level = 2; state.x = 1; state.y = 1; state.dir = 2; state.graceLeft = ENC_GRACE;
    markVisited(); dlog("The stair corkscrews down. The heat rises to meet you."); save(); renderView(); return;
  }
  if (raw === "U") {
    state.level = 1; state.x = 13; state.y = 9; state.dir = 3; state.graceLeft = ENC_GRACE;
    markVisited(); dlog("You climb back toward cooler air."); save(); renderView(); return;
  }
  if (raw === "E") {
    dlog("Daylight."); await sleep(300);
    openTown("You climb out of the Old Stair, blinking against the grey sky."); return;
  }
  if (raw === "B" && !state.bossDown) {
    dlog("The dark ahead breathes. Something crowned in flame rises to its feet.");
    await sleep(700);
    startCombat(["boss"], true);
    return;
  }
  if (raw === ".") {
    if (state.graceLeft > 0) { state.graceLeft--; }
    else if (rnd() < ENC_RATE[state.level]) {
      const g = GROUPS[state.level][ri(GROUPS[state.level].length)];
      await sleep(150);
      startCombat(g, false);
    }
  }
}
function usePotionField(): void {
  if (state.potions <= 0) { dlog("Your pack holds no more potions."); return; }
  const hurt = state.party.filter(m => !m.down && m.hp < m.maxhp);
  if (!hurt.length) { dlog("No one is bleeding. Yet."); return; }
  let worst = hurt[0]; for (const m of hurt) if (m.hp / m.maxhp < worst.hp / worst.maxhp) worst = m;
  state.potions--; worst.hp = Math.min(worst.maxhp, worst.hp + 35);
  dlog(`${worst.name} drinks a potion. (+35 HP · ${state.potions} left)`);
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
function bindDungeonControls(): void {
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

/* ============================== COMBAT ============================== */
function redrawCombatLog(lines: string[]): void {
  $("combat-log").innerHTML = lines
    .map((l, i) => i < lines.length - 1 ? `<div class="old" style="color:var(--parch-dim)">${l}</div>` : `<div>${l}</div>`)
    .join("");
}
function clog(msg: string): void {
  combat.log.push(msg); if (combat.log.length > 4) combat.log.shift();
  redrawCombatLog(combat.log);
}
function renderFoesData(enemies: EnemyInst[]): void {
  $("foes").innerHTML = enemies.map(e => `
    <div class="foe${e.hp <= 0 ? " dead" : ""}${e.boss ? " boss" : ""}" style="--sig:${e.hue}">
      <canvas class="portrait" width="112" height="112"></canvas>
      <span class="fname">${e.n}</span>
      <div class="bar hp" style="width:100%"><i style="width:${Math.max(0, 100 * e.hp / e.maxhp)}%"></i></div>
    </div>`).join("");
  document.querySelectorAll<HTMLCanvasElement>("#foes .foe .portrait").forEach((cv, i) => {
    const e = enemies[i];
    drawMonster(cv, e.boss ? "boss" : e.key, e.hue);
  });
}
function renderFoes(): void { renderFoesData(combat.enemies); }
function awaitChoice<T>(): Promise<T> {
  return new Promise<T>(r => { choiceResolve = r as (v: unknown) => void; });
}
function choose(v: unknown): void {
  if (choiceResolve) { const r = choiceResolve; choiceResolve = null; r(v); }
}
interface CmdBtn { t: string; v: unknown; wide?: boolean; dis?: boolean; }
function cmdMenu(title: string, btns: CmdBtn[]): void {
  $("cmd-title").textContent = title;
  const box = $("cmd-btns"); box.innerHTML = "";
  for (const b of btns) {
    const el = document.createElement("button");
    el.textContent = b.t; if (b.wide) el.className = "wide";
    if (b.dis) el.disabled = true;
    el.onclick = () => choose(b.v);
    box.appendChild(el);
  }
}
function startCombat(groupKeys: string[], isBoss: boolean): void {
  combat = {
    enemies: groupKeys.map((k, i) => {
      const d = ENEMIES[k];
      const suffix = groupKeys.filter(g => g === k).length > 1
        ? " " + String.fromCharCode(65 + groupKeys.slice(0, i).filter(g => g === k).length) : "";
      return {...d, n: d.n + suffix, hp: d.hp, maxhp: d.hp, key: k} as EnemyInst;
    }),
    isBoss, log: [], round: 0, fled: false,
  };
  $("combat-title").textContent = isBoss ? "Pyrelord Vhal, Keeper of the Ember" :
    combat.enemies.length > 1 ? "Shapes rush from the dark!" : "A shape rushes from the dark!";
  renderFoes(); renderPlaques("cb-plaques");
  $("combat-log").innerHTML = ""; combat.log = [];
  clog(isBoss ? "“Climbers. The Ember was promised bones.”" : "Steel out — they have your scent.");
  show("scr-combat");
  void runCombat();
}
async function runCombat(): Promise<void> {
  for (;;) {
    combat.round++;
    for (const m of state.party) m.guard = false;
    const cmds = await collectCommands();
    if (combat.fled) break;
    type Act = { side: "p"; spd: number; c: PlayerCmd } | { side: "e"; spd: number; e: EnemyInst };
    const acts: Act[] = [
      ...cmds.map(c => ({side: "p" as const, spd: c.m.spd + rnd() * 3, c})),
      ...combat.enemies.filter(e => e.hp > 0).map(e => ({side: "e" as const, spd: e.spd + rnd() * 3, e})),
    ].sort((a, b) => b.spd - a.spd);
    for (const a of acts) {
      if (combat.enemies.every(e => e.hp <= 0)) break;
      if (!alive().length) break;
      if (combat.fled) break;
      if (a.side === "p") { if (!a.c.m.down) await doPlayerAction(a.c); }
      else { if (a.e.hp > 0) await doEnemyAction(a.e); }
      renderFoes(); renderPlaques("cb-plaques");
    }
    if (combat.fled) break;
    if (combat.enemies.every(e => e.hp <= 0)) { await combatVictory(); return; }
    if (!alive().length) { await sleep(700); combatDefeat(); return; }
  }
  // fled
  await sleep(500);
  state.graceLeft = ENC_GRACE + 2; save();
  backToDungeon("You run until the torchlight steadies. Nothing follows. Probably.");
}
/* --- co-op: the last two party slots are commanded by the linked companion --- */
let remoteResolve: ((i: number) => void) | null = null;
let remotePending: { title: string; btns: CmdBtn[] } | null = null;
function controllerOf(idx: number): "local" | "remote" {
  return net.role === "host" && net.connected && idx >= 2 ? "remote" : "local";
}
async function ask(idx: number, title: string, btns: CmdBtn[]): Promise<unknown> {
  if (controllerOf(idx) === "remote") {
    $("cmd-title").textContent = `${state.party[idx].name} — your companion decides…`;
    $("cmd-btns").innerHTML = "";
    remotePending = { title, btns };
    net.send({ t: "menu", title, btns: btns.map(b => ({ t: b.t, dis: !!b.dis, wide: !!b.wide })) });
    const i = await new Promise<number>(res => { remoteResolve = res; });
    remotePending = null; remoteResolve = null;
    if (i < 0) { // companion dropped mid-choice: fall back to local control
      cmdMenu(title, btns);
      return awaitChoice();
    }
    return btns[i] ? btns[i].v : { t: "back" };
  }
  cmdMenu(title, btns);
  return awaitChoice();
}
async function collectCommands(): Promise<PlayerCmd[]> {
  const cmds: PlayerCmd[] = [];
  for (let idx = 0; idx < state.party.length; idx++) {
    const m = state.party[idx];
    if (m.down) continue;
    let done = false;
    while (!done) {
      const sp = spellsOf(m).filter(s => m.mp >= SPELLS[s].mp);
      const c = await ask(idx, `${m.name} — your move`, [
        {t: "Attack", v: {t: "atk"}},
        {t: "Spell", v: {t: "sp"}, dis: !sp.length},
        {t: `Potion (${state.potions})`, v: {t: "pot"}, dis: state.potions <= 0},
        {t: "Defend", v: {t: "def"}},
        {t: combat.isBoss ? "Flee (no escape)" : "Flee", v: {t: "flee"}, wide: true, dis: combat.isBoss},
      ]) as {t: string};
      if (c.t === "atk") {
        const t = await pickEnemy(idx); if (t == null) continue;
        cmds.push({m, act: "atk", t}); done = true;
      } else if (c.t === "sp") {
        const spells = spellsOf(m);
        const spellBtns: CmdBtn[] = spells.map(s => ({
          t: `${SPELLS[s].n} · ${SPELLS[s].mp} MP`, v: {t: "cast", s}, dis: m.mp < SPELLS[s].mp,
        }));
        const sc = await ask(idx, `${m.name} — which spell?`,
          spellBtns.concat([{t: "Back", v: {t: "back"}}])) as {t: string; s?: string};
        if (sc.t === "back" || !sc.s) continue;
        const def = SPELLS[sc.s];
        if (def.kind === "enemy") {
          const t = await pickEnemy(idx); if (t == null) continue;
          cmds.push({m, act: "cast", s: sc.s, t});
        } else if (def.kind === "ally") {
          const t = await pickAlly(idx, false); if (t == null) continue;
          cmds.push({m, act: "cast", s: sc.s, t});
        } else if (def.kind === "fallen") {
          const t = await pickAlly(idx, true); if (t == null) continue;
          cmds.push({m, act: "cast", s: sc.s, t});
        } else {
          cmds.push({m, act: "cast", s: sc.s});
        }
        done = true;
      } else if (c.t === "pot") {
        const t = await pickAlly(idx, false); if (t == null) continue;
        cmds.push({m, act: "pot", t}); done = true;
      } else if (c.t === "def") { cmds.push({m, act: "def"}); done = true; }
      else if (c.t === "flee") { cmds.push({m, act: "flee"}); done = true; }
    }
  }
  cmdMenu("", []); $("cmd-title").textContent = "…";
  net.send({t: "menuclear"});
  return cmds;
}
async function pickEnemy(idx: number): Promise<number | null> {
  const opts = combat.enemies.map((e, i) => ({e, i})).filter(o => o.e.hp > 0)
    .map(o => ({t: `${o.e.n} · ${o.e.hp}`, v: {t: "pick", i: o.i}}));
  if (opts.length === 1) return (opts[0].v as {i: number}).i;
  const c = await ask(idx, "Strike whom?",
    (opts as CmdBtn[]).concat([{t: "Back", v: {t: "back"}, wide: true}])) as {t: string; i?: number};
  return c.t === "back" || c.i == null ? null : c.i;
}
async function pickAlly(idx: number, fallen: boolean): Promise<number | null> {
  const opts = state.party.map((m, i) => ({m, i})).filter(o => fallen ? o.m.down : !o.m.down)
    .map(o => ({t: `${o.m.name} · ${o.m.down ? "fallen" : o.m.hp + "/" + o.m.maxhp}`, v: {t: "pick", i: o.i}}));
  if (!opts.length) return null;
  const c = await ask(idx, fallen ? "Raise whom?" : "Aid whom?",
    (opts as CmdBtn[]).concat([{t: "Back", v: {t: "back"}, wide: true}])) as {t: string; i?: number};
  return c.t === "back" || c.i == null ? null : c.i;
}
function physDmg(atk: number, def: number, critCh?: number): [number, boolean] {
  let d = Math.max(1, Math.round(atk * (0.85 + rnd() * 0.3) - def * 0.5));
  if (rnd() < (critCh || 0.08)) { d = Math.round(d * 2); return [d, true]; }
  return [d, false];
}
function liveEnemy(i: number): EnemyInst | null { // retarget if dead
  if (combat.enemies[i] && combat.enemies[i].hp > 0) return combat.enemies[i];
  const l = combat.enemies.filter(e => e.hp > 0);
  return l.length ? l[ri(l.length)] : null;
}
const PACE = 440;
async function doPlayerAction(c: PlayerCmd): Promise<void> {
  const m = c.m;
  if (c.act === "atk") {
    const e = liveEnemy(c.t!); if (!e) return;
    const [d, crit] = physDmg(atkOf(m), e.def, CLASSES[m.cls].crit);
    e.hp -= d;
    clog(`${m.name} strikes ${e.n} for ${d}${crit ? " — a telling blow!" : "."}`);
    if (e.hp <= 0) { e.hp = 0; clog(`${e.n} falls.`); state.kills++; }
    await sleep(PACE);
  } else if (c.act === "cast" && c.s) {
    const def = SPELLS[c.s];
    if (m.mp < def.mp) return;
    m.mp -= def.mp;
    if (def.kind === "enemy") {
      const e = liveEnemy(c.t!); if (!e) return;
      let d = def.d(m); if (def.holy && e.undead) d = Math.round(d * 1.5);
      e.hp -= d; clog(`${m.name} ${def.txt} ${e.n} for ${d}.`);
      if (e.hp <= 0) { e.hp = 0; clog(`${e.n} falls.`); state.kills++; }
    } else if (def.kind === "enemies") {
      clog(`${m.name} casts ${def.n} — fire washes the cavern!`);
      for (const e of combat.enemies) {
        if (e.hp <= 0) continue;
        const d = Math.max(1, def.d(m) - Math.floor(e.def / 3)); e.hp -= d;
        if (e.hp <= 0) { e.hp = 0; state.kills++; }
      }
      if (combat.enemies.some(e => e.hp === 0)) clog(`The flames take their toll.`);
    } else if (def.kind === "ally") {
      const t = state.party[c.t!]; if (!t || t.down) return;
      const h = def.d(m); t.hp = Math.min(t.maxhp, t.hp + h);
      clog(`${m.name} ${def.txt} ${t.name} for ${h}.`);
    } else if (def.kind === "allies") {
      const h = def.d(m);
      for (const t of alive()) t.hp = Math.min(t.maxhp, t.hp + h);
      clog(`${m.name} lifts a prayer — the party is mended (+${h}).`);
    } else if (def.kind === "fallen") {
      const t = state.party[c.t!]; if (!t || !t.down) return;
      t.down = false; t.hp = Math.floor(t.maxhp / 2);
      clog(`${m.name} ${def.txt} ${t.name} from the dark!`);
    }
    await sleep(PACE);
  } else if (c.act === "pot") {
    if (state.potions <= 0) return;
    const t = state.party[c.t!]; if (!t || t.down) return;
    state.potions--; t.hp = Math.min(t.maxhp, t.hp + 35);
    clog(`${m.name} presses a potion to ${t.name}'s lips. (+35)`);
    await sleep(PACE);
  } else if (c.act === "def") {
    m.guard = true; clog(`${m.name} sets a guard.`); await sleep(260);
  } else if (c.act === "flee") {
    const ch = 0.55 + (m.spd - combat.enemies.reduce((a, e) => a + e.spd, 0) / combat.enemies.length) * 0.03;
    if (rnd() < ch) { combat.fled = true; clog("You break for the corridor!"); }
    else clog("No opening — they cut off your retreat!");
    await sleep(PACE);
  }
}
async function doEnemyAction(e: EnemyInst): Promise<void> {
  const targets = alive(); if (!targets.length) return;
  const t = targets[ri(targets.length)];
  if (e.boss && combat.round % 3 === 0) {
    clog(`${e.n} draws breath — FLAME sweeps the chamber!`);
    for (const m of alive()) {
      let d = Math.max(3, 14 + ri(7) - Math.floor(defOf(m) / 3));
      if (m.guard) d = Math.ceil(d / 2);
      m.hp -= d; if (m.hp <= 0) { m.hp = 0; m.down = true; clog(`${m.name} is engulfed and falls!`); }
    }
    await sleep(PACE + 200); return;
  }
  if (e.caster && rnd() < 0.35) {
    let d = Math.max(2, 12 + ri(6) - Math.floor(defOf(t) / 4));
    if (t.guard) d = Math.ceil(d / 2);
    t.hp -= d;
    clog(`${e.n} hurls emberfire at ${t.name} for ${d}.`);
    if (t.hp <= 0) { t.hp = 0; t.down = true; clog(`${t.name} falls!`); }
    await sleep(PACE); return;
  }
  const effDef = e.pierce ? Math.floor(defOf(t) / 2) : defOf(t);
  let [d] = physDmg(e.atk, effDef);
  if (t.guard) d = Math.ceil(d / 2);
  t.hp -= d;
  clog(`${e.n} tears at ${t.name} for ${d}.`);
  if (t.hp <= 0) { t.hp = 0; t.down = true; clog(`${t.name} falls!`); }
  await sleep(PACE);
}
async function combatVictory(): Promise<void> {
  const xp = combat.enemies.reduce((a, e) => a + e.xp, 0);
  const gold = combat.enemies.reduce((a, e) => a + e.g, 0) + ri(8);
  state.gold += gold;
  const each = Math.max(1, Math.floor(xp / alive().length));
  await sleep(500);
  clog(`Victory — ${gold} gold, ${each} experience each.`);
  for (const m of alive()) {
    m.xp += each;
    while (m.xp >= xpNeed(m.lvl)) {
      m.lvl++;
      const g = CLASSES[m.cls].g;
      m.maxhp += g.hp; m.hp += g.hp; m.maxmp += g.mp; m.mp += g.mp;
      m.atk += g.atk; m.def += g.def; m.spd += g.spd;
      clog(`${m.name} reaches level ${m.lvl}!`);
      const learned = CLASSES[m.cls].spells.filter(([, l]) => l === m.lvl).map(([s]) => SPELLS[s].n);
      if (learned.length) clog(`${m.name} learns ${learned.join(", ")}!`);
      await sleep(420);
    }
  }
  renderPlaques("cb-plaques");
  if (rnd() < 0.22 && !combat.isBoss) { state.potions++; clog("Among the remains: a stoppered potion, intact."); }
  if (combat.isBoss) {
    state.bossDown = true; state.heart = true;
    clog("Vhal's crown gutters out. In the ash lies the HEART OF EMBER, already cooling.");
    await sleep(1400);
    cmdMenu("", [{t: "Take the Heart and go on", v: 1, wide: true}]);
    await awaitChoice();
    save();
    backToDungeon("The Heart of Ember weighs your pack like a promise. The harbor is waiting.");
    return;
  }
  state.graceLeft = ENC_GRACE; save();
  cmdMenu("", [{t: "Press On", v: 1, wide: true}]);
  await awaitChoice();
  backToDungeon(null);
}
function backToDungeon(msg: string | null): void {
  show("scr-dungeon");
  renderPlaques("dg-plaques");
  if (msg) dlog(msg);
  renderView();
}
function combatDefeat(): void { save(); show("scr-dead"); }

/* ============================== DEFEAT / ENDING ============================== */
function bindEndScreens(): void {
  $("bt-dead-load").onclick = () => {
    const s = loadSave();
    if (s) {
      setState(s);
      if (!alive().length) { // saved state is also dead: rescue to temple
        for (const m of state.party) { m.down = false; m.hp = Math.max(1, Math.floor(m.maxhp * 0.3)); }
        state.gold = Math.floor(state.gold * 0.5); state.inDungeon = false;
        openTown("Fisherfolk drag you from the stairmouth, half-alive. Half your gold pays for the trouble.");
        return;
      }
      if (state.inDungeon) enterDungeon(false); else openTown();
    } else { show("scr-title"); }
  };
  $("bt-dead-title").onclick = () => show("scr-title");
  $("bt-end-continue").onclick = () => openTown("Vhalis breathes again. The caves below are quieter now — but not empty.");
  $("bt-end-title").onclick = () => show("scr-title");
  $("bt-shop-back").onclick = () => openTown();
  $("bt-temple-back").onclick = () => openTown();
}

/* ============================== CO-OP LINK ============================== */
let lastSync = "";
let guestActive = false;
interface SyncMsg {
  t: "sync"; screen: string; state: GameState; logLines: string[];
  combat: {enemies: EnemyInst[]; log: string[]; title: string} | null;
}
function snapshot(): NetMsg {
  return {
    t: "sync",
    screen: currentScreen,
    state,
    logLines,
    combat: currentScreen === "scr-combat" && combat
      ? {enemies: combat.enemies, log: combat.log, title: $("combat-title").textContent || ""}
      : null,
  };
}
setInterval(() => {
  if (net.role !== "host" || !net.connected || !state) return;
  const snap = snapshot();
  const j = JSON.stringify(snap);
  if (j !== lastSync) { lastSync = j; net.send(snap); }
}, 250);

function applySync(m: SyncMsg): void {
  if (!m.state) return;
  setState(m.state);
  logLines = m.logLines || [];
  const scr = m.screen;
  if (scr === "scr-dungeon") {
    if (currentScreen !== "scr-dungeon") show("scr-dungeon");
    renderPlaques("dg-plaques"); redrawLog(); renderView();
  } else if (scr === "scr-combat" && m.combat) {
    if (currentScreen !== "scr-combat") show("scr-combat");
    $("combat-title").textContent = m.combat.title;
    renderFoesData(m.combat.enemies); renderPlaques("cb-plaques"); redrawCombatLog(m.combat.log);
  } else if (scr === "scr-end") { show("scr-end");
  } else if (scr === "scr-dead") {
    show("scr-dead");
    $("bt-dead-load").style.display = "none"; // the host decides what happens next
  } else { // town, shop, temple, tavern — the host manages the surface world
    if (currentScreen !== "scr-town") show("scr-town");
    $("town-gold").textContent = String(state.gold);
    $("town-potions").textContent = String(state.potions);
    renderPlaques("town-plaques");
    $("town-menu").innerHTML = `<p class="dim">Your host walks the town — rest while the party provisions. You'll be swept along when they take the Old Stair.</p>`;
    $("town-msg").textContent = "";
  }
}

net.onPeerChange = () => {
  if (net.role === "host") {
    lastSync = ""; // force a full snapshot to the (dis)connected companion
    if (net.connected) {
      if (currentScreen === "scr-dungeon") dlog("A companion's torch joins yours.");
      else if (currentScreen === "scr-town") openTown("A companion has answered the signal fire.");
      if (remotePending) net.send({t: "menu", title: remotePending.title,
        btns: remotePending.btns.map(b => ({t: b.t, dis: !!b.dis, wide: !!b.wide}))});
    } else {
      if (remoteResolve) remoteResolve(-1); // take back control of their members
      if (currentScreen === "scr-dungeon") dlog("Your companion's torch gutters out — you walk alone again.");
    }
  } else if (guestActive && !net.connected) {
    guestActive = false; setSaveEnabled(true);
    show("scr-title");
    $("join-status").textContent = "The link was severed.";
  }
};

net.onMessage = m => {
  if (net.role === "host") {
    if (m.t === "input" && currentScreen === "scr-dungeon") {
      const a = m.a as string;
      if (a === "left") turn(-1); else if (a === "right") turn(1);
      else if (a === "fwd") step(false); else if (a === "back") step(true);
      else if (a === "potion") usePotionField();
    } else if (m.t === "choice" && remoteResolve) {
      remoteResolve(typeof m.i === "number" ? m.i : -1);
    }
  } else if (net.role === "guest") {
    if (m.t === "sync") applySync(m as unknown as SyncMsg);
    else if (m.t === "menu") {
      const btns = (m.btns as {t: string; dis: boolean; wide: boolean}[]) || [];
      $("cmd-title").textContent = (m.title as string) || "";
      const box = $("cmd-btns"); box.innerHTML = "";
      btns.forEach((b, i) => {
        const el = document.createElement("button");
        el.textContent = b.t; if (b.wide) el.className = "wide"; el.disabled = b.dis;
        el.onclick = () => { net.send({t: "choice", i}); box.innerHTML = ""; $("cmd-title").textContent = "…"; };
        box.appendChild(el);
      });
    } else if (m.t === "menuclear") {
      $("cmd-btns").innerHTML = ""; $("cmd-title").textContent = "…";
    }
  }
};

function bindJoin(): void {
  const codeEl = $("join-code") as HTMLInputElement;
  $("bt-join").onclick = () => {
    const code = codeEl.value.trim().toUpperCase();
    if (code.length !== 4) { $("join-status").textContent = "Codes are four characters — ask your host for theirs."; return; }
    $("join-status").textContent = "Following the signal…";
    net.join(code, err => {
      if (err) { $("join-status").textContent = "No fire answers that code. Check it and try again."; return; }
      guestActive = true;
      setSaveEnabled(false);
      $("join-status").textContent = "";
      show("scr-town");
      $("town-menu").innerHTML = `<p class="dim">Linked! Waiting for your host's world…</p>`;
      $("town-msg").textContent = "";
    });
  };
}

/* ============================== BOOT ============================== */
initTitle();
bindDungeonControls();
bindEndScreens();
bindJoin();
declare global { interface Window { __ei: unknown; } }
window.__ei = {
  get state() { return state; },
  startCombat, enterDungeon, openTown, save,
};
