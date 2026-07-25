import type { GameState, EnemyInst, Member } from "./types";
import { state, setState, setSaveEnabled, save, loadSave } from "./state";
import { SAVE_KEY } from "./data";
import { sanitizeCard, cleanupLend } from "./cards";
import { app } from "./bus";
import { net } from "./net";
import { show, currentScreen, renderPlaques, renderFoesData, redrawCombatLog } from "./ui";
import { $ } from "./util";
import { renderView } from "./render";
import { getLogLines, setLogLines, dlog } from "./dungeon";
import { openPicker } from "./tavern";
import { sfx } from "./audio";
import {
  initTrade, onTradeMessage, tradeLinkLost, forceLeaveForCombat, isAtTradePost,
  openTradePost, type TradeWorld,
} from "./trade";

/* ============================== REMOTE COMBAT SEATS ============================== */
/* With a loan active, the companion commands their own cards; otherwise
   (companion-mode fallback) they command the host's rear two seats. */
interface WireBtn { t: string; dis: boolean; wide: boolean; }
let remoteResolve: ((i: number) => void) | null = null;
let remotePending: {title: string; btns: WireBtn[]} | null = null;
let guestReady = false; // the guest has finished its lend/companion decision

export function isRemoteSeat(idx: number): boolean {
  if (net.role !== "host" || !net.connected || !guestReady) return false;
  if (state.coopGuestIds?.length) return state.coopGuestIds.includes(state.party[idx]?.id);
  return idx >= 2;
}

export function askRemote(title: string, btns: WireBtn[]): Promise<number> {
  remotePending = {title, btns};
  net.send({t: "menu", title, btns});
  return new Promise<number>(res => {
    remoteResolve = i => { remotePending = null; remoteResolve = null; res(i); };
  });
}

export function clearRemoteMenu(): void {
  if (net.role === "host" && net.connected) net.send({t: "menuclear"});
}

/* ============================== CARD LENDING (host side) ============================== */
let pendingLend: Member[] | null = null;
let pendingUnlend = false;

function inCombat(): boolean { return currentScreen === "scr-combat"; }

function applyLend(cards: Member[]): void {
  if (state.coopGuestIds?.length) return; // one loan at a time
  const displaced = state.party.splice(2, 2);
  state.collection.push(...displaced);
  state.coopDisplacedIds = displaced.map(c => c.id);
  state.party.push(...cards);
  state.coopGuestIds = cards.map(c => c.id);
  state.guestGoldOwed = 0;
  save(); sfx("recruit");
  const names = cards.map(c => c.name).join(" and ");
  if (currentScreen === "scr-dungeon") {
    dlog(`${names} step out of the signal fire's light and fall in beside you.`);
    renderPlaques("dg-plaques");
  } else if (currentScreen === "scr-town") {
    app.openTown(`${names} step out of the signal fire's light. ${displaced.map(c => c.name).join(" and ") || "No one"} head${displaced.length === 1 ? "s" : ""} to the tavern benches.`);
  }
}

function applyUnlend(reason: string): void {
  if (!state.coopGuestIds?.length) return;
  cleanupLend(state);
  save();
  if (currentScreen === "scr-dungeon") { dlog(reason); renderPlaques("dg-plaques"); }
  else if (currentScreen === "scr-town") app.openTown(reason);
}

/* ============================== GUEST SIDE ============================== */
let guestActive = false;
let ownSave: GameState | null = null;   // the guest's real world, kept safe while mirroring
let lentIds: string[] = [];
let lastGoldOwed = 0;
let lastMerge = "";

function guestMergeProgress(hostState: GameState): void {
  if (!ownSave || !lentIds.length) return;
  const pool = [...hostState.party, ...hostState.collection];
  let changed = false;
  for (const id of lentIds) {
    const updated = pool.find(c => c.id === id);
    if (!updated) continue;
    const clean: Member = {...updated, guard: false};
    const put = (arr: Member[]) => {
      const i = arr.findIndex(c => c.id === id);
      if (i >= 0) { arr[i] = clean; return true; }
      return false;
    };
    if (put(ownSave.party) || put(ownSave.collection)) changed = true;
  }
  const owed = hostState.guestGoldOwed ?? 0;
  if (owed > lastGoldOwed) { ownSave.gold += owed - lastGoldOwed; lastGoldOwed = owed; changed = true; }
  if (!changed) return;
  const j = JSON.stringify(ownSave);
  if (j === lastMerge) return;
  lastMerge = j;
  try { localStorage.setItem(SAVE_KEY, j); } catch { /* private mode */ }
}

function offerLend(): void {
  ownSave = loadSave();
  const lendable = ownSave ? [...ownSave.party, ...ownSave.collection].filter(c => !c.down) : [];
  if (!ownSave || lendable.length < 2) {
    // companion mode: no cards of their own yet
    enterMirror("Linked! You fight with your host's crew tonight — play your own expedition sometime and you can bring your own cards.");
    return;
  }
  openPicker(lendable, 2, {
    title: "The Signal Fire",
    blurb: `The flames will carry <b style="color:var(--parch)">two</b> of your cards into your
      friend's world. They fight there, and bring home the experience — and half the gold.`,
    button: "Send Through the Fire",
  }, chosen => {
    lentIds = chosen.map(c => c.id);
    lastGoldOwed = 0;
    net.send({t: "lend", cards: chosen as unknown as Record<string, unknown>[]});
    sfx("spell");
    enterMirror("Your cards step into the flame. Waiting for your host's world…");
  });
}

