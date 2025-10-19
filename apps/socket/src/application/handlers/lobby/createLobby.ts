import { Mutex } from 'async-mutex';
import { EVENTS, LOBBY_CAPACITY, schemas } from '@repo/shared';
import type { z } from 'zod';
import { createLobbyRow, type LobbyState, type PlayerState } from '../../../state.js';
import { hashPassword } from '../../../security.js';
import type { EventHandler } from '../../types.js';

const schema = schemas[EVENTS.CREATE];

type CreateLobbyInput = z.infer<typeof schema>;

export const handleCreateLobby: EventHandler<CreateLobbyInput> = async (context, input) => {
  context.logger.info(
    {
      sid: context.sid,
      socketId: context.socket.id,
      lobbyName: input.name,
      isPrivate: input.isPrivate,
    },
    'Creating lobby',
  );

  const lobbyRow = createLobbyRow({
    name: input.name,
    ownerSid: context.sid,
    isPrivate: input.isPrivate ?? Boolean(input.password),
    passwordHash: input.password ? hashPassword(input.password) : null,
    capacity: LOBBY_CAPACITY,
  });

  await context.db.lobby.create({
    data: {
      id: lobbyRow.id,
      name: lobbyRow.name,
      isPrivate: lobbyRow.isPrivate,
      passwordHash: lobbyRow.passwordHash,
      capacity: lobbyRow.capacity,
      ownerSid: lobbyRow.ownerSid,
      createdAt: new Date(lobbyRow.createdAt),
      status: lobbyRow.status,
    },
  });

  const joinedAt = Date.now();
  const inserted = await context.db.player.create({
    data: {
      lobbyId: lobbyRow.id,
      sid: context.sid,
      joinedAt: new Date(joinedAt),
      isReady: false,
    },
    select: { id: true },
  });

  const playerState: PlayerState = {
    lobbyId: lobbyRow.id,
    sid: context.sid,
    joinedAt,
    isReady: false,
    id: inserted?.id ?? undefined,
  };

  const lobbyState: LobbyState = {
    meta: lobbyRow,
    players: [playerState],
    currentPlayerSid: null,
    turnNumber: 0,
    deadlineAt: null,
    match: null,
    mutex: new Mutex(),
  };

  context.store.set(lobbyRow.id, lobbyState);

  context.logger.info(
    {
      lobbyId: lobbyRow.id,
      sid: context.sid,
      socketId: context.socket.id,
    },
    'Joining lobby room',
  );

  await context.joinLobbyRoom(lobbyRow.id);

  context.logger.info(
    {
      lobbyId: lobbyRow.id,
      sid: context.sid,
      socketId: context.socket.id,
      room: `lobby:${lobbyRow.id}`,
    },
    'Creator joined lobby room, broadcasting state',
  );

  await context.broadcastState(lobbyState);

  context.logger.info(
    {
      lobbyId: lobbyRow.id,
      playerCount: lobbyState.players.length,
    },
    'Lobby creation complete - state broadcast finished',
  );
};

export const createLobbyDefinition = {
  event: EVENTS.CREATE,
  schema,
  useRateLimit: true,
  handler: handleCreateLobby,
} as const;
