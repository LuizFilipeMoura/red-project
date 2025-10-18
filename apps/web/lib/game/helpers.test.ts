import { resolveSpellArea, computeTalentRangeCells, computeSpawnRowsForSide } from './helpers.js';
import { SIDE_ROWS, type Card_Talent } from '@repo/shared';

describe('game helpers', () => {
  it('resolves single cell area', () => {
    expect(resolveSpellArea('cell', { x: 3, y: 3 })).toEqual([{ x: 3, y: 3 }]);
  });

  it('resolves row area within bounds', () => {
    const cells = resolveSpellArea('row', { x: 4, y: 2 });
    expect(cells).toHaveLength(8);
    expect(cells.every((cell) => cell.y === 2)).toBe(true);
  });

  it('resolves diagonal area with length', () => {
    const cells = resolveSpellArea({ shape: 'diag', length: 1 }, { x: 1, y: 1 });
    expect(cells).toEqual(
      expect.arrayContaining([
        { x: 1, y: 1 },
        { x: 2, y: 2 },
        { x: 0, y: 2 },
        { x: 2, y: 0 },
        { x: 0, y: 0 },
      ]),
    );
  });

  it('computes talent range based on Manhattan distance', () => {
    const talent: Card_Talent = {
      id: 't',
      kind: 'Talent',
      sourceUnitId: 'u',
      unitType: 'Warrior',
      cost: 1,
      range: 1,
      text: '',
      effect: { type: 'damage', amount: 1 },
      expiresAtTurn: 1,
    };
    const cells = computeTalentRangeCells(talent, { x: 3, y: 3 });
    expect(cells).toEqual(
      expect.arrayContaining([
        { x: 3, y: 3 },
        { x: 4, y: 3 },
        { x: 2, y: 3 },
        { x: 3, y: 4 },
        { x: 3, y: 2 },
      ]),
    );
  });

  it('computes spawn rows for a side', () => {
    const cells = computeSpawnRowsForSide('A');
    expect(cells.every((cell) => cell.y >= SIDE_ROWS.A.min && cell.y <= SIDE_ROWS.A.max)).toBe(true);
    expect(cells).toHaveLength(32);
  });
});