function persistOwnSave(): void {
  if (!ownSave) return;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(ownSave)); } catch { /* private mode */ }
}

/** The guest's parked-world town view, with a door to the Trading Post. */
function mirrorTownMenu(msg: string): void {
  $("town-menu").innerHTML = `<p class="dim">${msg}</p>`;
  const bt = document.createElement("button");
  bt.id = "bt-guest-trade";
  bt.innerHTML = `<span>The Trading Post</span><span class="hint">barter cards with your host</span>`;
  bt.onclick = () => openTradePost();
  $("town-menu").appendChild(bt);
}

let bufferedMenu: {title: string; btns: WireBtn[]} | null = null;
function enterMirror(msg: string): void {
  guestActive = true;
  setSaveEnabled(false); // never let the host's mirrored world overwrite our own save
  if (net.role === "guest" && !lentIds.length) net.send({t: "companion"});
  show("scr-town");
  mirrorTownMenu(msg);
  $("town-msg").textContent = "";
  $("join-status").textContent = "";
  if (bufferedMenu) { const b = bufferedMenu; bufferedMenu = null; renderGuestMenu(b.title, b.btns); }
}

function renderGuestMenu(title: string, btns: WireBtn[]): void {
  $("cmd-title").textContent = title || "";
  const box = $("cmd-btns"); box.innerHTML = "";
  btns.forEach((b, i) => {
    const el = document.createElement("button");
    el.textContent = b.t; if (b.wide) el.className = "wide"; el.disabled = b.dis;
    el.onclick = () => { sfx("tap"); net.send({t: "choice", i}); box.innerHTML = ""; $("cmd-title").textContent = "…"; };
    box.appendChild(el);
  });
}

/* ============================== HOST → GUEST SYNC ============================== */
let lastSync = "";

interface SyncMsg {
  t: "sync"; screen: string; state: GameState; logLines: string[];
  combat: {enemies: EnemyInst[]; log: string[]; title: string} | null;
}

function snapshot(): SyncMsg {
  return {
    t: "sync",
    screen: currentScreen,
    state,
    logLines: getLogLines(),
    combat: app.combatSnapshot(),
  };
}

function applySync(m: SyncMsg): void {
  if (!m.state) return;
  guestMergeProgress(m.state);
  setState(m.state);
  const scr = m.screen;
  if (isAtTradePost()) {
    // the post holds the screen — only a battle drags the guest away
    if (scr === "scr-combat" && m.combat) forceLeaveForCombat();
    else return;
  }
  if (scr === "scr-dungeon") {
    if (currentScreen !== "scr-dungeon") show("scr-dungeon");
    renderPlaques("dg-plaques"); setLogLines(m.logLines || []); renderView();
  } else if (scr === "scr-combat" && m.combat) {
    if (currentScreen !== "scr-combat") show("scr-combat");
    $("combat-title").textContent = m.combat.title;
    renderFoesData(m.combat.enemies); renderPlaques("cb-plaques"); redrawCombatLog(m.combat.log);
  } else if (scr === "scr-end") { show("scr-end");
  } else if (scr === "scr-dead") {
    show("scr-dead");
    $("bt-dead-load").style.display = "none"; // the host decides what happens next
  } else { // town, tavern, shop, temple — the host manages the surface world
    if (currentScreen !== "scr-town") show("scr-town");
    $("town-gold").textContent = String(state.gold);
    $("town-potions").textContent = String(state.potions);
    renderPlaques("town-plaques");
    mirrorTownMenu("Your host walks the town — rest while the party provisions. You'll be swept along when they take the Old Stair.");
    $("town-msg").textContent = "";
  }
}

/* ============================== TRADE WORLD ADAPTERS ============================== */
const hostWorld: TradeWorld = {
  gold: () => state.gold,
  addGold: n => { state.gold += n; },
  tradeables: () => {
    const excluded = new Set([...(state.coopGuestIds ?? []), ...(state.coopDisplacedIds ?? [])]);
    return [...state.party, ...state.collection].filter(c => !excluded.has(c.id));
  },
  removeCard: id => {
    let i = state.party.findIndex(c => c.id === id);
    if (i >= 0) return state.party.splice(i, 1)[0];
    i = state.collection.findIndex(c => c.id === id);
    return i >= 0 ? state.collection.splice(i, 1)[0] : null;
  },
  addCard: c => { state.collection.push(c); },
  commit: () => save(),
  notify: msg => {
    if (currentScreen === "scr-dungeon") dlog(msg);
    else if (currentScreen === "scr-town") $("town-msg").textContent = msg;
  },
  leave: () => app.openTown(),
};

