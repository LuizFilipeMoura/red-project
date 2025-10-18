import { EVENTS, MANA_PER_TURN, schemas } from '@repo/shared';
import type { z } from 'zod';
import type { EventHandler, HandlerContext } from '../../types.js';
import { ApplicationError } from '../../errors.js';
import { getPlayerOrder } from '../../../game/rules.js';
import type { LobbyState } from '../../../state.js';

const schema = schemas[EVENTS.GAME_END_TURN];

type EndTurnInput = z.infer<typeof schema>;

type ActiveMatch = NonNullable<LobbyState['match']>;

type EndTurnContextData = {
  lobby: LobbyState;
  match: ActiveMatch;
  nextPlayer: string;
  release: () => void;
};

type EndTurnContext = HandlerContext & { [endTurnContextKey]?: EndTurnContextData };

const endTurnContextKey = Symbol('endTurnContext');

const setEndTurnContext = (context: HandlerContext, data: EndTurnContextData) => {
  (context as EndTurnContext)[endTurnContextKey] = data;
};

const getEndTurnContext = (context: HandlerContext) => {
  const data = (context as EndTurnContext)[endTurnContextKey];
  if (!data) {
    throw new ApplicationError('PREPROCESS_REQUIRED', 'Missing end turn pre-processing context');
  }
  return data;
};

const clearEndTurnContext = (context: HandlerContext) => {
  delete (context as EndTurnContext)[endTurnContextKey];
};

export const preProcessEndTurn = async (context: HandlerContext, input: EndTurnInput) => {
  const lobby = context.store.get(input.lobbyId);
  if (!lobby) {
    throw new ApplicationError('NOT_FOUND', 'Lobby not found');
  }

  const release = await lobby.mutex.acquire();
  try {
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

    setEndTurnContext(context, { lobby, match, nextPlayer: next, release });
  } catch (error) {
    release();
    throw error;
  }
};

export const handleEndTurn: EventHandler<EndTurnInput> = async (context, input) => {
  const { lobby, match, nextPlayer, release } = getEndTurnContext(context);
  const current = context.sid;
  try {
    match.mana[current] = 0;
    match.mana[nextPlayer] = MANA_PER_TURN;
    match.turnNumber += 1;
    match.currentPlayerSid = nextPlayer;
    lobby.currentPlayerSid = nextPlayer;
    lobby.turnNumber = match.turnNumber;

    await context.broadcastState(lobby, { type: EVENTS.GAME_END_TURN, payload: input });
  } finally {
    release();
    clearEndTurnContext(context);
  }
};

export const endTurnDefinition = {
  event: EVENTS.GAME_END_TURN,
  schema,
  useRateLimit: true,
  preProcess: preProcessEndTurn,
  handler: handleEndTurn,
};
