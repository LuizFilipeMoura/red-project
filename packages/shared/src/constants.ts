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
} as const;
