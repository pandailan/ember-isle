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

## Next

- **Phase 3 — the Trading Post**: propose/confirm card and item swaps over the
  P2P link while both players are online. Trust-based (saves are local).
- **Phase 4 — server ledger** *(needs a free Cloudflare account)*: Worker + KV
  as the source of truth for card ownership, plus shared leaderboard and a
  graveyard (fallen parties appear in other players' dungeons).
- More depths, quests, and a second boss; hardcore mode (cards can truly die).

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
