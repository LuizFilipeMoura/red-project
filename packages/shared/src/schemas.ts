import { z } from 'zod';
import {
  BOARD_H,
  BOARD_W,
  EVENTS,
  FLAG_A,
  FLAG_B,
  LOBBY_CAPACITY,
  MAX_LOBBY_NAME_LENGTH,
  MOVE_RANGE,
  MANA_PER_TURN,
  SIDE_ROWS,
  TURN_TIMEOUT_MS,
  UNIT_COST,
  UNIT_TYPES,
} from './constants.js';

export const lobbyIdSchema = z.string().min(1);
export const sidSchema = z.string().min(1);
export const lobbyNameSchema = z
  .string()
  .min(1)
  .max(MAX_LOBBY_NAME_LENGTH)
  .transform((value) => value.trim());

export const paginationSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(50).default(10),
});

export const playerSchema = z.object({
  sid: sidSchema,
  joinedAt: z.string(),
  isReady: z.boolean(),
});

export const lobbySchema = z.object({
  id: lobbyIdSchema,
  name: lobbyNameSchema,
  isPrivate: z.boolean().default(false),
  players: z.array(playerSchema).max(LOBBY_CAPACITY),
  capacity: z.literal(LOBBY_CAPACITY),
  createdAt: z.string(),
  ownerSid: sidSchema.optional(),
  status: z.enum(['waiting', 'started', 'finished']),
  currentPlayerSid: sidSchema.optional(),
  turnNumber: z.number().int().min(0).default(0),
  deadlineAt: z.string().nullable().optional(),
});

export const unitTypeSchema = z.enum(UNIT_TYPES);
export const unitSchema = z.object({
  id: z.string(),
  type: unitTypeSchema,
  owner: sidSchema,
  x: z.number().int().min(0).max(BOARD_W - 1),
  y: z.number().int().min(0).max(BOARD_H - 1),
  canMoveAtTurn: z.number().int().min(1),
});

export const boardSchema = z.object({
  width: z.literal(BOARD_W),
  height: z.literal(BOARD_H),
  flagA: z.object({ x: z.literal(FLAG_A.x), y: z.literal(FLAG_A.y) }),
  flagB: z.object({ x: z.literal(FLAG_B.x), y: z.literal(FLAG_B.y) }),
});

export const matchStateSchema = z.object({
  lobbyId: lobbyIdSchema,
  board: boardSchema,
  units: z.array(unitSchema),
  currentPlayerSid: sidSchema,
  turnNumber: z.number().int().min(1),
  mana: z.record(sidSchema, z.number().int().min(0)),
  winnerSid: sidSchema.optional().nullable(),
});

export const stateSyncSchema = z.object({
  lobby: lobbySchema,
  match: matchStateSchema.nullable(),
  yourSid: sidSchema.optional(),
});

export const errorSchema = z.object({
  code: z.string().default('UNKNOWN'),
  message: z.string(),
});

export const lobbyListResponseSchema = z.object({
  items: z.array(lobbySchema.pick({
    id: true,
    name: true,
    isPrivate: true,
    players: true,
    capacity: true,
    status: true,
  })),
  page: z.number().int().min(1),
  total: z.number().int().nonnegative(),
});

export const placeUnitSchema = z.object({
  lobbyId: lobbyIdSchema,
  type: unitTypeSchema,
  x: z.number().int().min(0).max(BOARD_W - 1),
  y: z.number().int().min(0).max(BOARD_H - 1),
});

export const moveUnitSchema = z.object({
  lobbyId: lobbyIdSchema,
  unitId: z.string(),
  toX: z.number().int().min(0).max(BOARD_W - 1),
  toY: z.number().int().min(0).max(BOARD_H - 1),
});

export const endTurnSchema = z.object({
  lobbyId: lobbyIdSchema,
});

// Request schemas (for client -> server)
export const requestSchemas = {
  'lobby:create': z.object({
    name: lobbyNameSchema,
    password: z.string().optional(),
    isPrivate: z.boolean().optional(),
  }),
  'lobby:list': paginationSchema,
  'lobby:join': z.object({
    lobbyId: lobbyIdSchema,
    password: z.string().optional(),
  }),
  'lobby:leave': z.object({
    lobbyId: lobbyIdSchema,
  }),
  'lobby:start': z.object({
    lobbyId: lobbyIdSchema,
  }),
  'turn:pass': z.object({
    lobbyId: lobbyIdSchema,
  }),
  [EVENTS.GAME_PLACE_UNIT]: placeUnitSchema,
  [EVENTS.GAME_MOVE_UNIT]: moveUnitSchema,
  [EVENTS.GAME_END_TURN]: endTurnSchema,
} satisfies Record<string, z.ZodTypeAny>;

// Response schemas (for server -> client)
export const schemas = {
  'lobby:create': z.object({
    name: lobbyNameSchema,
    password: z.string().optional(),
    isPrivate: z.boolean().optional(),
  }),
  'lobby:list': lobbyListResponseSchema,
  'lobby:join': z.object({
    lobbyId: lobbyIdSchema,
    password: z.string().optional(),
  }),
  'lobby:leave': z.object({
    lobbyId: lobbyIdSchema,
  }),
  'lobby:start': z.object({
    lobbyId: lobbyIdSchema,
  }),
  'turn:pass': z.object({
    lobbyId: lobbyIdSchema,
  }),
  'state:sync': stateSyncSchema,
  error: errorSchema,
  [EVENTS.GAME_PLACE_UNIT]: placeUnitSchema,
  [EVENTS.GAME_MOVE_UNIT]: moveUnitSchema,
  [EVENTS.GAME_END_TURN]: endTurnSchema,
} satisfies Record<string, z.ZodTypeAny>;

export type Lobby = z.infer<typeof lobbySchema>;
export type Player = z.infer<typeof playerSchema>;
export type StateSync = z.infer<typeof stateSyncSchema>;
export type ErrorPayload = z.infer<typeof errorSchema>;
export type LobbyListPayload = z.infer<typeof lobbyListResponseSchema>;
export type Unit = z.infer<typeof unitSchema>;
export type MatchState = z.infer<typeof matchStateSchema>;
export type PlaceUnitPayload = z.infer<typeof placeUnitSchema>;
export type MoveUnitPayload = z.infer<typeof moveUnitSchema>;
export type EndTurnPayload = z.infer<typeof endTurnSchema>;

export const turnStateSchema = z.object({
  lobbyId: lobbyIdSchema,
  currentPlayerSid: sidSchema,
  turnNumber: z.number().int().min(0),
  deadlineAt: z.number().int().nonnegative(),
  timeoutMs: z.literal(TURN_TIMEOUT_MS),
});

export const matchConfigSchema = z.object({
  board: boardSchema,
  manaPerTurn: z.literal(MANA_PER_TURN),
  unitCost: z.object({ Mage: z.literal(UNIT_COST.Mage), Warrior: z.literal(UNIT_COST.Warrior), Archer: z.literal(UNIT_COST.Archer) }),
  moveRange: z.object({ Mage: z.literal(MOVE_RANGE.Mage), Warrior: z.literal(MOVE_RANGE.Warrior), Archer: z.literal(MOVE_RANGE.Archer) }),
  sides: z.object({ A: z.object({ min: z.literal(SIDE_ROWS.A.min), max: z.literal(SIDE_ROWS.A.max) }), B: z.object({ min: z.literal(SIDE_ROWS.B.min), max: z.literal(SIDE_ROWS.B.max) }) }),
});
