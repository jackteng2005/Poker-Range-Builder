# Range Vault

[![Tests](https://github.com/jackteng2005/Poker-Range-Builder/actions/workflows/test.yml/badge.svg)](https://github.com/jackteng2005/Poker-Range-Builder/actions/workflows/test.yml)

A local web app for building and editing preflop poker hand-range charts. You pick a stack depth (a "vault"), browse the preflop action tree, and paint actions onto a 13×13 hand grid. Every change saves automatically.

Built with plain Node.js and vanilla JavaScript: no framework, no build step, and no dependencies.

## Features

- **Full preflop action tree**: every position, then open, facing an open, and 3-bet, 4-bet and 5-bet lines.
- **Combined facing-open spots**: each first response to an open is a single spot with Allin / Raise / Call / Fold buttons that show live percentages and combo counts.
- **Drag-to-paint grid**: click or drag across the 13×13 matrix. *Smart Cover* mode also paints every stronger hand above in the same column, so one diagonal stroke fills a whole region.
- **Autosave with failure recovery**: each paint stroke saves on mouse-up. If a save fails, the spot is flagged as unsaved again and you're warned before leaving it, so work is never lost silently.
- **Copy / paste ranges** between spots and vaults, with a confirmation before anything is overwritten.
- **Multiple vaults**: create, switch between and delete stack-depth vaults. They persist straight away.

## Running it

Requires [Node.js](https://nodejs.org) (any recent version).

```sh
node server.js
```

Then open <http://localhost:5173>. On Windows, `launch.ps1` / `launch.vbs` open it as a standalone app window.

## Tests

```sh
npm test
```

API tests use Node's built-in test runner, so nothing needs installing. Each run starts the real server on a free port with a temporary data file, then checks saving, deleting, vault creation, the linked SB spots, bad input (400), unknown routes (404) and 25 saves arriving at the same moment. GitHub Actions runs them on Node 20 and 22 on every push.

## Architecture

```
server.js            static file server + JSON REST API (Node http module only)
data/ranges.json     persistence: { depth: { spotId: { hands, updatedAt } } }
public/
  index.html         app shell
  app.js             client state, rendering, painting, autosave
  treeConfig.js      builds the preflop action tree
  handGrid.js        13×13 hand-matrix builder
  styles.css         layout and styling
```

### REST API

| Method   | Endpoint                      | Description                                   |
|----------|-------------------------------|-----------------------------------------------|
| `GET`    | `/api/ranges`                 | Return the full store                         |
| `POST`   | `/api/ranges/:depth`          | Register a vault (creates an empty entry)     |
| `PUT`    | `/api/ranges/:depth/:spotId`  | Save a spot's hands (an empty body deletes it) |
| `DELETE` | `/api/ranges/:depth`          | Delete a vault                                |
| `DELETE` | `/api/ranges/:depth/:spotId`  | Delete a single spot                          |

### Design notes

- **Serialised writes.** Every read-modify-write of `data/ranges.json` runs in turn through a single promise queue, so saves arriving at the same moment each build on the previous one instead of overwriting it. A test fires 25 saves at once and checks that all of them are kept.
- **Saves are tied to the spot they started on.** Each autosave captures its vault, spot and hands when it starts, so a request still in flight can't be credited to a different spot if you navigate away before it finishes.
- **One save per gesture.** Painting sends one `PUT` per click or drag stroke, not one per cell, which keeps the request count low.
