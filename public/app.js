import { buildTree, flattenTree } from './treeConfig.js';
import { buildHandMatrix } from './handGrid.js';

const state = {
  depth: null,
  store: { '50bb': {}, '100bb': {} }, // full server payload
  tree: [],
  nodeMap: new Map(),
  expanded: new Set(),
  selectedNodeId: null,
  currentHands: {}, // hand -> true (normal spot) or action string (facing-open spot)
  dirty: false,
  paintAction: null, // currently selected action to paint with, for facing-open spots
  smartCover: localStorage.getItem('rv-smart-cover') === '1',
};

const HAND_MATRIX = buildHandMatrix();
const COMBOS = { pair: 6, suited: 4, offsuit: 12 };
const TOTAL_COMBOS = 1326;

// Row/column lookup for the smart-cover drag: each hand knows its grid
// position, and each column knows its hands from strongest (row 0) down,
// so a touched cell can pull in everything "above" it in that column.
const HAND_POSITION = new Map();
const COLUMNS = [];
for (let c = 0; c < 13; c++) {
  const column = [];
  for (let r = 0; r < 13; r++) {
    const hand = HAND_MATRIX[r][c].hand;
    column.push(hand);
    HAND_POSITION.set(hand, { row: r, col: c });
  }
  COLUMNS.push(column);
}
let handCellDivs = new Map();

const el = {
  depthScreen: document.getElementById('depth-screen'),
  app: document.getElementById('app'),
  depthPill: document.getElementById('depth-pill'),
  treeRoot: document.getElementById('tree-root'),
  emptyState: document.getElementById('empty-state'),
  editor: document.getElementById('editor'),
  breadcrumb: document.getElementById('breadcrumb'),
  spotTitle: document.getElementById('spot-title'),
  handGrid: document.getElementById('hand-grid'),
  actionToolbar: document.getElementById('action-toolbar'),
  handCount: document.getElementById('hand-count'),
  saveStatus: document.getElementById('save-status'),
  saveBtn: document.getElementById('save-btn'),
  clearBtn: document.getElementById('clear-btn'),
  smartCoverBtn: document.getElementById('smart-cover-btn'),
  switchDepthBtn: document.getElementById('switch-depth-btn'),
  expandAllBtn: document.getElementById('expand-all-btn'),
  collapseAllBtn: document.getElementById('collapse-all-btn'),
  customDepthForm: document.getElementById('custom-depth-form'),
  customDepthInput: document.getElementById('custom-depth-input'),
  customDepthError: document.getElementById('custom-depth-error'),
  otherDepths: document.getElementById('other-depths'),
  otherDepthsList: document.getElementById('other-depths-list'),
};

function accentColor(label) {
  const token = label.split(' ').pop();
  if (token === 'Open') return 'var(--accent)'; // facing-open combo spot
  if (token === '5B') return 'var(--purple)';
  if (token === '4B') return 'var(--red)';
  if (token === '3B') return 'var(--amber)';
  if (token === 'C') return 'var(--blue)';
  return 'var(--green)'; // R (open raise)
}

// ---------- Facing-open combo spots (Call / Raise / Allin / Fold) ----------
const FACING_ACTIONS = [
  { key: 'allin', label: 'Allin', cls: 'action-btn--allin' },
  { key: 'raise', label: 'Raise', cls: 'action-btn--raise' },
  { key: 'call', label: 'Call', cls: 'action-btn--call' },
  { key: 'fold', label: 'Fold', cls: 'action-btn--fold' },
];
const FACING_COLORS = {
  allin: 'var(--maroon)',
  raise: 'var(--crimson)',
  call: 'var(--green)',
  fold: 'var(--blue)',
};
let facingButtonRefs = {};

function computeFacingStats(hands) {
  const totals = { allin: 0, raise: 0, call: 0 };
  for (const [hand, action] of Object.entries(hands)) {
    if (!(action in totals)) continue;
    const combos = hand.length === 2 ? COMBOS.pair : hand.endsWith('s') ? COMBOS.suited : COMBOS.offsuit;
    totals[action] += combos;
  }
  const assigned = totals.allin + totals.raise + totals.call;
  return { ...totals, fold: TOTAL_COMBOS - assigned };
}

function renderActionToolbar() {
  el.actionToolbar.innerHTML = '';
  facingButtonRefs = {};
  for (const action of FACING_ACTIONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `action-btn ${action.cls}` + (state.paintAction === action.key ? ' selected' : '');

    const label = document.createElement('span');
    label.className = 'action-btn__label';
    label.textContent = action.label;

    const pct = document.createElement('span');
    pct.className = 'action-btn__pct';

    const combos = document.createElement('span');
    combos.className = 'action-btn__combos';

    btn.appendChild(label);
    btn.appendChild(pct);
    btn.appendChild(combos);

    btn.addEventListener('click', () => {
      state.paintAction = action.key;
      for (const child of el.actionToolbar.children) child.classList.remove('selected');
      btn.classList.add('selected');
    });

    el.actionToolbar.appendChild(btn);
    facingButtonRefs[action.key] = { pctEl: pct, combosEl: combos };
  }
  updateFacingStats();
}

