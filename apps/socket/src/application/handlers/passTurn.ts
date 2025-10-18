import { EVENTS, schemas } from '@repo/shared';
import type { z } from 'zod';
import { ApplicationError } from '../errors.js';
import type { EventHandler } from '../types.js';

const schema = schemas[EVENTS.TURN_PASS];

type PassTurnInput = z.infer<typeof schema>;

export const handlePassTurn: EventHandler<PassTurnInput> = async (context, input) => {
  const lobby = context.store.get(input.lobbyId);
  if (!lobby) {
    throw new ApplicationError('NOT_FOUND', 'Lobby not found');
  }

  await lobby.mutex.runExclusive(async () => {
    if (lobby.currentPlayerSid !== context.sid) {
      throw new ApplicationError('TURN', 'Not your turn');
    }

    const other = lobby.players.find((player) => player.sid !== context.sid);
    if (!other) return;

    lobby.currentPlayerSid = other.sid;
    lobby.turnNumber += 1;
    context.scheduleTurnTimeout(lobby);
    await context.broadcastState(lobby);
  });
};

export const passTurnDefinition = {
  event: EVENTS.TURN_PASS,
  schema,
  useRateLimit: true,
  handler: handlePassTurn,
} as const;
