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

- **The living wilds** — the outdoors filled in. Five new canonical assets:
  cairns that mark the ways, barrows with lintel doorways, rings of standing
  stones, hollow watchtowers with part-fallen crowns, and beached hulls the
  sea gave back. The moor now seats two towers, two stone circles, three
  barrows, and six ruins among far denser heather, logs, reeds, and boulder
  clusters; the cove keeps its open sand but gains wrecks, a tower, old
  bones, and waymark cairns. The moor spring's night glow was rebuilt — its
  light anchor sat close enough to the water to blow out bloom into a red
  blob at point-blank range; lifted and dimmed, it reads as a soft blue
  basin now.

- **Filmic light & thumb controls** — the renderer now tone-maps with ACES
  filmic (exposure 1.25) and bloom's threshold rose to 0.85, so near-field
  hot spots — torches, lamps, the spring, the signal fire — compress into
  warm bounded glows instead of clipping into bloom blobs, everywhere and
  for every future light. Controls went touch-first: flick the viewport to
  move (up walks, down retreats, sideways turns; taps and slow presses are
  ignored), the movement diamond sits under the left thumb, and Map, Cards,
  Potion, and Save fan out in a quarter-circle arc under the right thumb.

- **Flick to strike & landmarks that give back** — in combat, flicking the
  viewport at a foe strikes them with the acting member (works on the root
  menu and on any "strike whom?" pick, including spell targets); the foe
  under your finger is found by projecting the staged sprites to the screen,
  and flicks that point at no one are ignored. Landmarks reward their first
  visit, once per save: the watchtower's crown opens a wide sweep of the
  automap, the stone circle mends the living to full, barrows hold
  grave-gold and a relic — though the sleepers may want it back — wrecks
  yield salvage and potions, and ruins hide small hoards.

- **One screen, every device** — the play screen locks to the viewport: no
  page scroll on iPad, iPhone, or PC. Wide screens get a sidebar layout —
  the 3D view fills the left edge to edge while compass, log, party
  plaques (2×2), combat commands, and thumb controls stack on the right.
  Portrait phones keep the column but everything fits above the fold. The
  renderer now resizes to its container — true widescreen aspect instead
  of a fixed 4:3 letterbox — with the buffer capped so retina tablets
  don't quadruple the bloom cost.

- **Creatures with bodies** — every enemy is a real 3D rig now
  (`src/monsters3d.ts`, canonical and swap-friendly like the asset library):
  wolves with muzzles and breathing flanks, rattling skeletons, glossy
  slimes, hooded wraiths that never touch the ground, golems with burning
  seams, the horned Pyrelord under a crown of flame. Rigs idle, yaw to face
  the party, flinch white-hot when struck, lunge when they attack, and
  truly die — bipeds topple, soft things melt. World mobs use the same
  rigs. Crits punch the camera; melee hits flare a slash arc.

- **The isle drawn deeper** — instanced wind-bent grass across moor and
  cove (one draw call), ground cover that shares cells with standing props,
  a real sun that rakes cast shadows over the open ground (PCF-soft,
  balanced against ambient so noon has shape), a sea that swells in the
  vertex stage instead of only scrolling, and golden-hour god rays that
  pour from the sun's seat on screen through the grade pass.

