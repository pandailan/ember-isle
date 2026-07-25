# Ember Isle

A first-person, grid-based party RPG in the tradition of *Might and Magic* and
*Shining in the Darkness*, delivered as a single self-contained HTML file.

Recruit four adventurers in the tavern of a fog-bound island, then descend the
Old Stair: two dungeon depths rendered in first-person on canvas, random
encounters, turn-based combat, spells, levelling, shops, a temple, treasure
chests, an automap, and a boss guarding the Heart of Ember.

## Play

The game deploys to GitHub Pages on every push to `main`:
**https://pandailan.github.io/ember-isle/**

Designed for touch (iPad): on-screen buttons or swipe the viewport to move;
arrow keys / WASD also work. Progress saves to `localStorage` on the device.
No server or network is needed once the page has loaded.

## Develop

Source is strict-mode TypeScript in `src/`:

| File | Contents |
| --- | --- |
| `src/types.ts` | Shared interfaces (members, enemies, game state, combat) |
| `src/data.ts` | Classes, spells, roster, bestiary, maps, loot, tuning constants |
| `src/state.ts` | Game state, saves, derived stats, map queries |
| `src/render.ts` | First-person canvas renderer, automap, monster portraits |
| `src/main.ts` | Screens, dungeon movement, combat engine, boot |
| `src/page.html` | Markup and CSS template the bundle is inlined into |

```sh
npm install
npm run check   # type-check
npm run build   # emit dist/index.html (single self-contained file)
```

`.github/workflows/deploy.yml` type-checks, builds, and publishes `dist/` to
GitHub Pages. To play locally, open `dist/index.html` in any browser.
