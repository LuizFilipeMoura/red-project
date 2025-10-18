import { SIDE_ROWS, BOARD_W, BOARD_H, UNIT_COST, MOVE_RANGE, FLAG_A, FLAG_B } from '@repo/shared';
import type { LobbyState } from '../state.js';
import type { MatchState } from '@repo/shared';

export const getPlayerOrder = (lobby: LobbyState): [string, string] | null => {
  if (lobby.players.length < 2) return null;
  const sorted = [...lobby.players].sort((a, b) => a.joinedAt - b.joinedAt);
  return [sorted[0]!.sid, sorted[1]!.sid];
};

export const getPlayerSide = (lobby: LobbyState, sid: string): 'A' | 'B' | null => {
  const order = getPlayerOrder(lobby);
  if (!order) return null;
  return order[0] === sid ? 'A' : order[1] === sid ? 'B' : null;
};

export const isOnBoard = (x: number, y: number) => x >= 0 && x < BOARD_W && y >= 0 && y < BOARD_H;

export const isWithinSpawnZone = (side: 'A' | 'B', y: number) => {
  const rows = SIDE_ROWS[side];
  return y >= rows.min && y <= rows.max;
};

export const isCellOccupied = (match: MatchState, x: number, y: number) =>
  match.units.some((unit) => unit.x === x && unit.y === y);

export const manhattanDistance = (fromX: number, fromY: number, toX: number, toY: number) =>
  Math.abs(fromX - toX) + Math.abs(fromY - toY);

export const getUnitCost = (type: keyof typeof UNIT_COST) => UNIT_COST[type];

export const getMoveRange = (type: keyof typeof MOVE_RANGE) => MOVE_RANGE[type];

export const isFlagCell = (x: number, y: number) =>
  (x === FLAG_A.x && y === FLAG_A.y) || (x === FLAG_B.x && y === FLAG_B.y);
