# Ember Isle — Roadmap

## Done

- **v1** — first-person crawl: tavern party, town hub, two depths, turn-based
  combat, boss, saves. Single self-contained HTML file.
- **Graphics pass** — stone-course walls, flagstone perspective, torch glow,
  hand-drawn canvas monster portraits.
- **TypeScript + CI** — strict-mode modules, esbuild single-file output,
  GitHub Actions deploy to Pages.
- **Co-op v1** — PeerJS link: host lights the Signal Fire, guest joins by code,
  shared dungeon, guest commands the rear two party seats.
- **Cards (Phase 1)** — random opening draft of 8, rarity tiers with stat rolls
  and traits, collection + benching, daily tavern visitors to recruit, per-class
  skill trees (2 branches × 3 tiers), skill points on even levels.
- **Procedural audio** — WebAudio sfx and ambient scene music, no asset files.
- **Phase 2 — bring-your-own-cards co-op**: a joining guest sends two cards from
  their own collection through the Signal Fire (2+2 parties); battle gold is
  split and the guest's save continuously receives their cards' XP, levels, and
  gold share. Wire-sanitized cards, heartbeat disconnect detection, and loan
  cleanup on reload. Guests without cards fall back to companion mode.
- **Phase 3 — the Trading Post**: while linked, both players can visit the
  post, see each other's tradeable cards, and swap one-for-one with an optional
  gold sweetener. Three-step offer→accept→commit handshake (no rollbacks),
  wire-sanitized cards, decline/cancel paths, combat pre-empts bartering.
  Trust-based, as saves are local — the Phase 4 ledger hardens ownership.
- **Host migration** — if the host drops (heartbeat detects within ~7s), the
  guest adopts the expedition from its last synced snapshot and plays on
  locally: mid-combat fights are rebuilt and continued, all four seats become
  theirs, and their lent cards' XP and gold share keep merging into their own
  save (which is never overwritten — unless they had no save, in which case
  they inherit the world outright).
- **True 3D + audio v2** — three.js WebGL renderer (gliding camera, real point
  lights over normal-mapped procedural stone, fog, bloom) and WebAudio v2
  (convolution reverb, generative per-biome music, layered SFX).
- **Streaming build** — code-split chunks loaded on demand (three.js and PeerJS
  lazy), service-worker offline caching on Pages; the single-file artifact
  build is preserved as `dist/single.html`.
- **Town & the Moor** — pitched roofs, chimneys, and varied building heights in
  the harbor; floating signposts over every sight (fading out up close); a west
  gate into the first wilderness, The Moor of Vhalis — an open night moor with
  low outcrops, pines, fireflies, and Moor Wolf packs. The moor's far edges are
  open sea with foam-lined coast; barriers inland are boulders and thickets.
- **Time & weather** — a world clock advanced by walking and fighting (saved,
  synced to co-op guests) drives a keyframed sky: dawn, day, golden hour, dusk,
  and night, with a sun and moon that cross the sky and stars and fireflies
  that belong to the dark. Weather fronts roll over the isle — sea mist, rain,
  and storms with lightning, thunder, and a rain soundscape. Lamps, torches,
  and door-flames burn only while the sun is down (a storm counts as dark),
  and the world is scattered with life: banners, handcarts, and grain sacks in
  the harbor; reeds, fallen logs, and standing stones on the moor; stalagmites
  and old bones in the deeps.

- **Cards with faces & backpacks** — every card gets a procedural painted
  portrait (deterministic per card, dressed by class, framed by rarity), shown
  in the tavern, draft, party bar, and combat. Clicking a card or plaque opens
  the character sheet: STR/CON attributes (+1 point per level to spend),
  equipment with weights, and a slot-based backpack. Carry capacity comes from
  STR, CON, and the pack (Belt Pouch → Satchel → Rucksack at Provisions);
  wolves, golems, cultists, and skeletons drop trophies that weigh real weight
  and sell at the shop; an overloaded card fights slower. A dedicated moor
  music theme, gulls over the harbor by day, and wolf howls across the moor at
  night round out the soundscape.

- **The card economy** — everything tradeable is a card now. Relic cards are
  worn by characters (Wolfsbane, Stormglass, Emberheart, Gull-Feather — real
  combat hooks tied to night, weather, and spellcraft) and travel with them
  when traded. Event cards burn on play: the Rite of Return raises the fallen,
  the Smuggler's Charter sails the party to the Hidden Cove (a new open-sea
  level with rich chests and orc packs), and the Torn Map Page unfolds a
  procedurally carved vault below ground — same page, same vault, with a pale
  door back out. Cards come from chests, the boss, and the tavern peddler's
  sealed packs; the binder UI works from the tavern and the walking view; the
  Trading Post now trades any card kind over the same handshake.

