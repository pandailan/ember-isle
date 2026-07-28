import type { Member, Rarity, GameState, Mob, TCard, AnyCard, CardKind } from "./types";
import { CLASSES, CLASS_BODY, GROUPS, MAPS, ITEMS, PACKS, RELICS, EVENTS, ELITES, ELITE_CHANCE } from "./data";
import { TRAITS, hasTrait } from "./traits";
import { rnd, ri } from "./util";

/* ============================== RARITY ============================== */
export const RARITY_NAMES = ["Common", "Seasoned", "Renowned", "Legendary"];
export const RARITY_HUES = ["#a3916c", "#8fae6a", "#7fa8bd", "#e09a3c"];
/** Extra stat points rolled onto a card (hp points count double). */
const RARITY_POINTS = [1, 3, 5, 8];
const RARITY_TRAITS = [0, 1, 1, 2];
export const RECRUIT_COST = [60, 150, 400, 1000];

export function rollRarity(): Rarity {
  const r = rnd();
  if (r < 0.03) return 3;
  if (r < 0.13) return 2;
  if (r < 0.40) return 1;
  return 0;
}

/* ============================== NAMES ============================== */
const FIRST = ["Aldric","Isolde","Mira","Finn","Odo","Zephyra","Grimbold","Sella","Corin","Maeve",
  "Tobin","Yska","Bran","Liora","Edda","Joris","Nyx","Petra","Rufus","Wren","Halla","Osric",
  "Tamsin","Vell","Ingrid","Casper","Duna","Ewan"];
const EPITHETS: string[][] = [
  [],
  ["of the Vale","the Steady","Saltborn","of the Cliffs","the Quiet","Two-Knives","the Patient"],
  ["Wavebreaker","the Unbowed","Griefsinger","of the Last Watch","Stormtaken","the Thrice-Sworn"],
  ["Emberborn","the Undrowned","Twice-Crowned","Doomslayer","of the First Dawn"],
];

function makeName(rarity: Rarity, taken: Set<string>): string {
  for (let tries = 0; tries < 40; tries++) {
    const first = FIRST[ri(FIRST.length)];
    const pool = EPITHETS[rarity];
    const name = pool.length ? `${first} ${pool[ri(pool.length)]}` : first;
    if (!taken.has(name)) { taken.add(name); return name; }
  }
  return FIRST[ri(FIRST.length)] + " the Wanderer";
}

