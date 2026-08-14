# Range Vault — preflop poker range builder

Local web app for building/editing preflop hand-range charts. Plain Node
`http` server (`server.js`, no framework), port 5173, serving `public/`
statically. No build step, no bundler, no dependencies.

## Architecture

- `server.js` — static file server + JSON API:
  - `GET /api/ranges` — full store
  - `POST /api/ranges/:depth` — register a vault (creates an empty entry if absent)
  - `PUT /api/ranges/:depth/:spotId` — save a spot's hands (deletes the spot if `hands` is empty)
  - `DELETE /api/ranges/:depth` and `DELETE /api/ranges/:depth/:spotId`
  - Writes are serialized through a single promise chain (`writeQueue`) so concurrent saves can't corrupt `data/ranges.json`.
- `data/ranges.json` — sole persistence layer. Shape: `{ depthName: { spotId: { hands: {...}, updatedAt } } }`.
- `public/treeConfig.js` — builds the preflop action tree (positions → open → facing actions → 3bet/4bet/5bet lines).
- `public/app.js` — all client state/rendering/paint logic.
- `public/handGrid.js` — static 13×13 hand-matrix builder.
- `public/index.html`, `public/styles.css` — shell and styling.

## Running it

- `node server.js`, or `launch.ps1` / `launch.vbs` for a standalone window.
- A `poker-range-manager` entry exists in the root `D:\Claude\.claude\launch.json` for the Browser-pane preview tool.

## Features implemented so far

1. **Facing-open combo spots** — every "first response to an open" node (e.g. `LJ vs Open`, `SB vs Open` facing BB's iso-raise) is one combined spot with Call/Raise/Allin strategies instead of separate pages. 4 big colored frequency buttons (Allin/Raise/Call/Fold, GTOWizard-style) show live %/combo counts; click a button to select it, then paint hands. Deeper spots (vs 3bet, vs 4bet) are still single-action. Each hand holds one dominant action only — no fractional/mixed-frequency splitting (flagged as a possible future add).
2. **Vault auto-persist** — creating a vault `POST`s to `/api/ranges/:depth` immediately, writing an empty entry to disk so it survives reload and shows under "Your Vaults" before any spot is saved.
3. **Smart Cover drag-paint** — toggle button (`localStorage['rv-smart-cover']`) that makes painting a hand also paint every stronger hand above it in the same grid column, so dragging one diagonal border line fills the whole staircase region above it. Off by default.

## Conventions

- No framework, no build step — keep it that way unless there's a concrete reason to add tooling.
- Update the "Features implemented" list above when a feature lands, instead of leaving it to drift from the code.
