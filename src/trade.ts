import type { Member } from "./types";
import type { NetMsg } from "./net";
import { net } from "./net";
import { show, currentScreen } from "./ui";
import { $ } from "./util";
import { cardHTML, sanitizeCard, RARITY_NAMES } from "./cards";
import { paintFaces } from "./portraits";
import { sfx } from "./audio";

/* The Trading Post: 1-for-1 card swaps (plus an optional gold sweetener from
   the proposer) over the live link. Three-step handshake so neither side ever
   has to roll back: offer → accept → commit. One pending trade at a time. */

/** How each role reaches its own cards & purse; wired up by coop.ts. */
export interface TradeWorld {
  gold(): number;
  addGold(n: number): void;
  tradeables(): Member[];
  removeCard(id: string): Member | null;
  addCard(c: Member): void;
  commit(): void;
  notify(msg: string): void;
  leave(): void;
}

let getWorld: (() => TradeWorld) | null = null;
export function initTrade(fn: () => TradeWorld): void { getWorld = fn; }

let atPost = false;
let partnerAtPost = false;
let partnerCards: Member[] = [];
let myPick: string | null = null;
let theirPick: string | null = null;
let offerGold = 0;
let incoming: {give: Member; gold: number; want: string} | null = null;
let outgoing: {give: Member; gold: number; want: string} | null = null;
let awaitingCommit: Member | null = null; // the card we promised while waiting for commit

function status(msg: string): void { if (atPost) $("trade-status").textContent = msg; }

function sendList(): void {
  if (!getWorld) return;
  net.send({t: "trade_open", cards: getWorld().tradeables() as unknown as Record<string, unknown>[]});
}

export function openTradePost(): void {
  if (!getWorld) return;
  atPost = true;
  myPick = null; theirPick = null; offerGold = 0;
  sendList();
  render();
  show("scr-trade");
}

export function closeTradePost(silent = false): void {
  if (!atPost) return;
  atPost = false;
  if (!silent) net.send({t: "trade_close"});
}

/** The link died: forget everything in-flight. */
export function tradeLinkLost(): void {
  partnerAtPost = false; partnerCards = [];
  incoming = null; outgoing = null; awaitingCommit = null;
  if (atPost) { atPost = false; getWorld?.().leave(); }
}

function render(): void {
  if (!atPost) return;
  const world = getWorld!();
  const mine = world.tradeables();
  if (myPick && !mine.some(c => c.id === myPick)) myPick = null;
  if (theirPick && !partnerCards.some(c => c.id === theirPick)) theirPick = null;

  // incoming offer panel
  const inc = $("trade-incoming");
  if (incoming) {
    const wanted = mine.find(c => c.id === incoming!.want);
    inc.innerHTML = `<div class="tradeoffer">
      <h3>They offer:</h3>
      <div class="roster">${cardHTML(incoming.give)}${wanted ? cardHTML(wanted) : `<p class="dim">…for a card you no longer hold.</p>`}</div>
      <p class="dim" style="font-size:.84rem;">${RARITY_NAMES[incoming.give.rarity]} ${incoming.give.cls} “${incoming.give.name}”${incoming.gold ? ` plus ${incoming.gold} gold` : ""} — in exchange for ${wanted ? `your “${wanted.name}”` : "a card you traded away"}.</p>
      <div class="btnrow">
        <button id="bt-trade-accept" class="primary" ${wanted && !awaitingCommit ? "" : "disabled"}>Shake On It</button>
        <button id="bt-trade-decline">Decline</button>
      </div>
    </div>`;
    paintFaces(inc);
    $("bt-trade-accept").onclick = acceptOffer;
    $("bt-trade-decline").onclick = () => {
      incoming = null; net.send({t: "trade_decline"});
      status("You wave the offer away."); render();
    };
  } else {
    inc.innerHTML = "";
  }

  // partner grid
  const theirs = $("trade-theirs");
  if (!partnerAtPost) {
    theirs.innerHTML = `<p class="dim" style="font-size:.85rem;">Your companion isn't at the post yet — ask them to visit the Trading Post on their side.</p>`;
  } else if (!partnerCards.length) {
    theirs.innerHTML = `<p class="dim" style="font-size:.85rem;">They carry nothing they can part with.</p>`;
  } else {
    theirs.innerHTML = partnerCards.map(c => cardHTML(c)).join("");
    paintFaces(theirs);
    theirs.querySelectorAll<HTMLElement>(".rcard").forEach(el => {
      el.classList.toggle("sel", el.dataset.card === theirPick);
      el.onclick = () => { theirPick = el.dataset.card!; sfx("tap"); render(); };
    });
  }

  // my grid
  const mineEl = $("trade-mine");
  mineEl.innerHTML = mine.length ? mine.map(c => cardHTML(c)).join("")
    : `<p class="dim" style="font-size:.85rem;">You carry nothing you can part with.</p>`;
  paintFaces(mineEl);
  mineEl.querySelectorAll<HTMLElement>(".rcard").forEach(el => {
    el.classList.toggle("sel", el.dataset.card === myPick);
    el.onclick = () => { myPick = el.dataset.card!; sfx("tap"); render(); };
  });

  $("trade-gold-ui").textContent = offerGold ? `· sweetened with ${offerGold} g` : "";
  ($("bt-trade-gold") as HTMLButtonElement).disabled = world.gold() < offerGold + 10;
  ($("bt-trade-propose") as HTMLButtonElement).disabled =
    !myPick || !theirPick || !!outgoing || !!incoming || !!awaitingCommit;
}

