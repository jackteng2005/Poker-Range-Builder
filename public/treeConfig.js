// Builds the preflop action tree: positions -> open raise -> facing actions -> 3bet/4bet/5bet lines.
// Simplification (v1): once a hand gets to a raise/re-raise, only the two players directly
// involved in that raise continue the line (other seats are treated as folded). This mirrors
// how most manual range-building tools scope "vs 3bet" / "vs 4bet" spots.

export const POSITIONS = ['UTG', 'UTG+1', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];

// Terse HRC-style action codes: R = raise/open, 3B/4B/5B = re-raise levels, C = call.
const RAISE_LABEL = ['R', '3B', '4B', '5B'];
const MAX_RAISE_LEVEL = 3; // index into RAISE_LABEL: 0=open,1=3bet,2=4bet,3=5bet(shove, no further raise)

function positionsAfter(pos) {
  const idx = POSITIONS.indexOf(pos);
  return POSITIONS.slice(idx + 1);
}

let nodeCounter = 0;
function buildRaiseNode(raiser, facingPositions, level, idPrefix) {
  const id = idPrefix;
  const node = {
    id,
    label: `${raiser} ${RAISE_LABEL[level]}`,
    position: raiser,
    kind: 'spot', // always has its own range chart
    seq: nodeCounter++,
    children: [],
  };

  if (level === 0) {
    // First response to an open: one combined spot per responder holding
    // Call / Raise / Allin as strategies inside a single range chart,
    // instead of separate call-only and raise-only pages.
    for (const responder of facingPositions) {
      const facingId = `${id}>${responder}-FacingOpen`;
      // Reuse the normal raise-tree builder to get what follows if the
      // responder's chosen action is "raise" (a 3bet) — only its children
      // are needed; the 3bet spot itself now lives inside the combo node.
      const raiseSubtree = buildRaiseNode(responder, [raiser], level + 1, facingId);
      node.children.push({
        id: facingId,
        label: `${responder} vs Open`,
        position: responder,
        kind: 'facing-open', // combined Allin/Raise/Call/Fold strategy chart
        actions: ['allin', 'raise', 'call'],
        seq: nodeCounter++,
        children: raiseSubtree.children,
      });
    }
    return node;
  }

  if (level < MAX_RAISE_LEVEL) {
    for (const responder of facingPositions) {
      const callId = `${id}>${responder}-Call-vs-L${level}`;
      node.children.push({
        id: callId,
        label: `${responder} C`,
        position: responder,
        kind: 'spot',
        seq: nodeCounter++,
        children: [],
      });

      const raiseId = `${id}>${responder}-Raise-L${level + 1}`;
      node.children.push(buildRaiseNode(responder, [raiser], level + 1, raiseId));
    }
  } else {
    // Final level (5-bet shove): only a call is left, no further raise.
    for (const responder of facingPositions) {
      const callId = `${id}>${responder}-CallsShove`;
      node.children.push({
        id: callId,
        label: `${responder} C`,
        position: responder,
        kind: 'spot',
        seq: nodeCounter++,
        children: [],
      });
    }
  }
  return node;
}

export function buildTree() {
  nodeCounter = 0;
  const roots = [];
  for (const pos of POSITIONS.slice(0, -1)) {
    // every position except BB can be first to open
    const facing = positionsAfter(pos);
    roots.push(buildRaiseNode(pos, facing, 0, `${pos}-RFI`));

    if (pos === 'SB') {
      // SB can also limp (call the BB) instead of raising. BB can then
      // isolate-raise the limp, which SB can call back.
      roots.push({
        id: 'SB-Limp',
        label: 'SB C',
        position: 'SB',
        kind: 'spot',
        seq: nodeCounter++,
        children: [
          {
            id: 'SB-Limp>BB-Raise',
            label: 'BB R',
            position: 'BB',
            kind: 'spot',
            seq: nodeCounter++,
            children: [
              {
                id: 'SB-Limp>BB-Raise>SB-FacingOpen',
                label: 'SB vs Open',
                position: 'SB',
                kind: 'facing-open',
                actions: ['allin', 'raise', 'call'],
                seq: nodeCounter++,
                children: [],
              },
            ],
          },
        ],
      });
    }
  }
  return roots;
}

// Flatten helper for lookups.
export function flattenTree(roots) {
  const map = new Map();
  (function walk(nodes) {
    for (const n of nodes) {
      map.set(n.id, n);
      if (n.children && n.children.length) walk(n.children);
    }
  })(roots);
  return map;
}
