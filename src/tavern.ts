import type { Member } from "./types";
import { state, setState, newState, save, allCards } from "./state";
import { app } from "./bus";
import { show } from "./ui";
import { $ } from "./util";
import { cardHTML, rollDraft, rollVisitors, todayStamp, RECRUIT_COST, RARITY_NAMES, RARITY_HUES } from "./cards";
import { TRAITS, SKILL_TREES, buySkill, spellsOf } from "./traits";
import { SPELLS } from "./data";
import { sfx } from "./audio";

/* ============================== CARD PICKER ============================== */
/** Reusable pick-N-cards screen; used by the opening draft and co-op lending. */
export function openPicker(
  cards: Member[], count: number,
  texts: {title: string; blurb: string; button: string},
  cb: (chosen: Member[]) => void,
): void {
  const picked: string[] = [];
  $("draft-title").textContent = texts.title;
  $("draft-blurb").innerHTML = texts.blurb;
  const box = $("draft-roster");
  box.innerHTML = cards.map(c => cardHTML(c)).join("");
  const bt = $("bt-setout") as HTMLButtonElement;
  const refresh = () => {
    box.querySelectorAll<HTMLElement>(".rcard").forEach(e2 =>
      e2.classList.toggle("sel", picked.includes(e2.dataset.card!)));
    bt.disabled = picked.length !== count;
    bt.textContent = `${texts.button} (${picked.length} / ${count})`;
  };
  box.querySelectorAll<HTMLElement>(".rcard").forEach(el => {
    el.onclick = () => {
      const id = el.dataset.card!;
      const at = picked.indexOf(id);
      if (at >= 0) picked.splice(at, 1);
      else if (picked.length < count) picked.push(id);
      refresh();
    };
  });
  refresh();
  bt.onclick = () => cb(picked.map(id => cards.find(c => c.id === id)!));
  show("scr-draft");
}

/* ============================== OPENING DRAFT ============================== */
export function openDraft(): void {
  openPicker(rollDraft(), 4, {
    title: "The Salted Gull",
    blurb: `Lanternlight, spilled ale, and eight strangers who have nowhere left to go.
      Choose <b style="color:var(--parch)">four</b> to descend with you — the rest sail on the morning tide.`,
    button: "Set Out",
  }, party => {
    setState(newState(party));
    refreshVisitors();
    save();
    sfx("recruit");
    app.openTown("You shoulder your packs. The Salted Gull's door swings shut behind you.");
  });
}

/* ============================== TAVERN ============================== */
function refreshVisitors(): void {
  const today = todayStamp();
  if (state.visitorsDay !== today) {
    state.visitors = rollVisitors(state);
    state.visitorsDay = today;
  }
}

export function openTavern(msg?: string): void {
  refreshVisitors(); save();
  $("tav-gold").textContent = String(state.gold);
  $("tav-day").textContent = "new faces at dawn";
  $("tav-msg").textContent = msg ?? "";

  const company = $("company");
  company.innerHTML = allCards().map(c =>
    cardHTML(c, state.party.some(p => p.id === c.id)
      ? `<span class="inparty">✦ marching</span>` : "")).join("");
  company.querySelectorAll<HTMLElement>(".rcard").forEach(el => {
    el.onclick = () => openCard(el.dataset.card!);
  });

  const vis = $("visitors");
  if (!state.visitors.length) {
    vis.innerHTML = `<p class="dim" style="font-size:.85rem;">The benches are empty tonight. New faces at dawn.</p>`;
  } else {
    vis.innerHTML = state.visitors.map(c =>
      cardHTML(c, `<button class="recruit" data-r="${c.id}">Recruit · ${RECRUIT_COST[c.rarity]} g</button>`)).join("");
    vis.querySelectorAll<HTMLButtonElement>("button.recruit").forEach(b => {
      const card = state.visitors.find(c => c.id === b.dataset.r)!;
      b.disabled = state.gold < RECRUIT_COST[card.rarity];
      b.onclick = e => {
        e.stopPropagation();
        state.gold -= RECRUIT_COST[card.rarity];
        state.visitors = state.visitors.filter(c => c.id !== card.id);
        state.collection.push(card);
        save(); sfx("recruit");
        openTavern(`${card.name} drains their cup and stands. "About time someone asked."`);
      };
    });
  }

  ($("bt-tav-rest") as HTMLButtonElement).disabled = state.gold < 12;
  $("bt-tav-rest").onclick = () => {
    if (state.gold < 12) return;
    state.gold -= 12;
    for (const m of allCards()) if (!m.down) { m.hp = m.maxhp; m.mp = m.maxmp; }
    save(); sfx("heal");
    openTavern("Hot stew and a night without dreams. The living wake restored.");
  };
  $("bt-tav-back").onclick = () => {
    if (state.party.length !== 4) { $("tav-msg").textContent = "The harbormaster won't let fewer than four near the Stair. Choose a marching four."; return; }
    app.openTown();
  };
  show("scr-tavern");
}

