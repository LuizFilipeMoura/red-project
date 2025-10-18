import { EVENTS, LOBBY_CAPACITY, schemas } from '@repo/shared';
import type { z } from 'zod';
import { ApplicationError } from '../errors.js';
import type { EventHandler } from '../types.js';
import { verifyPassword } from '../../security.js';
import type { PlayerState } from '../../state.js';

const schema = schemas[EVENTS.JOIN];

type JoinLobbyInput = z.infer<typeof schema>;

export const handleJoinLobby: EventHandler<JoinLobbyInput> = async (context, input) => {
  const lobby = context.store.get(input.lobbyId);
  if (!lobby) {
    throw new ApplicationError('NOT_FOUND', 'Lobby not found');
  }

  await lobby.mutex.runExclusive(async () => {
    if (lobby.players.some((player) => player.sid === context.sid)) {
      await context.joinLobbyRoom(lobby.meta.id);
      return;
    }

    if (lobby.players.length >= LOBBY_CAPACITY) {
      throw new ApplicationError('FULL', 'Lobby is full');
    }

    if (!verifyPassword(lobby.meta.passwordHash ?? null, input.password)) {
      throw new ApplicationError('PASSWORD', 'Invalid password');
    }

    const playerInsert = {
      lobbyId: lobby.meta.id,
      sid: context.sid,
      joinedAt: new Date(),
      isReady: false,
    };

    const inserted = await context.db.player.create({ data: playerInsert });
    const playerState: PlayerState = {
      lobbyId: playerInsert.lobbyId,
      sid: playerInsert.sid,
      joinedAt: playerInsert.joinedAt.getTime(),
      isReady: playerInsert.isReady,
      id: inserted.id,
    };

    lobby.players.push(playerState);
    await context.joinLobbyRoom(lobby.meta.id);

    if (lobby.players.length === LOBBY_CAPACITY) {
      const first = lobby.players[Math.floor(Math.random() * lobby.players.length)];
      lobby.currentPlayerSid = first.sid;
      lobby.turnNumber = 1;
      lobby.meta.status = 'started';
      await context.db.lobby.update({
        where: { id: lobby.meta.id },
        data: { status: lobby.meta.status },
      });
      context.scheduleTurnTimeout(lobby);
    }

    await context.broadcastState(lobby);
  });
};

export const joinLobbyDefinition = {
  event: EVENTS.JOIN,
  schema,
  useRateLimit: true,
  handler: handleJoinLobby,
} as const;
