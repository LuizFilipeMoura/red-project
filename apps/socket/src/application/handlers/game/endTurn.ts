import { EVENTS, MANA_PER_TURN, schemas } from '@repo/shared';
import type { z } from 'zod';
import type { EventHandler } from '../../types.js';
import { ApplicationError } from '../../errors.js';
import { getPlayerOrder } from '../../../game/rules.js';

const schema = schemas[EVENTS.GAME_END_TURN];

type EndTurnInput = z.infer<typeof schema>;

export const handleEndTurn: EventHandler<EndTurnInput> = async (context, input) => {
  const lobby = context.store.get(input.lobbyId);
  if (!lobby) {
    throw new ApplicationError('NOT_FOUND', 'Lobby not found');
  }

  await lobby.mutex.runExclusive(async () => {
    const match = lobby.match;
    if (!match) {
      throw new ApplicationError('MATCH_NOT_READY', 'Match not initialized');
    }
    if (match.winnerSid) {
      throw new ApplicationError('GAME_OVER', 'Match already finished');
    }
    if (lobby.currentPlayerSid !== context.sid) {
      throw new ApplicationError('NOT_YOUR_TURN', 'It is not your turn');
    }

    const order = getPlayerOrder(lobby);
    if (!order) {
      throw new ApplicationError('INVALID_STATE', 'Match requires two players');
    }

    const current = context.sid;
    const next = order.find((sid) => sid !== current);
    if (!next) {
      throw new ApplicationError('INVALID_STATE', 'No opponent found');
    }

    match.mana[current] = 0;
    match.mana[next] = MANA_PER_TURN;
    match.turnNumber += 1;
    match.currentPlayerSid = next;
    lobby.currentPlayerSid = next;
    lobby.turnNumber = match.turnNumber;

    await context.broadcastState(lobby, { type: EVENTS.GAME_END_TURN, payload: input });
  });
};

export const endTurnDefinition = {
  event: EVENTS.GAME_END_TURN,
  schema,
  useRateLimit: true,
  handler: handleEndTurn,
} as const;
