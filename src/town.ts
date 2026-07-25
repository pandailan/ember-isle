import { state, save, allCards } from "./state";
import { app } from "./bus";
import { show } from "./ui";
import { $ } from "./util";
import { WBONUS, WCOST, WNAME, ABONUS, ACOST, ANAME } from "./data";
import { net } from "./net";
import { setScene, sfx } from "./audio";

/** The harbor town is a place you walk: level 0 of the same engine. */
export function openTown(msg?: string): void {
  state.inDungeon = false;
  if (state.level !== 0) { state.level = 0; state.x = 7; state.y = 5; state.dir = 0; }
  save();
  setScene("town");
  app.enterWalk(msg ?? null);
}

/** Walking into a door or plaza fixture. */
export function townDoorBump(c: string): void {
  switch (c) {
    case "T": app.openTavern(); break;
    case "P": openShop(); break;
    case "M": openTemple(); break;
    case "O": app.enterDungeon(true); break;
    case "H":
      if (state.heart) app.showEnding();
      else app.dlog("The harbormaster shakes his head. “While the Ember burns below, the fog holds the bay.”");
      break;
    case "G": townSignal(); break;
    case "R":
      if (net.connected) app.openTrade();
      else app.dlog("An empty stall. With a companion linked, you could barter cards here.");
      break;
  }
}

function townSignal(): void {
  if (net.role === "host") {
    app.dlog(net.connected
      ? "The fire burns steady. Your companion walks with you."
      : `The fire is lit — share the code ${net.code}. A friend Joins from their title screen.`);
    return;
  }
  app.dlog("You stack driftwood and strike flint…");
  net.host((codeOrErr, ok) => {
    if (ok) app.dlog(`The signal fire roars up! Share the code ${codeOrErr} — your friend Joins from their title screen.`);
    else app.dlog("The fire gutters out — the far shore does not answer. (Co-op needs internet.)");
  });
}

export function showEnding(): void {
  $("end-stats").innerHTML = `steps taken ${state.steps} · foes felled ${state.kills} · gold ${state.gold}<br>` +
    state.party.map(m => `${m.name} — level ${m.lvl} ${m.cls}`).join("<br>");
  show("scr-end");
}

/* ============================== SHOP ============================== */
export function openShop(): void {
  $("shop-gold").textContent = String(state.gold);
  $("shop-potions").textContent = String(state.potions);
  const list = $("shop-list"); list.innerHTML = "";
  function row(info: string, dim: string, btn: string, cost: number, fn: () => void): void {
    const d = document.createElement("div"); d.className = "shoprow";
    d.innerHTML = `<span class="sinfo"><span>${info}</span><span class="dim">${dim}</span></span>`;
    const b = document.createElement("button"); b.textContent = btn;
    b.disabled = cost > state.gold; b.onclick = () => { fn(); sfx("tap"); openShop(); };
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
export function openTemple(msg?: string): void {
  $("temple-gold").textContent = String(state.gold);
  $("temple-msg").textContent = msg || "";
  const list = $("temple-list"); list.innerHTML = "";
  const fallen = allCards().filter(m => m.down);
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
      state.gold -= 50; m.down = false; m.hp = m.maxhp; m.mp = m.maxmp; save(); sfx("heal");
      openTemple(`${m.name} draws a long breath, tasting salt.`);
    };
    list.appendChild(b);
  }
  show("scr-temple");
}

export function bindTownScreens(): void {
  $("bt-shop-back").onclick = () => openTown();
  $("bt-temple-back").onclick = () => openTown();
}
