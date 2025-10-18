import { EVENTS, LOBBY_CAPACITY, schemas } from '@repo/shared';
import type { z } from 'zod';
import { ApplicationError } from '../../errors.js';
import type { EventHandler, HandlerContext } from '../../types.js';
import { initializeMatchState, type LobbyState } from '../../../state.js';
import { createInitialDecks, startTurnForPlayer } from '../../../game/cards.js';

const schema = schemas[EVENTS.START];

type StartLobbyInput = z.infer<typeof schema>;

type StartLobbyContextData = {
  lobby: LobbyState;
  release: () => void;
};

type StartLobbyContext = HandlerContext & { [startLobbyContextKey]?: StartLobbyContextData };

const startLobbyContextKey = Symbol('startLobbyContext');

const setStartLobbyContext = (context: HandlerContext, data: StartLobbyContextData) => {
  (context as StartLobbyContext)[startLobbyContextKey] = data;
};

const getStartLobbyContext = (context: HandlerContext) => {
  const data = (context as StartLobbyContext)[startLobbyContextKey];
  if (!data) {
    throw new ApplicationError('PREPROCESS_REQUIRED', 'Missing start lobby pre-processing context');
  }
  return data;
};

const clearStartLobbyContext = (context: HandlerContext) => {
  delete (context as StartLobbyContext)[startLobbyContextKey];
};

export const preProcessStartLobby = async (context: HandlerContext, input: StartLobbyInput) => {
  const lobby = context.store.get(input.lobbyId);
  if (!lobby) {
    throw new ApplicationError('NOT_FOUND', 'Lobby not found');
  }

  const release = await lobby.mutex.acquire();
  try {
    if (lobby.players.length < LOBBY_CAPACITY) {
      throw new ApplicationError('NOT_READY', 'Need 2 players to start');
    }

    setStartLobbyContext(context, { lobby, release });
  } catch (error) {
    release();
    throw error;
  }
};

export const handleStartLobby: EventHandler<StartLobbyInput> = async (context, input) => {
  const { lobby, release } = getStartLobbyContext(context);

  try {

    lobby.meta.status = 'started';
    if (!lobby.currentPlayerSid) {
      lobby.currentPlayerSid = lobby.players[0]?.sid ?? null;
    }
    if (!lobby.match && lobby.players.length === LOBBY_CAPACITY) {
      const first = lobby.currentPlayerSid ?? lobby.players[0]!.sid;
      const second = lobby.players.find((player) => player.sid !== first)?.sid ?? lobby.players[0]!.sid;
      const { cards, decks } = createInitialDecks([first, second]);
      lobby.match = initializeMatchState(lobby, [first, second]);
      lobby.match.cards = cards;
      lobby.match.decks = decks;
      lobby.match.talentsInHand = { [first]: [], [second]: [] };
      lobby.match.mana[first] = 0;
      lobby.match.mana[second] = 0;
      startTurnForPlayer(lobby.match, first);
      lobby.turnNumber = lobby.match.turnNumber;
      lobby.currentPlayerSid = lobby.match.currentPlayerSid;
    }

    await context.db.lobby.update({
      where: { id: lobby.meta.id },
      data: { status: lobby.meta.status },
    });

    await context.broadcastState(lobby);
  } finally {
    release();
    clearStartLobbyContext(context);
  }
};

export const startLobbyDefinition = {
  event: EVENTS.START,
  schema,
  useRateLimit: true,
  preProcess: preProcessStartLobby,
  handler: handleStartLobby,
} as const;