/* ============================== CARD CREATION ============================== */
export function genId(): string {
  return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

const CLASS_NAMES = Object.keys(CLASSES);

export function makeCard(takenNames: Set<string>, cls?: string, rarity?: Rarity): Member {
  const cn = cls ?? CLASS_NAMES[ri(CLASS_NAMES.length)];
  const r = rarity ?? rollRarity();
  const base = CLASSES[cn];
  const body = CLASS_BODY[cn];
  const m: Member = {
    id: genId(), name: makeName(r, takenNames), cls: cn,
    rarity: r, traits: [], skills: [], sp: 0,
    lvl: 1, xp: 0,
    hp: base.hp, maxhp: base.hp, mp: base.mp, maxmp: base.mp,
    atk: base.atk, def: base.def, spd: base.spd,
    str: body.str, con: body.con, ap: 0, pack: 0, items: [],
    wTier: 0, aTier: 0, down: false,
  };
  // roll bonus stat points (hp points are worth 2 HP)
  const stats: ("hp" | "atk" | "def" | "spd" | "mp" | "str" | "con")[] = base.mp > 0
    ? ["hp", "atk", "def", "spd", "mp", "str", "con"] : ["hp", "atk", "def", "spd", "str", "con"];
  for (let p = 0; p < RARITY_POINTS[r]; p++) {
    const s = stats[ri(stats.length)];
    if (s === "hp") { m.maxhp += 2; m.hp += 2; }
    else if (s === "mp") { m.maxmp += 2; m.mp += 2; }
    else m[s] += 1;
  }
  // roll traits, then apply creation-time trait effects
  const pool = Object.keys(TRAITS);
  while (m.traits.length < RARITY_TRAITS[r]) {
    const t = pool[ri(pool.length)];
    if (!m.traits.includes(t)) m.traits.push(t);
  }
  if (hasTrait(m, "grim")) { m.atk += 2; m.spd = Math.max(1, m.spd - 1); }
  if (hasTrait(m, "lightfoot")) m.spd += 1;
  if (hasTrait(m, "vigorous")) { m.maxhp = Math.round(m.maxhp * 1.12); m.hp = m.maxhp; }
  if (hasTrait(m, "arcane") && m.maxmp > 0) { m.maxmp = Math.round(m.maxmp * 1.2); m.mp = m.maxmp; }
  return m;
}

/** Opening night: eight strangers, guaranteed to include a healer and real variety. */
export function rollDraft(): Member[] {
  const taken = new Set<string>();
  const cards: Member[] = [];
  cards.push(makeCard(taken, rnd() < 0.5 ? "Cleric" : "Paladin"));      // a healer walks in
  const shuffled = [...CLASS_NAMES].sort(() => rnd() - 0.5);
  for (const cn of shuffled.slice(0, 4)) cards.push(makeCard(taken, cn)); // class spread
  while (cards.length < 8) cards.push(makeCard(taken));
  if (!cards.some(c => c.rarity >= 1)) cards[ri(cards.length)] = makeCard(taken, undefined, 1);
  return cards.sort(() => rnd() - 0.5);
}

export function rollVisitors(state: GameState): Member[] {
  const taken = new Set<string>([...state.party, ...state.collection].map(c => c.name));
  return Array.from({length: 4}, () => makeCard(taken));
}

export function todayStamp(): string { return new Date().toDateString(); }

/* ============================== WORLD MOBS ============================== */
const MOB_COUNT: Record<number, number> = {1: 6, 2: 7, 3: 9, 4: 5, 5: 2};

/** Populate a depth with visible, roaming monster packs. */
export function spawnMobs(level: number, existing: Mob[] = []): Mob[] {
  const map = MAPS[level];
  const mobs = [...existing];
  const taken = new Set(mobs.map(m => m.x + "," + m.y));
  const entry = level === 3 ? [2, 1] : level === 4 ? [3, 2] : [1, 1];
  let guard = 0;
  while (mobs.length < MOB_COUNT[level] && guard++ < 400) {
    const y = ri(map.length), x = ri(map[0].length);
    if (map[y][x] !== ".") continue;
    if (Math.abs(x - entry[0]) + Math.abs(y - entry[1]) < 5) continue;
    if (taken.has(x + "," + y)) continue;
    const group = GROUPS[level][ri(GROUPS[level].length)];
    const elite = !!ELITES[group[0]] && rnd() < (ELITE_CHANCE[level] ?? 0.1);
    mobs.push({x, y, key: group[0], group: [...group], ...(elite ? {elite: true} : {})});
    taken.add(x + "," + y);
  }
  return mobs;
}

/* ============================== TRADEABLE CARDS ============================== */
export const isTCard = (c: AnyCard): c is TCard => {
  const k = (c as TCard).kind;
  return k === "relic" || k === "event";
};
export const tcardDef = (c: TCard) => (c.kind === "relic" ? RELICS : EVENTS)[c.key];
export const cardName = (c: AnyCard): string => isTCard(c) ? tcardDef(c)?.n ?? "Strange Card" : c.name;

export function makeTCard(kind: CardKind, key: string): TCard {
  const def = (kind === "relic" ? RELICS : EVENTS)[key];
  return {id: genId(), kind, key, rarity: def?.rarity ?? 0};
}

/** The peddler's sealed pack: one random relic or event card, weighted by rarity. */
export function rollPackCard(): TCard {
  const pool: [CardKind, string, number][] = [];
  for (const [k, d] of Object.entries(RELICS)) pool.push(["relic", k, [50, 30, 14, 4][d.rarity]]);
  for (const [k, d] of Object.entries(EVENTS)) pool.push(["event", k, [50, 30, 14, 4][d.rarity]]);
  let roll = rnd() * pool.reduce((a, p) => a + p[2], 0);
  for (const [kind, key, w] of pool) { roll -= w; if (roll <= 0) return makeTCard(kind, key); }
  return makeTCard("relic", "gullfeather");
}

export function tcardHTML(c: TCard, extra = ""): string {
  const def = tcardDef(c);
  return `<div class="rcard tcard r${c.rarity}" data-card="${c.id}">
    <span class="rname">${def?.n ?? "Strange Card"}</span>
    <span class="rcls">${RARITY_NAMES[c.rarity]} ${c.kind === "relic" ? "Relic" : "Event"}</span>
    <span class="rblurb">${def?.desc ?? ""}</span>
    ${extra}
  </div>`;
}

/* ============================== WIRE SAFETY ============================== */
const num = (v: unknown, lo: number, hi: number, fb: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : fb;
};

/** Rebuild a tradeable card from the wire: kind and key must exist in the registry. */
export function sanitizeTCard(raw: unknown): TCard | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (c.kind !== "relic" && c.kind !== "event") return null;
  if (typeof c.key !== "string" || !(c.kind === "relic" ? RELICS : EVENTS)[c.key]) return null;
  const def = (c.kind === "relic" ? RELICS : EVENTS)[c.key];
  return {
    id: typeof c.id === "string" ? c.id.slice(0, 24) : genId(),
    kind: c.kind, key: c.key, rarity: def.rarity,
  };
}

