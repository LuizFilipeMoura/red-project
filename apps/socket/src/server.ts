import { createServer } from 'node:http';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import cookie from 'cookie';
import signature from 'cookie-signature';
import { Server, type Socket } from 'socket.io';
import { and, desc, eq } from 'drizzle-orm';
import { Mutex } from 'async-mutex';
import { z } from 'zod';
import { env } from './env.js';
import { logger } from './logger.js';
import {
  COOKIE_NAME,
  EVENTS,
  LOBBY_CAPACITY,
  LOBBY_RETENTION_MS,
  LOBBY_ROOM,
  makeMsg,
  paginationSchema,
  lobbyIdSchema,
  schemas,
} from '@repo/shared';
import {
  createLobbyStore,
  toLobby,
  createLobbyRow,
  persistSnapshot,
  attachTimeout,
  clearLobbyTimeout,
} from './state.js';
import { getDatabase, lobbies, players, turns } from '@repo/db';
import type { LobbyState, PlayerState } from './state.js';

const db = getDatabase(env.DATABASE_URL);
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
const unsignSid = (signed: string | undefined | null) => {
  if (!signed) return null;
  if (!signed.startsWith('s:')) return null;
  const unsigned = signature.unsign(signed.slice(2), env.COOKIE_SECRET);
  return unsigned ?? null;
};

const issueSid = () => randomBytes(16).toString('hex');

