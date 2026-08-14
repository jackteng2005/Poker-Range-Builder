# Range Vault — session notes

Not a git repo. Plain Node `http` server (`server.js`, port 5173, no framework) serving `public/` statically. Data persists to `data/ranges.json` only: `{ depthName: { spotId: { hands: {...}, updatedAt } } }`.

- `public/treeConfig.js` — builds the preflop action tree (positions → open → facing actions → 3bet/4bet/5bet lines).
- `public/app.js` — all client state/rendering/paint logic.
- `public/handGrid.js` — static 13×13 hand-matrix builder.
- Launch: `node server.js`, or `launch.ps1`/`launch.vbs` for a standalone window. A `poker-range-manager` entry lives in the root `D:\Claude\.claude\launch.json` for the Browser-pane preview tool.

## Features implemented (as of 2026-08-12)

1. **Facing-open combo spots** — every "first response to an open" node (e.g. `LJ vs Open`, `SB vs Open` facing BB's iso-raise) is one combined spot with Call/Raise/Allin strategies instead of separate pages. 4 big colored frequency buttons (Allin/Raise/Call/Fold, GTOWizard-style) show live %/combo counts; click a button to select it, then paint hands. Deeper spots (vs 3bet, vs 4bet) still single-action. Each hand holds one dominant action only — no fractional/mixed-frequency splitting (flagged as a possible future add).
2. **Vault auto-persist** — creating a vault `POST`s to `/api/ranges/:depth` immediately, writing an empty entry to disk so it survives reload and shows under "Your Vaults" before any spot is saved.
3. **Smart Cover drag-paint** — toggle button (`localStorage['rv-smart-cover']`) that makes painting a hand also paint every stronger hand above it in the same grid column, so dragging one diagonal border line fills the whole staircase region above it. Off by default.

## Note on cross-session memory

This file is a stopgap. The intended home for this context is Claude's auto-memory system (`~/.claude/projects/D--Claude/memory/`), but that directory's ACL currently only grants standard users read access — writes were denied until permissions get fixed (see chat for the `icacls` fix). Once fixed, this content should live there instead and this file can just stay as a quick human-readable reference.
