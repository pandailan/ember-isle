import type { Member, EnemyInst, CombatState, PlayerCmd } from "./types";
import { CLASSES, SPELLS, ENEMIES, ENC_GRACE, ITEMS } from "./data";
import { findCarrier } from "./items";
import { grantBossCard } from "./binder";
import { state, save, alive, defOf, xpNeed } from "./state";
import {
  atkOf, critOf, spdOf, mitigate, healAmount, spellPower, spellCost,
  fleeBonus, goldMult, potionHeal, spellsOf, hasFlag,
} from "./traits";
import { app } from "./bus";
import { show, renderPlaques, renderFoesData, redrawCombatLog } from "./ui";
import { $, sleep, rnd, ri } from "./util";
import { askRemote, isRemoteSeat, clearRemoteMenu } from "./coop";
import { setScene, sfx } from "./audio";

let combat: CombatState = null as unknown as CombatState;
let choiceResolve: ((v: unknown) => void) | null = null;
const PACE = 440;

export function combatSnapshot(): {enemies: EnemyInst[]; log: string[]; title: string} | null {
  if (!combat || !$("scr-combat").classList.contains("on")) return null;
  return {enemies: combat.enemies, log: combat.log, title: $("combat-title").textContent || ""};
}

function clog(msg: string): void {
  combat.log.push(msg); if (combat.log.length > 4) combat.log.shift();
  redrawCombatLog(combat.log);
}
function renderFoes(): void { renderFoesData(combat.enemies); }

/* Floating damage numbers & hit shakes, flushed after each re-render. */
interface Pop { side: "e" | "p"; idx: number; text: string; cls: string; }
let pendingPops: Pop[] = [];
function pop(side: "e" | "p", idx: number, text: string, cls = ""): void {
  pendingPops.push({side, idx, text, cls});
}
function flushPops(): void {
  for (const p of pendingPops) {
    const sel = p.side === "e" ? "#foes .foe" : "#cb-plaques .plaque";
    const el = document.querySelectorAll<HTMLElement>(sel)[p.idx];
    if (!el) continue;
    const span = document.createElement("span");
    span.className = "pop " + p.cls;
    span.textContent = p.text;
    el.appendChild(span);
    el.classList.remove("hit"); void el.offsetWidth; el.classList.add("hit");
    setTimeout(() => span.remove(), 950);
  }
  pendingPops = [];
}
function enemyIdx(e: EnemyInst): number { return combat.enemies.indexOf(e); }
function memberIdx(m: Member): number { return state.party.indexOf(m); }

function awaitChoice<T>(): Promise<T> {
  return new Promise<T>(r => { choiceResolve = r as (v: unknown) => void; });
}
function choose(v: unknown): void {
  if (choiceResolve) { const r = choiceResolve; choiceResolve = null; r(v); }
}
export interface CmdBtn { t: string; v: unknown; wide?: boolean; dis?: boolean; }
export function cmdMenu(title: string, btns: CmdBtn[]): void {
  $("cmd-title").textContent = title;
  const box = $("cmd-btns"); box.innerHTML = "";
  for (const b of btns) {
    const el = document.createElement("button");
    el.textContent = b.t; if (b.wide) el.className = "wide";
    if (b.dis) el.disabled = true;
    el.onclick = () => { sfx("tap"); choose(b.v); };
    box.appendChild(el);
  }
}

async function ask(idx: number, title: string, btns: CmdBtn[]): Promise<unknown> {
  if (isRemoteSeat(idx)) {
    $("cmd-title").textContent = `${state.party[idx].name} — your companion decides…`;
    $("cmd-btns").innerHTML = "";
    const i = await askRemote(title, btns.map(b => ({t: b.t, dis: !!b.dis, wide: !!b.wide})));
    if (i < 0) { // companion dropped mid-choice: fall back to local control
      cmdMenu(title, btns);
      return awaitChoice();
    }
    return btns[i] ? btns[i].v : {t: "back"};
  }
  cmdMenu(title, btns);
  return awaitChoice();
}