- **Co-op hardening** — the host now re-sends its snapshot periodically
  even when unchanged, so a single lost packet (like the one carrying a
  fight's start) can never strand the companion's mirror.

- **A taller isle, a truer coast** — two new canonical assets give the wilds
  vertical scale: lone pines grown far above their neighbors and crag spires
  of stacked leaning rock, seeded on open ground and mixed into the
  impassable thickets. The shoreline stopped being a straight line: a
  noise-jittered sand lip wanders along every coast (continuous across
  cells), a thin foam ribbon rides the waterline and surges in and out with
  the tide, half-sunk rocks break the shallows, and rare sea stacks stand
  offshore where the isle once reached. The open sea rolls with a real
  three-wave swell, damped flat near the coast so the shallows stay calm.

- **The surf** — whitecaps now roll in from the sea in staggered sets and
  break on the waterline, faster and taller when the wind is up; a dark
  wet-sand band follows the wandering waterline and breathes with the
  tide; and gulls wheel over the offshore sea stacks all day.

- **The moor becomes a forest** — after the Might & Magic X reference:
  density means enclosure, not decoration. The moor's impassable cells are
  true forest walls now (`forestWall`): three trunks with tiered crowns,
  underbrush choking the gaps, and a canopy that leans out over the
  adjacent path so the sky shows only in clearings. A new `bush` asset
  gives the near-ground layer, and the grass doubled again into a carpet.
  Paths read as carved through the woods; the cove keeps its open,
  windswept strand for contrast.

- **Flanked UI & height-banded moor** — on wide screens the interface holds
  both sides of a wide central view: log, party, and the movement diamond
  left; location, combat commands, and the action arc right. And elevation
  now writes the vegetation in three bands, keeping real open spaces: bare
  heights of crag, dry straw grass, and lone pines with long views; the
  forest belt at mid-height with its canopy over the paths; and low open
  marsh edges near the water. The summits you climb for automap reach are
  now visibly different country from the woods below them.

- **The ground truly rolls** — the correction that mattered: relief itself,
  not prop height. The moor's elevation amplitude nearly doubled (cove up
  half again), so paths climb and drop visibly and hills read as hills on
  the horizon; every height-coupled rule rescaled with it (automap vision
  bands, the slope-combat threshold, mob scrabbling, vegetation bands).
  The forest canopy was grounded at the same time — no more detached
  foliage floating over the trail; the path-side tree now spreads one
  attached bough over the way instead.

- **Sidestepping & smoother hands** — the crawler's classic strafe arrives:
  ◀ ▶ on the movement pad, Q/E on a keyboard, and co-op guests strafe
  through the host link like every other move. Movement buttons now repeat
  while held, so crossing the moor no longer means drumming a thumb; in
  combat a plain tap on a foe strikes (the flick still works). And the
  party plaques stopped bleeding over the 3D view on wide screens — the
  left column now clips and ellipsizes instead of overflowing.

- **A real compass** — "Facing East" gave way to a brass-and-parchment
  compass rose (`src/compass.ts`, a small self-contained class): the card
  swings so the facing cardinal sits under the fixed needle, always turning
  the short way around, with the facing kept as an aria-label for screen
  readers. A dead-class sweep went with it — the stylesheet audit found the
  CSS otherwise clean (one unused rule removed).

- **The flanks earn their keep** — the wide layout's empty spaces now work
  for a living. Left: a Satchel panel (`src/satchel.ts`) with the purse and
  potion count, a feed of the last five pickups (chest gold, landmark
  hoards, combat spoils, trophies, sealed cards — each with its glyph), and
  a landmarks-and-chests tally. Right: the automap docked and always open,
  scaled to the column with crisp pixels, hidden while fighting so the
  command panel takes its place; phones keep the corner-overlay toggle.
  The compass letters also learned to counter-rotate, staying upright
  while they orbit the card.

- **The curve splits: routs and veterans** — every pack is now weighed
  against the party at first sight (current hit points and steel on both
  sides). Outmatched packs offer "⚔ Cut them down": one tap auto-fights the
  whole battle at double pace, and it bails back to menus if the fight
  turns. At the other end, named elites now stalk the deeper floors and
  wilds — Old Greyjaw whose death-howl sends the pack red-eyed, the
  Gravebound that reassembles once, the Quarry's Heart whose slam takes two
  at a time — bigger in the world, fatter in stats, and worth it: double
  gold, a guaranteed potion, and a one-in-three sealed card. A combat
  generation guard also retires stale fight loops if a new fight ever
  replaces one mid-flight.

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
