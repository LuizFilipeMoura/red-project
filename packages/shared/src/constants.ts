export const VERSION = '1.0.0';
export const LOBBY_CAPACITY = 2;
export const TURN_TIMEOUT_MS = 10_000;
export const LOBBY_ROOM = (id: string) => `lobby:${id}`;
export const COOKIE_NAME = 'sid';
export const MAX_LOBBY_NAME_LENGTH = 32;
export const LOBBY_RETENTION_MS = 5 * 60 * 1000;

export const EVENTS = {
  CREATE: 'lobby:create',
  LIST: 'lobby:list',
  JOIN: 'lobby:join',
  LEAVE: 'lobby:leave',
  START: 'lobby:start',
  TURN_PASS: 'turn:pass',
  STATE_SYNC: 'state:sync',
  ERROR: 'error',
  GAME_PLACE_UNIT: 'game:placeUnit',
  GAME_MOVE_UNIT: 'game:moveUnit',
  GAME_END_TURN: 'game:endTurn',
} as const;

export const BOARD_W = 8;
export const BOARD_H = 8;
export const FLAG_A = { x: 0, y: 0 } as const;
export const FLAG_B = { x: BOARD_W - 1, y: BOARD_H - 1 } as const;
export const MANA_PER_TURN = 5;

export const UNIT_TYPES = ['Mage', 'Warrior', 'Archer'] as const;
export type UnitType = (typeof UNIT_TYPES)[number];

export const UNIT_COST: Record<UnitType, number> = {
  Mage: 3,
  Warrior: 2,
  Archer: 2,
};

export const MOVE_RANGE: Record<UnitType, number> = {
  Mage: 2,
  Warrior: 1,
  Archer: 3,
};

export const SIDE_ROWS = {
  A: { min: 0, max: 3 },
  B: { min: 4, max: 7 },
} as const;

export const SIDE_OF = (player: 'A' | 'B', y: number): 'A' | 'B' => {
  const side = player === 'A' ? SIDE_ROWS.A : SIDE_ROWS.B;
  return y >= side.min && y <= side.max ? player : player === 'A' ? 'B' : 'A';
};