function updateFacingStats() {
  const stats = computeFacingStats(state.currentHands);
  for (const key of Object.keys(facingButtonRefs)) {
    const pct = ((stats[key] / TOTAL_COMBOS) * 100).toFixed(1);
    facingButtonRefs[key].pctEl.textContent = `${pct}%`;
    facingButtonRefs[key].combosEl.textContent = `${stats[key]} combos`;
  }
}

function applyFacingCellState(div) {
  const hand = div.dataset.hand;
  const action = state.currentHands[hand] || 'fold';
  div.classList.add('included', 'facing');
  div.style.background = FACING_COLORS[action];
}

function setFacingHandAction(hand, value, div) {
  if (value) state.currentHands[hand] = value;
  else delete state.currentHands[hand];
  applyFacingCellState(div);
  updateFacingStats();
  markDirty();
}

async function fetchStore() {
  const res = await fetch('/api/ranges');
  state.store = await res.json();
}

function nodeHasSavedRange(nodeId) {
  const bucket = state.store[state.depth];
  return !!(bucket && bucket[nodeId] && Object.keys(bucket[nodeId].hands || {}).length > 0);
}

// ---------- Tree rendering ----------
function renderTree() {
  el.treeRoot.innerHTML = '';
  for (const root of state.tree) {
    el.treeRoot.appendChild(renderNode(root, 0));
  }
}

function renderNode(node, depthLevel) {
  const wrap = document.createElement('div');
  wrap.className = 'tree-node';

  const row = document.createElement('div');
  row.className = 'tree-node__row';
  row.style.paddingLeft = `${8 + depthLevel * 16}px`;
  if (node.id === state.selectedNodeId) row.classList.add('active');

  const hasChildren = node.children && node.children.length > 0;
  const caret = document.createElement('span');
  caret.className = 'tree-node__caret' + (hasChildren ? '' : ' leaf');
  const isExpanded = state.expanded.has(node.id);
  if (isExpanded) caret.classList.add('expanded');
  caret.textContent = '▸'; // ▸
  row.appendChild(caret);

  const label = document.createElement('span');
  label.className = 'tree-node__label';
  label.textContent = node.label;
  row.appendChild(label);

  if (nodeHasSavedRange(node.id)) {
    const dot = document.createElement('span');
    dot.className = 'tree-node__saved-dot';
    dot.style.background = accentColor(node.label);
    dot.title = 'Range saved';
    row.appendChild(dot);
  }

  row.addEventListener('click', (e) => {
    e.stopPropagation();
    selectNode(node.id);
    if (hasChildren) toggleExpand(node.id);
  });

  wrap.appendChild(row);

  if (hasChildren) {
    const childrenWrap = document.createElement('div');
    childrenWrap.className = 'tree-node__children' + (isExpanded ? '' : ' collapsed');
    childrenWrap.dataset.parent = node.id;
    for (const child of node.children) {
      childrenWrap.appendChild(renderNode(child, depthLevel + 1));
    }
    wrap.appendChild(childrenWrap);
  }

  return wrap;
}

function toggleExpand(nodeId) {
  if (state.expanded.has(nodeId)) state.expanded.delete(nodeId);
  else state.expanded.add(nodeId);
  renderTree();
}

function setAllExpanded(expand) {
  state.expanded.clear();
  if (expand) {
    for (const node of state.nodeMap.values()) {
      if (node.children && node.children.length) state.expanded.add(node.id);
    }
  }
  renderTree();
}

// ---------- Selection + editor ----------
function selectNode(nodeId) {
  if (state.dirty && !confirm('You have unsaved changes to this range. Discard them?')) {
    return;
  }
  state.selectedNodeId = nodeId;
  const node = state.nodeMap.get(nodeId);
  const saved = state.store[state.depth]?.[nodeId]?.hands || {};
  state.currentHands = { ...saved };
  state.dirty = false;

  el.emptyState.classList.add('hidden');
  el.editor.classList.remove('hidden');

  renderBreadcrumb(nodeId);
  el.spotTitle.textContent = node.label;

  const isFacingOpen = node.kind === 'facing-open';
  el.actionToolbar.classList.toggle('hidden', !isFacingOpen);
  el.handCount.classList.toggle('hidden', isFacingOpen);
  if (isFacingOpen) {
    if (!state.paintAction || state.paintAction === 'fold') state.paintAction = 'call';
    renderActionToolbar();
  }

  renderHandGrid();
  if (isFacingOpen) updateFacingStats();
  else updateHandCount();
  setSaveStatus('idle');
  renderTree();
}