- **In-world combat** — no more mode switch: fights are staged inside the
  first-person view. Foes fan out one cell ahead with floating HP bars, flinch
  and flash when struck, fade to shades when they fall; damage numbers rise in
  the world; the command bar replaces the d-pad below the view; the weather,
  fireflies, and sea stay visible behind the fight. Same turn engine, same
  co-op seats and host-migration adoption — only the stage changed.

- **The isle underfoot and on the horizon** — outdoor ground is real earth
  now: peat mottled with grass on the moor, sand with dry tussocks at the
  cove, baked with no masonry grid. The wilds occasionally hold older
  stonework — broken house corners, leaning doorways, tilted shrine slabs —
  and the isle's lighthouse stands on its rock off every open shore: a
  red-banded tower whose lantern wakes at dusk, twin beams turning over the
  sea all night, visible from the moor coast and above the harbor rooftops.

- **Rolling ground & open wilds** — outdoor terrain has elevation: a
  deterministic heightfield lifts the floor mesh into low hills that fall to
  sea level at every coast; the camera, ground cover, buildings, mobs, and
  in-world fights all ride the same surface. The moor and cove were redrawn
  twice as wide — broad open meadows and beaches where scattered rock
  clusters, pine stands, and ruins mark loose paths instead of corridor
  walls. Old saves relocate anything the new layouts displaced.

- **High ground matters** — elevation is gameplay, not just scenery. The
  height math lives in a renderer-independent module (`src/terrain.ts`)
  shared by the 3D scene and the rules. Standing on a rise widens what the
  automap reveals (up to a 5×5 sweep from a summit); fights on a slope tilt
  the melee math — the side holding the high ground strikes ~15% harder and
  the side below swings ~10% weaker, called out in the combat log when the
  ground is steep enough to matter.

- **Mob temperament** — packs are individuals now. Each species has a sight
  range and a chase patience: sighting the party lights a pursuit that burns
  down step by step until the pack loses heart and sulks (unable to re-aggro
  for a spell). Rats nip and think better of it; wolves run you down for
  a dozen steps; skeletons, wraiths, and golems never stop coming. Slimes
  and golems lumber a step behind. Outdoors, hunters keep to the low ground
  and steep climbs make them scrabble — luring wolves uphill is a real
  tactic. The log narrates the hunt: "has your scent", "loses interest".

- **The picturesque pass** — a final color-grade shader after tone mapping:
  a gentle contrast curve, split-toned shadows and highlights that follow
  the clock, a golden-hour warmth that swells as the sun rides low, a soft
  vignette that deepens at night, and a whisper of animated film grain.
  Torchlit depths get their own warm, close-cornered grade.

## Next

- **Phase 4 — server ledger** *(needs a free Cloudflare account)*: Worker + KV
  as the source of truth for card ownership — serial-minted event cards give
  rare cards real scarcity — plus shared leaderboard and a graveyard (fallen
  parties appear in other players' dungeons).
- **Contract cards** (tradeable bounties) and **descend-with-a-deck** (floors
  below the Ember Deep assembled from carried map cards).
- More depths, quests, and a second boss; hardcore mode (cards can truly die —
  and the Rite of Return becomes the most precious card on the isle).

## Art, 3D, sound & music strategy

**Sound & music (current):** everything is synthesized at runtime with WebAudio
(`src/audio.ts`) — zero asset downloads, keeps the single-file build. If richer
audio is ever wanted: [Kenney audio packs](https://kenney.nl/assets?q=audio)
(CC0) and [OpenGameArt](https://opengameart.org) (filter CC0/CC-BY); ship as
static files next to `index.html` on Pages.

**3D:** the current renderer is stylized 2.5D canvas — cohesive and tiny. A
real-3D upgrade is a dedicated project, best done as:

1. **Three.js** (`npm i three`, tree-shakes well with esbuild).
2. **CC0 low-poly packs** so no artist is needed:
   [Kenney](https://kenney.nl/assets) (dungeon kits),
   [Quaternius](https://quaternius.com) (Ultimate Dungeon + Monsters packs),
   aggregated at [Poly Pizza](https://poly.pizza). All GLTF, all free for any use.
3. GLTF models mean the build stops being one file — `dist/` gains an `assets/`
   folder. Pages serves it fine; only the claude.ai artifact mirror (which
   blocks external files) would stay on the 2.5D renderer.
4. Migration path: keep grid logic and game state untouched; swap
   `render.ts` for a Three.js scene that draws the same map cells as instanced
   wall/floor meshes, and monster cards for billboarded models.

**Interim art wins** (no 3D needed): larger illustrated monster portraits in
combat, particle embers in the viewport, animated water in the fountain, and a
parallax skyline for the town screen.
