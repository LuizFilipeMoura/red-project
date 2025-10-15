import { z } from 'zod';
import {
  LOBBY_CAPACITY,
  MAX_LOBBY_NAME_LENGTH,
  TURN_TIMEOUT_MS,
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

export const stateSyncSchema = z.object({
  lobby: lobbySchema,
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

export const schemas = {
  'lobby:create': z.object({
    name: lobbyNameSchema,
    password: z.string().optional(),
    isPrivate: z.boolean().optional(),
  }),
  'lobby:list': z.union([paginationSchema, lobbyListResponseSchema]),
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
} satisfies Record<string, z.ZodTypeAny>;

export type Lobby = z.infer<typeof lobbySchema>;
export type Player = z.infer<typeof playerSchema>;
export type StateSync = z.infer<typeof stateSyncSchema>;
export type ErrorPayload = z.infer<typeof errorSchema>;
export type LobbyListPayload = z.infer<typeof lobbyListResponseSchema>;

export const turnStateSchema = z.object({
  lobbyId: lobbyIdSchema,
  currentPlayerSid: sidSchema,
  turnNumber: z.number().int().min(0),
  deadlineAt: z.number().int().nonnegative(),
  timeoutMs: z.literal(TURN_TIMEOUT_MS),
});
