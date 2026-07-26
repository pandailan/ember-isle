# Credits & Asset Attribution

## Current build: procedural assets, open-source engine

Every visual and sound in Ember Isle is **generated in code** — no external
asset files are shipped. The renderer is built on an open-source library:

| Component | Source | License | Link |
| --- | --- | --- | --- |
| three.js (WebGL engine) | mrdoob & contributors | MIT | https://threejs.org |

Everything drawn *with* it is still procedural:

- **World geometry & materials** — the 3D scene (`src/scene3d.ts`) is built
  from map data at runtime; wall albedo and normal maps are baked in code
  (`src/biomes.ts`), monsters are vector-drawn canvas sprites, flames and
  embers are generated glow textures.
- **Music & sound effects** — synthesized at runtime with WebAudio
  (`src/audio.ts`): generated-impulse reverb, per-biome generative scores,
  no samples.

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