/** Sanitize a card of any kind coming off the wire. */
export function sanitizeAnyCard(raw: unknown): AnyCard | null {
  if (!raw || typeof raw !== "object") return null;
  const k = (raw as Record<string, unknown>).kind;
  return k === "relic" || k === "event" ? sanitizeTCard(raw) : sanitizeCard(raw);
}

/** Rebuild a card received over the co-op link from scratch — never trust the wire. */
export function sanitizeCard(raw: unknown): Member | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.cls !== "string" || !CLASSES[c.cls]) return null;
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === "string").slice(0, 12) : [];
  const maxhp = num(c.maxhp, 1, 999, 20), maxmp = num(c.maxmp, 0, 999, 0);
  const body = CLASS_BODY[c.cls];
  return {
    id: typeof c.id === "string" ? c.id.slice(0, 24) : genId(),
    name: typeof c.name === "string" ? c.name.slice(0, 40) : "Stranger",
    cls: c.cls,
    rarity: num(c.rarity, 0, 3, 0) as Rarity,
    traits: strArr(c.traits), skills: strArr(c.skills),
    sp: num(c.sp, 0, 99, 0),
    lvl: num(c.lvl, 1, 99, 1), xp: num(c.xp, 0, 1e6, 0),
    maxhp, hp: num(c.hp, 0, maxhp, maxhp),
    maxmp, mp: num(c.mp, 0, maxmp, maxmp),
    atk: num(c.atk, 1, 99, 5), def: num(c.def, 0, 99, 3), spd: num(c.spd, 1, 99, 5),
    str: num(c.str, 1, 99, body.str), con: num(c.con, 1, 99, body.con),
    ap: num(c.ap, 0, 99, 0),
    pack: num(c.pack, 0, PACKS.length - 1, 0),
    relic: sanitizeTCard(c.relic) ?? undefined,
    items: strArr(c.items).filter(id => ITEMS[id]),
    wTier: num(c.wTier, 0, 3, 0), aTier: num(c.aTier, 0, 3, 0),
    down: c.down === true,
  };
}

/** Undo an interrupted co-op loan: drop guest cards, restore displaced hosts. */
export function cleanupLend(s: GameState): void {
  if (!s.coopGuestIds?.length) return;
  const guestIds = s.coopGuestIds;
  s.party = s.party.filter(c => !guestIds.includes(c.id));
  for (const id of s.coopDisplacedIds ?? []) {
    const i = s.collection.findIndex(c => c.id === id);
    if (i >= 0 && s.party.length < 4) s.party.push(s.collection.splice(i, 1)[0]);
  }
  s.coopGuestIds = []; s.coopDisplacedIds = []; s.guestGoldOwed = 0;
}