io.engine.use((req, res, next) => {
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

const hashPassword = (password: string) => {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
};

const verifyPassword = (stored: string | null, password: string | undefined) => {
  if (!stored) return true;
  if (!password) return false;
  const [salt, hash] = stored.split(':');
  const derived = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return timingSafeEqual(derived, expected);
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

const broadcastState = async (lobby: LobbyState) => {
  await persistSnapshot(db, lobby);
  const dto = makeMsg(EVENTS.STATE_SYNC, { lobby: toLobby(lobby) });
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
  const lobbyRows = await db.select().from(lobbies);
  for (const row of lobbyRows) {
    const playerRows = await db.select().from(players).where(eq(players.lobbyId, row.id));
    const playerStates: PlayerState[] = playerRows.map((player) => ({
      id: player.id,
      lobbyId: player.lobbyId,
      sid: player.sid,
      joinedAt: player.joinedAt ?? Date.now(),
      isReady: Boolean(player.isReady),
    }));
    const lobbyState: LobbyState = {
      meta: row,
      players: playerStates,
      currentPlayerSid: null,
      turnNumber: 0,
      deadlineAt: null,
      mutex: new Mutex(),
    };
    const lastTurn = await db
      .select()
      .from(turns)
      .where(eq(turns.lobbyId, row.id))
      .orderBy(desc(turns.id))
      .limit(1);
    if (lastTurn.length > 0) {
      try {
        const parsed = JSON.parse(lastTurn[0].stateJson);
        lobbyState.currentPlayerSid = parsed?.lobby?.currentPlayerSid ?? null;
        lobbyState.turnNumber = parsed?.lobby?.turnNumber ?? 0;
        lobbyState.deadlineAt = parsed?.lobby?.deadlineAt
          ? Date.parse(parsed.lobby.deadlineAt)
          : null;
      } catch (error) {
        logger.error({ err: error }, 'Failed to parse snapshot');
      }
    }
    store.set(row.id, lobbyState);
    if (lobbyState.currentPlayerSid) {
      const remaining = lobbyState.deadlineAt ? Math.max(0, lobbyState.deadlineAt - Date.now()) : undefined;
      scheduleTurnTimeout(lobbyState, remaining);
    }
  }
  logger.info({ count: store.size }, 'Restored lobbies from database');
};

const pruneEmptyLobbies = async () => {
  const now = Date.now();
  for (const [id, lobby] of store) {
    if (lobby.players.length === 0) {
      const lastSeen = lobby.deadlineAt ?? lobby.meta.createdAt ?? now;
      if (now - lastSeen > LOBBY_RETENTION_MS) {
        clearLobbyTimeout(store, id);
        store.delete(id);
        await db.delete(lobbies).where(eq(lobbies.id, id));
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

  const joinLobbyRoom = (lobbyId: string) => socket.join(LOBBY_ROOM(lobbyId));

  socket.on(EVENTS.CREATE, async (payload) => {
    try {
      if (!checkRateLimit(socket, EVENTS.CREATE)) {
        return emitError('RATE_LIMIT', 'Too many requests');
      }
      const input = parsePayload(EVENTS.CREATE, payload, schemas[EVENTS.CREATE]);
      const lobbyRow = createLobbyRow({
        name: input.name,
        ownerSid: sid,
        isPrivate: input.isPrivate ?? Boolean(input.password),
        passwordHash: input.password ? hashPassword(input.password) : null,
      });
      await db.insert(lobbies).values(lobbyRow);
      const playerInsert = {
        lobbyId: lobbyRow.id,
        sid,
        joinedAt: Date.now(),
        isReady: false,
      };
      const inserted = await db.insert(players).values(playerInsert).returning();
      const playerState: PlayerState = {
        ...playerInsert,
        id: inserted[0]?.id ?? null,
      };
      const lobbyState: LobbyState = {
        meta: lobbyRow,
        players: [playerState],
        currentPlayerSid: null,
        turnNumber: 0,
        deadlineAt: null,
        mutex: new Mutex(),
      };
      store.set(lobbyRow.id, lobbyState);
      joinLobbyRoom(lobbyRow.id);
      await broadcastState(lobbyState);
    } catch (error) {
      logger.error({ err: error, event: EVENTS.CREATE, sid }, 'Failed to create lobby');
      emitError('VALIDATION', error instanceof Error ? error.message : 'Invalid payload');
    }
  });

  socket.on(EVENTS.LIST, async (payload) => {
    try {
      if (!checkRateLimit(socket, EVENTS.LIST)) {
        return emitError('RATE_LIMIT', 'Too many requests');
      }
      const input = parsePayload(EVENTS.LIST, payload, paginationSchema);
      const lobbiesArray = Array.from(store.values())
        .filter((lobby) => !lobby.meta.isPrivate)
        .filter((lobby) => lobby.players.length < LOBBY_CAPACITY)
        .sort((a, b) => (a.meta.createdAt ?? 0) - (b.meta.createdAt ?? 0));
      const total = lobbiesArray.length;
      const start = (input.page - 1) * input.pageSize;
      const end = start + input.pageSize;
      const pageItems = lobbiesArray.slice(start, end).map((lobby) => toLobby(lobby));
      socket.emit(
        EVENTS.LIST,
        makeMsg(EVENTS.LIST, { items: pageItems, page: input.page, total }),
      );
    } catch (error) {
      emitError('VALIDATION', error instanceof Error ? error.message : 'Invalid payload');
    }
  });

  socket.on(EVENTS.JOIN, async (payload) => {
    try {
      if (!checkRateLimit(socket, EVENTS.JOIN)) {
        return emitError('RATE_LIMIT', 'Too many requests');
      }
      const input = parsePayload(
        EVENTS.JOIN,
        payload,
        schemas[EVENTS.JOIN],
      );
      const lobby = store.get(input.lobbyId);
      if (!lobby) {
        return emitError('NOT_FOUND', 'Lobby not found');
      }
      await lobby.mutex.runExclusive(async () => {
        if (lobby.players.some((player) => player.sid === sid)) {
          joinLobbyRoom(lobby.meta.id);
          return;
        }
        if (lobby.players.length >= LOBBY_CAPACITY) {
          return emitError('FULL', 'Lobby is full');
        }
        if (!verifyPassword(lobby.meta.passwordHash ?? null, input.password)) {
          return emitError('PASSWORD', 'Invalid password');
        }
        const playerInsert = {
          lobbyId: lobby.meta.id,
          sid,
          joinedAt: Date.now(),
          isReady: false,
        };
        const inserted = await db.insert(players).values(playerInsert).returning();
        lobby.players.push({
          ...playerInsert,
          id: inserted[0]?.id ?? null,
        });
        joinLobbyRoom(lobby.meta.id);
        if (lobby.players.length === LOBBY_CAPACITY) {
          const first = lobby.players[Math.floor(Math.random() * lobby.players.length)];
          lobby.currentPlayerSid = first.sid;
          lobby.turnNumber = 1;
          lobby.meta.status = 'started';
          await db
            .update(lobbies)
            .set({ status: lobby.meta.status })
            .where(eq(lobbies.id, lobby.meta.id));
          scheduleTurnTimeout(lobby);
        }
        await broadcastState(lobby);
      });
    } catch (error) {
      emitError('VALIDATION', error instanceof Error ? error.message : 'Invalid payload');
    }
  });

  socket.on(EVENTS.LEAVE, async (payload) => {
    try {
      if (!checkRateLimit(socket, EVENTS.LEAVE)) {
        return emitError('RATE_LIMIT', 'Too many requests');
      }
      const input = parsePayload(EVENTS.LEAVE, payload, schemas[EVENTS.LEAVE]);
      const lobby = store.get(input.lobbyId);
      if (!lobby) return;
      await lobby.mutex.runExclusive(async () => {
        const index = lobby.players.findIndex((player) => player.sid === sid);
        if (index >= 0) {
          lobby.players.splice(index, 1);
          await db
            .delete(players)
            .where(and(eq(players.lobbyId, lobby.meta.id), eq(players.sid, sid)));
          socket.leave(LOBBY_ROOM(lobby.meta.id));
          if (lobby.players.length === 0) {
            clearLobbyTimeout(store, lobby.meta.id);
            lobby.currentPlayerSid = null;
            lobby.deadlineAt = null;
          }
          lobby.meta.status = 'waiting';
          await db
            .update(lobbies)
            .set({ status: lobby.meta.status })
            .where(eq(lobbies.id, lobby.meta.id));
          if (lobby.currentPlayerSid === sid) {
            lobby.currentPlayerSid = lobby.players[0]?.sid ?? null;
            if (lobby.currentPlayerSid) {
              scheduleTurnTimeout(lobby);
            }
          }
          await broadcastState(lobby);
        }
      });
    } catch (error) {
      emitError('VALIDATION', error instanceof Error ? error.message : 'Invalid payload');
    }
  });

  socket.on(EVENTS.START, async (payload) => {
    try {
      if (!checkRateLimit(socket, EVENTS.START)) {
        return emitError('RATE_LIMIT', 'Too many requests');
      }
      const input = parsePayload(EVENTS.START, payload, schemas[EVENTS.START]);
      const lobby = store.get(input.lobbyId);
      if (!lobby) return emitError('NOT_FOUND', 'Lobby not found');
      await lobby.mutex.runExclusive(async () => {
        if (lobby.players.length < LOBBY_CAPACITY) {
          return emitError('NOT_READY', 'Need 2 players to start');
        }
        lobby.meta.status = 'started';
        if (!lobby.currentPlayerSid) {
          lobby.currentPlayerSid = lobby.players[0]?.sid ?? null;
        }
        await db
          .update(lobbies)
          .set({ status: lobby.meta.status })
          .where(eq(lobbies.id, lobby.meta.id));
        scheduleTurnTimeout(lobby);
        await broadcastState(lobby);
      });
    } catch (error) {
      emitError('VALIDATION', error instanceof Error ? error.message : 'Invalid payload');
    }
  });

  socket.on(EVENTS.TURN_PASS, async (payload) => {
    try {
      if (!checkRateLimit(socket, EVENTS.TURN_PASS)) {
        return emitError('RATE_LIMIT', 'Too many requests');
      }
      const input = parsePayload(EVENTS.TURN_PASS, payload, schemas[EVENTS.TURN_PASS]);
      const lobby = store.get(input.lobbyId);
      if (!lobby) return emitError('NOT_FOUND', 'Lobby not found');
      await lobby.mutex.runExclusive(async () => {
        if (lobby.currentPlayerSid !== sid) {
          return emitError('TURN', 'Not your turn');
        }
        const other = lobby.players.find((player) => player.sid !== sid);
        if (!other) return;
        lobby.currentPlayerSid = other.sid;
        lobby.turnNumber += 1;
        scheduleTurnTimeout(lobby);
        await broadcastState(lobby);
      });
    } catch (error) {
      emitError('VALIDATION', error instanceof Error ? error.message : 'Invalid payload');
    }
  });

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
