# Credits & Asset Attribution

## Current build: 100% procedural

Every visual and sound in Ember Isle is currently **generated in code** — no
external asset files are shipped:

- **Dungeon renderer, monster art, title scene** — drawn at runtime on canvas
  (`src/render.ts`); monster portraits are vector-drawn shapes, walls are
  procedural stone with per-face lighting, particles and light shafts are
  computed each frame.
- **Music & sound effects** — synthesized at runtime with WebAudio
  (`src/audio.ts`); no samples.

This keeps the game a single self-contained HTML file. Original code and art
direction: built with Claude Code for this project.

## When external assets are added

Any imported image, model, or audio file must be listed here with its source
and license before it ships. Planned sources (all free, attribution noted even
when the license doesn't require it):

| Asset | Source | License | Link |
| --- | --- | --- | --- |
| *(none yet)* | | | |

Recommended libraries of CC0 (public-domain-equivalent) game assets:

- **Kenney** — kenney.nl — CC0 — dungeon tile kits, UI packs, audio packs
- **Quaternius** — quaternius.com — CC0 — low-poly monster & dungeon 3D packs
- **Poly Pizza** — poly.pizza — aggregator; check per-model license (mostly CC0/CC-BY)
- **OpenGameArt** — opengameart.org — mixed; filter to CC0/CC-BY and record author
- **Kevin MacLeod** — incompetech.com — CC-BY 4.0 — music (requires credit line)

CC-BY assets require the author + license in this file **and** in the in-game
credits screen.