/* ============================== SAVE MIGRATION ============================== */
/** Upgrade a pre-card (v1) save in place: members become common cards. */
export function migrateState(s: GameState & {version?: number}): GameState {
  if (s.mobs) {
    s.mobs[3] = s.mobs[3] ?? spawnMobs(3); // the moor opened after some saves were written
    s.mobs[4] = s.mobs[4] ?? spawnMobs(4); // and later, the cove
  }
  s.binder = s.binder ?? [];
  s.landmarks = s.landmarks ?? [];
  // the wilds were widened after some saves were written: relocate what no longer fits
  if ((s.mapsV ?? 1) < 2) {
    for (const lvl of [3, 4]) {
      if (s.mobs?.[lvl]) s.mobs[lvl] = s.mobs[lvl].filter(m => MAPS[lvl][m.y]?.[m.x] === ".");
      if (s.visited?.[lvl]) s.visited[lvl] = [];
    }
    if ((s.level === 3 || s.level === 4) && !".CFV".includes(MAPS[s.level][s.y]?.[s.x] ?? "#")) {
      const entry = s.level === 3 ? [2, 1] : [3, 2];
      s.x = entry[0]; s.y = entry[1];
    }
    s.mapsV = 2;
  }
  s.clock = s.clock ?? 1230; // clocks and weather arrived after some saves too
  s.weather = s.weather ?? "clear";
  s.weatherLeft = s.weatherLeft ?? 70;
  // bodies and backpacks arrived later still: seed every card, old points included
  for (const m of [...(s.party ?? []), ...(s.collection ?? []), ...(s.visitors ?? [])]) {
    const body = CLASS_BODY[m.cls] ?? {str: 4, con: 5};
    m.str = m.str ?? body.str;
    m.con = m.con ?? body.con;
    m.ap = m.ap ?? Math.max(0, (m.lvl ?? 1) - 1);
    m.pack = m.pack ?? 0;
    m.items = m.items ?? [];
  }
  if (s.version === 2) return s;
  for (const m of s.party ?? []) {
    m.id = m.id ?? genId();
    m.rarity = m.rarity ?? 0;
    m.traits = m.traits ?? [];
    m.skills = m.skills ?? [];
    m.sp = m.sp ?? Math.floor(m.lvl / 2);
  }
  s.collection = s.collection ?? [];
  s.visitors = s.visitors ?? [];
  s.visitorsDay = s.visitorsDay ?? "";
  s.mobs = s.mobs ?? {1: spawnMobs(1), 2: spawnMobs(2), 3: spawnMobs(3)};
  s.version = 2;
  return s;
}

/* ============================== CARD PRESENTATION ============================== */
export function cardHTML(m: Member, extra = ""): string {
  const traitChips = m.traits.map(t => `<span class="chip" title="${TRAITS[t]?.desc ?? ""}">${TRAITS[t]?.n ?? t}</span>`).join("");
  return `<div class="rcard r${m.rarity}${m.down ? " carddown" : ""}" data-card="${m.id}">
    <canvas class="cardface" width="96" height="96" data-face="${m.id}" data-cls="${m.cls}" data-rarity="${m.rarity}"></canvas>
    <span class="rname">${m.name}</span>
    <span class="rcls">${RARITY_NAMES[m.rarity]} ${m.cls} · L${m.lvl}${m.sp > 0 ? " · ✦" + m.sp : ""}</span>
    <span class="rstats">HP ${m.hp}/${m.maxhp}${m.maxmp > 0 ? " · MP " + m.mp + "/" + m.maxmp : ""} · ATK ${m.atk} · DEF ${m.def} · SPD ${m.spd}</span>
    ${traitChips ? `<span class="chips">${traitChips}</span>` : ""}
    ${extra}
  </div>`;
}
