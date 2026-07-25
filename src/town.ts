import { state, save, allCards } from "./state";
import { app } from "./bus";
import { show, renderPlaques } from "./ui";
import { $ } from "./util";
import { WBONUS, WCOST, WNAME, ABONUS, ACOST, ANAME } from "./data";
import { net } from "./net";
import { setScene, sfx } from "./audio";

export function openTown(msg?: string): void {
  state.inDungeon = false; save();
  setScene("town");
  $("town-gold").textContent = String(state.gold);
  $("town-potions").textContent = String(state.potions);
  $("town-msg").textContent = msg || "";
  renderPlaques("town-plaques");
  const menu = $("town-menu"); menu.innerHTML = "";
  const opts: [string, string, () => void][] = [
    ["The Salted Gull", "company, recruits & rest", () => app.openTavern()],
    ["Ember & Anchor Provisions", "potions & gear", openShop],
    ["Temple of the Tide", "raise the fallen", () => openTemple()],
    ["The Old Stair", "descend into the caves", () => app.enterDungeon(true)],
    ["The Harbor", state.heart ? "a ship waits" : "no ship will sail", townHarbor],
    ["The Signal Fire",
      net.role === "host" ? (net.connected ? "companion linked" : `code ${net.code} — waiting`) : "invite a friend (co-op)",
      townSignal],
  ];
  if (net.connected) opts.push(["The Trading Post", "barter cards with your companion", () => app.openTrade()]);
  for (const [t, h, fn] of opts) {
    const b = document.createElement("button");
    b.innerHTML = `<span>${t}</span><span class="hint">${h}</span>`;
    b.onclick = fn; menu.appendChild(b);
  }
  show("scr-town");
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
  if (state.heart) { app.showEnding(); }
  else $("town-msg").textContent = "The harbormaster shakes his head. “While the Ember burns below, the fog holds the bay. Bring me proof it's out.”";
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
