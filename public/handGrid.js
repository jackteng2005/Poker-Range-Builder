// Standard 13x13 preflop hand matrix, high-to-low ranks, suited upper-right / offsuit lower-left.
export const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];

export function buildHandMatrix() {
  const rows = [];
  for (let i = 0; i < 13; i++) {
    const row = [];
    for (let j = 0; j < 13; j++) {
      let hand, type;
      if (i === j) {
        hand = RANKS[i] + RANKS[i];
        type = 'pair';
      } else if (i < j) {
        hand = RANKS[i] + RANKS[j] + 's';
        type = 'suited';
      } else {
        hand = RANKS[j] + RANKS[i] + 'o';
        type = 'offsuit';
      }
      row.push({ hand, type });
    }
    rows.push(row);
  }
  return rows;
}

export const ALL_HANDS = buildHandMatrix().flat().map((c) => c.hand);