function proposeOffer(): void {
  const world = getWorld!();
  const give = world.tradeables().find(c => c.id === myPick);
  if (!give || !theirPick || outgoing) return;
  outgoing = {give, gold: offerGold, want: theirPick};
  net.send({t: "trade_offer", give: give as unknown as Record<string, unknown>, gold: offerGold, want: theirPick});
  sfx("spell");
  status(`Offer sent: “${give.name}”${offerGold ? ` + ${offerGold} g` : ""}. Waiting on their handshake…`);
  render();
}

function acceptOffer(): void {
  if (!incoming || awaitingCommit) return;
  const world = getWorld!();
  const giving = world.tradeables().find(c => c.id === incoming!.want);
  if (!giving) { status("You no longer hold that card."); return; }
  awaitingCommit = giving;
  net.send({t: "trade_accept", give: giving as unknown as Record<string, unknown>});
  status("Hands shaken — sealing the trade…");
  render();
}

/** Route a trade_* message. Returns true when handled. */
export function onTradeMessage(m: NetMsg): boolean {
  if (!getWorld || typeof m.t !== "string" || !m.t.startsWith("trade_")) return false;
  const world = getWorld();
  switch (m.t) {
    case "trade_open": {
      partnerAtPost = true;
      partnerCards = (Array.isArray(m.cards) ? m.cards : [])
        .map(sanitizeCard).filter((c): c is Member => !!c).slice(0, 60);
      if (atPost) render();
      else world.notify("Your companion is waiting at the Trading Post.");
      break;
    }
    case "trade_close": {
      partnerAtPost = false; partnerCards = [];
      incoming = null; outgoing = null; awaitingCommit = null;
      if (atPost) { status("Your companion left the post."); render(); }
      break;
    }
    case "trade_offer": {
      const give = sanitizeCard(m.give);
      if (!give) break;
      const gold = Math.max(0, Math.min(100000, Number(m.gold) || 0));
      incoming = {give, gold, want: typeof m.want === "string" ? m.want : ""};
      sfx("chest");
      if (atPost) { status("An offer is on the table."); render(); }
      else world.notify("Your companion has an offer waiting at the Trading Post.");
      break;
    }
    case "trade_decline": {
      outgoing = null;
      if (atPost) { status("They wave your offer away."); render(); }
      break;
    }
    case "trade_accept": {
      if (!outgoing) break;
      const theirCard = sanitizeCard(m.give);
      const stillMine = world.tradeables().some(c => c.id === outgoing!.give.id);
      if (!theirCard || !stillMine || world.gold() < outgoing.gold) {
        net.send({t: "trade_cancel"});
        outgoing = null;
        if (atPost) { status("The trade fell through."); render(); }
        break;
      }
      world.removeCard(outgoing.give.id);
      world.addGold(-outgoing.gold);
      world.addCard(theirCard);
      world.commit();
      net.send({t: "trade_commit"});
      outgoing = null; offerGold = 0; myPick = null; theirPick = null;
      sfx("recruit");
      if (atPost) { status(`Done! “${theirCard.name}” is yours now.`); sendList(); render(); }
      else world.notify(`Trade complete — “${theirCard.name}” joins your collection.`);
      break;
    }
    case "trade_commit": {
      if (!awaitingCommit || !incoming) break;
      world.removeCard(awaitingCommit.id);
      world.addCard(incoming.give);
      world.addGold(incoming.gold);
      world.commit();
      const got = incoming.give.name;
      awaitingCommit = null; incoming = null;
      sfx("recruit");
      if (atPost) { status(`Done! “${got}” is yours now.`); sendList(); render(); }
      else world.notify(`Trade complete — “${got}” joins your collection.`);
      break;
    }
    case "trade_cancel": {
      incoming = null; outgoing = null; awaitingCommit = null;
      if (atPost) { status("The trade fell through."); render(); }
      break;
    }
    default: return false;
  }
  return true;
}

/** Combat pulls everyone away from the counter. */
export function forceLeaveForCombat(): void {
  if (!atPost) return;
  closeTradePost();
  show("scr-combat");
}

export function isAtTradePost(): boolean { return atPost; }

export function bindTrade(): void {
  $("bt-trade-gold").onclick = () => {
    if (getWorld && getWorld().gold() >= offerGold + 10) { offerGold += 10; render(); }
  };
  $("bt-trade-propose").onclick = proposeOffer;
  $("bt-trade-leave").onclick = () => {
    const world = getWorld?.();
    closeTradePost();
    world?.leave();
  };
}