function pathToNode(nodeId) {
  const parts = nodeId.split('>');
  const labels = [];
  let cursor = '';
  for (const part of parts) {
    cursor = cursor ? `${cursor}>${part}` : part;
    const n = state.nodeMap.get(cursor);
    if (n) labels.push(n.label);
  }
  return labels;
}

function renderBreadcrumb(nodeId) {
  const labels = pathToNode(nodeId);
  el.breadcrumb.innerHTML = '';
  for (const label of labels) {
    const span = document.createElement('span');
    span.textContent = label;
    el.breadcrumb.appendChild(span);
  }
}

function renderHandGrid() {
  el.handGrid.innerHTML = '';
  handCellDivs = new Map();
  const node = state.nodeMap.get(state.selectedNodeId);
  const isFacingOpen = node.kind === 'facing-open';
  const color = isFacingOpen ? null : accentColor(node.label);

  for (const row of HAND_MATRIX) {
    for (const cell of row) {
      const div = document.createElement('div');
      div.className = `hand-cell ${cell.type}`;
      div.textContent = cell.hand;
      div.dataset.hand = cell.hand;
      handCellDivs.set(cell.hand, div);

      if (isFacingOpen) applyFacingCellState(div);
      else applyCellState(div, color);

      div.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (isFacingOpen) {
          const current = state.currentHands[cell.hand];
          const paint = state.paintAction;
          const nextValue = paint === 'fold' ? undefined : current === paint ? undefined : paint;
          paintState.active = true;
          paintState.facingValue = nextValue;
          paintHand(cell.hand, (h) => setFacingHandAction(h, nextValue, handCellDivs.get(h)));
        } else {
          const nowIncluded = !state.currentHands[cell.hand];
          paintState.active = true;
          paintState.value = nowIncluded;
          paintHand(cell.hand, (h) => setHandIncluded(h, nowIncluded, handCellDivs.get(h), color));
        }
      });
      div.addEventListener('mouseenter', () => {
        if (!paintState.active) return;
        if (isFacingOpen) paintHand(cell.hand, (h) => setFacingHandAction(h, paintState.facingValue, handCellDivs.get(h)));
        else paintHand(cell.hand, (h) => setHandIncluded(h, paintState.value, handCellDivs.get(h), color));
      });

      el.handGrid.appendChild(div);
    }
  }
}

// Applies `applyOne` to the touched hand, and — when Smart Cover is on —
// to every stronger hand above it in the same column, so dragging along a
// single border line fills the whole range above that line.
function paintHand(hand, applyOne) {
  applyOne(hand);
  if (!state.smartCover) return;
  const pos = HAND_POSITION.get(hand);
  const column = COLUMNS[pos.col];
  for (let r = 0; r < pos.row; r++) {
    applyOne(column[r]);
  }
}

function applyCellState(div, color) {
  const hand = div.dataset.hand;
  if (state.currentHands[hand]) {
    div.classList.add('included');
    div.style.background = color;
  } else {
    div.classList.remove('included');
    div.style.background = '';
  }
}

function setHandIncluded(hand, included, div, color) {
  if (included) state.currentHands[hand] = true;
  else delete state.currentHands[hand];
  applyCellState(div, color);
  updateHandCount();
  markDirty();
}

const paintState = { active: false, value: true };
window.addEventListener('mouseup', () => {
  paintState.active = false;
});

function updateHandCount() {
  const hands = Object.keys(state.currentHands);
  let combos = 0;
  for (const h of hands) {
    if (h.length === 2) combos += COMBOS.pair;
    else combos += h.endsWith('s') ? COMBOS.suited : COMBOS.offsuit;
  }
  const pct = ((combos / TOTAL_COMBOS) * 100).toFixed(1);
  el.handCount.textContent = `${hands.length} hands · ${combos} combos · ${pct}%`;
}

function markDirty() {
  state.dirty = true;
  setSaveStatus('dirty');
}

function setSaveStatus(mode) {
  el.saveStatus.classList.remove('dirty', 'saved');
  if (mode === 'dirty') {
    el.saveStatus.textContent = 'Unsaved changes';
    el.saveStatus.classList.add('dirty');
  } else if (mode === 'saved') {
    const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    el.saveStatus.textContent = `Saved at ${t}`;
    el.saveStatus.classList.add('saved');
  } else {
    el.saveStatus.textContent = '';
  }
}

