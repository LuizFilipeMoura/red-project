import { eq } from 'drizzle-orm';
import { EVENTS, LOBBY_CAPACITY, schemas } from '@repo/shared';
import type { z } from 'zod';
import { lobbies as lobbiesTable } from '@repo/db';
import { ApplicationError } from '../errors.js';
import type { EventHandler } from '../types.js';
import { initializeMatchState } from '../../state.js';

const schema = schemas[EVENTS.START];

type StartLobbyInput = z.infer<typeof schema>;

export const handleStartLobby: EventHandler<StartLobbyInput> = async (context, input) => {
  const lobby = context.store.get(input.lobbyId);
  if (!lobby) {
    throw new ApplicationError('NOT_FOUND', 'Lobby not found');
  }

  await lobby.mutex.runExclusive(async () => {
    if (lobby.players.length < LOBBY_CAPACITY) {
      throw new ApplicationError('NOT_READY', 'Need 2 players to start');
    }

    lobby.meta.status = 'started';
    if (!lobby.currentPlayerSid) {
      lobby.currentPlayerSid = lobby.players[0]?.sid ?? null;
    }
    if (!lobby.match && lobby.players.length === LOBBY_CAPACITY) {
      const first = lobby.currentPlayerSid ?? lobby.players[0]!.sid;
      const second = lobby.players.find((player) => player.sid !== first)?.sid ?? lobby.players[0]!.sid;
      lobby.match = initializeMatchState(lobby, [first, second]);
      lobby.turnNumber = lobby.match.turnNumber;
      lobby.currentPlayerSid = lobby.match.currentPlayerSid;
    }

    await context.db
      .update(lobbiesTable)
      .set({ status: lobby.meta.status })
      .where(eq(lobbiesTable.id, lobby.meta.id))
      .run();

    await context.broadcastState(lobby);
  });
};

export const startLobbyDefinition = {
  event: EVENTS.START,
  schema,
  useRateLimit: true,
  handler: handleStartLobby,
} as const;