/* ============================== CARD DETAIL ============================== */
function findCard(id: string): Member | undefined {
  return allCards().find(c => c.id === id);
}

export function openCard(id: string): void {
  const m = findCard(id);
  if (!m) return;
  const ov = $("card-overlay");
  ov.hidden = false;

  const inParty = state.party.some(p => p.id === m.id);
  $("card-head").innerHTML = `
    <h3 style="color:${RARITY_HUES[m.rarity]}">${m.name}</h3>
    <p class="dim" style="font-size:.85rem;">${RARITY_NAMES[m.rarity]} ${m.cls} · Level ${m.lvl} · ${m.sp} skill point${m.sp === 1 ? "" : "s"}</p>`;

  const traits = m.traits.length
    ? m.traits.map(t => `<div class="trow"><b>${TRAITS[t]?.n}</b><span class="dim">${TRAITS[t]?.desc}</span></div>`).join("")
    : `<p class="dim" style="font-size:.82rem;">No birth-traits. Honest work will have to do.</p>`;

  const spells = spellsOf(m).map(s => SPELLS[s].n).join(", ") || "none yet";

  const tree = SKILL_TREES[m.cls];
  const branches = [...new Set(Object.values(tree).map(n => n.branch))];
  const treeHTML = branches.map(br => {
    const nodes = Object.entries(tree).filter(([, n]) => n.branch === br)
      .sort((a, b) => a[1].tier - b[1].tier);
    return `<div class="skillcol"><h4>${br}</h4>` + nodes.map(([nid, n]) => {
      const owned = m.skills.includes(nid);
      const prereq = n.tier === 0 || nodes.some(([pid, p]) => p.tier === n.tier - 1 && m.skills.includes(pid));
      const cls = owned ? "owned" : (prereq && m.sp > 0 ? "avail" : "locked");
      return `<button class="skillnode ${cls}" data-node="${nid}" ${owned || !prereq || m.sp <= 0 ? "disabled" : ""}>
        <b>${n.n}</b><span>${n.desc}</span>${owned ? "<i>mastered</i>" : ""}</button>`;
    }).join("") + `</div>`;
  }).join("");

  $("card-body").innerHTML = `
    <p class="dim" style="font-size:.82rem;">HP ${m.hp}/${m.maxhp}${m.maxmp > 0 ? ` · MP ${m.mp}/${m.maxmp}` : ""} · ATK ${m.atk} · DEF ${m.def} · SPD ${m.spd}</p>
    <p class="dim" style="font-size:.82rem;">Spells &amp; arts: ${spells}</p>
    <div class="traitbox">${traits}</div>
    <div class="skilltree">${treeHTML}</div>`;

  const onLoan = !!state.coopGuestIds?.includes(m.id);
  if (!onLoan) {
    $("card-body").querySelectorAll<HTMLButtonElement>(".skillnode.avail").forEach(b => {
      b.onclick = () => {
        const err = buySkill(m, b.dataset.node!);
        if (err) { $("tav-msg").textContent = err; return; }
        save(); sfx("levelup");
        openCard(m.id);
      };
    });
  } else {
    $("card-body").querySelectorAll<HTMLButtonElement>(".skillnode").forEach(b => { b.disabled = true; });
  }

  const actions = $("card-actions");
  actions.innerHTML = "";
  if (onLoan) {
    const note = document.createElement("p");
    note.className = "dim"; note.style.fontSize = ".82rem";
    note.textContent = "On loan from your companion — their card, their choices.";
    actions.appendChild(note);
    const close0 = document.createElement("button");
    close0.textContent = "Close"; close0.className = "primary";
    close0.onclick = () => { $("card-overlay").hidden = true; };
    actions.appendChild(close0);
    return;
  }
  const swap = document.createElement("button");
  if (inParty) {
    swap.textContent = "Send to the Benches";
    swap.disabled = state.party.length <= 1;
    swap.onclick = () => {
      state.party = state.party.filter(p => p.id !== m.id);
      state.collection.push(m);
      save(); closeCard(); openTavern(`${m.name} takes a seat by the fire.`);
    };
  } else {
    swap.textContent = "Join the Marching Four";
    swap.onclick = () => {
      if (state.party.length >= 4) { $("tav-msg").textContent = "Four march, no more. Bench someone first."; closeCard(); return; }
      state.collection = state.collection.filter(c => c.id !== m.id);
      state.party.push(m);
      save(); closeCard(); openTavern(`${m.name} stands and buckles on their gear.`);
    };
    if (state.party.length >= 4) swap.disabled = true;
  }
  actions.appendChild(swap);
  const close = document.createElement("button");
  close.textContent = "Close"; close.className = "primary";
  close.onclick = closeCard;
  actions.appendChild(close);
}

function closeCard(): void { $("card-overlay").hidden = true; }

export function bindTavern(): void {
  $("card-overlay").addEventListener("click", e => {
    if (e.target === $("card-overlay")) closeCard();
  });
}
