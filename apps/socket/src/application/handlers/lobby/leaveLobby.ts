import { EVENTS, LOBBY_CAPACITY, schemas } from '@repo/shared';
import type { z } from 'zod';
import type { EventHandler, HandlerContext } from '../../types.js';
import { ApplicationError } from '../../errors.js';
import type { LobbyState } from '../../../state.js';

const schema = schemas[EVENTS.LEAVE];

type LeaveLobbyInput = z.infer<typeof schema>;

type LeaveLobbyContextData = {
  lobby: LobbyState;
  playerIndex: number;
  release: () => void;
};

type LeaveLobbyContext = HandlerContext & { [leaveLobbyContextKey]?: LeaveLobbyContextData };

const leaveLobbyContextKey = Symbol('leaveLobbyContext');

const setLeaveLobbyContext = (context: HandlerContext, data: LeaveLobbyContextData) => {
  (context as LeaveLobbyContext)[leaveLobbyContextKey] = data;
};

const getLeaveLobbyContext = (context: HandlerContext) => {
  const data = (context as LeaveLobbyContext)[leaveLobbyContextKey];
  if (!data) {
    throw new ApplicationError('PREPROCESS_REQUIRED', 'Missing leave lobby pre-processing context');
  }
  return data;
};

const clearLeaveLobbyContext = (context: HandlerContext) => {
  delete (context as LeaveLobbyContext)[leaveLobbyContextKey];
};

export const preProcessLeaveLobby = async (context: HandlerContext, input: LeaveLobbyInput) => {
  const lobby = context.store.get(input.lobbyId);
  if (!lobby) {
    throw new ApplicationError('NOT_FOUND', 'Lobby not found');
  }

  const release = await lobby.mutex.acquire();
  try {
    const playerIndex = lobby.players.findIndex((player) => player.sid === context.sid);
    if (playerIndex < 0) {
      throw new ApplicationError('NOT_IN_LOBBY', 'You are not in this lobby');
    }

    setLeaveLobbyContext(context, { lobby, playerIndex, release });
  } catch (error) {
    release();
    throw error;
  }
};

export const handleLeaveLobby: EventHandler<LeaveLobbyInput> = async (context, input) => {
  const { lobby, playerIndex, release } = getLeaveLobbyContext(context);

  try {
    lobby.players.splice(playerIndex, 1);
    await context.db.player.deleteMany({
      where: { lobbyId: lobby.meta.id, sid: context.sid },
    });

    await context.leaveLobbyRoom(lobby.meta.id);

    if (lobby.players.length === 0) {
      context.clearLobbyTimeout(lobby.meta.id);
      lobby.currentPlayerSid = null;
      lobby.turnNumber = 0;
      lobby.deadlineAt = null;
      lobby.match = null;
      await context.db.match.deleteMany({ where: { id: lobby.meta.id } });
    } else if (lobby.players.length < LOBBY_CAPACITY) {
      lobby.match = null;
      lobby.currentPlayerSid = lobby.players[0]?.sid ?? null;
      lobby.turnNumber = lobby.currentPlayerSid ? 1 : 0;
    }

    lobby.meta.status = 'waiting';
    await context.db.lobby.update({
      where: { id: lobby.meta.id },
      data: { status: lobby.meta.status },
    });

    if (lobby.currentPlayerSid === context.sid) {
      lobby.currentPlayerSid = lobby.players[0]?.sid ?? null;
      lobby.turnNumber = lobby.currentPlayerSid ? 1 : 0;
    }

    await context.broadcastState(lobby);
  } finally {
    release();
    clearLeaveLobbyContext(context);
  }
};

export const leaveLobbyDefinition = {
  event: EVENTS.LEAVE,
  schema,
  useRateLimit: true,
  preProcess: preProcessLeaveLobby,
  handler: handleLeaveLobby,
} as const;
