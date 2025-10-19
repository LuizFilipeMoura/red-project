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
  STATE_SYNC: 'state:sync',
  ERROR: 'error',
  CARD_PLAY_UNIT: 'card:playUnit',
  CARD_PLAY_SPELL: 'card:playSpell',
  CARD_PLAY_TALENT: 'card:playTalent',
  GAME_MOVE_UNIT: 'game:moveUnit',
  GAME_END_TURN: 'game:endTurn',
} as const;

export const BOARD_W = 8;
export const BOARD_H = 8;
export const FLAG_A = { x: 0, y: 0 } as const;
export const FLAG_B = { x: BOARD_W - 1, y: BOARD_H - 1 } as const;
export const MANA_PER_TURN = 5;

export const CARD_KINDS = ['Unit', 'Spell', 'Talent'] as const;
export type CardKind = (typeof CARD_KINDS)[number];

export const UNIT_TYPES = ['Mage', 'Warrior', 'Archer'] as const;
export type UnitType = (typeof UNIT_TYPES)[number];

export const UNIT_COST: Record<UnitType, number> = {
  Mage: 3,
  Warrior: 2,
  Archer: 2,
};

export const UNIT_HP: Record<UnitType, number> = {
  Mage: 4,
  Warrior: 6,
  Archer: 3,
};

export const MOVE_RANGE: Record<UnitType, number> = {
  Mage: 2,
  Warrior: 1,
  Archer: 3,
};

export const TALENT_RANGE: Record<UnitType, number> = {
  Mage: 2,
  Warrior: 1,
  Archer: 3,
};

export const SIDE_ROWS = {
  A: { min: 0, max: 3 },
  B: { min: 4, max: 7 },
} as const;

export const BOARD_SIDES = SIDE_ROWS;

export const isOwnSide = (side: 'A' | 'B', y: number) => {
  const rows = SIDE_ROWS[side];
  return y >= rows.min && y <= rows.max;
};

export const manhattan = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
