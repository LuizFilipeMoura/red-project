import { EVENTS, LOBBY_CAPACITY, schemas } from '@repo/shared';
import type { z } from 'zod';
import { ApplicationError } from '../errors.js';
import type { EventHandler } from '../types.js';

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

    await context.db.lobby.update({
      where: { id: lobby.meta.id },
      data: { status: lobby.meta.status },
    });

    context.scheduleTurnTimeout(lobby);
    await context.broadcastState(lobby);
  });
};

export const startLobbyDefinition = {
  event: EVENTS.START,
  schema,
  useRateLimit: true,
  handler: handleStartLobby,
} as const;
