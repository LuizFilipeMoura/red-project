import { Mutex } from 'async-mutex';
import { EVENTS, LOBBY_CAPACITY, schemas } from '@repo/shared';
import type { z } from 'zod';
import { lobbies, players } from '@repo/db';
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
    capacity: LOBBY_CAPACITY,
  });

  await context.db.insert(lobbies).values(lobbyRow).run();

  const joinedAt = Date.now();
  const [inserted] = await context.db
    .insert(players)
    .values({
      lobbyId: lobbyRow.id,
      sid: context.sid,
      joinedAt,
      isReady: false,
    })
    .returning({ id: players.id })
    .execute();

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
  await context.joinLobbyRoom(lobbyRow.id);
  await context.broadcastState(lobbyState);
};

export const createLobbyDefinition = {
  event: EVENTS.CREATE,
  schema,
  useRateLimit: true,
  handler: handleCreateLobby,
} as const;
