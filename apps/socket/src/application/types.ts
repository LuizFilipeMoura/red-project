import type { Socket } from 'socket.io';
import type { z } from 'zod';
import type { Logger } from 'pino';
import type { PrismaClient } from '@repo/db';
import type { LobbyState, LobbyStore } from '../state.js';

export type HandlerContext = {
  db: PrismaClient;
  store: LobbyStore;
  socket: Socket;
  sid: string;
  logger: Logger;
  emitError: (code: string, message: string) => void;
  joinLobbyRoom: (lobbyId: string) => Promise<void> | void;
  leaveLobbyRoom: (lobbyId: string) => Promise<void> | void;
  broadcastState: (lobby: LobbyState) => Promise<void>;
  scheduleTurnTimeout: (lobby: LobbyState, duration?: number) => void;
  clearLobbyTimeout: (lobbyId: string) => void;
  checkRateLimit: (event: string) => boolean;
  parsePayload: <T>(event: keyof typeof import('@repo/shared').schemas, payload: unknown, schema: z.ZodType<T>) => T;
};

export type EventHandler<TInput> = (context: HandlerContext, input: TInput) => Promise<void>;
