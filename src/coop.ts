import type { GameState, EnemyInst } from "./types";
import { state, setState, setSaveEnabled } from "./state";
import { app } from "./bus";
import { net } from "./net";
import { show, currentScreen, renderPlaques, renderFoesData, redrawCombatLog } from "./ui";
import { $ } from "./util";
import { renderView } from "./render";
import { getLogLines, setLogLines, dlog } from "./dungeon";
import { sfx } from "./audio";

/* ============================== REMOTE COMBAT SEATS ============================== */
/* The last two party slots are commanded by the linked companion. */
interface WireBtn { t: string; dis: boolean; wide: boolean; }
let remoteResolve: ((i: number) => void) | null = null;
let remotePending: {title: string; btns: WireBtn[]} | null = null;

export function isRemoteSeat(idx: number): boolean {
  return net.role === "host" && net.connected && idx >= 2;
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

/* ============================== HOST → GUEST SYNC ============================== */
let lastSync = "";
let guestActive = false;

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
  setState(m.state);
  const scr = m.screen;
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
    $("town-menu").innerHTML = `<p class="dim">Your host walks the town — rest while the party provisions. You'll be swept along when they take the Old Stair.</p>`;
    $("town-msg").textContent = "";
  }
}

export function initCoop(): void {
  setInterval(() => {
    if (net.role !== "host" || !net.connected || !state) return;
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
        if (a === "left") app.turn(-1); else if (a === "right") app.turn(1);
        else if (a === "fwd") app.step(false); else if (a === "back") app.step(true);
        else if (a === "potion") app.usePotionField();
      } else if (m.t === "choice" && remoteResolve) {
        remoteResolve(typeof m.i === "number" ? m.i : -1);
      }
    } else if (net.role === "guest") {
      if (m.t === "sync") applySync(m as unknown as SyncMsg);
      else if (m.t === "menu") {
        const btns = (m.btns as WireBtn[]) || [];
        $("cmd-title").textContent = (m.title as string) || "";
        const box = $("cmd-btns"); box.innerHTML = "";
        btns.forEach((b, i) => {
          const el = document.createElement("button");
          el.textContent = b.t; if (b.wide) el.className = "wide"; el.disabled = b.dis;
          el.onclick = () => { sfx("tap"); net.send({t: "choice", i}); box.innerHTML = ""; $("cmd-title").textContent = "…"; };
          box.appendChild(el);
        });
      } else if (m.t === "menuclear") {
        $("cmd-btns").innerHTML = ""; $("cmd-title").textContent = "…";
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
      guestActive = true;
      setSaveEnabled(false);
      $("join-status").textContent = "";
      show("scr-town");
      $("town-menu").innerHTML = `<p class="dim">Linked! Waiting for your host's world…</p>`;
      $("town-msg").textContent = "";
    });
  };
}
