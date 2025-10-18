import { EVENTS, schemas } from '@repo/shared';
import type { z } from 'zod';
import { ApplicationError } from '../errors.js';
import type { EventHandler, HandlerContext } from '../types.js';

const schema = schemas[EVENTS.TURN_PASS];

type PassTurnInput = z.infer<typeof schema>;

// Pre-process: Validate lobby exists and player is in the lobby
const preProcessPassTurn = async (context: HandlerContext, input: PassTurnInput) => {
  const lobby = context.store.get(input.lobbyId);
  if (!lobby) {
    throw new ApplicationError('NOT_FOUND', 'Lobby not found');
  }

  const player = lobby.players.find((p) => p.sid === context.sid);
  if (!player) {
    throw new ApplicationError('FORBIDDEN', 'You are not in this lobby');
  }

  context.logger.info({ lobbyId: input.lobbyId, sid: context.sid }, 'Pre-processing pass turn');
};

// Main handler: Execute the turn pass logic
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
    if (!other) {
      throw new ApplicationError('INVALID_STATE', 'No other player found');
    }

    lobby.currentPlayerSid = other.sid;
    lobby.turnNumber += 1;
    context.scheduleTurnTimeout(lobby);
    await context.broadcastState(lobby);
  });
};

// Post-process: Log turn completion
const postProcessPassTurn = async (context: HandlerContext, input: PassTurnInput) => {
  const lobby = context.store.get(input.lobbyId);
  if (lobby) {
    context.logger.info(
      {
        lobbyId: input.lobbyId,
        turnNumber: lobby.turnNumber,
        currentPlayer: lobby.currentPlayerSid,
      },
      'Turn passed successfully',
    );
  }
};

export const passTurnDefinition = {
  event: EVENTS.TURN_PASS,
  schema,
  useRateLimit: true,
  preProcess: preProcessPassTurn,
  handler: handlePassTurn,
  postProcess: postProcessPassTurn,
} as const;