const guestWorld: TradeWorld = {
  gold: () => ownSave?.gold ?? 0,
  addGold: n => { if (ownSave) ownSave.gold += n; },
  tradeables: () => ownSave
    ? [...ownSave.party, ...ownSave.collection].filter(c => !lentIds.includes(c.id))
    : [],
  removeCard: id => {
    if (!ownSave) return null;
    let i = ownSave.party.findIndex(c => c.id === id);
    if (i >= 0) return ownSave.party.splice(i, 1)[0];
    i = ownSave.collection.findIndex(c => c.id === id);
    return i >= 0 ? ownSave.collection.splice(i, 1)[0] : null;
  },
  addCard: c => { ownSave?.collection.push(c); },
  commit: () => persistOwnSave(),
  notify: msg => { if (currentScreen === "scr-town") $("town-msg").textContent = msg; },
  leave: () => {
    if (guestActive) enterMirror("Back from the post. Your host plays on.");
    else show("scr-title");
  },
};

export function initCoop(): void {
  initTrade(() => net.role === "guest" ? guestWorld : hostWorld);
  setInterval(() => {
    if (net.role !== "host" || !state) return;
    // deferred loan changes wait for combat to end
    if (!inCombat()) {
      if (pendingUnlend) { pendingUnlend = false; applyUnlend("Your companion's cards fade back into the fire."); }
      if (pendingLend && net.connected) { const c = pendingLend; pendingLend = null; applyLend(c); }
    }
    if (!net.connected) return;
    const snap = snapshot();
    const j = JSON.stringify(snap);
    if (j !== lastSync) { lastSync = j; net.send(snap as unknown as Record<string, unknown> & {t: string}); }
  }, 250);

  net.onPeerChange = () => {
    if (net.role === "host") {
      lastSync = ""; // force a full snapshot to the (dis)connected companion
      if (net.connected) {
        if (currentScreen === "scr-dungeon") dlog("A companion's torch joins yours.");
        else if (currentScreen === "scr-town") app.openTown("A companion has answered the signal fire.");
        if (remotePending) net.send({t: "menu", title: remotePending.title, btns: remotePending.btns});
      } else {
        if (remoteResolve) remoteResolve(-1); // take back control of their seats
        pendingLend = null; guestReady = false;
        tradeLinkLost();
        if (inCombat()) pendingUnlend = true;
        else applyUnlend("The link breaks — your companion's cards fade back into the fire.");
        if (currentScreen === "scr-dungeon" && !state.coopGuestIds?.length)
          dlog("Your companion's torch gutters out — you walk alone again.");
      }
    } else if (guestActive && !net.connected) {
      tradeLinkLost();
      guestActive = false; setSaveEnabled(true);
      ownSave = null; lentIds = []; lastGoldOwed = 0; lastMerge = "";
      show("scr-title");
      $("join-status").textContent = "The link was severed. Your cards remember what they learned.";
    }
  };

  net.onMessage = m => {
    if (onTradeMessage(m)) return;
    if (net.role === "host") {
      if (m.t === "input" && currentScreen === "scr-dungeon") {
        const a = m.a as string;
        if (a === "left") app.turn(-1); else if (a === "right") app.turn(1);
        else if (a === "fwd") app.step(false); else if (a === "back") app.step(true);
        else if (a === "potion") app.usePotionField();
      } else if (m.t === "choice" && remoteResolve) {
        remoteResolve(typeof m.i === "number" ? m.i : -1);
      } else if (m.t === "lend") {
        const cards = (Array.isArray(m.cards) ? m.cards : [])
          .map(sanitizeCard).filter((c): c is Member => !!c).slice(0, 2);
        if (cards.length !== 2 || state.coopGuestIds?.length) return;
        guestReady = true;
        if (inCombat()) pendingLend = cards;
        else applyLend(cards);
      } else if (m.t === "companion") {
        guestReady = true;
      }
    } else if (net.role === "guest") {
      // until the lend/companion decision is made, the picker owns the screen
      if (m.t === "sync") { if (guestActive) applySync(m as unknown as SyncMsg); }
      else if (m.t === "menu") {
        const menu = {title: (m.title as string) || "", btns: (m.btns as WireBtn[]) || []};
        if (isAtTradePost()) forceLeaveForCombat(); // battle outranks bartering
        if (guestActive) renderGuestMenu(menu.title, menu.btns);
        else bufferedMenu = menu;
      } else if (m.t === "menuclear") {
        bufferedMenu = null;
        if (guestActive) { $("cmd-btns").innerHTML = ""; $("cmd-title").textContent = "…"; }
      }
    }
  };

  const codeEl = $("join-code") as HTMLInputElement;
  $("bt-join").onclick = () => {
    const code = codeEl.value.trim().toUpperCase();
    if (code.length !== 4) { $("join-status").textContent = "Codes are four characters — ask your host for theirs."; return; }
    $("join-status").textContent = "Following the signal…";
    net.join(code, err => {
      if (err) { $("join-status").textContent = "No fire answers that code. Check it and try again."; return; }
      offerLend();
    });
  };
}
