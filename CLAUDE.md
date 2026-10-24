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
4. **Full-viewport layout, no page scroll** — the editor (header, action toolbar, hand grid, footer) sizes itself with `vh`-aware `clamp()`s instead of fixed pixel values, so the whole app fits in one screen at the 1400×900 app window size with no page-level scrollbar. The sidebar's spot tree still scrolls internally (expected for a long list); that's unrelated to the page-level fix.
5. **Autosave, no Save Range button** — the button is gone; every hand-paint gesture saves on its own `mouseup` (one PUT per click or drag stroke, not per cell touched mid-drag), and `Clear` saves immediately. `saveCurrentSpot()` snapshots depth/spot/hands at call time so a save still in flight can't get misattributed if the user navigates to another spot before it resolves; on fetch failure it re-flags the spot dirty (only if the user is still on it) so the existing "unsaved changes" nav guard still protects against silent data loss.
6. **Copy / paste a range** — `Copy` snapshots the current spot's hands into an in-memory `clipboard` (module-level, not persisted); `Paste` (disabled until something's copied) applies it to whatever spot is open, works across vaults since the clipboard only stores hand data + a facing-open flag, not a node reference. Facing-open ↔ single-action spots translate sensibly: single→facing-open uses the currently-selected toolbar action for every copied hand, facing-open→single includes anything that wasn't fold. Confirms before overwriting a non-empty target spot; autosaves immediately after.

## Quick reference — where things live

Check here first for small changes. Grep for the specific selector/function
below plus a few lines of context instead of reading a whole file top to
bottom — these files are long enough that a full read is overkill for a
one-line tweak.

**`public/index.html`**
- `#depth-screen` — landing screen (name/pick a vault)
- `#app` — main shell: `.topbar` (header) / `.sidebar` + `#tree-root` (spot tree) / `.content` + `#editor` (hand-grid editor)
- `#action-toolbar` — the 4 Allin/Raise/Call/Fold buttons (facing-open spots only)
- `#hand-grid` — the 13×13 grid
- `#save-status` — autosave status text (there is no save button)

**`public/styles.css`** (by region)
- `.depth-screen*` — landing screen
- `.topbar*` — header bar
- `.sidebar`, `.tree*` — spot tree (has its own internal scroll — that's intentional, don't "fix" it)
- `.content`, `.editor*` — main editor pane, sized with `vh`-aware `clamp()`s to avoid page-level scroll; don't reintroduce fixed-px paddings here without re-checking fit at 1400×900
- `.action-toolbar`, `.action-btn*` — facing-open action buttons
- `.hand-grid`, `.hand-cell*` — the matrix; cell size is `clamp(24px, min(3.2vw, 4.4vh), 54px)`
- `.grid-wrap` — wraps the grid; deliberately `align-items: flex-start` (not `center`) with its own `overflow: auto` safety net. If the grid ever doesn't fit, it must clip/scroll *within grid-wrap itself*, never overlap the action toolbar above it — `align-items: center` here previously caused the grid to bleed upward over the toolbar whenever it didn't fit its allotted space (fixed 2026-08-14).
- `.save-status*` — dirty/saving/saved/error states

**`public/app.js`** (by behavior)
- `chooseDepth` / `showDepthScreen` / `submitCustomDepth` / `refreshOtherDepths` / `deleteDepth` — vault selection flow
- `renderTree` / `renderNode` / `toggleExpand` / `selectNode` — spot tree
- `renderHandGrid` / `applyCellState` / `setHandIncluded` — normal (single-action) spot painting
- `renderActionToolbar` / `updateFacingStats` / `applyFacingCellState` / `setFacingHandAction` — facing-open combo spot painting
- `paintHand` — shared drag-paint + Smart Cover fan-out logic
- `saveCurrentSpot` / `setSaveStatus` — autosave; fires from the `window` `mouseup` listener after a paint gesture, and directly from `clearCurrentSpot`
- `paintState` — drag-in-progress flag, read by the `mouseup` listener to decide whether to autosave

**`server.js`** — ~160 lines total, just read it directly; grepping it doesn't save much.

## Verification approach

- CSS-only or markup-only changes: read the diff, sanity-check nothing overflows its container. No need to spin up a duplicate server or drive it through the browser.
- Behavioral changes (new event wiring, autosave/API logic): check against the already-running instance in the Browser pane if one exists; only start a temporary `node server.js` if nothing is listening on 5173, and stop it again afterward.

## Conventions

- No framework, no build step — keep it that way unless there's a concrete reason to add tooling.
- Update the "Features implemented" list above when a feature lands, instead of leaving it to drift from the code.
