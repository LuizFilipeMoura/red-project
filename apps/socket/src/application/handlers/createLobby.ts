import { Mutex } from 'async-mutex';
import { EVENTS, schemas } from '@repo/shared';
import type { z } from 'zod';
import { createLobbyRow, type LobbyState, type PlayerState } from '../../state.js';
import { hashPassword } from '../../security.js';
import type { EventHandler } from '../types.js';

const schema = schemas[EVENTS.CREATE];

type CreateLobbyInput = z.infer<typeof schema>;

export const handleCreateLobby: EventHandler<CreateLobbyInput> = async (context, input) => {
  const lobbyRow = createLobbyRow({
    name: input.name,
    ownerSid: context.sid,
    isPrivate: input.isPrivate ?? Boolean(input.password),
    passwordHash: input.password ? hashPassword(input.password) : null,
  });

  await context.db.lobby.create({ data: lobbyRow });

  const playerInsert = {
    lobbyId: lobbyRow.id,
    sid: context.sid,
    joinedAt: new Date(),
    isReady: false,
  };

  const inserted = await context.db.player.create({ data: playerInsert });
  const playerState: PlayerState = {
    lobbyId: playerInsert.lobbyId,
    sid: playerInsert.sid,
    joinedAt: playerInsert.joinedAt.getTime(),
    isReady: playerInsert.isReady,
    id: inserted.id,
  };

  const lobbyState: LobbyState = {
    meta: lobbyRow,
    players: [playerState],
    currentPlayerSid: null,
    turnNumber: 0,
    deadlineAt: null,
    mutex: new Mutex(),
  };

  context.store.set(lobbyRow.id, lobbyState);
  await context.joinLobbyRoom(lobbyRow.id);
  await context.broadcastState(lobbyState);
};

export const createLobbyDefinition = {
  event: EVENTS.CREATE,
  schema,
  useRateLimit: true,
  handler: handleCreateLobby,
} as const;