export function startCombat(groupKeys: string[], isBoss: boolean): void {
  combat = {
    enemies: groupKeys.map((k, i) => {
      const d = ENEMIES[k];
      const suffix = groupKeys.filter(g => g === k).length > 1
        ? " " + String.fromCharCode(65 + groupKeys.slice(0, i).filter(g => g === k).length) : "";
      return {...d, n: d.n + suffix, hp: d.hp, maxhp: d.hp, key: k} as EnemyInst;
    }),
    isBoss, log: [], round: 0, fled: false,
  };
  setScene("combat"); sfx("combat");
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
    type Act = {side: "p"; spd: number; c: PlayerCmd} | {side: "e"; spd: number; e: EnemyInst};
    const acts: Act[] = [
      ...cmds.map(c => ({side: "p" as const, spd: spdOf(c.m) + rnd() * 3, c})),
      ...combat.enemies.filter(e => e.hp > 0).map(e => ({side: "e" as const, spd: e.spd + rnd() * 3, e})),
    ].sort((a, b) => b.spd - a.spd);
    for (const a of acts) {
      if (combat.enemies.every(e => e.hp <= 0)) break;
      if (!alive().length) break;
      if (combat.fled) break;
      if (a.side === "p") { if (!a.c.m.down) await doPlayerAction(a.c); }
      else { if (a.e.hp > 0) await doEnemyAction(a.e); }
      renderFoes(); renderPlaques("cb-plaques"); flushPops();
    }
    if (combat.fled) break;
    if (combat.enemies.every(e => e.hp <= 0)) { await combatVictory(); return; }
    if (!alive().length) { await sleep(700); combatDefeat(); return; }
  }
  // fled
  await sleep(500);
  state.graceLeft = ENC_GRACE + 2;
  app.combatFled(); save();
  app.backToDungeon("You run until the torchlight steadies. Nothing follows. Probably.");
}

