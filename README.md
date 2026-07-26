# Ember Isle

A first-person, grid-based party RPG in the tradition of *Might and Magic* and
*Shining in the Darkness*, delivered as a single self-contained HTML file.

Draft four adventurer cards from a random tavern roster, then descend the Old
Stair: two dungeon depths rendered in first-person on canvas, random
encounters, turn-based combat, spells and weapon arts, levelling with skill
trees, rarity-tiered cards with rolled traits, a growing collection with daily
recruits, shops, a temple, treasure chests, an automap, 2-player co-op over
WebRTC, procedural music, and a boss guarding the Heart of Ember.
See `ROADMAP.md` for what's next.

## Play

The game deploys to GitHub Pages on every push to `main`:
**https://pandailan.github.io/ember-isle/**

Assets stream on demand: a small core loads instantly, the WebGL world engine
streams in behind the title screen, and the co-op networking chunk only loads
when a signal fire is lit. A service worker makes repeat visits instant and
lets the game run fully offline. For a copy that works from a plain file with
no server at all, grab `single.html` from the deployed site.

Designed for touch (iPad): on-screen buttons or swipe the viewport to move;
arrow keys / WASD also work. Progress saves to `localStorage` on the device.
No server or network is needed once the page has loaded.

## Develop

Source is strict-mode TypeScript in `src/`:

| File | Contents |
| --- | --- |
| `src/types.ts` | Shared interfaces (cards, enemies, game state, skills) |
| `src/data.ts` | Classes, spells & arts, bestiary, maps, loot, tuning constants |
| `src/traits.ts` | Trait & skill-tree content plus every derived-stat hook |
| `src/cards.ts` | Card generation, rarity rolls, naming, save migration |
| `src/state.ts` | Runtime state, versioned saves, map queries |
| `src/biomes.ts` | Biome structs: textures, ambient light, prop placement per level |
| `src/scene3d.ts` | WebGL engine (three.js): placement, sky, weather, lights, bloom, camera |
| `src/assets3d.ts` | Canonical 3D asset library: every world object as a named, swappable factory over a shared material palette — replace any entry (or return a GLTF group) without touching the engine |
| `src/render.ts` | 2D subsystems: automap, title scene, monster art |
| `src/audio.ts` | Procedural WebAudio sfx and ambient scene music |
| `src/net.ts` | PeerJS link (host/join, message framing) |
| `src/ui.ts` | Router, party plaques, shared combat widgets |
| `src/bus.ts` | Cross-screen action registry (keeps the graph acyclic) |
| `src/tavern.ts` | Opening draft, collection, card detail & skill spending |
| `src/town.ts` | Town hub, shop, temple, ending |
| `src/dungeon.ts` | Movement, cell events, dungeon controls |
| `src/combat.ts` | Turn engine, arts/spells, victory & levelling |
| `src/coop.ts` | Host↔guest sync, remote combat seats, join flow |
| `src/main.ts` | Boot wiring only |
| `src/page.html` | Markup and CSS template the bundle is inlined into |

```sh
npm install
npm run check   # type-check
npm run build   # emit dist/: streaming build (index.html + chunks + sw.js)
                # and dist/single.html (one self-contained file)
```

`.github/workflows/deploy.yml` type-checks, builds, and publishes `dist/` to
GitHub Pages. To play locally, open `dist/single.html` in any browser.