async function saveCurrentSpot() {
  if (!state.selectedNodeId) return;
  el.saveBtn.disabled = true;
  el.saveBtn.textContent = 'Saving…';
  try {
    const res = await fetch(`/api/ranges/${encodeURIComponent(state.depth)}/${encodeURIComponent(state.selectedNodeId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hands: state.currentHands }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Save failed');

    if (!state.store[state.depth]) state.store[state.depth] = {};
    if (data.spot) state.store[state.depth][state.selectedNodeId] = data.spot;
    else delete state.store[state.depth][state.selectedNodeId];

    state.dirty = false;
    setSaveStatus('saved');
    renderTree();
  } catch (err) {
    alert('Could not save range: ' + err.message);
  } finally {
    el.saveBtn.disabled = false;
    el.saveBtn.textContent = 'Save Range';
  }
}

function clearCurrentSpot() {
  if (Object.keys(state.currentHands).length === 0) return;
  if (!confirm('Clear all selected hands in this spot?')) return;
  state.currentHands = {};
  const node = state.nodeMap.get(state.selectedNodeId);
  renderHandGrid();
  if (node.kind === 'facing-open') updateFacingStats();
  else updateHandCount();
  markDirty();
}

// ---------- Depth flow ----------
async function chooseDepth(depth) {
  state.depth = depth;
  localStorage.setItem('rv-last-depth', depth);
  state.tree = buildTree();
  state.nodeMap = flattenTree(state.tree);
  state.selectedNodeId = null;
  state.expanded.clear();

  // Registers the vault on disk immediately, even if no spot gets saved in
  // it yet, so it survives a reload and shows up under "Your Vaults".
  await fetch(`/api/ranges/${encodeURIComponent(depth)}`, { method: 'POST' });
  await fetchStore();

  el.depthPill.textContent = depth;
  el.depthScreen.classList.add('hidden');
  el.app.classList.remove('hidden');
  el.editor.classList.add('hidden');
  el.emptyState.classList.remove('hidden');

  renderTree();
}

function showDepthScreen() {
  if (state.dirty && !confirm('You have unsaved changes. Discard them?')) return;
  el.app.classList.add('hidden');
  el.depthScreen.classList.remove('hidden');
  el.customDepthInput.value = '';
  hideCustomDepthError();
  refreshOtherDepths();
}

function hideCustomDepthError() {
  el.customDepthError.classList.add('hidden');
  el.customDepthError.textContent = '';
}

function submitCustomDepth() {
  const value = el.customDepthInput.value.trim();
  if (!value) {
    el.customDepthError.textContent = 'Enter a depth name first — e.g. "50bb" or "20bb Bubble".';
    el.customDepthError.classList.remove('hidden');
    el.customDepthInput.focus();
    return;
  }
  hideCustomDepthError();
  chooseDepth(value);
}

async function refreshOtherDepths() {
  try {
    const res = await fetch('/api/ranges');
    const store = await res.json();
    const keys = Object.keys(store);
    el.otherDepthsList.innerHTML = '';
    if (keys.length === 0) {
      el.otherDepths.classList.add('hidden');
      return;
    }
    keys.sort((a, b) => a.localeCompare(b));
    for (const key of keys) {
      const chip = document.createElement('div');
      chip.className = 'other-depth-chip';

      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'other-depth-chip__label';
      label.textContent = key;
      label.addEventListener('click', () => chooseDepth(key));

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'other-depth-chip__delete';
      del.textContent = '×';
      del.title = `Delete "${key}"`;
      del.addEventListener('click', () => deleteDepth(key));

      chip.appendChild(label);
      chip.appendChild(del);
      el.otherDepthsList.appendChild(chip);
    }
    el.otherDepths.classList.remove('hidden');
  } catch {
    // Non-fatal: custom depth entry still works without the recent-list.
  }
}

async function deleteDepth(depth) {
  if (!confirm(`Delete the "${depth}" vault and all its saved ranges? This can't be undone.`)) return;
  await fetch(`/api/ranges/${encodeURIComponent(depth)}`, { method: 'DELETE' });
  refreshOtherDepths();
}

// ---------- Wire up ----------
el.customDepthForm.addEventListener('submit', (e) => {
  e.preventDefault();
  submitCustomDepth();
});

refreshOtherDepths();

el.smartCoverBtn.classList.toggle('active', state.smartCover);
el.smartCoverBtn.addEventListener('click', () => {
  state.smartCover = !state.smartCover;
  localStorage.setItem('rv-smart-cover', state.smartCover ? '1' : '0');
  el.smartCoverBtn.classList.toggle('active', state.smartCover);
});

el.switchDepthBtn.addEventListener('click', showDepthScreen);
el.saveBtn.addEventListener('click', saveCurrentSpot);
el.clearBtn.addEventListener('click', clearCurrentSpot);
el.expandAllBtn.addEventListener('click', () => setAllExpanded(true));
el.collapseAllBtn.addEventListener('click', () => setAllExpanded(false));

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    if (!el.editor.classList.contains('hidden')) saveCurrentSpot();
  }
});