async function collectCommands(): Promise<PlayerCmd[]> {
  const cmds: PlayerCmd[] = [];
  for (let idx = 0; idx < state.party.length; idx++) {
    const m = state.party[idx];
    if (m.down) continue;
    let done = false;
    while (!done) {
      const usable = spellsOf(m).filter(s => m.mp >= spellCost(m, SPELLS[s]));
      const c = await ask(idx, `${m.name} — your move`, [
        {t: "Attack", v: {t: "atk"}},
        {t: "Spell / Art", v: {t: "sp"}, dis: !usable.length},
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
          t: `${SPELLS[s].n}${spellCost(m, SPELLS[s]) > 0 ? " · " + spellCost(m, SPELLS[s]) + " MP" : ""}`,
          v: {t: "cast", s}, dis: m.mp < spellCost(m, SPELLS[s]),
        }));
        const sc = await ask(idx, `${m.name} — which art?`,
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
  clearRemoteMenu();
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

function physDmg(atk: number, def: number, critCh: number): [number, boolean] {
  let d = Math.max(1, Math.round(atk * (0.85 + rnd() * 0.3) - def * 0.5));
  if (rnd() < critCh) { d = Math.round(d * 2); return [d, true]; }
  return [d, false];
}
function liveEnemy(i: number): EnemyInst | null { // retarget if dead
  if (combat.enemies[i] && combat.enemies[i].hp > 0) return combat.enemies[i];
  const l = combat.enemies.filter(e => e.hp > 0);
  return l.length ? l[ri(l.length)] : null;
}
function hitEnemy(e: EnemyInst, d: number): void {
  e.hp -= d;
  if (e.hp <= 0) { e.hp = 0; clog(`${e.n} falls.`); state.kills++; }
}
function hurtMember(t: Member, raw: number, fire = false): void {
  const d = mitigate(t, raw, fire);
  t.hp -= d;
  if (t.hp <= 0) { t.hp = 0; t.down = true; }
}

async function doPlayerAction(c: PlayerCmd): Promise<void> {
  const m = c.m;
  if (c.act === "atk") {
    const e = liveEnemy(c.t!); if (!e) return;
    const [d, crit] = physDmg(atkOf(m), e.def, critOf(m));
    sfx(crit ? "crit" : "hit");
    clog(`${m.name} strikes ${e.n} for ${d}${crit ? " — a telling blow!" : "."}`);
    pop("e", enemyIdx(e), `-${d}`, crit ? "crit" : "");
    hitEnemy(e, d);
    await sleep(PACE);
  } else if (c.act === "cast" && c.s) {
    const def = SPELLS[c.s];
    const cost = spellCost(m, def);
    if (m.mp < cost) return;
    m.mp -= cost;
    if (def.phys) { // weapon arts
      sfx("hit");
      const targets = def.kind === "enemies"
        ? combat.enemies.filter(e => e.hp > 0)
        : [liveEnemy(c.t!)].filter((e): e is EnemyInst => !!e);
      clog(`${m.name} ${def.txt} ${def.kind === "enemies" ? "the whole pack" : targets[0]?.n ?? ""}!`);
      for (const e of targets) {
        for (let h = 0; h < (def.hits ?? 1); h++) {
          if (e.hp <= 0) break;
          const [d, crit] = physDmg(atkOf(m) * (def.mult ?? 1), e.def, critOf(m) + (def.critBonus ?? 0));
          clog(`— ${e.n} takes ${d}${crit ? ", a telling blow!" : "."}`);
          pop("e", enemyIdx(e), `-${d}`, crit ? "crit" : "");
          hitEnemy(e, d);
        }
      }
    } else if (def.kind === "enemy") {
      const e = liveEnemy(c.t!); if (!e) return;
      sfx("spell");
      let d = spellPower(m, def.d!(m)); if (def.holy && e.undead) d = Math.round(d * 1.5);
      clog(`${m.name} ${def.txt} ${e.n} for ${d}.`);
      pop("e", enemyIdx(e), `-${d}`, "spell");
      hitEnemy(e, d);
    } else if (def.kind === "enemies") {
      sfx("spell");
      clog(`${m.name} casts ${def.n} — fire washes the cavern!`);
      for (const e of combat.enemies) {
        if (e.hp <= 0) continue;
        const d = Math.max(1, spellPower(m, def.d!(m)) - Math.floor(e.def / 3));
        pop("e", enemyIdx(e), `-${d}`, "spell");
        hitEnemy(e, d);
      }
    } else if (def.kind === "ally") {
      const t = state.party[c.t!]; if (!t || t.down) return;
      sfx("heal");
      const h = healAmount(def.d!(m), m, t); t.hp = Math.min(t.maxhp, t.hp + h);
      clog(`${m.name} ${def.txt} ${t.name} for ${h}.`);
      pop("p", c.t!, `+${h}`, "heal");
    } else if (def.kind === "allies") {
      sfx("heal");
      clog(`${m.name} lifts a prayer — the party is mended.`);
      for (const t of alive()) {
        const h = healAmount(def.d!(m), m, t);
        t.hp = Math.min(t.maxhp, t.hp + h);
        pop("p", memberIdx(t), `+${h}`, "heal");
      }
    } else if (def.kind === "fallen") {
      const t = state.party[c.t!]; if (!t || !t.down) return;
      sfx("heal");
      t.down = false; t.hp = Math.floor(t.maxhp / 2);
      clog(`${m.name} ${def.txt} ${t.name} from the dark!`);
      pop("p", c.t!, "risen", "heal");
    }
    await sleep(PACE);
  } else if (c.act === "pot") {
    if (state.potions <= 0) return;
    const t = state.party[c.t!]; if (!t || t.down) return;
    sfx("heal");
    const heal = potionHeal(state.party);
    state.potions--; t.hp = Math.min(t.maxhp, t.hp + heal);
    clog(`${m.name} presses a potion to ${t.name}'s lips. (+${heal})`);
    pop("p", c.t!, `+${heal}`, "heal");
    await sleep(PACE);
  } else if (c.act === "def") {
    m.guard = true; clog(`${m.name} sets a guard.`); await sleep(260);
  } else if (c.act === "flee") {
    const avgSpd = combat.enemies.reduce((a, e) => a + e.spd, 0) / combat.enemies.length;
    const ch = 0.55 + (spdOf(m) - avgSpd) * 0.03 + fleeBonus(m);
    if (rnd() < ch) { combat.fled = true; clog("You break for the corridor!"); }
    else clog("No opening — they cut off your retreat!");
    await sleep(PACE);
  }
}

async function doEnemyAction(e: EnemyInst): Promise<void> {
  const targets = alive(); if (!targets.length) return;
  const t = targets[ri(targets.length)];
  if (e.boss && combat.round % 3 === 0) {
    sfx("spell");
    clog(`${e.n} draws breath — FLAME sweeps the chamber!`);
    for (const m of alive()) {
      const before = m.hp;
      hurtMember(m, 14 + ri(7) - Math.floor(defOf(m) / 3), true);
      pop("p", memberIdx(m), `-${before - m.hp}`, "");
      if (m.down) clog(`${m.name} is engulfed and falls!`);
    }
    await sleep(PACE + 200); return;
  }
  if (e.caster && rnd() < 0.35) {
    sfx("spell");
    const raw = Math.max(2, 12 + ri(6) - Math.floor(defOf(t) / 4));
    const before = t.hp;
    hurtMember(t, raw, true);
    pop("p", memberIdx(t), `-${before - t.hp}`, "spell");
    clog(`${e.n} hurls emberfire at ${t.name}.`);
    if (t.down) clog(`${t.name} falls!`);
    await sleep(PACE); return;
  }
  if (hasFlag(t, "dodge") && rnd() < 0.12) {
    clog(`${e.n} lunges — ${t.name} is simply not there.`);
    pop("p", memberIdx(t), "miss", "miss");
    await sleep(PACE); return;
  }
  sfx("hit");
  const effDef = e.pierce ? Math.floor(defOf(t) / 2) : defOf(t);
  const [raw] = physDmg(e.atk, effDef, 0.08);
  const before = t.hp;
  hurtMember(t, raw);
  pop("p", memberIdx(t), `-${before - t.hp}`, "");
  clog(`${e.n} tears at ${t.name}.`);
  if (t.down) clog(`${t.name} falls!`);
  await sleep(PACE);
}

async function combatVictory(): Promise<void> {
  const xp = combat.enemies.reduce((a, e) => a + e.xp, 0);
  const gold = Math.round((combat.enemies.reduce((a, e) => a + e.g, 0) + ri(8)) * goldMult(state.party));
  const each = Math.max(1, Math.floor(xp / alive().length));
  await sleep(500);
  sfx("victory");
  if (state.coopGuestIds?.length) { // split the spoils with the linked companion
    const guestShare = Math.floor(gold / 2);
    state.gold += gold - guestShare;
    state.guestGoldOwed = (state.guestGoldOwed ?? 0) + guestShare;
    clog(`Victory — ${gold} gold split with your companion, ${each} experience each.`);
  } else {
    state.gold += gold;
    clog(`Victory — ${gold} gold, ${each} experience each.`);
  }
  for (const m of alive()) {
    m.xp += each;
    while (m.xp >= xpNeed(m.lvl)) {
      m.lvl++;
      const g = CLASSES[m.cls].g;
      m.maxhp += g.hp; m.hp += g.hp; m.maxmp += g.mp; m.mp += g.mp;
      m.atk += g.atk; m.def += g.def; m.spd += g.spd;
      m.ap++;
      sfx("levelup");
      clog(`${m.name} reaches level ${m.lvl}! (+1 attribute point)`);
      if (m.lvl % 2 === 0) { m.sp++; clog(`${m.name} earns a skill point — spend it at the tavern.`); }
      const learned = CLASSES[m.cls].spells.filter(([, l]) => l === m.lvl).map(([s]) => SPELLS[s].n);
      if (learned.length) clog(`${m.name} learns ${learned.join(", ")}!`);
      await sleep(420);
    }
  }
  renderPlaques("cb-plaques");
  // trophies: some foes leave something worth hauling home
  for (const e of combat.enemies) {
    const drop = ENEMIES[e.key]?.drop;
    if (!drop || rnd() > drop[1]) continue;
    const it = ITEMS[drop[0]];
    const carrier = findCarrier(state.party, drop[0]);
    if (carrier) { carrier.items.push(drop[0]); clog(`${carrier.name} takes the ${it.n.toLowerCase()} (${it.w} wt).`); }
    else clog(`A ${it.n.toLowerCase()} is left behind — every back is full.`);
  }
  if (rnd() < 0.22 && !combat.isBoss) { state.potions++; clog("Among the remains: a stoppered potion, intact."); }
  if (combat.isBoss) {
    state.bossDown = true; state.heart = true;
    clog("Vhal's crown gutters out. In the ash lies the HEART OF EMBER, already cooling.");
    grantBossCard();
    clog("Beneath it, unburnt: a sealed card — a RITE OF RETURN.");
    await sleep(1400);
    cmdMenu("", [{t: "Take the Heart and go on", v: 1, wide: true}]);
    await awaitChoice();
    save();
    app.backToDungeon("The Heart of Ember weighs your pack like a promise. The harbor is waiting.");
    return;
  }
  state.graceLeft = ENC_GRACE;
  app.combatWon(); save();
  cmdMenu("", [{t: "Press On", v: 1, wide: true}]);
  await awaitChoice();
  app.backToDungeon(null);
}

function combatDefeat(): void {
  sfx("defeat"); save();
  $("bt-dead-load").style.display = ""; // may have been hidden while mirroring a host
  show("scr-dead");
}

/** Host migration: the last synced fight, rebuilt and continued locally. */
export function adoptCombat(enemies: EnemyInst[]): void {
  const keys = enemies.map(e => e.key);
  startCombat(keys, enemies.some(e => !!e.boss));
  combat.enemies.forEach((e, i) => {
    if (enemies[i]) { e.hp = enemies[i].hp; e.maxhp = enemies[i].maxhp; }
  });
  renderFoesData(combat.enemies);
  clog("The link is severed — the whole line is yours to command now.");
}
