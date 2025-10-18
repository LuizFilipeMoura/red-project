import {
  BOARD_H,
  BOARD_W,
  SIDE_ROWS,
  type AreaShape,
  type Card_Talent,
} from '@repo/shared';

export type BoardCell = { x: number; y: number };

export const isOnBoard = (x: number, y: number) => x >= 0 && x < BOARD_W && y >= 0 && y < BOARD_H;

const pushIfValid = (cells: BoardCell[], cell: BoardCell) => {
  if (isOnBoard(cell.x, cell.y)) {
    cells.push(cell);
  }
};

export const resolveSpellArea = (area: AreaShape, anchor: BoardCell): BoardCell[] => {
  const cells: BoardCell[] = [];
  if (area === 'cell') {
    pushIfValid(cells, anchor);
    return cells;
  }
  if (area === 'row') {
    for (let x = 0; x < BOARD_W; x += 1) {
      pushIfValid(cells, { x, y: anchor.y });
    }
    return cells;
  }
  if (area === 'col') {
    for (let y = 0; y < BOARD_H; y += 1) {
      pushIfValid(cells, { x: anchor.x, y });
    }
    return cells;
  }
  if (typeof area === 'object' && area.shape === 'square2x2') {
    for (let dx = 0; dx < 2; dx += 1) {
      for (let dy = 0; dy < 2; dy += 1) {
        pushIfValid(cells, { x: anchor.x + dx, y: anchor.y + dy });
      }
    }
    return cells;
  }
  if (typeof area === 'object' && area.shape === 'diag') {
    pushIfValid(cells, anchor);
    for (let step = 1; step <= area.length; step += 1) {
      pushIfValid(cells, { x: anchor.x + step, y: anchor.y + step });
      pushIfValid(cells, { x: anchor.x - step, y: anchor.y + step });
      pushIfValid(cells, { x: anchor.x + step, y: anchor.y - step });
      pushIfValid(cells, { x: anchor.x - step, y: anchor.y - step });
    }
    return cells;
  }
  return cells;
};

export const computeTalentRangeCells = (talent: Card_Talent, unitPosition: BoardCell) => {
  const cells: BoardCell[] = [];
  for (let y = 0; y < BOARD_H; y += 1) {
    for (let x = 0; x < BOARD_W; x += 1) {
      const distance = Math.abs(unitPosition.x - x) + Math.abs(unitPosition.y - y);
      if (distance <= talent.range) {
        cells.push({ x, y });
      }
    }
  }
  return cells;
};

export const computeSpawnRowsForSide = (side: 'A' | 'B') => {
  const rows = SIDE_ROWS[side];
  const cells: BoardCell[] = [];
  for (let y = rows.min; y <= rows.max; y += 1) {
    for (let x = 0; x < BOARD_W; x += 1) {
      cells.push({ x, y });
    }
  }
  return cells;
};
