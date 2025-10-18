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
import { db as database, lobbies as lobbiesTable } from '@repo/db';
import type { LobbyState } from './state.js';
import { hydrateLobbies } from './state.js';
import { eq } from 'drizzle-orm';

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

const signSid = (sid: string | false) => 's:' + signature.sign(sid, env.COOKIE_SECRET);
const unsignSid = (signed: string | undefined | null) => {
  if (!signed) return null;
  if (!signed.startsWith('s:')) return null;
  const unsigned = signature.unsign(signed.slice(2), env.COOKIE_SECRET);
  return unsigned ?? null;
};

const issueSid = () => randomBytes(16).toString('hex');

io.engine.use((req: { headers: { cookie: any; }; }, res: { setHeader: (arg0: string, arg1: string) => void; }, next: () => void) => {
  const cookies = cookie.parse(req.headers.cookie ?? '');
  const existing = unsignSid(cookies[COOKIE_NAME]);
  const sid = existing ?? issueSid();
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
  const dto = makeMsg(EVENTS.STATE_SYNC, {
    lobby: toLobby(lobby),
    match: lobby.match,
  });
  gameNs.to(LOBBY_ROOM(lobby.meta.id)).emit(EVENTS.STATE_SYNC, dto);
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
      const lastSeen = lobby.deadlineAt ?? lobby.meta.createdAt.getTime() ?? now;
      if (now - lastSeen > LOBBY_RETENTION_MS) {
        clearLobbyTimeoutForStore(store, id);
        store.delete(id);
        await db.delete(lobbiesTable).where(eq(lobbiesTable.id, id)).run();
        logger.info({ lobbyId: id }, 'Removed empty lobby');
      }
    }
  }
};

setInterval(pruneEmptyLobbies, 60_000).unref();

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
