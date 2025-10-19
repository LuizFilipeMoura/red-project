import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import cookie from 'cookie';
import signature from 'cookie-signature';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import { env } from './env.js';
import { logger } from './logger.js';
import {
  COOKIE_NAME,
  EVENTS,
  LOBBY_RETENTION_MS,
  LOBBY_ROOM,
  makeMsg,
  schemas,
} from '@repo/shared';
import {
  createLobbyStore,
  toLobby,
  persistSnapshot,
  attachTimeout,
  clearLobbyTimeout as clearLobbyTimeoutForStore,
} from './state.js';
import { registerHandlers } from './application/registry.js';
import { handlerDefinitions } from './application/handlers';
import { prisma as database } from '@repo/db';
import type { LobbyState } from './state.js';
import { hydrateLobbies } from './state.js';

const db = database;
const store = createLobbyStore();

const httpServer = createServer((_, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
});

const io = new Server(httpServer, {
  cors: {
    origin: env.CORS_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST'],
  },
  transports: ['polling', 'websocket'],
});

const signSid = (sid: string) => 's:' + signature.sign(sid, env.COOKIE_SECRET);
const unsignSid = (signed: string | undefined | null): string | null => {
  if (!signed) return null;
  if (!signed.startsWith('s:')) return null;
  const unsigned = signature.unsign(signed.slice(2), env.COOKIE_SECRET);
  return unsigned === false ? null : unsigned;
};

const issueSid = () => randomBytes(16).toString('hex');

io.engine.use((req: { headers: { cookie: any; }; }, res: { setHeader: (arg0: string, arg1: string) => void; }, next: () => void) => {
  const cookies = cookie.parse(req.headers.cookie ?? '');
  const existing = unsignSid(cookies[COOKIE_NAME]);
  const sid: string = existing ?? issueSid();
  if (!existing) {
    const signed = signSid(sid);
    const cookieStr = cookie.serialize(COOKIE_NAME, signed, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    });
    res.setHeader('Set-Cookie', cookieStr);
  }
  (req as any).sid = sid;
  next();
});

const gameNs = io.of('/game');

type RateBucket = { timestamps: number[] };
const rateLimits = new Map<string, RateBucket>();
const RATE_LIMIT_WINDOW = 1_000;
const RATE_LIMIT_MAX = 5;

const checkRateLimit = (socket: Socket, event: string) => {
  const key = `${socket.id}:${event}`;
  const bucket = rateLimits.get(key) ?? { timestamps: [] };
  const now = Date.now();
  bucket.timestamps = bucket.timestamps.filter((ts) => now - ts < RATE_LIMIT_WINDOW);
  if (bucket.timestamps.length >= RATE_LIMIT_MAX) {
    rateLimits.set(key, bucket);
    return false;
  }
  bucket.timestamps.push(now);
  rateLimits.set(key, bucket);
  return true;
};

const parsePayload = <T>(event: keyof typeof schemas, payload: unknown, schema: z.ZodType<T>) => {
  if (payload && typeof payload === 'object' && 'version' in (payload as any)) {
    const message = payload as { version: string; type: string; payload: unknown };
    if (message.type !== event) {
      throw new Error(`Unexpected message type ${message.type}`);
    }
    return schema.parse(message.payload);
  }
  return schema.parse(payload);
};

const broadcastState = async (lobby: LobbyState, action?: { type: string; payload: unknown }) => {
  await persistSnapshot(db, lobby, action);
  const lobbyDto = toLobby(lobby);
  const matchDto = lobby.match;

  // Emit to each player individually with their SID
  const sockets = await gameNs.in(LOBBY_ROOM(lobby.meta.id)).fetchSockets();
  for (const socket of sockets) {
    const sid = socket.data.sid;
    const dto = makeMsg(EVENTS.STATE_SYNC, {
      lobby: lobbyDto,
      match: matchDto,
      yourSid: sid,
    });
    socket.emit(EVENTS.STATE_SYNC, dto);
  }
};

const scheduleTurnTimeout = (lobby: LobbyState, duration?: number) => {
  const timeoutMs = duration ?? (lobby.deadlineAt ? lobby.deadlineAt - Date.now() : undefined);
  const handler = async (state: LobbyState) => {
    if (!state.currentPlayerSid) return;
    const next = state.players.find((player) => player.sid !== state.currentPlayerSid);
    if (!next) return;
    state.currentPlayerSid = next.sid;
    state.turnNumber += 1;
    scheduleTurnTimeout(state);
    await broadcastState(state);
  };
  if (timeoutMs !== undefined) {
    attachTimeout(store, lobby.meta.id, handler, Math.max(timeoutMs, 0));
  } else {
    attachTimeout(store, lobby.meta.id, handler);
  }
};

const loadPersistedState = async () => {
  await hydrateLobbies(db, store);
  logger.info({ count: store.size }, 'Restored lobbies from database');
};

const pruneEmptyLobbies = async () => {
  const now = Date.now();
  for (const [id, lobby] of store) {
    if (lobby.players.length === 0) {
      const lastSeen = lobby.deadlineAt ?? lobby.meta.createdAt ?? now;
      if (now - lastSeen > LOBBY_RETENTION_MS) {
        clearLobbyTimeoutForStore(store, id);
        store.delete(id);
        await db.lobby.deleteMany({ where: { id } });
        logger.info({ lobbyId: id }, 'Removed empty lobby');
      }
    }
  }
};

const syncActiveMatches = async () => {
  for (const [id, lobby] of store) {
    // Only sync lobbies that have an active match (status = 'started')
    if (lobby.meta.status === 'started' && lobby.match && !lobby.match.winnerSid) {
      await broadcastState(lobby);
    }
  }
};

setInterval(pruneEmptyLobbies, 60_000).unref();
setInterval(syncActiveMatches, 1_000).unref();

gameNs.use((socket, next) => {
  const cookies = cookie.parse(socket.handshake.headers.cookie ?? '');
  const sid = unsignSid(cookies[COOKIE_NAME]);
  if (!sid) {
    return next(new Error('unauthorized'));
  }
  socket.data.sid = sid;
  next();
});

gameNs.on('connection', (socket) => {
  const sid: string = socket.data.sid;
  logger.info({ sid }, 'Socket connected');

  const emitError = (code: string, message: string) => {
    socket.emit(EVENTS.ERROR, makeMsg(EVENTS.ERROR, { code, message }));
  };

  registerHandlers(
    {
      db,
      store,
      socket,
      sid,
      logger,
      emitError,
      joinLobbyRoom: (lobbyId: string) => socket.join(LOBBY_ROOM(lobbyId)),
      leaveLobbyRoom: (lobbyId: string) => socket.leave(LOBBY_ROOM(lobbyId)),
      broadcastState,
      scheduleTurnTimeout,
      clearLobbyTimeout: (lobbyId: string) => clearLobbyTimeoutForStore(store, lobbyId),
      checkRateLimit: (event: string) => checkRateLimit(socket, event),
      parsePayload,
    },
    handlerDefinitions,
  );

  socket.on('disconnect', () => {
    logger.info({ sid }, 'Socket disconnected');
  });
});

const start = async () => {
  await loadPersistedState();
  httpServer.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'Socket server listening');
  });
};

start().catch((error) => {
  logger.error({ err: error }, 'Failed to start server');
  process.exit(1);
});

