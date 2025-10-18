import { EVENTS, schemas } from '@repo/shared';
import type { z } from 'zod';
import { ApplicationError } from '../errors.js';
import type { EventHandler, HandlerContext } from '../types.js';
import { handleEndTurn, preProcessEndTurn } from './game/endTurn.js';

const schema = schemas[EVENTS.TURN_PASS];

type PassTurnInput = z.infer<typeof schema>;

const preProcessPassTurn = async (context: HandlerContext, input: PassTurnInput) => {
  const lobby = context.store.get(input.lobbyId);
  if (!lobby) {
    throw new ApplicationError('NOT_FOUND', 'Lobby not found');
  }

  const player = lobby.players.find((p) => p.sid === context.sid);
  if (!player) {
    throw new ApplicationError('FORBIDDEN', 'You are not in this lobby');
  }
};

export const handlePassTurn: EventHandler<PassTurnInput> = async (context, input) => {
  await preProcessEndTurn(context, input);
  await handleEndTurn(context, input);
};

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
